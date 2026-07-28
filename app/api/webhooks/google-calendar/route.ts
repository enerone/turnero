import { NextResponse, type NextRequest } from 'next/server'
import { obtenerIntegracionPorChannel } from '@/lib/calendar/google-client'
import { enqueuePullCalendarChanges } from '@/lib/jobs/enqueue'
import { logger } from '@/lib/shared/logger'

export const dynamic = 'force-dynamic'

/**
 * Webhook receiver de Google Calendar. Google POSTea acá cada vez que hay un
 * cambio en un calendario que estamos watching. El body no importa — la info
 * viene en headers:
 *
 * - X-Goog-Channel-ID: el channelId que le dimos a Google al crear el watch.
 * - X-Goog-Channel-Token: el token secreto que le dimos, reenviado tal cual.
 * - X-Goog-Resource-State: "sync" (inicial), "exists" (cambio), "not_exists".
 * - X-Goog-Message-Number: monotónicamente creciente por channel.
 *
 * Responsabilidad de este endpoint: validar el token, resolver a qué cuenta
 * pertenece el channel, y encolar un job de pull incremental. El trabajo real
 * lo hace `pull-calendar-changes` handler.
 *
 * DEBE devolver 200 rápido (Google reintenta si no).
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get('x-goog-channel-id')
  const channelToken = req.headers.get('x-goog-channel-token')
  const resourceState = req.headers.get('x-goog-resource-state')

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 })
  }

  // 'sync' es el ping inicial que Google manda al crear el watch — sólo
  // confirma que el endpoint es alcanzable, no hay cambios que traer.
  if (resourceState === 'sync') {
    return new NextResponse(null, { status: 200 })
  }

  const integracion = await obtenerIntegracionPorChannel(channelId)
  if (!integracion) {
    // Channel desconocido: probablemente watch viejo huérfano. 410 le dice a
    // Google que deje de mandarnos pings.
    logger.warn({ channelId }, 'webhook: channel desconocido, respondemos 410')
    return new NextResponse(null, { status: 410 })
  }

  if (integracion.token && channelToken !== integracion.token) {
    logger.warn({ channelId, cuentaId: integracion.cuenta_id }, 'webhook: token mismatch, ignoramos')
    return new NextResponse(null, { status: 401 })
  }

  try {
    await enqueuePullCalendarChanges({
      cuentaId: integracion.cuenta_id,
      tipo: integracion.tipo,
    })
  } catch (err) {
    logger.error({ err, cuentaId: integracion.cuenta_id }, 'webhook: falló enqueue de pull')
    // Devolvemos 500 para que Google reintente en unos minutos.
    return new NextResponse(null, { status: 500 })
  }

  return new NextResponse(null, { status: 200 })
}
