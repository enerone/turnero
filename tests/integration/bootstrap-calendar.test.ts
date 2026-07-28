import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'

const listMock = vi.fn()
const insertMock = vi.fn()

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    calendar: vi.fn().mockImplementation(() => ({
      calendarList: { list: listMock },
      calendars: { insert: insertMock },
    })),
  },
}))

import { handlerBootstrapCalendar } from '@/lib/jobs/handlers/bootstrap-calendar'

describe('handlerBootstrapCalendar', () => {
  useTestDatabase()

  beforeEach(() => {
    listMock.mockReset()
    insertMock.mockReset()
  })

  async function crearIntegracion(cuentaId: string, calendarIdDedicado: string | null = null) {
    const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')
    const llave = await derivarLlavePorCuenta(master, cuentaId)
    const cifrado = await cifrar('refresh-de-test', new Uint8Array(llave))
    return basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
      return tx.integracionCalendar.create({
        data: {
          cuentaId,
          refreshTokenCifrado: Buffer.from(cifrado),
          calendarIdDedicado,
          calendarIdPrimario: 'primary',
        },
      })
    })
  }

  it('crea calendario dedicado y guarda el ID', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id)

    listMock.mockResolvedValue({ data: { items: [] } })
    insertMock.mockResolvedValue({ data: { id: 'cal-nuevo-123' } })

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(insertMock).toHaveBeenCalledOnce()
    expect(insertMock).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({ summary: 'Turnero' }),
    })

    const integracion = await basePrisma.$queryRaw<Array<{ calendar_id_dedicado: string }>>`
      SELECT calendar_id_dedicado FROM lookup_integracion_calendar(${cuenta.id}::uuid)
    `
    expect(integracion[0].calendar_id_dedicado).toBe('cal-nuevo-123')
  })

  it('es idempotente: si calendar_id_dedicado ya existe, no llama a Google', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id, 'cal-ya-existe')

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(listMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('reusa calendario existente si aparece en calendarList (retry recovery)', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id)

    listMock.mockResolvedValue({
      data: { items: [{ id: 'cal-preexistente-777', summary: 'Turnero' }] },
    })

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(insertMock).not.toHaveBeenCalled()
    const integracion = await basePrisma.$queryRaw<Array<{ calendar_id_dedicado: string }>>`
      SELECT calendar_id_dedicado FROM lookup_integracion_calendar(${cuenta.id}::uuid)
    `
    expect(integracion[0].calendar_id_dedicado).toBe('cal-preexistente-777')
  })

  it('falla explícito si no hay IntegracionCalendar', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)

    await expect(handlerBootstrapCalendar({ cuentaId: cuenta.id })).rejects.toThrow(
      /IntegracionCalendar/,
    )
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })
})
