import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'
import { enviarEmailRecordatorio } from '@/lib/public-booking/email'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

export const dynamic = 'force-dynamic'

const TOKEN_PATTERN = /token_confirmacion_hash:([a-f0-9]+);expira:([^;]+)/

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function resolveTenant() {
  try {
    return await getTenant()
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      return null
    }
    throw e
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
  const { cuenta, db } = tenant

  const tokenHash = hashToken(token)

  const turno = await db.turno.findFirst({
    where: {
      notas: { contains: `token_confirmacion_hash:${tokenHash}` },
      estado: 'borrador',
    },
    include: { servicio: true, cliente: true },
  })

  if (!turno) {
    return NextResponse.json({ error: 'Token inválido o turno ya confirmado' }, { status: 404 })
  }

  const match = turno.notas.match(TOKEN_PATTERN)
  if (!match) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 400 })
  }
  const expira = new Date(match[2])
  if (expira < new Date()) {
    return NextResponse.json({ error: 'Token expirado' }, { status: 410 })
  }

  await db.turno.update({
    where: { id: turno.id },
    data: {
      estado: 'confirmado',
      notas: turno.notas.replace(TOKEN_PATTERN, '').replace(/^;+|;+$/g, ''),
    },
  })

  const fechaLocal = turno.inicio.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: cuenta.timezone,
  })
  const horaLocal = turno.inicio.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: cuenta.timezone,
  })
  const cancelUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${token}`

  try {
    await enviarEmailRecordatorio({
      to: turno.cliente?.email ?? '',
      cuentaNombre: cuenta.nombrePublico,
      servicio: turno.servicio.nombre,
      fecha: fechaLocal,
      hora: horaLocal,
      cancelUrl,
    })
  } catch (err) {
    logger.warn({ err, turnoId: turno.id }, 'No se pudo enviar recordatorio post-confirmación')
  }

  return NextResponse.json({ ok: true, turnoId: turno.id })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
  const { db } = tenant

  const tokenHash = hashToken(token)

  const turno = await db.turno.findFirst({
    where: {
      notas: { contains: `token_confirmacion_hash:${tokenHash}` },
      estado: { in: ['borrador', 'confirmado'] },
    },
  })

  if (!turno) {
    return NextResponse.json({ error: 'Token inválido o turno no encontrado' }, { status: 404 })
  }

  await db.turno.update({
    where: { id: turno.id },
    data: {
      estado: 'cancelado',
      origenCancelacion: 'cliente',
      notas: turno.notas.replace(TOKEN_PATTERN, '').replace(/^;+|;+$/g, ''),
    },
  })

  return NextResponse.json({ ok: true, mensaje: 'Turno cancelado y horario liberado' })
}
