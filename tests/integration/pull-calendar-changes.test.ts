import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

const listSpy = vi.fn()

let currentCuentaId = ''
let currentCalendarIdDedicado: string | null = 'cal_dedicado'
let currentCalendarIdPrimario = 'primary'
let currentSyncTokenDedicado: string | null = null
let currentSyncTokenPrimario: string | null = null

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
      calendar_id_dedicado: currentCalendarIdDedicado,
      calendar_id_primario: currentCalendarIdPrimario,
      estado: 'conectado' as const,
      sync_token_dedicado: currentSyncTokenDedicado,
      sync_token_primario: currentSyncTokenPrimario,
      watch_channel_dedicado_id: null,
      watch_channel_dedicado_resource_id: null,
      watch_channel_dedicado_token: null,
      watch_channel_dedicado_expira: null,
      watch_channel_primario_id: null,
      watch_channel_primario_resource_id: null,
      watch_channel_primario_token: null,
      watch_channel_primario_expira: null,
    }),
    obtenerCalendarClient: async () => ({
      events: {
        list: (...args: unknown[]) => listSpy(...args),
      },
    }),
  }
})

describe('pull-calendar-changes handler', () => {
  useTestDatabase()

  beforeEach(async () => {
    listSpy.mockReset()
    currentCalendarIdDedicado = 'cal_dedicado'
    currentSyncTokenDedicado = null
    currentSyncTokenPrimario = null
    // La integración se necesita para el UPDATE final del sync_token —
    // creamos una real por cuenta en cada test.
  })

  it('primario: crea EventoExterno cuando aparece un bloqueo nuevo', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdPrimario: 'primary',
      },
    })

    listSpy.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt_bloqueo_1',
            status: 'confirmed',
            summary: 'Almuerzo',
            start: { dateTime: '2028-02-01T13:00:00Z' },
            end: { dateTime: '2028-02-01T14:00:00Z' },
          },
        ],
        nextSyncToken: 'sync_v2',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'primario' })

    const eventos = await testPrisma.eventoExterno.findMany({ where: { cuentaId: cuenta.id } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0].googleEventId).toBe('evt_bloqueo_1')
    expect(eventos[0].titulo).toBe('Almuerzo')

    const integ = await testPrisma.integracionCalendar.findUnique({ where: { cuentaId: cuenta.id } })
    expect(integ?.syncTokenPrimario).toBe('sync_v2')
  })

  it('primario: elimina EventoExterno cuando el evento se cancela en Google', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdPrimario: 'primary',
      },
    })
    await testPrisma.eventoExterno.create({
      data: {
        cuentaId: cuenta.id,
        googleEventId: 'evt_bloqueo_x',
        inicio: new Date('2028-02-01T13:00:00Z'),
        fin: new Date('2028-02-01T14:00:00Z'),
      },
    })

    listSpy.mockResolvedValue({
      data: {
        items: [{ id: 'evt_bloqueo_x', status: 'cancelled' }],
        nextSyncToken: 'sync_v3',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'primario' })

    const eventos = await testPrisma.eventoExterno.findMany({ where: { cuentaId: cuenta.id } })
    expect(eventos).toHaveLength(0)
  })

  it('dedicado: cancela el turno cuando Google marca el evento como cancelled', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdDedicado: 'cal_dedicado',
        calendarIdPrimario: 'primary',
      },
    })
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)
    const cliente = await testPrisma.cliente.create({
      data: { cuentaId: cuenta.id, nombre: 'X', telefono: '+5491100000000' },
    })
    const turno = await testPrisma.turno.create({
      data: {
        cuentaId: cuenta.id,
        clienteId: cliente.id,
        servicioId: servicio.id,
        inicio: new Date('2028-02-05T10:00:00Z'),
        fin: new Date('2028-02-05T10:30:00Z'),
        estado: 'confirmado',
        googleEventId: 'evt_turno_1',
        googleEventEtag: '"v1"',
      },
    })

    listSpy.mockResolvedValue({
      data: {
        items: [{ id: 'evt_turno_1', status: 'cancelled', etag: '"v2"' }],
        nextSyncToken: 'sync_dedicado_v1',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'dedicado' })

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.estado).toBe('cancelado')
    expect(actualizado?.origenCancelacion).toBe('google_calendar')
  })

  it('dedicado: aplica cambio de horario y resetea flag de recordatorio', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdDedicado: 'cal_dedicado',
        calendarIdPrimario: 'primary',
      },
    })
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)
    const cliente = await testPrisma.cliente.create({
      data: { cuentaId: cuenta.id, nombre: 'X', telefono: '+5491100000001' },
    })
    const turno = await testPrisma.turno.create({
      data: {
        cuentaId: cuenta.id,
        clienteId: cliente.id,
        servicioId: servicio.id,
        inicio: new Date('2028-02-05T10:00:00Z'),
        fin: new Date('2028-02-05T10:30:00Z'),
        estado: 'confirmado',
        googleEventId: 'evt_turno_move',
        googleEventEtag: '"v1"',
        recordatorioEnviadoEn: new Date(),
      },
    })

    listSpy.mockResolvedValue({
      data: {
        items: [{
          id: 'evt_turno_move',
          status: 'confirmed',
          etag: '"v2"',
          start: { dateTime: '2028-02-05T11:00:00Z' },
          end: { dateTime: '2028-02-05T11:30:00Z' },
        }],
        nextSyncToken: 'sync_dedicado_v2',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'dedicado' })

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.inicio.toISOString()).toBe('2028-02-05T11:00:00.000Z')
    expect(actualizado?.recordatorioEnviadoEn).toBeNull()
    expect(actualizado?.googleEventEtag).toBe('"v2"')
  })

  it('regla #4: evento nuevo creado en el dedicado desde Google → EventoExterno', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdDedicado: 'cal_dedicado',
        calendarIdPrimario: 'primary',
      },
    })

    listSpy.mockResolvedValue({
      data: {
        items: [{
          id: 'evt_manual_google',
          status: 'confirmed',
          etag: '"v1"',
          summary: 'Reunión con proveedor',
          start: { dateTime: '2028-02-10T15:00:00Z' },
          end: { dateTime: '2028-02-10T16:00:00Z' },
        }],
        nextSyncToken: 'sync_x',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'dedicado' })

    // No se debe crear un turno
    const turnos = await testPrisma.turno.findMany({ where: { cuentaId: cuenta.id } })
    expect(turnos).toHaveLength(0)

    // Sí se debe crear un EventoExterno para bloquear el slot
    const bloqueos = await testPrisma.eventoExterno.findMany({ where: { cuentaId: cuenta.id } })
    expect(bloqueos).toHaveLength(1)
    expect(bloqueos[0].googleEventId).toBe('evt_manual_google')
    expect(bloqueos[0].titulo).toBe('Reunión con proveedor')
  })

  it('idempotente: mismo etag no dispara update', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentCuentaId = cuenta.id
    await testPrisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.alloc(0),
        calendarIdDedicado: 'cal_dedicado',
        calendarIdPrimario: 'primary',
      },
    })
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)
    const cliente = await testPrisma.cliente.create({
      data: { cuentaId: cuenta.id, nombre: 'X', telefono: '+5491100000002' },
    })
    const turno = await testPrisma.turno.create({
      data: {
        cuentaId: cuenta.id,
        clienteId: cliente.id,
        servicioId: servicio.id,
        inicio: new Date('2028-02-05T10:00:00Z'),
        fin: new Date('2028-02-05T10:30:00Z'),
        estado: 'confirmado',
        googleEventId: 'evt_iden',
        googleEventEtag: '"same"',
      },
    })
    const updatedAtInicial = turno.updatedAt

    listSpy.mockResolvedValue({
      data: {
        items: [{
          id: 'evt_iden',
          status: 'confirmed',
          etag: '"same"',
          start: { dateTime: '2028-02-05T10:00:00Z' },
          end: { dateTime: '2028-02-05T10:30:00Z' },
        }],
        nextSyncToken: 'x',
      },
    })

    const { handlerPullCalendarChanges } = await import('@/lib/jobs/handlers/pull-calendar-changes')
    await handlerPullCalendarChanges({ cuentaId: cuenta.id, tipo: 'dedicado' })

    const despues = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(despues?.updatedAt.getTime()).toBe(updatedAtInicial.getTime())
  })
})
