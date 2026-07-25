import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { OAuth2RequestError } from 'arctic'
import { google, obtenerUserInfo } from '@/lib/auth/google-oauth'
import { basePrisma } from '@/lib/db/base-prisma'
import { lucia } from '@/lib/auth/lucia'
import {
  NOMBRE_COOKIE_PENDING,
  serializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const err = searchParams.get('error')

  if (err) {
    logger.warn({ err }, 'Google OAuth callback con error')
    return NextResponse.redirect(new URL('/login?error=denied', env.PUBLIC_BASE_URL))
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(COOKIE_STATE)?.value ?? null
  const storedVerifier = cookieStore.get(COOKIE_VERIFIER)?.value ?? null

  if (!code || !state || !storedState || !storedVerifier || state !== storedState) {
    logger.warn('OAuth callback: state/code missing o no matchea')
    return NextResponse.redirect(new URL('/login?error=state', env.PUBLIC_BASE_URL))
  }

  try {
    const tokens = await google.validateAuthorizationCode(code, storedVerifier)
    const userInfo = await obtenerUserInfo(tokens.accessToken)

    const existente = await basePrisma.usuario.findUnique({
      where: { googleSub: userInfo.sub },
      include: { cuenta: true },
    })

    cookieStore.delete(COOKIE_STATE)
    cookieStore.delete(COOKIE_VERIFIER)

    if (existente) {
      const session = await lucia.createSession(existente.id, {})
      const sessionCookie = lucia.createSessionCookie(session.id)
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
      return NextResponse.redirect(
        new URL(`/${existente.cuenta.slug}`, env.PUBLIC_BASE_URL),
      )
    }

    if (!tokens.refreshToken) {
      logger.warn(
        { googleSub: userInfo.sub },
        'Google no devolvió refresh_token; probablemente el usuario ya había consentido',
      )
      return NextResponse.redirect(new URL('/login?error=no_refresh', env.PUBLIC_BASE_URL))
    }

    const sealed = await serializarPendingOnboarding(
      {
        googleSub: userInfo.sub,
        email: userInfo.email,
        nombre: userInfo.name,
        refreshToken: tokens.refreshToken,
        creadoEn: new Date().toISOString(),
      },
      env.SESSION_SECRET,
    )
    cookieStore.set(NOMBRE_COOKIE_PENDING, sealed, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    })
    return NextResponse.redirect(new URL('/onboarding', env.PUBLIC_BASE_URL))
  } catch (e) {
    if (e instanceof OAuth2RequestError) {
      logger.warn({ err: e.message }, 'OAuth2RequestError en callback')
      return NextResponse.redirect(new URL('/login?error=oauth', env.PUBLIC_BASE_URL))
    }
    logger.error({ err: e }, 'Error inesperado en OAuth callback')
    return NextResponse.redirect(new URL('/login?error=server', env.PUBLIC_BASE_URL))
  }
}
