import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { obtenerCalendarClient, obtenerIntegracionCalendar } from '@/lib/calendar/google-client'
import { escribirAudit } from '@/lib/audit/log'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_SYNC_TURNO_GOOGLE = 'sync-turno-google'

export type OperacionSync = 'upsert' | 'delete'

export interface PayloadSyncTurnoGoogle {
  cuentaId: string
  turnoId: string
  operacion: OperacionSync
}

/**
 * Sincroniza un turno del turnero hacia el calendario dedicado de Google.
 *
 * Reglas:
 * - Sólo turnos confirmados llegan a Google. Borrador y cancelado NO (o SI el
 *   turno estaba en Google y ahora está cancelado, se BORRA de Google).
 * - Idempotente por diseño: si el turno ya tiene googleEventId, hacemos
 *   `events.patch` (update) en vez de re-insertar.
 * - Best-effort ante bootstrap incompleto: si `calendar_id_dedicado` es null,
 *   logueamos y NO reintentamos (bootstrap-calendar debería completarse
 *   primero; este job puede correr después).
 * - last-write-wins vía Google etag: mandamos `ifMatch: etag` cuando
 *   updateamos; si Google devuelve 412 (Precondition Failed), significa que
 *   Google tiene una versión más nueva → no pisamos, dejamos que el pull
 *   (Lote 6c) traiga los cambios.
 */
export async function handlerSyncTurnoGoogle(payload: PayloadSyncTurnoGoogle): Promise<void> {
  const { cuentaId, turnoId, operacion } = payload

  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    logger.warn({ cuentaId, turnoId }, 'sync-turno-google: no hay IntegracionCalendar, skip')
    return
  }
  if (!integracion.calendar_id_dedicado) {
    logger.warn(
      { cuentaId, turnoId },
      'sync-turno-google: calendario dedicado aún no creado (bootstrap incompleto), skip',
    )
    return
  }

  const db = createTenantClient(cuentaId)
  const turno = await db.turno.findUnique({
    where: { id: turnoId },
    include: { cliente: true, servicio: true },
  })
  if (!turno) {
    logger.warn({ cuentaId, turnoId }, 'sync-turno-google: turno no encontrado (¿eliminado?)')
    return
  }

  const calendar = await obtenerCalendarClient(cuentaId)
  const calendarId = integracion.calendar_id_dedicado

  if (operacion === 'delete') {
    if (!turno.googleEventId) {
      // Nunca se llegó a pushear a Google: nada que borrar.
      return
    }
    try {
      await calendar.events.delete({ calendarId, eventId: turno.googleEventId })
    } catch (err) {
      // 404 (Gone / Not Found): el evento ya no está en Google. Idempotente.
      const status = errorStatus(err)
      if (status !== 404 && status !== 410) throw err
    }
    await db.turno.update({
      where: { id: turnoId },
      data: { googleEventId: null, googleEventEtag: null },
    })
    await escribirAudit(db, {
      accion: 'turno_cancelado',
      entidad: 'turno',
      entidadId: turnoId,
      payload: { sync: 'google_deleted', googleEventId: turno.googleEventId },
    })
    return
  }

  // operacion === 'upsert'
  const nombreCliente = turno.cliente?.nombre ?? 'Cliente sin nombre'
  const requestBody = {
    summary: `${turno.servicio.nombre} - ${nombreCliente}`,
    description: turno.notas || undefined,
    start: { dateTime: turno.inicio.toISOString() },
    end: { dateTime: turno.fin.toISOString() },
  }

  if (turno.googleEventId) {
    // Update existente. Enviamos etag para last-write-wins.
    try {
      const res = await calendar.events.patch({
        calendarId,
        eventId: turno.googleEventId,
        requestBody,
        ...(turno.googleEventEtag ? { ifMatch: turno.googleEventEtag } : {}),
      })
      await db.turno.update({
        where: { id: turnoId },
        data: { googleEventEtag: res.data.etag ?? null },
      })
    } catch (err) {
      const status = errorStatus(err)
      if (status === 412) {
        // Google tiene versión más nueva. No pisamos — el pull (Lote 6c) va a
        // reconciliar. Nada más que hacer acá.
        logger.info(
          { cuentaId, turnoId, googleEventId: turno.googleEventId },
          'sync-turno-google: 412 precondition failed, cede a Google',
        )
        return
      }
      if (status === 404 || status === 410) {
        // El evento fue borrado desde Google. Limpiamos ID y re-insertamos.
        await db.turno.update({
          where: { id: turnoId },
          data: { googleEventId: null, googleEventEtag: null },
        })
        await insertar(db, calendar, calendarId, turnoId, requestBody)
        return
      }
      throw err
    }
    return
  }

  await insertar(db, calendar, calendarId, turnoId, requestBody)
}

async function insertar(
  db: ReturnType<typeof createTenantClient>,
  calendar: Awaited<ReturnType<typeof obtenerCalendarClient>>,
  calendarId: string,
  turnoId: string,
  requestBody: Record<string, unknown>,
): Promise<void> {
  const res = await calendar.events.insert({
    calendarId,
    requestBody: requestBody as any,
    sendUpdates: 'none',
  })
  if (!res.data.id) {
    throw new Error('Google no devolvió id al insertar evento')
  }
  await db.turno.update({
    where: { id: turnoId },
    data: {
      googleEventId: res.data.id,
      googleEventEtag: res.data.etag ?? null,
    },
  })
  await escribirAudit(db, {
    accion: 'turno_confirmado',
    entidad: 'turno',
    entidadId: turnoId,
    payload: { sync: 'google_inserted', googleEventId: res.data.id },
  })
}

function errorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const anyErr = err as { code?: number; response?: { status?: number } }
  return anyErr.code ?? anyErr.response?.status ?? null
}
