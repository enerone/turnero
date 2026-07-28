import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { obtenerCalendarClient, obtenerIntegracionCalendar } from '@/lib/calendar/google-client'
import type { calendar_v3 } from 'googleapis'
import { escribirAudit } from '@/lib/audit/log'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_PULL_CALENDAR_CHANGES = 'pull-calendar-changes'

export type TipoCalendario = 'dedicado' | 'primario'

export interface PayloadPullCalendarChanges {
  cuentaId: string
  tipo: TipoCalendario
}

/**
 * Pull incremental: trae cambios del calendario dedicado o primario desde
 * el último `sync_token`. Si nunca hicimos sync (sync_token null), hace un
 * full-sync con horizonte de 90 días hacia adelante.
 *
 * Aplica los cambios:
 * - Calendario dedicado: match por googleEventId con Turno; last-write-wins
 *   por etag; delete → cancela el turno.
 * - Calendario primario: upsert EventoExterno (bloquea slots).
 *
 * Idempotente por sync_token: si el ping se procesa dos veces, el segundo
 * pull devuelve 0 cambios.
 */
export async function handlerPullCalendarChanges(payload: PayloadPullCalendarChanges): Promise<void> {
  const { cuentaId, tipo } = payload

  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    logger.warn({ cuentaId, tipo }, 'pull: no hay IntegracionCalendar, skip')
    return
  }

  const calendarId = tipo === 'dedicado' ? integracion.calendar_id_dedicado : integracion.calendar_id_primario
  const syncToken = tipo === 'dedicado' ? integracion.sync_token_dedicado : integracion.sync_token_primario

  if (!calendarId) {
    logger.warn({ cuentaId, tipo }, 'pull: calendar_id no seteado (bootstrap incompleto)')
    return
  }

  const calendar = await obtenerCalendarClient(cuentaId)
  const eventos = await listarConSyncToken(calendar, calendarId, syncToken)
  const db = createTenantClient(cuentaId)

  let procesados = 0
  for (const ev of eventos.items) {
    try {
      if (tipo === 'dedicado') {
        await aplicarCambioDedicado(db, ev)
      } else {
        await aplicarCambioPrimario(db, ev)
      }
      procesados += 1
    } catch (err) {
      logger.error({ err, cuentaId, tipo, eventId: ev.id }, 'pull: error aplicando cambio, continúa')
    }
  }

  // Persistimos el nuevo sync_token para el próximo pull.
  if (eventos.nextSyncToken) {
    await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
      await tx.integracionCalendar.update({
        where: { cuentaId },
        data: tipo === 'dedicado'
          ? { syncTokenDedicado: eventos.nextSyncToken }
          : { syncTokenPrimario: eventos.nextSyncToken },
      })
    })
  }

  logger.info({ cuentaId, tipo, procesados, cambios: eventos.items.length }, 'pull: procesado')
}

interface ResultadoPull {
  items: calendar_v3.Schema$Event[]
  nextSyncToken: string | null
}

async function listarConSyncToken(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  syncToken: string | null,
): Promise<ResultadoPull> {
  const items: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  do {
    try {
      const res = await calendar.events.list({
        calendarId,
        syncToken: syncToken && !pageToken ? syncToken : undefined,
        pageToken,
        // Cuando NO tenemos syncToken previo, hacemos full-sync desde ahora
        // con horizonte de 90 días (suficiente para todos los turnos activos).
        ...(!syncToken && !pageToken
          ? {
              timeMin: new Date().toISOString(),
              timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
              singleEvents: true,
            }
          : {}),
        maxResults: 250,
      })
      if (res.data.items) items.push(...res.data.items)
      pageToken = res.data.nextPageToken ?? undefined
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken
    } catch (err) {
      const status = (err as { code?: number }).code
      // 410 Gone → syncToken invalidado. Restart full sync sin token.
      if (status === 410) {
        logger.warn({ calendarId }, 'pull: syncToken gone, reintenta full sync')
        return listarConSyncToken(calendar, calendarId, null)
      }
      throw err
    }
  } while (pageToken)

  return { items, nextSyncToken }
}

async function aplicarCambioDedicado(
  db: ReturnType<typeof createTenantClient>,
  ev: calendar_v3.Schema$Event,
): Promise<void> {
  if (!ev.id) return

  const turno = await db.turno.findFirst({ where: { googleEventId: ev.id } })

  // Evento borrado o cancelado en Google → cancelamos el turno local.
  if (ev.status === 'cancelled') {
    if (turno && turno.estado !== 'cancelado') {
      await db.turno.update({
        where: { id: turno.id },
        data: {
          estado: 'cancelado',
          origenCancelacion: 'google_calendar',
          googleEventEtag: ev.etag ?? null,
        },
      })
      await escribirAudit(db, {
        accion: 'turno_cancelado',
        entidad: 'turno',
        entidadId: turno.id,
        payload: { origen: 'google_calendar', googleEventId: ev.id },
      })
    }
    return
  }

  if (!turno) {
    // Regla de conflicto #4 (docs/calendar-sync-rules.md):
    // Evento creado directamente en Google en el calendario dedicado — no lo
    // convertimos en Turno porque no tenemos cliente ni servicio para
    // asociar. Lo guardamos como EventoExterno para que bloquee slots en el
    // booking público. El profesional puede crear el turno formal desde el
    // panel si quiere.
    const inicio = ev.start?.dateTime ? new Date(ev.start.dateTime) : null
    const fin = ev.end?.dateTime ? new Date(ev.end.dateTime) : null
    if (!inicio || !fin) return
    await db.eventoExterno.create({
      data: {
        googleEventId: ev.id,
        inicio,
        fin,
        titulo: ev.summary ?? '(sin título)',
      } as any,
    })
    logger.info(
      { googleEventId: ev.id, summary: ev.summary },
      'pull dedicado: evento nuevo importado como EventoExterno (regla #4)',
    )
    return
  }

  // Update: comparar etag para last-write-wins.
  if (turno.googleEventEtag && ev.etag === turno.googleEventEtag) return // no cambió

  const inicio = ev.start?.dateTime ? new Date(ev.start.dateTime) : turno.inicio
  const fin = ev.end?.dateTime ? new Date(ev.end.dateTime) : turno.fin

  await db.turno.update({
    where: { id: turno.id },
    data: {
      inicio,
      fin,
      googleEventEtag: ev.etag ?? null,
      // Si el turno se movió, resetear la flag de recordatorio.
      recordatorioEnviadoEn: inicio.getTime() !== turno.inicio.getTime() ? null : undefined,
    },
  })
  await escribirAudit(db, {
    accion: 'turno_movido',
    entidad: 'turno',
    entidadId: turno.id,
    payload: { origen: 'google_calendar', nuevoInicio: inicio.toISOString() },
  })
}

async function aplicarCambioPrimario(
  db: ReturnType<typeof createTenantClient>,
  ev: calendar_v3.Schema$Event,
): Promise<void> {
  if (!ev.id) return

  // Eventos borrados: sacamos del EventoExterno.
  if (ev.status === 'cancelled') {
    await db.eventoExterno.deleteMany({ where: { googleEventId: ev.id } })
    return
  }

  // Only-date events (all-day) → los ignoramos: no bloquean slots discretos.
  const inicio = ev.start?.dateTime ? new Date(ev.start.dateTime) : null
  const fin = ev.end?.dateTime ? new Date(ev.end.dateTime) : null
  if (!inicio || !fin) return

  // Upsert por googleEventId (unique index en EventoExterno).
  const existente = await db.eventoExterno.findFirst({ where: { googleEventId: ev.id } })
  if (existente) {
    await db.eventoExterno.update({
      where: { id: existente.id },
      data: { inicio, fin, titulo: ev.summary ?? null },
    })
  } else {
    await db.eventoExterno.create({
      data: {
        googleEventId: ev.id,
        inicio,
        fin,
        titulo: ev.summary ?? null,
      } as any,
    })
  }
}
