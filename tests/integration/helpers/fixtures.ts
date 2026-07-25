import type { PrismaClient } from '@prisma/client'

let cuentaCounter = 0

export async function crearCuentaFixture(
  prisma: PrismaClient,
  overrides: Partial<{ slug: string; nombrePublico: string }> = {},
) {
  cuentaCounter += 1
  const slug = overrides.slug ?? `cuenta-test-${cuentaCounter}-${Date.now()}`
  return prisma.cuenta.create({
    data: {
      slug,
      nombrePublico: overrides.nombrePublico ?? `Cuenta ${cuentaCounter}`,
    },
  })
}

export async function crearServicioFixture(
  prisma: PrismaClient,
  cuentaId: string,
  overrides: Partial<{ nombre: string; duracionMinutos: number; esDefault: boolean }> = {},
) {
  return prisma.servicio.create({
    data: {
      cuentaId,
      nombre: overrides.nombre ?? 'Consulta',
      duracionMinutos: overrides.duracionMinutos ?? 30,
      esDefault: overrides.esDefault ?? true,
    },
  })
}
