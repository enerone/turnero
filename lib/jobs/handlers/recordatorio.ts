import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { enviarEmailRecordatorio } from '@/lib/public-booking/email'
import { enviarWhatsAppRecordatorio } from '@/lib/public-booking/whatsapp'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_RECORDATORIO = 'recordatorio-diario'

const TZ_DEFAULT = 'America/Argentina/Buenos_Aires'

function formatFechaLocal(inicio: Date, timezone: string): { fecha: string; hora: string } {
  const fecha = inicio.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone,
  })
  const hora = inicio.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  })
  return { fecha, hora }
}

/**
 * Corre diario. Busca turnos confirmados que arrancan en las próximas 24h y
 * manda recordatorio por email + WhatsApp.
 *
 * TODO idempotencia: agregar columna `recordatorio_enviado_en` en `Turno` para
 * que dos corridas del mismo día no manden dos mensajes al mismo cliente.
 * Por ahora si el cron corre dos veces en el mismo día, el cliente recibe dos.
 * (Va con el schema-change de Lote 2.)
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
      },
      include: { cliente: true, servicio: true },
    })

    totalTurnos += turnos.length

    for (const turno of turnos) {
      if (!turno.cliente) continue

      const { fecha, hora } = formatFechaLocal(turno.inicio, cuenta.timezone || TZ_DEFAULT)
      const cancelUrl = `${env.PUBLIC_BASE_URL}/${cuenta.slug}/confirmar/${turno.id}`

      try {
        await enviarEmailRecordatorio({
          to: turno.cliente.email ?? '',
          cuentaNombre: cuenta.nombrePublico,
          servicio: turno.servicio.nombre,
          fecha,
          hora,
          cancelUrl,
        })
      } catch (err) {
        logger.error({ err, turnoId: turno.id }, 'Error enviando email de recordatorio')
      }

      try {
        await enviarWhatsAppRecordatorio({
          to: turno.cliente.telefono,
          cuentaNombre: cuenta.nombrePublico,
          servicio: turno.servicio.nombre,
          fecha,
          hora,
          cancelUrl,
        })
      } catch (err) {
        logger.error({ err, turnoId: turno.id }, 'Error enviando WhatsApp de recordatorio')
      }

      totalEnviados += 1
    }
  }

  logger.info({ totalTurnos, totalEnviados, cuentas: cuentas.length }, 'Recordatorios procesados')
}
