import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined
}

export const basePrisma =
  globalForPrisma.basePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.basePrisma = basePrisma
}
