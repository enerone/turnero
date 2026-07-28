import { basePrisma } from '@/lib/db/base-prisma'
import { asegurarWatches } from '@/lib/calendar/watch'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_RENOVAR_WATCHES = 'renovar-watch-channels'

// Renovamos con 24h de margen: los watches de Google expiran en <=7 días
// y no queremos correr el riesgo de perder pings durante horas.
const MARGEN_MS = 24 * 60 * 60 * 1000

/**
 * Corre cada hora. Busca cuentas cuyos watch channels expiran en las próximas
 * 24h (o ya expiraron) y los renueva.
 *
 * `asegurarWatches` es idempotente: cierra el watch viejo (si existe) y crea
 * uno nuevo. Actualiza los 4×2 campos en IntegracionCalendar.
 */
export async function handlerRenovarWatchChannels(): Promise<void> {
  const limite = new Date(Date.now() + MARGEN_MS)

  // Query cross-tenant vía basePrisma — necesitamos ver todas las cuentas.
  // Filtramos por cualquiera de los dos watches vencidos/por vencer.
  const cuentas = await basePrisma.integracionCalendar.findMany({
    where: {
      OR: [
        { watchChannelDedicadoExpira: { lte: limite } },
        { watchChannelDedicadoExpira: null, calendarIdDedicado: { not: null } },
        { watchChannelPrimarioExpira: { lte: limite } },
        { watchChannelPrimarioExpira: null, calendarIdDedicado: { not: null } },
      ],
    },
    select: { cuentaId: true },
  })

  logger.info({ cuentas: cuentas.length }, 'renovar-watches: candidatos')

  for (const { cuentaId } of cuentas) {
    try {
      await asegurarWatches(cuentaId)
    } catch (err) {
      logger.error({ err, cuentaId }, 'renovar-watches: falló renovación, se reintenta próximo tick')
    }
  }
}
