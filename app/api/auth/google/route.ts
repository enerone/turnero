import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { generateState, generateCodeVerifier } from 'arctic'
import { google, GOOGLE_SCOPES } from '@/lib/auth/google-oauth'
import { serializarPendingInvitacion } from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'
const COOKIE_INTENT_INVITACION = 'turnero_invitacion_pending'
const COOKIE_TTL = 60 * 10

export async function GET(req: NextRequest) {
  if (!env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google OAuth no configurado' }, { status: 500 })
  }

  const intent = req.nextUrl.searchParams.get('intent')
  const invitacionToken = req.nextUrl.searchParams.get('token')

  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: GOOGLE_SCOPES,
  })
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  const cookieStore = await cookies()
  const secure = env.NODE_ENV === 'production'
  const opts = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_TTL,
  }
  cookieStore.set(COOKIE_STATE, state, opts)
  cookieStore.set(COOKIE_VERIFIER, codeVerifier, opts)

  if (intent === 'invitacion' && invitacionToken) {
    const sealed = await serializarPendingInvitacion(
      { token: invitacionToken, creadoEn: new Date().toISOString() },
      env.SESSION_SECRET,
    )
    cookieStore.set(COOKIE_INTENT_INVITACION, sealed, opts)
  }

  return NextResponse.redirect(url)
}
