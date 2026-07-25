import { describe, expect, it } from 'vitest'
import { createTenantClient } from '@/lib/db/tenant-client'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

describe('createTenantClient', () => {
  useTestDatabase()

  it('inyecta cuentaId en findMany', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)
    const cuentaB = await crearCuentaFixture(testPrisma)
    await crearServicioFixture(testPrisma, cuentaA.id, { nombre: 'A' })
    await crearServicioFixture(testPrisma, cuentaB.id, { nombre: 'B' })

    const dbA = createTenantClient(cuentaA.id)
    const servicios = await dbA.servicio.findMany()

    expect(servicios).toHaveLength(1)
    expect(servicios[0].nombre).toBe('A')
  })

  it('inyecta cuentaId en create sin pedirlo explícito', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)

    const servicio = await db.servicio.create({
      data: { nombre: 'Consulta', duracionMinutos: 30 } as any,
    })

    expect(servicio.cuentaId).toBe(cuenta.id)
  })

  it('bloquea update de otro tenant vía findFirstOrThrow', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)
    const cuentaB = await crearCuentaFixture(testPrisma)
    const servicioB = await crearServicioFixture(testPrisma, cuentaB.id)

    const dbA = createTenantClient(cuentaA.id)

    await expect(
      dbA.servicio.update({
        where: { id: servicioB.id },
        data: { nombre: 'hackeado' },
      }),
    ).rejects.toThrow()

    const sinCambios = await testPrisma.servicio.findUnique({ where: { id: servicioB.id } })
    expect(sinCambios?.nombre).not.toBe('hackeado')
  })

  it('count respeta el filtro de tenant', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)
    const cuentaB = await crearCuentaFixture(testPrisma)
    await crearServicioFixture(testPrisma, cuentaA.id)
    await crearServicioFixture(testPrisma, cuentaB.id, { nombre: 'B1', esDefault: false })
    await crearServicioFixture(testPrisma, cuentaB.id, { nombre: 'B2', esDefault: false })

    const dbA = createTenantClient(cuentaA.id)
    const dbB = createTenantClient(cuentaB.id)

    expect(await dbA.servicio.count()).toBe(1)
    expect(await dbB.servicio.count()).toBe(2)
  })

  it('no toca modelos que no son tenant-scoped (Cuenta)', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)
    const dbA = createTenantClient(cuentaA.id)

    const todas = await dbA.cuenta.findMany()
    expect(todas.length).toBeGreaterThanOrEqual(1)
  })
})
