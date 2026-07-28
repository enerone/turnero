import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

const calendarSpy = {
  insert: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('@/lib/calendar/google-client', async () => {
  const mod = await vi.importActual<typeof import('@/lib/calendar/google-client')>(
    '@/lib/calendar/google-client',
  )
  return {
    ...mod,
    obtenerIntegracionCalendar: async () => ({
      id: '00000000-0000-0000-0000-000000000000',
      cuenta_id: currentCuentaId,
      refresh_token_cifrado: Buffer.alloc(0),
      calendar_id_dedicado: currentCalendarId,
      calendar_id_primario: 'primary',
      estado: 'conectado' as const,
    }),
    obtenerCalendarClient: async () => ({
      events: {
        insert: (...args: unknown[]) => calendarSpy.insert(...args),
        patch: (...args: unknown[]) => calendarSpy.patch(...args),
        delete: (...args: unknown[]) => calendarSpy.delete(...args),
      },
    }),
  }
})

let currentCuentaId = ''
let currentCalendarId: string | null = 'cal_dedicado_test'

describe('sync-turno-google handler', () => {
  useTestDatabase()

  beforeEach(() => {
    calendarSpy.insert.mockReset()
    calendarSpy.patch.mockReset()
    calendarSpy.delete.mockReset()
    currentCalendarId = 'cal_dedicado_test'
  })

  async function crearTurnoConfirmado() {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)
    const cliente = await testPrisma.cliente.create({
      data: { cuentaId: cuenta.id, nombre: 'Ana', telefono: '+5491100000001' },
    })
    const turno = await testPrisma.turno.create({
      data: {
        cuentaId: cuenta.id,
        clienteId: cliente.id,
        servicioId: servicio.id,
        inicio: new Date('2028-01-15T14:00:00Z'),
        fin: new Date('2028-01-15T14:30:00Z'),
        estado: 'confirmado',
      },
    })
    return { cuenta, turno }
  }

  it('upsert inserta el evento cuando el turno no tiene googleEventId', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    calendarSpy.insert.mockResolvedValue({ data: { id: 'gcal_evt_1', etag: '"abc"' } })

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'upsert' })

    expect(calendarSpy.insert).toHaveBeenCalledTimes(1)
    const call = calendarSpy.insert.mock.calls[0][0] as { calendarId: string; requestBody: { summary: string } }
    expect(call.calendarId).toBe('cal_dedicado_test')
    expect(call.requestBody.summary).toContain('Ana')

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.googleEventId).toBe('gcal_evt_1')
    expect(actualizado?.googleEventEtag).toBe('"abc"')
  })

  it('upsert hace patch cuando el turno ya tiene googleEventId', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: 'gcal_evt_existente', googleEventEtag: '"v1"' },
    })
    calendarSpy.patch.mockResolvedValue({ data: { id: 'gcal_evt_existente', etag: '"v2"' } })

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'upsert' })

    expect(calendarSpy.patch).toHaveBeenCalledTimes(1)
    expect(calendarSpy.insert).not.toHaveBeenCalled()
    const call = calendarSpy.patch.mock.calls[0][0] as { ifMatch: string }
    expect(call.ifMatch).toBe('"v1"')

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.googleEventEtag).toBe('"v2"')
  })

  it('upsert con 412 (Google tiene versión más nueva) NO pisa el turno local', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: 'gcal_evt_x', googleEventEtag: '"vieja"' },
    })
    const err: Error & { code?: number } = new Error('Precondition Failed')
    err.code = 412
    calendarSpy.patch.mockRejectedValue(err)

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await expect(
      handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'upsert' }),
    ).resolves.toBeUndefined()

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.googleEventEtag).toBe('"vieja"') // no cambió
  })

  it('upsert con 404 en patch limpia IDs y re-inserta', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: 'gcal_evt_borrado', googleEventEtag: '"x"' },
    })
    const err404: Error & { code?: number } = new Error('Not Found')
    err404.code = 404
    calendarSpy.patch.mockRejectedValue(err404)
    calendarSpy.insert.mockResolvedValue({ data: { id: 'gcal_evt_nuevo', etag: '"y"' } })

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'upsert' })

    expect(calendarSpy.insert).toHaveBeenCalledTimes(1)
    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.googleEventId).toBe('gcal_evt_nuevo')
  })

  it('delete borra el evento y limpia IDs', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: 'gcal_evt_1', googleEventEtag: '"a"', estado: 'cancelado' },
    })
    calendarSpy.delete.mockResolvedValue({ data: {} })

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'delete' })

    expect(calendarSpy.delete).toHaveBeenCalledWith({ calendarId: 'cal_dedicado_test', eventId: 'gcal_evt_1' })
    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.googleEventId).toBeNull()
    expect(actualizado?.googleEventEtag).toBeNull()
  })

  it('delete con 404 es idempotente', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: 'gcal_evt_fantasma' },
    })
    const err: Error & { code?: number } = new Error('Not Found')
    err.code = 404
    calendarSpy.delete.mockRejectedValue(err)

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await expect(
      handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'delete' }),
    ).resolves.toBeUndefined()
  })

  it('skip cuando calendar_id_dedicado es null (bootstrap incompleto)', async () => {
    const { cuenta, turno } = await crearTurnoConfirmado()
    currentCalendarId = null

    const { handlerSyncTurnoGoogle } = await import('@/lib/jobs/handlers/sync-turno-google')
    await handlerSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: turno.id, operacion: 'upsert' })

    expect(calendarSpy.insert).not.toHaveBeenCalled()
    expect(calendarSpy.patch).not.toHaveBeenCalled()
  })
})
