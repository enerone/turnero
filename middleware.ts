import { NextResponse, type NextRequest } from 'next/server'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'
import { NOMBRE_COOKIE_PENDING } from '@/lib/auth/pending-onboarding'
import { expectedAdminCookieValue } from '@/lib/admin/auth'

const DOMINIO_BASE = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : 'localhost'

const RUTAS_PUBLICAS_SIN_TENANT = new Set(['/login'])

function esRutaSistema(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/test/')
  )
}

const COOKIE_SESION = 'auth_session'

const RATE_LIMIT_MAP = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = RATE_LIMIT_MAP.get(key)
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT_MAP.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
}

export async function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/admin')) {
    if (pathname !== '/admin/login') {
      const adminCookie = req.cookies.get('admin_session')
      const expected = await expectedAdminCookieValue()
      if (!adminCookie || adminCookie.value !== expected) {
        return NextResponse.redirect(new URL('/admin/login', req.url))
      }
    }
    return NextResponse.next()
  }

  if (esRutaSistema(pathname)) return NextResponse.next()

  if (
    RUTAS_PUBLICAS_SIN_TENANT.has(pathname) ||
    pathname.startsWith('/aceptar-invitacion/')
  ) {
    return NextResponse.next()
  }

  // Rate limit /onboarding (GET): 10 req/min por IP
  if (pathname === '/onboarding') {
    const ip = getClientIp(req)
    if (!rateLimit(`onboarding:${ip}`, 10, 60_000)) {
      return new NextResponse('Demasiadas solicitudes', { status: 429 })
    }
  }

  // Rate limit /api/auth/google (GET): 20 req/min por IP
  if (pathname.startsWith('/api/auth/google') && req.method === 'GET') {
    const ip = getClientIp(req)
    if (!rateLimit(`oauth_google:${ip}`, 20, 60_000)) {
      return new NextResponse('Demasiadas solicitudes', { status: 429 })
    }
  }

  // Bloquear /onboarding sin cookie pending-onboarding
  if (pathname === '/onboarding' && !req.cookies.get(NOMBRE_COOKIE_PENDING)) {
    return NextResponse.redirect(new URL('/login?error=onboarding_expired', req.url))
  }

  const resuelto = slugDesdeRequest({ hostname, pathname }, DOMINIO_BASE)

  if (!resuelto) {
    if (req.cookies.get(NOMBRE_COOKIE_PENDING)) {
      return NextResponse.redirect(new URL('/onboarding', req.url))
    }
    if (!req.cookies.get(COOKIE_SESION) && pathname !== '/') {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    return NextResponse.next()
  }

  if (resuelto.fuente === 'subdominio') {
    const nuevaUrl = req.nextUrl.clone()
    nuevaUrl.pathname = `/${resuelto.slug}${pathname === '/' ? '' : pathname}`
    return NextResponse.redirect(nuevaUrl)
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-tenant-slug', resuelto.slug)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
