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

interface CuentaLookup {
  id: string
  slug: string
  nombre_publico: string
  color: string
  ubicacion: string | null
  timezone: string
  telefono_whatsapp: string | null
  subdominio_activo: boolean
  created_at: Date
  updated_at: Date
}

export const getTenant = cache(async (): Promise<TenantContext> => {
  const h = await headers()
  const slug = h.get('x-tenant-slug')
  if (!slug) throw new NoTenantInRequestError()

  const filas = await basePrisma.$queryRaw<CuentaLookup[]>`
    SELECT * FROM lookup_cuenta_por_slug(${slug})
  `
  const cuenta = filas[0]
  if (!cuenta) throw new TenantNotFoundError(slug)

  return {
    cuenta: cuenta as unknown as Cuenta,
    db: createTenantClient(cuenta.id),
  }
})
