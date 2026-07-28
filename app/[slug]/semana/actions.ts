'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { puede } from '@/lib/auth/puede'
import { escribirAudit } from '@/lib/audit/log'
import { enqueueSyncTurnoGoogle } from '@/lib/jobs/enqueue'
import { logger } from '@/lib/shared/logger'

const MoverTurnoSchema = z.object({
  turnoId: z.string().uuid(),
  nuevoInicio: z.string().datetime(),
})

export interface AccionResult {
  ok: boolean
  error?: string
}

/**
 * Mueve un turno a un nuevo horario preservando la duración original.
 *
 * - Auth: owner o secretaria de la misma cuenta.
 * - La exclusion constraint `turno_no_overlap` en DB previene solapamientos
 *   en concurrencia: si otro turno ocupa el slot destino, PostgreSQL tira
 *   23P01 y devolvemos 409.
 * - Resetea `recordatorio_enviado_en` a null: el nuevo horario amerita nuevo
 *   recordatorio.
 * - Encola `sync-turno-google upsert` para propagar el cambio a Google.
 * - AuditLog con inicio previo/nuevo.
 */
export async function moverTurno(input: unknown): Promise<AccionResult> {
  const parsed = MoverTurnoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }

  const s = await getSession()
  if (!s) return { ok: false, error: 'No autenticado' }

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) return { ok: false, error: 'Sin permisos' }
  if (!puede({ rol: s.user.rol, cuentaId: s.user.cuentaId }, 'mover_turno')) {
    return { ok: false, error: 'Sin permisos' }
  }

  const { turnoId, nuevoInicio } = parsed.data
  const turno = await db.turno.findUnique({ where: { id: turnoId } })
  if (!turno) return { ok: false, error: 'Turno no encontrado' }
  if (turno.estado !== 'confirmado' && turno.estado !== 'borrador') {
    return { ok: false, error: 'Solo se pueden mover turnos activos' }
  }

  const inicioDt = new Date(nuevoInicio)
  const duracionMs = turno.fin.getTime() - turno.inicio.getTime()
  const finDt = new Date(inicioDt.getTime() + duracionMs)

  if (inicioDt.getTime() === turno.inicio.getTime()) {
    return { ok: true } // no-op
  }

  try {
    await db.turno.update({
      where: { id: turnoId },
      data: {
        inicio: inicioDt,
        fin: finDt,
        // Nuevo horario = nuevo recordatorio.
        recordatorioEnviadoEn: null,
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      String((err.meta as { code?: string } | undefined)?.code) === '23P01'
    ) {
      return { ok: false, error: 'El horario destino ya está ocupado' }
    }
    if (err instanceof Error && /exclusion_violation|turno_no_overlap|23P01/.test(err.message)) {
      return { ok: false, error: 'El horario destino ya está ocupado' }
    }
    throw err
  }

  await escribirAudit(db, {
    accion: 'turno_movido',
    entidad: 'turno',
    entidadId: turnoId,
    usuarioId: s.user.id,
    payload: {
      origen: 'panel',
      inicioPrevio: turno.inicio.toISOString(),
      inicioNuevo: inicioDt.toISOString(),
    },
  })

  if (turno.googleEventId) {
    try {
      await enqueueSyncTurnoGoogle({ cuentaId: cuenta.id, turnoId, operacion: 'upsert' })
    } catch (err) {
      logger.warn({ err, turnoId }, 'moverTurno: falló enqueue de sync')
    }
  }

  revalidatePath(`/${cuenta.slug}/semana`)
  revalidatePath(`/${cuenta.slug}/hoy`)
  return { ok: true }
}
