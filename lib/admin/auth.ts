import type { NextResponse } from 'next/server'

const COOKIE_NAME = 'admin_session'
const COOKIE_TTL_SECONDS = 8 * 60 * 60

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function expectedAdminCookieValue(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD ?? ''
  return sha256Hex(password + 'turnero-admin')
}

export function verificarAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) return false
  return password === expected
}

export async function getAdminSession(request?: Request): Promise<boolean> {
  if (!request) return false
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE_NAME + '='))
  if (!match) return false
  const value = match.slice(COOKIE_NAME.length + 1)
  const expected = await expectedAdminCookieValue()
  return value === expected
}

export async function setAdminCookie(response: NextResponse): Promise<NextResponse> {
  const isProduction = process.env.NODE_ENV === 'production'
  const value = await expectedAdminCookieValue()
  response.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_TTL_SECONDS,
    secure: isProduction,
    path: '/',
  })
  return response
}

export function clearAdminCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}
