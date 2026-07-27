import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'
import { enviarEmailRecordatorio } from '@/lib/public-booking/email'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { escribirAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'

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

  const tokenRow = await db.tokenConfirmacion.findFirst({
    where: { tokenHash },
    include: { turno: { include: { servicio: true, cliente: true } } },
  })

  if (!tokenRow || !tokenRow.turno) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 404 })
  }
  if (tokenRow.usadaEn) {
    return NextResponse.json({ error: 'Token ya usado' }, { status: 410 })
  }
  if (tokenRow.expiraEn < new Date()) {
    return NextResponse.json({ error: 'Token expirado' }, { status: 410 })
  }
  if (tokenRow.turno.estado !== 'borrador' && tokenRow.turno.estado !== 'confirmado') {
    return NextResponse.json({ error: 'Turno no está en estado confirmable' }, { status: 409 })
  }

  const [, turnoActualizado] = await db.$transaction([
    db.tokenConfirmacion.update({
      where: { id: tokenRow.id },
      data: { usadaEn: new Date() },
    }),
    db.turno.update({
      where: { id: tokenRow.turno.id },
      data: { estado: 'confirmado' },
    }),
  ])

  await escribirAudit(db, {
    accion: 'turno_confirmado',
    entidad: 'turno',
    entidadId: tokenRow.turno.id,
    payload: { canal: 'cliente_via_token', tokenId: tokenRow.id },
  })

  const fechaLocal = turnoActualizado.inicio.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: cuenta.timezone,
  })
  const horaLocal = turnoActualizado.inicio.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: cuenta.timezone,
  })
  const cancelUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${token}`

  try {
    await enviarEmailRecordatorio({
      to: tokenRow.turno.cliente?.email ?? '',
      cuentaNombre: cuenta.nombrePublico,
      servicio: tokenRow.turno.servicio.nombre,
      fecha: fechaLocal,
      hora: horaLocal,
      cancelUrl,
    })
  } catch (err) {
    logger.warn({ err, turnoId: tokenRow.turno.id }, 'No se pudo enviar recordatorio post-confirmación')
  }

  return NextResponse.json({ ok: true, turnoId: tokenRow.turno.id })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
  const { db } = tenant

  const tokenHash = hashToken(token)

  const tokenRow = await db.tokenConfirmacion.findFirst({
    where: { tokenHash },
    include: { turno: true },
  })

  if (!tokenRow || !tokenRow.turno) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 404 })
  }
  if (tokenRow.turno.estado === 'cancelado') {
    return NextResponse.json({ error: 'Turno ya cancelado' }, { status: 409 })
  }

  await db.$transaction([
    db.tokenConfirmacion.update({
      where: { id: tokenRow.id },
      data: { usadaEn: new Date() },
    }),
    db.turno.update({
      where: { id: tokenRow.turno.id },
      data: { estado: 'cancelado', origenCancelacion: 'cliente' },
    }),
  ])

  await escribirAudit(db, {
    accion: 'turno_cancelado',
    entidad: 'turno',
    entidadId: tokenRow.turno.id,
    payload: { origen: 'cliente', tokenId: tokenRow.id },
  })

  return NextResponse.json({ ok: true, mensaje: 'Turno cancelado y horario liberado' })
}
