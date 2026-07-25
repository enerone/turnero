import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'

export default async function TenantLayout({ children }: { children: ReactNode }) {
  try {
    await getTenant()
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      notFound()
    }
    throw e
  }

  return <>{children}</>
}
