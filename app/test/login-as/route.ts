import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { lucia } from '@/lib/auth/lucia'
import { basePrisma } from '@/lib/db/base-prisma'
import { env } from '@/lib/shared/env'

export const dynamic = 'force-dynamic'

async function resolverParams(req: NextRequest): Promise<{ usuarioId?: string; cuentaId?: string }> {
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url)
    return { usuarioId: searchParams.get('usuarioId') ?? undefined, cuentaId: searchParams.get('cuentaId') ?? undefined }
  }
  const body = await req.json().catch(() => null)
  return { usuarioId: body?.usuarioId, cuentaId: body?.cuentaId }
}

async function handler(req: NextRequest) {
  if (env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { usuarioId, cuentaId } = await resolverParams(req)
  if (!usuarioId || !cuentaId) {
    return NextResponse.json({ error: 'usuarioId y cuentaId requeridos' }, { status: 400 })
  }

  const [usuario, cuenta] = await Promise.all([
    basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
      return tx.usuario.findUnique({ where: { id: usuarioId } })
    }),
    basePrisma.cuenta.findUnique({ where: { id: cuentaId }, select: { slug: true } }),
  ])
  if (!usuario) return NextResponse.json({ error: 'usuario no existe' }, { status: 404 })
  if (!cuenta) return NextResponse.json({ error: 'cuenta no existe' }, { status: 404 })

  const session = await lucia.createSession(usuario.id, {})
  const sessionCookie = lucia.createSessionCookie(session.id)
  const cookieStore = await cookies()
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

  if (req.method === 'GET') {
    return NextResponse.redirect(new URL(`/${cuenta.slug}/hoy`, req.url))
  }
  return NextResponse.json({ ok: true, sessionId: session.id })
}

export { handler as GET, handler as POST }
