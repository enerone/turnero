import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateState, generateCodeVerifier } from 'arctic'
import { google, GOOGLE_SCOPES } from '@/lib/auth/google-oauth'
import { env } from '@/lib/shared/env'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'
const COOKIE_TTL = 60 * 10

export async function GET() {
  if (!env.GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Google OAuth no está configurado en este entorno' },
      { status: 500 },
    )
  }

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

  return NextResponse.redirect(url)
}
