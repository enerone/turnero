import type { Prisma } from '@prisma/client'
import { createTenantClient } from '@/lib/db/tenant-client'

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

export interface RangoFechas {
  desde: Date
  hasta: Date
}

const MS_POR_MINUTO = 60_000
const MS_POR_HORA = 3_600_000

function timeToMinutes(time: Date): number {
  return time.getUTCHours() * 60 + time.getUTCMinutes()
}

function minutesToTime(minutes: number, baseDate: Date): Date {
  const d = new Date(baseDate)
  d.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_POR_MINUTO)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
}

export async function calcularDisponibilidad(
  db: ReturnType<typeof createTenantClient>,
  params: {
    desde: Date
    hasta: Date
    servicioId?: string
  }
): Promise<DisponibilidadDia[]> {
  const { desde, hasta, servicioId } = params

  const [horarios, excepciones, servicios, turnos] = await Promise.all([
    db.horarioSemanal.findMany({
      where: { cuentaId: { equals: '' } }, // se filtra por tenant client
      orderBy: { diaSemana: 'asc' },
    }),
    db.excepcionHorario.findMany({
      where: {
        fecha: { gte: desde, lte: hasta },
      },
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
        ...(servicioId ? { servicioId } : {}),
      },
      select: { inicio: true, fin: true, servicioId: true },
    }),
  ])

  if (horarios.length === 0 || servicios.length === 0) {
    return []
  }

  const excepcionesMap = new Map<string, typeof excepciones[0]>()
  for (const exc of excepciones) {
    const key = exc.fecha.toISOString().split('T')[0]
    excepcionesMap.set(key, exc)
  }

  const turnosByServicio = new Map<string, Array<{ inicio: Date; fin: Date }>>()
  for (const t of turnos) {
    const arr = turnosByServicio.get(t.servicioId) ?? []
    arr.push({ inicio: t.inicio, fin: t.fin })
    turnosByServicio.set(t.servicioId, arr)
  }

  const resultado: DisponibilidadDia[] = []
  let current = new Date(desde)
  current.setUTCHours(0, 0, 0, 0)

  while (current <= hasta) {
    const fechaKey = current.toISOString().split('T')[0]
    const diaSemana = current.getUTCDay()

    const excepcion = excepcionesMap.get(fechaKey)

    if (excepcion?.tipo === 'cerrado') {
      current = addMinutes(current, 24 * 60)
      continue
    }

    const horariosDelDia = horarios.filter(h => h.diaSemana === diaSemana)
    if (horariosDelDia.length === 0) {
      current = addMinutes(current, 24 * 60)
      continue
    }

    const slots: HorarioSlot[] = []

    for (const servicio of servicios) {
      const duracion = servicio.duracionMinutos
      const turnosServicio = turnosByServicio.get(servicio.id) ?? []

      for (const horario of horariosDelDia) {
        let slotInicio = minutesToTime(timeToMinutes(horario.desde), current)
        const slotFin = minutesToTime(timeToMinutes(horario.hasta), current)

        if (excepcion?.tipo === 'horario_especial' && excepcion.desde && excepcion.hasta) {
          const exDesde = minutesToTime(timeToMinutes(excepcion.desde), current)
          const exHasta = minutesToTime(timeToMinutes(excepcion.hasta), current)
          if (slotInicio < exDesde) slotInicio = exDesde
          if (slotFin > exHasta) continue
        }

        while (addMinutes(slotInicio, duracion) <= slotFin) {
          const slotFinCalc = addMinutes(slotInicio, duracion)

          const conflicto = turnosServicio.some(t =>
            slotInicio < t.fin && slotFinCalc > t.inicio
          )

          if (!conflicto) {
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
      resultado.push({ fecha: new Date(current), slots })
    }

    current = addMinutes(current, 24 * 60)
  }

  return resultado
}

