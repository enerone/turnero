import { randomBytes, createHash } from 'node:crypto'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { enviarEmailRecordatorio } from '@/lib/public-booking/email'
import { enviarWhatsAppRecordatorio } from '@/lib/public-booking/whatsapp'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { formatearFechaLocal, formatearHoraLocal } from '@/lib/format/fecha'

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
 * NO tienen recordatorio ya enviado. Manda por email + WhatsApp y marca
 * `recordatorio_enviado_en = now()` para idempotencia.
 *
 * Si el turno se mueve (update de inicio/fin), el caller es responsable de
 * resetear el flag a null — pendiente para cuando exista panel edit.
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

      // Marcamos como enviado independientemente del resultado de cada canal.
      // Si ambos fallan, el error queda en logs — no reintentamos para no
      // spamear al cliente.
      await db.turno.update({
        where: { id: turno.id },
        data: { recordatorioEnviadoEn: new Date() },
      })

      totalEnviados += 1
    }
  }

  logger.info({ totalTurnos, totalEnviados, cuentas: cuentas.length }, 'Recordatorios procesados')
}
