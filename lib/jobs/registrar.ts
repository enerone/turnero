import type PgBoss from 'pg-boss'
import { obtenerBoss } from './boss'
import { logger } from '@/lib/shared/logger'
import {
  handlerBootstrapCalendar,
  NOMBRE_JOB_BOOTSTRAP_CALENDAR,
  type PayloadBootstrapCalendar,
} from './handlers/bootstrap-calendar'

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
]

let registrado = false

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
}
