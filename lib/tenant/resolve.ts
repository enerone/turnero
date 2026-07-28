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
  const raw = filas[0]
  if (!raw) throw new TenantNotFoundError(slug)

  // lookup_cuenta_por_slug devuelve snake_case (nombre_publico, etc.).
  // Cuenta de Prisma es camelCase. Mapeo explícito — el cast "as Cuenta"
  // sin mapeo previo hace que cualquier campo con @map llegue undefined y
  // rompa cosas silenciosas como inputs controlados en la UI.
  const cuenta: Cuenta = {
    id: raw.id,
    slug: raw.slug,
    nombrePublico: raw.nombre_publico,
    color: raw.color,
    ubicacion: raw.ubicacion,
    timezone: raw.timezone,
    telefonoWhatsapp: raw.telefono_whatsapp,
    subdominioActivo: raw.subdominio_activo,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }

  return {
    cuenta,
    db: createTenantClient(cuenta.id),
  }
})
