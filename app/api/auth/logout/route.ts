import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { lucia } from '@/lib/auth/lucia'
import { getSession } from '@/lib/auth/session'
import { env } from '@/lib/shared/env'

export async function POST() {
  const s = await getSession()
  if (s) {
    await lucia.invalidateSession(s.session.id)
  }
  const blank = lucia.createBlankSessionCookie()
  const cookieStore = await cookies()
  cookieStore.set(blank.name, blank.value, blank.attributes)
  return NextResponse.redirect(new URL('/login', env.PUBLIC_BASE_URL), { status: 303 })
}
