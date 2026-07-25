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
