import { basePrisma } from '@/lib/db/base-prisma'
import {
  obtenerCalendarClient,
  obtenerIntegracionCalendar,
} from '@/lib/calendar/google-client'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_BOOTSTRAP_CALENDAR = 'bootstrap-calendar'

export interface PayloadBootstrapCalendar {
  cuentaId: string
}

const NOMBRE_CALENDARIO_DEDICADO = 'Turnero'

export async function handlerBootstrapCalendar(payload: PayloadBootstrapCalendar): Promise<void> {
  const { cuentaId } = payload

  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    throw new Error(`IntegracionCalendar no existe para cuenta ${cuentaId}`)
  }

  if (integracion.calendar_id_dedicado) {
    logger.info(
      { cuentaId, calendarId: integracion.calendar_id_dedicado },
      'bootstrap-calendar: ya existe, skip',
    )
    return
  }

  const calendar = await obtenerCalendarClient(cuentaId)

  const lista = await calendar.calendarList.list({})
  const existente = lista.data.items?.find(
    (c) => c.summary === NOMBRE_CALENDARIO_DEDICADO && c.id,
  )

  let calendarId: string
  if (existente?.id) {
    calendarId = existente.id
    logger.info(
      { cuentaId, calendarId },
      'bootstrap-calendar: reusando calendario existente',
    )
  } else {
    const creado = await calendar.calendars.insert({
      requestBody: { summary: NOMBRE_CALENDARIO_DEDICADO },
    })
    if (!creado.data.id) {
      throw new Error('Google no devolvió id al crear calendario')
    }
    calendarId = creado.data.id
    logger.info({ cuentaId, calendarId }, 'bootstrap-calendar: calendario creado')
  }

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
    await tx.integracionCalendar.update({
      where: { cuentaId },
      data: { calendarIdDedicado: calendarId },
    })
  })
}
