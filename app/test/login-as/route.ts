import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { lucia } from '@/lib/auth/lucia'
import { basePrisma } from '@/lib/db/base-prisma'
import { env } from '@/lib/shared/env'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const usuarioId = body?.usuarioId as string | undefined
  const cuentaId = body?.cuentaId as string | undefined
  if (!usuarioId || !cuentaId) {
    return NextResponse.json({ error: 'usuarioId y cuentaId requeridos' }, { status: 400 })
  }

  const usuario = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
    return tx.usuario.findUnique({ where: { id: usuarioId } })
  })
  if (!usuario) return NextResponse.json({ error: 'usuario no existe' }, { status: 404 })

  const session = await lucia.createSession(usuario.id, {})
  const sessionCookie = lucia.createSessionCookie(session.id)
  const cookieStore = await cookies()
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
  return NextResponse.json({ ok: true, sessionId: session.id })
}
