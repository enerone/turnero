import { randomBytes } from 'node:crypto'
import { createTenantClient } from '@/lib/db/tenant-client'
import type { Invitacion } from '@prisma/client'

const TTL_DIAS = 7

export function generarToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function crearInvitacion(cuentaId: string, email: string): Promise<Invitacion> {
  const token = generarToken()
  const expiraEn = new Date(Date.now() + TTL_DIAS * 24 * 60 * 60 * 1000)
  const db = createTenantClient(cuentaId)
  return db.invitacion.create({
    data: { cuentaId, email: email.toLowerCase(), token, expiraEn },
  })
}
