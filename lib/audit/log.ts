import type { TenantClient } from '@/lib/db/tenant-client'
import type { Prisma } from '@prisma/client'
import { logger } from '@/lib/shared/logger'

export type AccionAudit =
  | 'turno_creado'
  | 'turno_confirmado'
  | 'turno_cancelado'
  | 'turno_movido'
  | 'cliente_creado'
  | 'cliente_actualizado'
  | 'invitacion_creada'
  | 'invitacion_aceptada'
  | 'onboarding_completado'

export type EntidadAudit = 'turno' | 'cliente' | 'usuario' | 'cuenta' | 'invitacion'

export interface EscribirAuditParams {
  accion: AccionAudit
  entidad: EntidadAudit
  entidadId?: string
  usuarioId?: string | null
  payload?: Record<string, unknown>
}

/**
 * Escribe una fila en AuditLog. Best-effort: si falla no propaga (para no
 * derribar la operación principal). Diseñada para ser el último paso de
 * cualquier mutation de dominio.
 *
 * Cuenta_id se inyecta por el tenant client — no lo tomamos como parámetro.
 */
export async function escribirAudit(
  db: TenantClient,
  params: EscribirAuditParams,
): Promise<void> {
  const { accion, entidad, entidadId, usuarioId, payload } = params
  try {
    await db.auditLog.create({
      data: {
        accion,
        entidad,
        entidadId: entidadId ?? null,
        usuarioId: usuarioId ?? null,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      } as any,
    })
  } catch (err) {
    logger.warn({ err, accion, entidad, entidadId }, 'No se pudo escribir AuditLog')
  }
}
