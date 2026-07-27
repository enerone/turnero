import type { TenantClient } from '@/lib/db/tenant-client'

export interface HorarioSlot {
  inicio: Date
  fin: Date
  servicioId: string
  servicioNombre: string
  duracionMinutos: number
}

export interface DisponibilidadDia {
  fecha: Date
  slots: HorarioSlot[]
}

const MS_POR_MINUTO = 60_000

/**
 * Devuelve la fecha absoluta que representa "00:00 del día `year-month-day`
 * en el timezone `tz`". El resultado es un Date en UTC que, cuando se
 * formatea con `timeZone: tz`, se lee como esa medianoche local.
 *
 * Ejemplo: `zonedYmdToDate(2026, 7, 27, 'America/Argentina/Buenos_Aires')`
 * → Date que corresponde a 2026-07-27T03:00:00Z (00:00 ARG = 03:00 UTC).
 *
 * Estrategia: probar UTC como candidato, ver qué hora local devuelve, corregir.
 * DST-aware (funciona tanto para ARG sin DST como para Uruguay con DST).
 */
function zonedYmdToDate(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  // Candidato ingenuo: interpretar como UTC.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  // Ver a qué hora local del tz apunta esa marca UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(utcGuess))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  // El hour local a veces vuelve como 24 en vez de 0 en cambios de día.
  if (map.hour === 24) map.hour = 0
  // Diferencia = local - solicitado (en minutos).
  const localMinutes = map.hour * 60 + map.minute
  const requestedMinutes = hour * 60 + minute
  const dayDiff = (map.year - year) * 365 * 24 * 60 + (map.month - month) * 30 * 24 * 60 + (map.day - day) * 24 * 60
  const totalDiffMin = dayDiff + (localMinutes - requestedMinutes)
  return new Date(utcGuess - totalDiffMin * MS_POR_MINUTO)
}

/**
 * Devuelve el día de la semana (0=domingo, 6=sábado) en el timezone dado.
 */
function zonedWeekday(date: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s] ?? 0
}

/**
 * Devuelve `year-month-day` como strings, en el timezone dado, para usar como
 * key de excepciones.
 */
function zonedYmd(date: Date, tz: string): { y: number; m: number; d: number; key: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    key: `${map.year}-${map.month}-${map.day}`,
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * MS_POR_MINUTO)
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_POR_MINUTO)
}

/**
 * `HorarioSemanal.desde` y `.hasta` vienen como Date (@db.Time). Prisma los
 * devuelve como Date con año/mes/día random y las horas seteadas. Extraemos
 * horas y minutos en UTC (Postgres los guarda sin zone).
 */
function extraerHhMm(t: Date): { h: number; m: number } {
  return { h: t.getUTCHours(), m: t.getUTCMinutes() }
}

export async function calcularDisponibilidad(
  db: TenantClient,
  params: {
    desde: Date
    hasta: Date
    servicioId?: string
    timezone: string
  },
): Promise<DisponibilidadDia[]> {
  const { desde, hasta, servicioId, timezone } = params

  const [horarios, excepciones, servicios, turnos, eventosExternos] = await Promise.all([
    db.horarioSemanal.findMany({
      orderBy: { diaSemana: 'asc' },
    }),
    db.excepcionHorario.findMany({
      where: { fecha: { gte: desde, lte: hasta } },
    }),
    db.servicio.findMany({
      where: {
        activo: true,
        ...(servicioId ? { id: servicioId } : {}),
      },
      orderBy: { esDefault: 'desc' },
    }),
    db.turno.findMany({
      where: {
        inicio: { gte: desde, lte: hasta },
        estado: { in: ['confirmado', 'borrador'] },
      },
      select: { inicio: true, fin: true, servicioId: true },
    }),
    // Bloqueos importados desde Google Calendar: aunque la sync bidireccional
    // vive en Plan 3b, ya podemos filtrarlos si aparecen.
    db.eventoExterno.findMany({
      where: { inicio: { gte: desde, lte: hasta } },
      select: { inicio: true, fin: true },
    }),
  ])

  if (horarios.length === 0 || servicios.length === 0) return []

  const excepcionesMap = new Map<string, typeof excepciones[0]>()
  for (const exc of excepciones) {
    const key = zonedYmd(exc.fecha, timezone).key
    excepcionesMap.set(key, exc)
  }

  const bloqueosGlobales: Array<{ inicio: Date; fin: Date }> = eventosExternos.map((e) => ({
    inicio: e.inicio,
    fin: e.fin,
  }))

  const turnosByServicio = new Map<string, Array<{ inicio: Date; fin: Date }>>()
  for (const t of turnos) {
    const arr = turnosByServicio.get(t.servicioId) ?? []
    arr.push({ inicio: t.inicio, fin: t.fin })
    turnosByServicio.set(t.servicioId, arr)
  }

  const resultado: DisponibilidadDia[] = []
  const ahora = new Date()
  const desdeYmd = zonedYmd(desde, timezone)
  const hastaYmd = zonedYmd(hasta, timezone)

  // Iteramos por día calendario en el timezone del tenant.
  let y = desdeYmd.y, m = desdeYmd.m, d = desdeYmd.d
  while (true) {
    const inicioDiaLocal = zonedYmdToDate(y, m, d, 0, 0, timezone)
    if (inicioDiaLocal > hasta) break

    const fechaKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const diaSemana = zonedWeekday(inicioDiaLocal, timezone)
    const excepcion = excepcionesMap.get(fechaKey)

    if (excepcion?.tipo === 'cerrado') {
      const next = addDays(inicioDiaLocal, 1)
      const p = zonedYmd(next, timezone)
      y = p.y; m = p.m; d = p.d
      continue
    }

    const horariosDelDia = horarios.filter((h) => h.diaSemana === diaSemana)
    if (horariosDelDia.length === 0) {
      const next = addDays(inicioDiaLocal, 1)
      const p = zonedYmd(next, timezone)
      y = p.y; m = p.m; d = p.d
      continue
    }

    const slots: HorarioSlot[] = []

    for (const servicio of servicios) {
      const duracion = servicio.duracionMinutos
      const turnosServicio = turnosByServicio.get(servicio.id) ?? []

      for (const horario of horariosDelDia) {
        const hd = extraerHhMm(horario.desde)
        const hh = extraerHhMm(horario.hasta)
        let slotInicio = zonedYmdToDate(y, m, d, hd.h, hd.m, timezone)
        let slotFin = zonedYmdToDate(y, m, d, hh.h, hh.m, timezone)

        if (excepcion?.tipo === 'horario_especial' && excepcion.desde && excepcion.hasta) {
          const ed = extraerHhMm(excepcion.desde)
          const eh = extraerHhMm(excepcion.hasta)
          const exDesde = zonedYmdToDate(y, m, d, ed.h, ed.m, timezone)
          const exHasta = zonedYmdToDate(y, m, d, eh.h, eh.m, timezone)
          if (slotInicio < exDesde) slotInicio = exDesde
          if (slotFin > exHasta) slotFin = exHasta
        }

        while (addMinutes(slotInicio, duracion) <= slotFin) {
          const slotFinCalc = addMinutes(slotInicio, duracion)

          // Slots en el pasado no aparecen.
          if (slotInicio <= ahora) {
            slotInicio = addMinutes(slotInicio, duracion)
            continue
          }

          const chocaConTurno = turnosServicio.some((t) => slotInicio < t.fin && slotFinCalc > t.inicio)
          const chocaConEventoExterno = bloqueosGlobales.some((b) => slotInicio < b.fin && slotFinCalc > b.inicio)

          if (!chocaConTurno && !chocaConEventoExterno) {
            slots.push({
              inicio: new Date(slotInicio),
              fin: new Date(slotFinCalc),
              servicioId: servicio.id,
              servicioNombre: servicio.nombre,
              duracionMinutos: duracion,
            })
          }

          slotInicio = addMinutes(slotInicio, duracion)
        }
      }
    }

    if (slots.length > 0) {
      slots.sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
      resultado.push({ fecha: inicioDiaLocal, slots })
    }

    const next = addDays(inicioDiaLocal, 1)
    const p = zonedYmd(next, timezone)
    y = p.y; m = p.m; d = p.d
    if (y > hastaYmd.y || (y === hastaYmd.y && (m > hastaYmd.m || (m === hastaYmd.m && d > hastaYmd.d)))) break
  }

  return resultado
}
