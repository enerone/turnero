import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { enviarEmailConfirmacion } from '@/lib/public-booking/email'
import { enviarWhatsAppConfirmacion } from '@/lib/public-booking/whatsapp'
import { escribirAudit } from '@/lib/audit/log'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

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
  const fechaLocal = inicioDt.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: cuenta.timezone,
  })
  const horaLocal = inicioDt.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: cuenta.timezone,
  })

  try {
    if (cliente.email) {
      await enviarEmailConfirmacion({
        to: cliente.email,
        cuentaNombre: cuenta.nombrePublico,
        confirmUrl,
        servicio: servicio.nombre,
        fecha: fechaLocal,
        hora: horaLocal,
      })
    }
  } catch (err) {
    logger.warn({ err, turnoId: turno.id }, 'No se pudo enviar email de confirmación')
  }

  try {
    await enviarWhatsAppConfirmacion({
      to: cliente.telefono,
      cuentaNombre: cuenta.nombrePublico,
      confirmUrl,
      servicio: servicio.nombre,
      fecha: fechaLocal,
      hora: horaLocal,
    })
  } catch (err) {
    logger.warn({ err, turnoId: turno.id }, 'No se pudo enviar WhatsApp de confirmación')
  }

  logger.info({ turnoId: turno.id, cuentaId: cuenta.id }, 'Turno borrador creado, token enviado')

  return NextResponse.json({
    ok: true,
    turnoId: turno.id,
    confirmUrl,
    expiraEn: expiraEn.toISOString(),
  })
}
