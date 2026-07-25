import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

export const testPrisma = new PrismaClient({
  log: ['error'],
})

const TABLES_TO_TRUNCATE = [
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
