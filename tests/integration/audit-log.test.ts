import { describe, it, expect } from 'vitest'
import { escribirAudit } from '@/lib/audit/log'
import { createTenantClient } from '@/lib/db/tenant-client'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'

describe('escribirAudit', () => {
  useTestDatabase()

  it('escribe fila en audit_log con cuentaId inyectado por tenant client', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)

    await escribirAudit(db, {
      accion: 'turno_creado',
      entidad: 'turno',
      entidadId: '00000000-0000-0000-0000-000000000001',
      payload: { canal: 'test' },
    })

    const filas = await testPrisma.auditLog.findMany({ where: { cuentaId: cuenta.id } })
    expect(filas).toHaveLength(1)
    expect(filas[0].accion).toBe('turno_creado')
    expect(filas[0].entidad).toBe('turno')
    expect(filas[0].payload).toEqual({ canal: 'test' })
    expect(filas[0].cuentaId).toBe(cuenta.id)
  })

  it('no propaga error si el insert falla (best-effort)', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)

    // Payload con circular reference (JSON.stringify falla) — Prisma rechaza.
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    // No debe lanzar
    await expect(
      escribirAudit(db, {
        accion: 'turno_creado',
        entidad: 'turno',
        payload: circular as any,
      }),
    ).resolves.toBeUndefined()
  })
})
