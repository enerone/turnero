import { headers } from 'next/headers'
import { cache } from 'react'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient, type TenantClient } from '@/lib/db/tenant-client'
import { NoTenantInRequestError, TenantNotFoundError } from '@/lib/db/errors'
import type { Cuenta } from '@prisma/client'

export interface TenantContext {
  cuenta: Cuenta
  db: TenantClient
}

export const getTenant = cache(async (): Promise<TenantContext> => {
  const h = await headers()
  const slug = h.get('x-tenant-slug')
  if (!slug) throw new NoTenantInRequestError()

  const cuenta = await basePrisma.cuenta.findUnique({ where: { slug } })
  if (!cuenta) throw new TenantNotFoundError(slug)

  return {
    cuenta,
    db: createTenantClient(cuenta.id),
  }
})
