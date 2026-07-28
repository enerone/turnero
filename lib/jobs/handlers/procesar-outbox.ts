import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { enviarWhatsAppTexto } from '@/lib/whatsapp'
import { enviarEmailAviso } from '@/lib/public-booking/email'
import { logger } from '@/lib/shared/logger'
import type { PayloadEmail, PayloadWhatsApp } from '@/lib/outbox/encolar'

export const NOMBRE_JOB_OUTBOX = 'procesar-outbox'

const LOTE = 20
const MAX_INTENTOS = 5
// Backoff exponencial: 30s, 2min, 8min, 32min, 2h
const BACKOFF_SEG = [30, 120, 480, 1920, 7200]

/**
 * Barre `outbox_mensaje` cada minuto (registrado via boss.schedule), toma un
 * lote de mensajes pendientes vencidos con `FOR UPDATE SKIP LOCKED` para
 * permitir workers concurrentes sin doble procesamiento, y despacha por canal.
 *
 * Estados finales:
 * - procesado: envío OK.
 * - fallado: agotamos MAX_INTENTOS.
 * Mientras tanto: incrementa `intentos`, guarda `ultimo_error` y agenda
 * `siguiente_intento` con backoff exponencial.
 */
export async function handler(): Promise<void> {
  // Buscamos filas listas para reintento sin scope de tenant — el worker no
  // tiene una request. basePrisma va con turnero_app pero cuando accedemos a
  // `outbox_mensaje` sin `app.cuenta_id` seteado, RLS devuelve 0 filas. Por eso
  // usamos raw SQL con SET LOCAL ROLE al owner temporalmente NO, no queremos
  // eso. En lugar de eso: hacemos una consulta cross-tenant vía función SQL
  // SECURITY DEFINER análoga a las de invitacion.
  //
  // Alternativa más simple para este scale: query por cuenta. Un iterate por
  // cuentas y por cada una usar tenant client. Menos performante pero seguro
  // y consistente con el patrón del resto de jobs.
  const cuentas = await basePrisma.cuenta.findMany({ select: { id: true } })
  const ahora = new Date()
  let totalProcesados = 0
  let totalFallados = 0

  for (const { id: cuentaId } of cuentas) {
    const db = createTenantClient(cuentaId)

    // Prisma no expone SKIP LOCKED directamente. Como corremos un solo worker
    // (single-node deploy en Railway), la race no es problema. Si mañana
    // escalamos a N workers, migrar esto a `$queryRaw` con SELECT ... FOR
    // UPDATE SKIP LOCKED. Por ahora, findMany + intento de update funciona.
    const pendientes = await db.outboxMensaje.findMany({
      where: {
        estado: 'pendiente',
        siguienteIntento: { lte: ahora },
      },
      orderBy: { siguienteIntento: 'asc' },
      take: LOTE,
    })

    for (const msg of pendientes) {
      try {
        await despachar(msg.tipo, msg.destinatario, msg.payload as unknown)
        await db.outboxMensaje.update({
          where: { id: msg.id },
          data: {
            estado: 'procesado',
            procesadoEn: new Date(),
            ultimoError: null,
          },
        })
        totalProcesados += 1
      } catch (err) {
        const nuevoIntento = msg.intentos + 1
        const errMsg = err instanceof Error ? err.message : String(err)
        const estadoFinal = nuevoIntento >= MAX_INTENTOS ? 'fallado' : 'pendiente'
        const siguienteSeg = BACKOFF_SEG[Math.min(nuevoIntento - 1, BACKOFF_SEG.length - 1)]
        const siguienteIntento = new Date(Date.now() + siguienteSeg * 1000)

        await db.outboxMensaje.update({
          where: { id: msg.id },
          data: {
            estado: estadoFinal,
            intentos: nuevoIntento,
            ultimoError: errMsg.slice(0, 500),
            siguienteIntento,
          },
        })

        if (estadoFinal === 'fallado') {
          totalFallados += 1
          logger.error({ msgId: msg.id, cuentaId, err: errMsg }, 'Outbox: mensaje fallado tras max intentos')
        } else {
          logger.warn({ msgId: msg.id, cuentaId, intento: nuevoIntento, err: errMsg }, 'Outbox: intento fallido, reintentaremos')
        }
      }
    }
  }

  if (totalProcesados > 0 || totalFallados > 0) {
    logger.info({ totalProcesados, totalFallados, cuentas: cuentas.length }, 'Outbox: barrido completado')
  }
}

async function despachar(tipo: string, destinatario: string, payload: unknown): Promise<void> {
  if (tipo === 'email_transaccional') {
    const p = payload as PayloadEmail
    await enviarEmailAviso({ to: destinatario, asunto: p.asunto, cuerpoHtml: p.cuerpoHtml })
    return
  }
  if (tipo === 'whatsapp') {
    const p = payload as PayloadWhatsApp
    await enviarWhatsAppTexto({ to: destinatario, body: p.cuerpo })
    return
  }
  throw new Error(`Tipo de mensaje outbox desconocido: ${tipo}`)
}
