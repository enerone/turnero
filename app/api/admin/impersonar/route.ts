import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { basePrisma } from '@/lib/db/base-prisma'
import { lucia } from '@/lib/auth/lucia'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const cuentaId = formData.get('cuentaId')

  if (typeof cuentaId !== 'string') {
    return NextResponse.json({ error: 'cuentaId requerido' }, { status: 400 })
  }

  const cuenta = await basePrisma.cuenta.findUnique({
    where: { id: cuentaId },
    select: { slug: true },
  })
  if (!cuenta) {
    return NextResponse.json({ error: 'cuenta no encontrada' }, { status: 404 })
  }

  const owner = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
    return tx.usuario.findFirst({ where: { cuentaId, rol: 'owner' } })
  })

  if (!owner) {
    return NextResponse.json({ error: 'owner no encontrado' }, { status: 404 })
  }

  const session = await lucia.createSession(owner.id, {})
  const sessionCookie = lucia.createSessionCookie(session.id)
  const cookieStore = await cookies()
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

  return NextResponse.redirect(new URL(`/${cuenta.slug}/hoy`, req.url), { status: 303 })
}
