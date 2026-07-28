import { obtenerBoss } from './boss'
import {
  NOMBRE_JOB_BOOTSTRAP_CALENDAR,
  type PayloadBootstrapCalendar,
} from './handlers/bootstrap-calendar'
import {
  NOMBRE_JOB_SYNC_TURNO_GOOGLE,
  type PayloadSyncTurnoGoogle,
} from './handlers/sync-turno-google'
import {
  NOMBRE_JOB_PULL_CALENDAR_CHANGES,
  type PayloadPullCalendarChanges,
} from './handlers/pull-calendar-changes'

export async function enqueueBootstrapCalendar(payload: PayloadBootstrapCalendar): Promise<string> {
  const boss = await obtenerBoss()
  const jobId = await boss.send(NOMBRE_JOB_BOOTSTRAP_CALENDAR, payload, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    singletonKey: `bootstrap-calendar:${payload.cuentaId}`,
  })
  if (!jobId) throw new Error(`pg-boss no devolvió jobId para ${NOMBRE_JOB_BOOTSTRAP_CALENDAR}`)
  return jobId
}

/**
 * Encola sync push del turno hacia Google. Idempotente por singletonKey:
 * si ya hay uno pendiente para este turno + operación, no duplicamos.
 */
export async function enqueueSyncTurnoGoogle(payload: PayloadSyncTurnoGoogle): Promise<string | null> {
  const boss = await obtenerBoss()
  return boss.send(NOMBRE_JOB_SYNC_TURNO_GOOGLE, payload, {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    singletonKey: `sync-turno-google:${payload.turnoId}:${payload.operacion}`,
  })
}

/**
 * Encola un pull incremental del calendario. Coalescing por (cuenta, tipo):
 * si llegan 3 pings del mismo channel en 10s, un solo pull cubre los cambios
 * porque el sync_token nos da todo lo pendiente.
 */
export async function enqueuePullCalendarChanges(payload: PayloadPullCalendarChanges): Promise<string | null> {
  const boss = await obtenerBoss()
  return boss.send(NOMBRE_JOB_PULL_CALENDAR_CHANGES, payload, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    singletonKey: `pull-calendar:${payload.cuentaId}:${payload.tipo}`,
    singletonSeconds: 10, // debounce
  })
}
