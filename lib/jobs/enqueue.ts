import { obtenerBoss } from './boss'
import {
  NOMBRE_JOB_BOOTSTRAP_CALENDAR,
  type PayloadBootstrapCalendar,
} from './handlers/bootstrap-calendar'

export async function enqueueBootstrapCalendar(payload: PayloadBootstrapCalendar): Promise<string> {
  const boss = await obtenerBoss()
  const jobId = await boss.send(NOMBRE_JOB_BOOTSTRAP_CALENDAR, payload, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
  })
  if (!jobId) throw new Error(`pg-boss no devolvió jobId para ${NOMBRE_JOB_BOOTSTRAP_CALENDAR}`)
  return jobId
}
