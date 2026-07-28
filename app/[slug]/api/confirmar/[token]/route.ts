import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { escribirAudit } from '@/lib/audit/log'
import { formatearFechaLocal, formatearHoraLocal, formatearFechaHoraLocal } from '@/lib/format/fecha'
import { encolarEmail, encolarWhatsApp } from '@/lib/outbox/encolar'
import { enqueueSyncTurnoGoogle } from '@/lib/jobs/enqueue'

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

  // Sync a Google Calendar (best-effort, retry en pg-boss).
  try {
    await enqueueSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: tokenRow.turno.id, operacion: 'upsert' })
  } catch (err) {
    logger.warn({ err, turnoId: tokenRow.turno.id }, 'No se pudo encolar sync a Google')
  }

  const fechaLocal = formatearFechaLocal(turnoActualizado.inicio, cuenta.timezone)
  const horaLocal = formatearHoraLocal(turnoActualizado.inicio, cuenta.timezone)
  const cancelUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${token}`
  const clienteEmail = tokenRow.turno.cliente?.email

  if (clienteEmail) {
    await encolarEmail(db, {
      destinatario: clienteEmail,
      asunto: `Tu turno en ${cuenta.nombrePublico} está confirmado`,
      cuerpoHtml: `
        <p>Hola,</p>
        <p>Tu turno en <strong>${cuenta.nombrePublico}</strong> fue confirmado.</p>
        <p><strong>${tokenRow.turno.servicio.nombre}</strong> · ${fechaLocal} a las ${horaLocal}</p>
        <p>Si no podés ir, cancelá desde <a href="${cancelUrl}">este link</a> y liberás el horario para otra persona.</p>
      `,
    })
  }

  return NextResponse.json({ ok: true, turnoId: tokenRow.turno.id })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
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

  // Sync a Google Calendar: borrar el evento si estaba pusheado.
  try {
    await enqueueSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId: tokenRow.turno.id, operacion: 'delete' })
  } catch (err) {
    logger.warn({ err, turnoId: tokenRow.turno.id }, 'No se pudo encolar sync-delete a Google')
  }

  // Aviso al owner: encolamos en outbox para no bloquear la request.
  const dueño = await db.usuario.findFirst({ where: { rol: 'owner' } })
  const nombreCliente = tokenRow.turno.cliente?.nombre ?? 'un cliente'
  const cuando = formatearFechaHoraLocal(tokenRow.turno.inicio, cuenta.timezone)
  const mensaje = `Se canceló un turno: ${nombreCliente} para ${cuando} (${tokenRow.turno.servicio.nombre}). El horario quedó libre.`

  if (cuenta.telefonoWhatsapp) {
    await encolarWhatsApp(db, { destinatario: cuenta.telefonoWhatsapp, cuerpo: mensaje })
  }
  if (dueño?.email) {
    await encolarEmail(db, {
      destinatario: dueño.email,
      asunto: `Turno cancelado en ${cuenta.nombrePublico}`,
      cuerpoHtml: `<p>${mensaje}</p>`,
    })
  }

  return NextResponse.json({ ok: true, mensaje: 'Turno cancelado y horario liberado' })
}
