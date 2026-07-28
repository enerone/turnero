import { randomBytes, createHash } from 'node:crypto'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { formatearFechaLocal, formatearHoraLocal } from '@/lib/format/fecha'
import { encolarEmail, encolarWhatsApp } from '@/lib/outbox/encolar'

export const NOMBRE_JOB_RECORDATORIO = 'recordatorio-diario'

const TZ_DEFAULT = 'America/Argentina/Buenos_Aires'

async function crearTokenParaRecordatorio(
  db: ReturnType<typeof createTenantClient>,
  turnoId: string,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const expira = new Date(Date.now() + 25 * 60 * 60 * 1000) // cubre hasta después del turno
  await db.tokenConfirmacion.create({
    data: { turnoId, tokenHash, expiraEn: expira } as any,
  })
  return raw
}

/**
 * Corre diario. Busca turnos confirmados que arrancan en las próximas 24h y
 * NO tienen recordatorio ya enviado. Encola email + WhatsApp en la outbox y
 * marca `recordatorio_enviado_en = now()` para idempotencia.
 *
 * Encolar en outbox (en vez de enviar inline) desacopla este cron de la
 * disponibilidad de Resend/Meta y lo hace idempotente vs reintentos de
 * proveedores.
 */
export async function handler(): Promise<void> {
  const ahora = new Date()
  const en24h = new Date(ahora.getTime() + 24 * 60 * 60 * 1000)

  const cuentas = await basePrisma.cuenta.findMany({
    select: { id: true, slug: true, nombrePublico: true, timezone: true },
  })

  let totalTurnos = 0
  let totalEnviados = 0

  for (const cuenta of cuentas) {
    const db = createTenantClient(cuenta.id)

    const turnos = await db.turno.findMany({
      where: {
        estado: 'confirmado',
        inicio: { gte: ahora, lte: en24h },
        recordatorioEnviadoEn: null,
      },
      include: { cliente: true, servicio: true },
    })

    totalTurnos += turnos.length

    for (const turno of turnos) {
      if (!turno.cliente) continue

      const tz = cuenta.timezone || TZ_DEFAULT
      const fecha = formatearFechaLocal(turno.inicio, tz)
      const hora = formatearHoraLocal(turno.inicio, tz)
      const token = await crearTokenParaRecordatorio(db, turno.id)
      const cancelUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${token}`

      if (turno.cliente.email) {
        await encolarEmail(db, {
          destinatario: turno.cliente.email,
          asunto: `Recordatorio: tu turno en ${cuenta.nombrePublico}`,
          cuerpoHtml: `
            <p>Hola ${turno.cliente.nombre},</p>
            <p>Te recordamos tu turno en <strong>${cuenta.nombrePublico}</strong>.</p>
            <p><strong>${turno.servicio.nombre}</strong> · ${fecha} a las ${hora}</p>
            <p>Si no podés ir, cancelá desde <a href="${cancelUrl}">este link</a> y liberás el horario.</p>
          `,
        })
      }

      await encolarWhatsApp(db, {
        destinatario: turno.cliente.telefono,
        cuerpo: `Recordatorio: tu turno en ${cuenta.nombrePublico} es ${fecha} a las ${hora} (${turno.servicio.nombre}).\n\nSi no podés venir, cancelalo acá: ${cancelUrl}`,
      })

      await db.turno.update({
        where: { id: turno.id },
        data: { recordatorioEnviadoEn: new Date() },
      })

      totalEnviados += 1
    }
  }

  logger.info({ totalTurnos, totalEnviados, cuentas: cuentas.length }, 'Recordatorios encolados')
}
