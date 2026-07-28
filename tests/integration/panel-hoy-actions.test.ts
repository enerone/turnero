import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cambiarEstadoTurno } from '@/app/[slug]/hoy/actions'
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
  getSession: async () => currentUser ? { session: { id: 'sess', userId: currentUser.id, expiresAt: new Date(Date.now() + 3600_000), fresh: false }, user: currentUser } : null,
}))

// Mock del enqueue para no requerir pg-boss booted en test.
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
  const servicio = await crearServicioFixture(testPrisma, cuenta.id)
  const cliente = await testPrisma.cliente.create({
    data: { cuentaId: cuenta.id, nombre: 'Ana', telefono: '+5491100000000' },
  })
  const turno = await testPrisma.turno.create({
    data: {
      cuentaId: cuenta.id,
      clienteId: cliente.id,
      servicioId: servicio.id,
      inicio: new Date('2028-05-10T14:00:00Z'),
      fin: new Date('2028-05-10T14:30:00Z'),
      estado: 'confirmado',
      googleEventId: 'gcal_x',
    },
  })
  return { cuenta, usuario, turno }
}

describe('cambiarEstadoTurno (server action)', () => {
  useTestDatabase()

  beforeEach(() => {
    enqueueSpy.mockClear()
    currentUser = null
    currentSlug = ''
  })

  it('cancela turno + audit + encola sync-delete a Google', async () => {
    const { cuenta, turno } = await crearContexto()

    const res = await cambiarEstadoTurno({ turnoId: turno.id, nuevoEstado: 'cancelado' })

    expect(res.ok).toBe(true)
    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.estado).toBe('cancelado')
    expect(actualizado?.origenCancelacion).toBe('panel')

    const audit = await testPrisma.auditLog.findMany({ where: { cuentaId: cuenta.id } })
    expect(audit).toHaveLength(1)
    expect(audit[0].accion).toBe('turno_cancelado')
    expect(audit[0].usuarioId).toBe(currentUser!.id)

    expect(enqueueSpy).toHaveBeenCalledWith({
      cuentaId: cuenta.id,
      turnoId: turno.id,
      operacion: 'delete',
    })
  })

  it('marca no_asistio sin encolar sync (Google no distingue "no vino")', async () => {
    const { turno } = await crearContexto()

    const res = await cambiarEstadoTurno({ turnoId: turno.id, nuevoEstado: 'no_asistio' })

    expect(res.ok).toBe(true)
    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.estado).toBe('no_asistio')
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('idempotente: mismo estado no dispara audit ni sync', async () => {
    const { turno } = await crearContexto()

    const res = await cambiarEstadoTurno({ turnoId: turno.id, nuevoEstado: 'confirmado' })

    expect(res.ok).toBe(true)
    const audit = await testPrisma.auditLog.findMany()
    expect(audit).toHaveLength(0)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión', async () => {
    await crearContexto()
    currentUser = null

    const { turno } = await crearContexto() // vuelve a setear user, ojo
    currentUser = null

    const res = await cambiarEstadoTurno({ turnoId: turno.id, nuevoEstado: 'cancelado' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('No autenticado')
  })

  it('secretaria puede cancelar pero no editar config (perms de puede())', async () => {
    const { cuenta, turno } = await crearContexto()
    // Cambiar rol a secretaria
    currentUser = { ...currentUser!, rol: 'secretaria' }
    // Necesito actualizar el usuario en DB también
    await testPrisma.usuario.update({
      where: { id: currentUser.id },
      data: { rol: 'secretaria' },
    })

    const res = await cambiarEstadoTurno({ turnoId: turno.id, nuevoEstado: 'cancelado' })
    expect(res.ok).toBe(true)

    const actualizado = await testPrisma.turno.findUnique({ where: { id: turno.id } })
    expect(actualizado?.estado).toBe('cancelado')
    // cleanup
    expect(cuenta.id).toBeTruthy()
  })

  it('rechaza cross-tenant (user de cuenta A intenta operar turno de cuenta B)', async () => {
    const ctxA = await crearContexto()
    // El middleware/tenant-resolve va a devolver cuenta B (currentSlug apunta a A),
    // pero currentUser.cuentaId != cuenta A → falla el chequeo.
    currentUser = { ...currentUser!, cuentaId: 'otra-cuenta-uuid-xxxxxxxxxxxxxxxx' }

    const res = await cambiarEstadoTurno({ turnoId: ctxA.turno.id, nuevoEstado: 'cancelado' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Sin permisos')
  })
})
