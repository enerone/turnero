import type PgBoss from 'pg-boss'
import { obtenerBoss } from './boss'
import { logger } from '@/lib/shared/logger'
import {
  handlerBootstrapCalendar,
  NOMBRE_JOB_BOOTSTRAP_CALENDAR,
  type PayloadBootstrapCalendar,
} from './handlers/bootstrap-calendar'
import {
  handler as handlerRecordatorio,
  NOMBRE_JOB_RECORDATORIO,
} from './handlers/recordatorio'

/**
 * Mapa de todos los jobs registrados. Extender acá cuando se agreguen jobs nuevos.
 */
const REGISTRO: Array<{
  nombre: string
  handler: (data: unknown) => Promise<void>
}> = [
  {
    nombre: NOMBRE_JOB_BOOTSTRAP_CALENDAR,
    handler: (data) => handlerBootstrapCalendar(data as PayloadBootstrapCalendar),
  },
  {
    nombre: NOMBRE_JOB_RECORDATORIO,
    handler: () => handlerRecordatorio(),
  },
]

let registrado = false

// Cron: todos los días a las 09:00 UTC (~06:00 ARG). pg-boss usa cron syntax estándar.
const CRON_RECORDATORIO = '0 9 * * *'

export async function registrarHandlers(): Promise<void> {
  if (registrado) return
  const boss = await obtenerBoss()

  for (const { nombre, handler } of REGISTRO) {
    await boss.work(nombre, async (job: PgBoss.Job<unknown> | Array<PgBoss.Job<unknown>>) => {
      const jobs = Array.isArray(job) ? job : [job]
      for (const j of jobs) {
        logger.info({ nombre, jobId: j.id }, 'ejecutando job')
        await handler(j.data)
      }
    })
    logger.info({ nombre }, 'handler registrado')
  }

  registrado = true

  try {
    await boss.schedule(NOMBRE_JOB_RECORDATORIO, CRON_RECORDATORIO, {}, { tz: 'UTC' })
    logger.info({ cron: CRON_RECORDATORIO }, 'Recordatorio diario agendado')
  } catch (err) {
    logger.error({ err }, 'Error agendando cron de recordatorio')
  }
}
