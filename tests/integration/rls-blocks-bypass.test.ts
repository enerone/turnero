import { describe, expect, it } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

describe('RLS bloquea bypass del extension', () => {
  useTestDatabase()

  it('con app.cuenta_id seteado a cuenta A, no se ven servicios de cuenta B via basePrisma', async () => {
    // Setup con testPrisma (rol owner, bypassea RLS) para poder insertar en 2 tenants.
    const cuentaA = await crearCuentaFixture(testPrisma)
    const cuentaB = await crearCuentaFixture(testPrisma)
    await crearServicioFixture(testPrisma, cuentaA.id, { nombre: 'A' })
    await crearServicioFixture(testPrisma, cuentaB.id, { nombre: 'B' })

    // Simulamos un query "hostil" que corre en el mismo pool
    // con app.cuenta_id seteado a cuentaA, pero pide TODOS los servicios.
    const resultado = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaA.id}, TRUE)`
      return tx.servicio.findMany()
    })

    expect(resultado).toHaveLength(1)
    expect(resultado[0].nombre).toBe('A')
  })

  it('sin app.cuenta_id seteado, RLS devuelve 0 filas', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)
    await crearServicioFixture(testPrisma, cuentaA.id)

    const resultado = await basePrisma.$transaction(async (tx) => {
      // No seteamos app.cuenta_id: current_setting(..., true) devuelve NULL
      // La policy compara con NULL::uuid → false → cero filas
      return tx.servicio.findMany()
    })

    expect(resultado).toHaveLength(0)
  })

  it('inserta directo sin cuentaId falla por RLS WITH CHECK', async () => {
    const cuentaA = await crearCuentaFixture(testPrisma)

    await expect(
      basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaA.id}, TRUE)`
        // Intentamos insertar con cuentaId distinto al seteado
        return tx.$executeRaw`
          INSERT INTO servicio (id, cuenta_id, nombre, duracion_minutos, es_default, permite_sobreturnos, activo, created_at, updated_at)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'hack', 30, false, false, true, now(), now())
        `
      }),
    ).rejects.toThrow(/row-level security/i)
  })
})
