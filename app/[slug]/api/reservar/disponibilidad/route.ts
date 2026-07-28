import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { calcularDisponibilidad } from '@/lib/public-booking/disponibilidad'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'

const QuerySchema = z.object({
  desde: z.string().min(1),
  hasta: z.string().min(1),
  servicioId: z.string().uuid().optional(),
})

const MAX_DIAS = 90

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parámetros inválidos', detalles: parsed.error.flatten() }, { status: 400 })
  }

  const desde = new Date(parsed.data.desde)
  const hasta = new Date(parsed.data.hasta)
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  }
  if (desde > hasta) {
    return NextResponse.json({ error: 'desde debe ser anterior a hasta' }, { status: 400 })
  }
  const diffDias = Math.ceil((hasta.getTime() - desde.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDias > MAX_DIAS) {
    return NextResponse.json({ error: `Rango máximo ${MAX_DIAS} días` }, { status: 400 })
  }

  let cuenta, db
  try {
    ({ cuenta, db } = await getTenant())
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
    }
    throw e
  }

  const disponibilidad = await calcularDisponibilidad(db, {
    desde,
    hasta,
    servicioId: parsed.data.servicioId,
    timezone: cuenta.timezone,
  })

  return NextResponse.json({
    disponibilidad: disponibilidad.map((d) => ({
      fecha: d.fecha.toISOString(),
      slots: d.slots.map((s) => ({
        inicio: s.inicio.toISOString(),
        fin: s.fin.toISOString(),
        servicioId: s.servicioId,
        servicioNombre: s.servicioNombre,
        duracionMinutos: s.duracionMinutos,
      })),
    })),
  })
}
