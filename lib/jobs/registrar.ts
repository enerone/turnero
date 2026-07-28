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
import {
  handler as handlerOutbox,
  NOMBRE_JOB_OUTBOX,
} from './handlers/procesar-outbox'
import {
  handlerSyncTurnoGoogle,
  NOMBRE_JOB_SYNC_TURNO_GOOGLE,
  type PayloadSyncTurnoGoogle,
} from './handlers/sync-turno-google'
import {
  handlerPullCalendarChanges,
  NOMBRE_JOB_PULL_CALENDAR_CHANGES,
  type PayloadPullCalendarChanges,
} from './handlers/pull-calendar-changes'
import {
  handlerRenovarWatchChannels,
  NOMBRE_JOB_RENOVAR_WATCHES,
} from './handlers/renovar-watch-channels'

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
  {
    nombre: NOMBRE_JOB_OUTBOX,
    handler: () => handlerOutbox(),
  },
  {
    nombre: NOMBRE_JOB_SYNC_TURNO_GOOGLE,
    handler: (data) => handlerSyncTurnoGoogle(data as PayloadSyncTurnoGoogle),
  },
  {
    nombre: NOMBRE_JOB_PULL_CALENDAR_CHANGES,
    handler: (data) => handlerPullCalendarChanges(data as PayloadPullCalendarChanges),
  },
  {
    nombre: NOMBRE_JOB_RENOVAR_WATCHES,
    handler: () => handlerRenovarWatchChannels(),
  },
]

let registrado = false

const CRON_RECORDATORIO = '0 9 * * *' // 09:00 UTC = 06:00 ARG
const CRON_OUTBOX = '* * * * *' // cada minuto
const CRON_RENOVAR_WATCHES = '15 * * * *' // cada hora en el minuto 15

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

  try {
    await boss.schedule(NOMBRE_JOB_OUTBOX, CRON_OUTBOX, {}, { tz: 'UTC' })
    logger.info({ cron: CRON_OUTBOX }, 'Outbox worker agendado')
  } catch (err) {
    logger.error({ err }, 'Error agendando cron de outbox')
  }

  try {
    await boss.schedule(NOMBRE_JOB_RENOVAR_WATCHES, CRON_RENOVAR_WATCHES, {}, { tz: 'UTC' })
    logger.info({ cron: CRON_RENOVAR_WATCHES }, 'Renovar watches agendado')
  } catch (err) {
    logger.error({ err }, 'Error agendando cron de renovar watches')
  }
}
