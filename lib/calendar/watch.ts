import { randomBytes } from 'node:crypto'
import type { calendar_v3 } from 'googleapis'
import { obtenerCalendarClient, obtenerIntegracionCalendar } from './google-client'
import { env } from '@/lib/shared/env'
import { basePrisma } from '@/lib/db/base-prisma'
import { logger } from '@/lib/shared/logger'

/**
 * Ciclo de watch channels de Google Calendar:
 *
 * 1. `events.watch` sobre el calendarId → Google devuelve `{ id, resourceId,
 *    expiration }`. Guardamos los 3 + un token secreto que enviamos y Google
 *    reenvía en cada ping.
 * 2. Cada vez que hay un cambio, Google POSTea al webhook con headers
 *    X-Goog-Channel-ID, X-Goog-Resource-ID, X-Goog-Resource-State,
 *    X-Goog-Channel-Token.
 * 3. Watches expiran en ≤ 7 días. Un cron los renueva 24h antes de expirar.
 *
 * Google requiere que el webhook sea HTTPS y esté accesible desde internet
 * (no localhost). En dev, usar un tunnel tipo ngrok y exportar
 * PUBLIC_BASE_URL=https://xxx.ngrok.io.
 */

export type TipoWatch = 'dedicado' | 'primario'

export interface DatosWatch {
  channelId: string
  resourceId: string
  token: string
  expira: Date
}

const WATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000 // Google TTL max

function generarToken(): string {
  return randomBytes(24).toString('base64url')
}

function webhookUrl(): string {
  return `${env.PUBLIC_BASE_URL}/api/webhooks/google-calendar`
}

/**
 * Crea un watch channel nuevo sobre `calendarId`. Devuelve los datos para
 * persistir en IntegracionCalendar (channelId, resourceId, token, expira).
 */
export async function crearWatch(
  calendar: calendar_v3.Calendar,
  calendarId: string,
): Promise<DatosWatch> {
  const channelId = randomBytes(16).toString('hex')
  const token = generarToken()
  const expiration = Date.now() + WATCH_TTL_MS

  const res = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl(),
      token,
      expiration: String(expiration),
    },
  })

  if (!res.data.resourceId) {
    throw new Error('Google no devolvió resourceId al crear watch')
  }

  const expiraStr = res.data.expiration ?? String(expiration)
  const expira = new Date(Number(expiraStr))

  return {
    channelId,
    resourceId: res.data.resourceId,
    token,
    expira,
  }
}

/**
 * Cierra un watch existente. Best-effort: si Google devuelve 404 (ya
 * cerrado/expirado), silenciamos.
 */
export async function detenerWatch(
  calendar: calendar_v3.Calendar,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await calendar.channels.stop({ requestBody: { id: channelId, resourceId } })
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } }).code ??
      (err as { response?: { status?: number } }).response?.status
    if (status === 404 || status === 410) return
    logger.warn({ err, channelId, resourceId }, 'detenerWatch: error no-fatal')
  }
}

/**
 * Setea ambos watches (dedicado + primario) para una cuenta. Idempotente:
 * si ya hay un watch vivo, lo cierra antes de crear el nuevo.
 * Persiste en IntegracionCalendar via basePrisma con SET LOCAL app.cuenta_id.
 */
export async function asegurarWatches(cuentaId: string): Promise<void> {
  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion || !integracion.calendar_id_dedicado) {
    logger.info({ cuentaId }, 'asegurarWatches: calendario dedicado aún no bootstrap, skip')
    return
  }

  const calendar = await obtenerCalendarClient(cuentaId)

  // Cerrar watches viejos si existen
  if (integracion.watch_channel_dedicado_id && integracion.watch_channel_dedicado_resource_id) {
    await detenerWatch(
      calendar,
      integracion.watch_channel_dedicado_id,
      integracion.watch_channel_dedicado_resource_id,
    )
  }
  if (integracion.watch_channel_primario_id && integracion.watch_channel_primario_resource_id) {
    await detenerWatch(
      calendar,
      integracion.watch_channel_primario_id,
      integracion.watch_channel_primario_resource_id,
    )
  }

  const dedicado = await crearWatch(calendar, integracion.calendar_id_dedicado)
  const primario = await crearWatch(calendar, integracion.calendar_id_primario)

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
    await tx.integracionCalendar.update({
      where: { cuentaId },
      data: {
        watchChannelDedicadoId: dedicado.channelId,
        watchChannelDedicadoResourceId: dedicado.resourceId,
        watchChannelDedicadoToken: dedicado.token,
        watchChannelDedicadoExpira: dedicado.expira,
        watchChannelPrimarioId: primario.channelId,
        watchChannelPrimarioResourceId: primario.resourceId,
        watchChannelPrimarioToken: primario.token,
        watchChannelPrimarioExpira: primario.expira,
      },
    })
  })

  logger.info(
    {
      cuentaId,
      dedicadoExpira: dedicado.expira.toISOString(),
      primarioExpira: primario.expira.toISOString(),
    },
    'asegurarWatches: watches configurados',
  )
}
