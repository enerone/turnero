import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

// testPrisma usa DIRECT_URL (rol owner) para poder TRUNCATE.
// La app runtime (basePrisma) usa DATABASE_URL (rol non-superuser, RLS aplica).
export const testPrisma = new PrismaClient({
  log: ['error'],
  datasources: {
    db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  },
})

const TABLES_TO_TRUNCATE = [
  'token_confirmacion',
  'invitacion',
  'audit_log',
  'evento_externo',
  'turno',
  'cliente',
  'excepcion_horario',
  'horario_semanal',
  'servicio',
  'integracion_calendar',
  'usuario',
  'cuenta',
]

export async function truncateAll(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`,
  )
}

export function useTestDatabase() {
  beforeAll(async () => {
    await testPrisma.$connect()
  })

  beforeEach(async () => {
    await truncateAll(testPrisma)
  })

  afterAll(async () => {
    await testPrisma.$disconnect()
  })
}
