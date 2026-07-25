import type { Prisma } from '@prisma/client'
import { basePrisma } from './base-prisma'
import { TENANT_SCOPED_MODELS } from './tenant-models'

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

const WRITE_WITH_WHERE = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
])

function injectTenantScope(operation: string, args: any, cuentaId: string): any {
  if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
    return {
      ...args,
      where: { ...(args?.where ?? {}), cuentaId },
    }
  }

  if (operation === 'create') {
    return {
      ...args,
      data: { ...(args?.data ?? {}), cuentaId },
    }
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = args?.data
    const nuevoData = Array.isArray(data)
      ? data.map((d: any) => ({ ...d, cuentaId }))
      : { ...(data ?? {}), cuentaId }
    return { ...args, data: nuevoData }
  }

  return args
}

/**
 * Devuelve un Prisma client extendido que inyecta cuentaId en todas las queries
 * sobre modelos tenant-scoped, y las envuelve en una transacción con
 * SET LOCAL app.cuenta_id (para que RLS coopere).
 *
 * Cheap de llamar por-request: comparte el pool de conexiones de basePrisma.
 *
 * LIMITACIONES CONOCIDAS (RLS en Postgres actúa como red de seguridad):
 * 1. Nested writes NO reciben inyección de cuentaId. No hacer:
 *      db.turno.create({ data: { cliente: { create: { ... } } } })
 *    En su lugar: crear cliente y turno en dos llamadas separadas.
 * 2. $queryRaw y $executeRaw NO son interceptados. Evitar raw SQL sobre
 *    modelos tenant-scoped, o setear app.cuenta_id manualmente en la misma
 *    transacción.
 */
export function createTenantClient(cuentaId: string) {
  return basePrisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model as Prisma.ModelName)) {
            return query(args)
          }

          const scoped = injectTenantScope(operation, args, cuentaId)

          const [, result] = await basePrisma.$transaction([
            basePrisma.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`,
            query(scoped),
          ])

          return result
        },
      },
    },
  })
}

export type TenantClient = ReturnType<typeof createTenantClient>
