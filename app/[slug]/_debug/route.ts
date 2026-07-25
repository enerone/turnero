import { NextResponse } from 'next/server'
import { getTenant } from '@/lib/tenant/resolve'
import { NoTenantInRequestError, TenantNotFoundError } from '@/lib/db/errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const { cuenta, db } = await getTenant()
    const cantidadServicios = await db.servicio.count()
    const cantidadTurnos = await db.turno.count()

    return NextResponse.json({
      cuenta: {
        id: cuenta.id,
        slug: cuenta.slug,
        nombrePublico: cuenta.nombrePublico,
      },
      counts: {
        servicios: cantidadServicios,
        turnos: cantidadTurnos,
      },
    })
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
