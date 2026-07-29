import { NextResponse, type NextRequest } from 'next/server'
import { verificarAdminPassword, setAdminCookie } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const password = formData.get('password')

  if (typeof password !== 'string' || !verificarAdminPassword(password)) {
    return NextResponse.redirect(new URL('/admin/login?error=1', req.url), { status: 303 })
  }

  const res = NextResponse.redirect(new URL('/admin/cuentas', req.url), { status: 303 })
  return await setAdminCookie(res)
}
