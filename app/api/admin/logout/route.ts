import { NextResponse, type NextRequest } from 'next/server'
import { clearAdminCookie } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 })
  return clearAdminCookie(res)
}
