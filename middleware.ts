import { NextResponse, type NextRequest } from 'next/server'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'

const DOMINIO_BASE = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : 'localhost'

export function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const { pathname } = req.nextUrl

  // Rutas del app que nunca son tenant
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const resuelto = slugDesdeRequest({ hostname, pathname }, DOMINIO_BASE)

  if (!resuelto) {
    // Landing pública: sigue sin tenant
    return NextResponse.next()
  }

  // Propagamos el slug del tenant a la request para que server components / route handlers
  // puedan leerlo vía `headers()`.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-tenant-slug', resuelto.slug)

  // Si vino por subdominio, reescribimos el path para que Next.js matchee /[slug]/...
  if (resuelto.fuente === 'subdominio') {
    const nuevaUrl = req.nextUrl.clone()
    nuevaUrl.pathname = `/${resuelto.slug}${pathname === '/' ? '' : pathname}`
    const resp = NextResponse.rewrite(nuevaUrl, {
      request: { headers: requestHeaders },
    })
    resp.headers.set('x-tenant-slug', resuelto.slug)
    return resp
  }

  const resp = NextResponse.next({
    request: { headers: requestHeaders },
  })
  resp.headers.set('x-tenant-slug', resuelto.slug)
  return resp
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
