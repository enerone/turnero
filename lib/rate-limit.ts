import { NextResponse, type NextRequest } from 'next/server'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

function limpiarExpirados(): void {
  const ahora = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < ahora) store.delete(key)
  }
}

export interface RateLimitOptions {
  max: number
  windowMs: number
  keyPrefix?: string
}

export function rateLimit(options: RateLimitOptions) {
  const { max, windowMs, keyPrefix = 'rl' } = options

  return function (req: NextRequest): NextResponse | null {
    limpiarExpirados()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown'
    const key = `${keyPrefix}:${ip}`
    const ahora = Date.now()
    const entry = store.get(key)

    if (!entry || entry.resetAt < ahora) {
      store.set(key, { count: 1, resetAt: ahora + windowMs })
      return null
    }

    if (entry.count >= max) {
      const resetSeg = Math.ceil((entry.resetAt - ahora) / 1000)
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intente más tarde.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(resetSeg),
            'X-RateLimit-Limit': String(max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
          },
        },
      )
    }

    entry.count++
    return null
  }
}

export const rateLimitAuth = rateLimit({
  max: 10,
  windowMs: 60_000,
  keyPrefix: 'auth',
})

export const rateLimitOnboarding = rateLimit({
  max: 5,
  windowMs: 60_000,
  keyPrefix: 'onboarding',
})