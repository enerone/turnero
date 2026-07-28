import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { escribirAudit } from '@/lib/audit/log'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'
import { formatearFechaLocal, formatearHoraLocal } from '@/lib/format/fecha'
import { encolarEmail, encolarWhatsApp } from '@/lib/outbox/encolar'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  servicioId: z.string().uuid(),
  inicio: z.string().datetime(),
  fin: z.string().datetime(),
  cliente: z.object({
    nombre: z.string().min(1).max(120),
    telefono: z.string().min(6).max(30),
    email: z.string().email().optional().or(z.literal('')),
  }),
})

const TOKEN_TTL_MS = 30 * 60 * 1000

function generarToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(req: NextRequest) {
  let cuenta, db
  try {
    ({ cuenta, db } = await getTenant())
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
    }
    throw e
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalles: parsed.error.flatten() }, { status: 400 })
  }

  const { servicioId, inicio, fin, cliente: clienteRaw } = parsed.data
  const telefonoNormalizado = normalizarTelefonoE164(clienteRaw.telefono)
  if (!telefonoNormalizado) {
    return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
  }
  const cliente = { ...clienteRaw, telefono: telefonoNormalizado }
  const inicioDt = new Date(inicio)
  const finDt = new Date(fin)

  if (finDt <= inicioDt) {
    return NextResponse.json({ error: 'fin debe ser posterior a inicio' }, { status: 400 })
  }
  if (inicioDt < new Date()) {
    return NextResponse.json({ error: 'No se puede reservar en el pasado' }, { status: 400 })
  }

  const servicio = await db.servicio.findUnique({ where: { id: servicioId } })
  if (!servicio || !servicio.activo) {
    return NextResponse.json({ error: 'Servicio no disponible' }, { status: 404 })
  }

  let clienteDb = await db.cliente.findFirst({ where: { telefono: cliente.telefono } })
  if (!clienteDb) {
    clienteDb = await db.cliente.create({
      data: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email || null,
      } as any,
    })
  } else if (clienteDb.nombre !== cliente.nombre || (cliente.email && clienteDb.email !== cliente.email)) {
    await db.cliente.update({
      where: { id: clienteDb.id },
      data: {
        nombre: cliente.nombre,
        email: cliente.email || clienteDb.email,
      },
    })
  }

  const token = generarToken()
  const tokenHash = hashToken(token)
  const expiraEn = new Date(Date.now() + TOKEN_TTL_MS)

  // La exclusion constraint `turno_no_overlap` garantiza atomicidad: si dos
  // requests concurrentes intentan el mismo slot, el segundo INSERT falla con
  // 23P01 (exclusion_violation). Ya no hace falta el findFirst previo.
  let turno
  try {
    turno = await db.turno.create({
      data: {
        clienteId: clienteDb.id,
        servicioId,
        inicio: inicioDt,
        fin: finDt,
        estado: 'borrador',
        origen: 'turnero',
      } as any,
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      String((err.meta as { code?: string } | undefined)?.code) === '23P01'
    ) {
      return NextResponse.json({ error: 'El horario ya no está disponible' }, { status: 409 })
    }
    if (err instanceof Error && /exclusion_violation|turno_no_overlap|23P01/.test(err.message)) {
      return NextResponse.json({ error: 'El horario ya no está disponible' }, { status: 409 })
    }
    throw err
  }

  await db.tokenConfirmacion.create({
    data: {
      turnoId: turno.id,
      tokenHash,
      expiraEn,
    } as any,
  })

  await escribirAudit(db, {
    accion: 'turno_creado',
    entidad: 'turno',
    entidadId: turno.id,
    payload: {
      clienteId: clienteDb.id,
      servicioId,
      inicio: inicioDt.toISOString(),
      fin: finDt.toISOString(),
      canal: 'public_booking',
    },
  })

  const confirmUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${token}`
  const fechaLocal = formatearFechaLocal(inicioDt, cuenta.timezone)
  const horaLocal = formatearHoraLocal(inicioDt, cuenta.timezone)

  // Encolamos las notificaciones en la outbox — el worker las despacha con
  // reintento + backoff. Ventajas vs. envío inline:
  // 1. Idempotencia: retry del cliente no manda dos emails.
  // 2. Recovery: si Resend/Meta caen, se reintenta después.
  // 3. Latencia: la request devuelve al cliente sin esperar red externa.
  if (cliente.email) {
    await encolarEmail(db, {
      destinatario: cliente.email,
      asunto: `Confirmá tu turno en ${cuenta.nombrePublico}`,
      cuerpoHtml: `
        <p>Hola,</p>
        <p>Tenés un turno pendiente de confirmación en <strong>${cuenta.nombrePublico}</strong>.</p>
        <p><strong>${servicio.nombre}</strong> · ${fechaLocal} a las ${horaLocal}</p>
        <p><a href="${confirmUrl}" style="display:inline-block;padding:0.75rem 1.5rem;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">Confirmar mi turno</a></p>
        <p>El link expira en 30 minutos. Si no podés ir, cancelá desde el mismo link para liberar el horario.</p>
      `,
    })
  }
  await encolarWhatsApp(db, {
    destinatario: cliente.telefono,
    cuerpo: `Hola! Tenés un turno pendiente de confirmación en ${cuenta.nombrePublico}.\n\n${servicio.nombre}\n${fechaLocal} a las ${horaLocal}\n\nConfirmá acá: ${confirmUrl}\n\nEl link expira en 30 min. Si no vas a venir, cancelalo desde el mismo link.`,
  })

  logger.info({ turnoId: turno.id, cuentaId: cuenta.id }, 'Turno borrador creado, notificaciones encoladas')

  return NextResponse.json({
    ok: true,
    turnoId: turno.id,
    confirmUrl,
    expiraEn: expiraEn.toISOString(),
  })
}
