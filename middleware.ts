import { NextResponse, type NextRequest } from 'next/server'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'
import { NOMBRE_COOKIE_PENDING } from '@/lib/auth/pending-onboarding'

const DOMINIO_BASE = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : 'localhost'

const RUTAS_PUBLICAS_SIN_TENANT = new Set(['/login', '/onboarding'])

function esRutaSistema(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/test/')
  )
}

// El nombre de la cookie de sesión de Lucia es 'auth_session' por default en v3
const COOKIE_SESION = 'auth_session'

export function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const { pathname } = req.nextUrl

  if (esRutaSistema(pathname)) return NextResponse.next()

  if (
    RUTAS_PUBLICAS_SIN_TENANT.has(pathname) ||
    pathname.startsWith('/aceptar-invitacion/')
  ) {
    return NextResponse.next()
  }

  const resuelto = slugDesdeRequest({ hostname, pathname }, DOMINIO_BASE)

  if (!resuelto) {
    // Landing sin slug
    if (req.cookies.get(NOMBRE_COOKIE_PENDING)) {
      return NextResponse.redirect(new URL('/onboarding', req.url))
    }
    if (!req.cookies.get(COOKIE_SESION) && pathname !== '/') {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    return NextResponse.next()
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-tenant-slug', resuelto.slug)

  if (resuelto.fuente === 'subdominio') {
    const nuevaUrl = req.nextUrl.clone()
    nuevaUrl.pathname = `/${resuelto.slug}${pathname === '/' ? '' : pathname}`
    return NextResponse.rewrite(nuevaUrl, { request: { headers: requestHeaders } })
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
