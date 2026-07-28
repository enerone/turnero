import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moverTurno } from '@/app/[slug]/semana/actions'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

let currentSlug = ''
let currentUser: {
  id: string
  cuentaId: string
  rol: 'owner' | 'secretaria'
} | null = null

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (n: string) => (n === 'x-tenant-slug' ? currentSlug : null),
  }),
  cookies: async () => ({ get: () => null, set: () => {} }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => currentUser
    ? { session: { id: 'sess', userId: currentUser.id, expiresAt: new Date(Date.now() + 3600_000), fresh: false }, user: currentUser }
    : null,
}))

const enqueueSpy = vi.fn().mockResolvedValue('job-id')
vi.mock('@/lib/jobs/enqueue', () => ({
  enqueueSyncTurnoGoogle: (...args: unknown[]) => enqueueSpy(...args),
}))

async function crearContexto() {
  const cuenta = await crearCuentaFixture(testPrisma)
  currentSlug = cuenta.slug
  const usuario = await testPrisma.usuario.create({
    data: {
      cuentaId: cuenta.id,
      email: 'owner@x.com',
      nombre: 'Owner',
      googleSub: `sub-${cuenta.id}`,
      rol: 'owner',
    },
  })
  currentUser = { id: usuario.id, cuentaId: cuenta.id, rol: 'owner' }
  const servicio = await crearServicioFixture(testPrisma, cuenta.id, { duracionMinutos: 30 })
  const cliente = await testPrisma.cliente.create({
    data: { cuentaId: cuenta.id, nombre: 'Ana', telefono: '+5491100000000' },
  })
  const turno = await testPrisma.turno.create({
    data: {
      cuentaId: cuenta.id,
      clienteId: cliente.id,
      servicioId: servicio.id,
      inicio: new Date('2028-06-01T14:00:00Z'),
      fin: new Date('2028-06-01T14:30:00Z'),
      estado: 'confirmado',
      googleEventId: 'gcal_x',
      recordatorioEnviadoEn: new Date(),
    },
  })
  return { cuenta, servicio, turno, cliente }
}

describe('moverTurno (server action)', () => {
  useTestDatabase()

  beforeEach(() => {
    enqueueSpy.mockClear()
    currentUser = null
    currentSlug = ''
  })

  it('mueve turno preservando duración, resetea recordatorio y encola sync', async () => {
    const { cuenta, turno } = await crearContexto()

    const nuevoInicio = '2028-06-01T16:00:00Z'
    const res = await moverTurno({ turnoId: turno.id, nuevoInicio })

    expect(res.ok).toBe(true)
    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.inicio.toISOString()).toBe('2028-06-01T16:00:00.000Z')
    expect(actualizado?.fin.toISOString()).toBe('2028-06-01T16:30:00.000Z')
    expect(actualizado?.recordatorioEnviadoEn).toBeNull()

    const audit = await testPrisma.auditLog.findMany({ where: { cuentaId: cuenta.id } })
    expect(audit).toHaveLength(1)
    expect(audit[0].accion).toBe('turno_movido')
    expect((audit[0].payload as any).origen).toBe('panel')

    expect(enqueueSpy).toHaveBeenCalledWith({
      cuentaId: cuenta.id,
      turnoId: turno.id,
      operacion: 'upsert',
    })
  })

  it('rechaza 409 cuando el slot destino está ocupado por la exclusion constraint', async () => {
    const { cuenta, servicio, turno, cliente } = await crearContexto()
    // Turno bloqueador en el slot destino
    await testPrisma.turno.create({
      data: {
        cuentaId: cuenta.id,
        clienteId: cliente.id,
        servicioId: servicio.id,
        inicio: new Date('2028-06-01T16:00:00Z'),
        fin: new Date('2028-06-01T16:30:00Z'),
        estado: 'confirmado',
      },
    })

    const res = await moverTurno({
      turnoId: turno.id,
      nuevoInicio: '2028-06-01T16:00:00Z',
    })

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/ocupado/i)

    // Turno original queda intacto
    const sinCambios = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(sinCambios?.inicio.toISOString()).toBe('2028-06-01T14:00:00.000Z')
  })

  it('idempotente: mover al mismo horario no hace nada', async () => {
    const { turno } = await crearContexto()

    const res = await moverTurno({
      turnoId: turno.id,
      nuevoInicio: turno.inicio.toISOString(),
    })

    expect(res.ok).toBe(true)
    const audit = await testPrisma.auditLog.findMany()
    expect(audit).toHaveLength(0)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('rechaza mover turnos cancelados o completados', async () => {
    const { turno } = await crearContexto()
    await testPrisma.turno.update({ where: { id: turno.id }, data: { estado: 'cancelado' } })

    const res = await moverTurno({
      turnoId: turno.id,
      nuevoInicio: '2028-06-01T16:00:00Z',
    })

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/activos/i)
  })

  it('rechaza sin sesión', async () => {
    const { turno } = await crearContexto()
    currentUser = null

    const res = await moverTurno({
      turnoId: turno.id,
      nuevoInicio: '2028-06-01T16:00:00Z',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('No autenticado')
  })

  it('no encola sync si el turno no tiene googleEventId', async () => {
    const { cuenta, turno } = await crearContexto()
    await testPrisma.turno.update({
      where: { id: turno.id },
      data: { googleEventId: null, googleEventEtag: null },
    })

    const res = await moverTurno({
      turnoId: turno.id,
      nuevoInicio: '2028-06-01T16:00:00Z',
    })

    expect(res.ok).toBe(true)
    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(cuenta.id).toBeTruthy()
  })
})
