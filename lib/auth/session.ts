import { cookies } from 'next/headers'
import { cache } from 'react'
import { lucia } from './lucia'
import { basePrisma } from '@/lib/db/base-prisma'
import type { Session, User } from 'lucia'

export interface SessionInfo {
  session: Session
  user: User
}

type SessionRow = {
  session_id: string
  session_usuario_id: string
  session_expires_at: Date
  usuario_id: string
  usuario_cuenta_id: string
  usuario_email: string
  usuario_nombre: string
  usuario_google_sub: string
  usuario_rol: 'owner' | 'secretaria'
}

/**
 * Lee la cookie de sesión y valida contra la base.
 * Memoizado por-request con React cache().
 * Refresca la cookie si Lucia la marca "fresh".
 *
 * Usa la función SECURITY DEFINER lookup_session_con_usuario para
 * bypasear RLS: no conocemos el cuenta_id antes de resolver la sesión.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null
  if (!sessionId) return null

  const rows = await basePrisma.$queryRaw<SessionRow[]>`
    SELECT
      session_id, session_usuario_id, session_expires_at,
      usuario_id, usuario_cuenta_id, usuario_email,
      usuario_nombre, usuario_google_sub, usuario_rol
    FROM lookup_session_con_usuario(${sessionId})
  `

  const row = rows[0]

  // No existe o expiró.
  if (!row || row.session_expires_at.getTime() <= Date.now()) {
    try {
      const sessionCookie = lucia.createBlankSessionCookie()
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    } catch {
      // cookies() no permite escribir fuera de handlers/actions; ignorar
    }
    if (row) {
      // Sesión expirada — limpiar de la DB (best-effort).
      await lucia.invalidateSession(row.session_id).catch(() => {})
    }
    return null
  }

  const session: Session = {
    id: row.session_id,
    userId: row.session_usuario_id,
    expiresAt: row.session_expires_at,
    fresh: false,
  }

  const user: User = {
    id: row.usuario_id,
    email: row.usuario_email,
    nombre: row.usuario_nombre,
    cuentaId: row.usuario_cuenta_id,
    rol: row.usuario_rol,
    googleSub: row.usuario_google_sub,
  }

  return { session, user }
})

export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession()
  if (!s) throw new Error('No hay sesión activa')
  return s
}
