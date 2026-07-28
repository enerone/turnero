'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { puede } from '@/lib/auth/puede'
import { escribirAudit } from '@/lib/audit/log'
import { enqueueSyncTurnoGoogle } from '@/lib/jobs/enqueue'
import { logger } from '@/lib/shared/logger'

const CambiarEstadoSchema = z.object({
  turnoId: z.string().uuid(),
  nuevoEstado: z.enum(['confirmado', 'cancelado', 'completado', 'no_asistio']),
})

export interface AccionResult {
  ok: boolean
  error?: string
}

export async function cambiarEstadoTurno(input: unknown): Promise<AccionResult> {
  const parsed = CambiarEstadoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }

  const s = await getSession()
  if (!s) return { ok: false, error: 'No autenticado' }

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) return { ok: false, error: 'Sin permisos' }

  const { turnoId, nuevoEstado } = parsed.data
  const accionRequerida =
    nuevoEstado === 'cancelado' ? 'cancelar_turno' :
    nuevoEstado === 'completado' || nuevoEstado === 'no_asistio' ? 'completar_turno' :
    'ver_turno'

  if (!puede({ rol: s.user.rol, cuentaId: s.user.cuentaId }, accionRequerida)) {
    return { ok: false, error: 'Sin permisos' }
  }

  const turno = await db.turno.findUnique({ where: { id: turnoId } })
  if (!turno) return { ok: false, error: 'Turno no encontrado' }
  if (turno.estado === nuevoEstado) return { ok: true } // idempotente

  const data: {
    estado: typeof nuevoEstado
    origenCancelacion?: 'panel'
  } = { estado: nuevoEstado }
  if (nuevoEstado === 'cancelado') data.origenCancelacion = 'panel'

  await db.turno.update({ where: { id: turnoId }, data })

  await escribirAudit(db, {
    accion:
      nuevoEstado === 'cancelado' ? 'turno_cancelado' :
      nuevoEstado === 'confirmado' ? 'turno_confirmado' :
      'turno_movido',
    entidad: 'turno',
    entidadId: turnoId,
    usuarioId: s.user.id,
    payload: { origen: 'panel', nuevoEstado, estadoPrevio: turno.estado },
  })

  // Sync a Google:
  // - cancelado → borrar el evento.
  // - confirmado (desde otro estado) → upsert.
  // - completado/no_asistio → no cambia Google (el evento del pasado queda).
  if (nuevoEstado === 'cancelado' && turno.googleEventId) {
    try {
      await enqueueSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId, operacion: 'delete' })
    } catch (err) {
      logger.warn({ err, turnoId }, 'panel: falló enqueue de sync-delete')
    }
  }
  if (nuevoEstado === 'confirmado' && turno.estado !== 'confirmado') {
    try {
      await enqueueSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId, operacion: 'upsert' })
    } catch (err) {
      logger.warn({ err, turnoId }, 'panel: falló enqueue de sync-upsert')
    }
  }

  revalidatePath(`/${cuenta.slug}/hoy`)
  return { ok: true }
}
