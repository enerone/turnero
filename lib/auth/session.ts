import { cookies } from 'next/headers'
import { cache } from 'react'
import { lucia } from './lucia'
import type { Session, User } from 'lucia'

export interface SessionInfo {
  session: Session
  user: User
}

/**
 * Lee la cookie de sesión y valida contra la base.
 * Memoizado por-request con React cache().
 * Refresca la cookie si Lucia la marca "fresh".
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null
  if (!sessionId) return null

  const { session, user } = await lucia.validateSession(sessionId)

  try {
    if (session && session.fresh) {
      const sessionCookie = lucia.createSessionCookie(session.id)
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }
    if (!session) {
      const sessionCookie = lucia.createBlankSessionCookie()
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }
  } catch {
    // cookies() no permite escribir fuera de handlers/actions; ignorar
  }

  if (!session || !user) return null
  return { session, user }
})

export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession()
  if (!s) throw new Error('No hay sesión activa')
  return s
}
