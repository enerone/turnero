import type { TenantClient } from '@/lib/db/tenant-client'
import type { Prisma } from '@prisma/client'

/**
 * Payload de un email transaccional en el outbox. `cuerpoHtml` es HTML ya
 * renderizado — no re-renderizamos plantillas al procesar.
 */
export interface PayloadEmail {
  asunto: string
  cuerpoHtml: string
}

/**
 * Payload de un mensaje de WhatsApp: sólo texto plano por ahora.
 */
export interface PayloadWhatsApp {
  cuerpo: string
}

export async function encolarEmail(
  db: TenantClient,
  params: { destinatario: string; asunto: string; cuerpoHtml: string },
): Promise<void> {
  const payload: PayloadEmail = { asunto: params.asunto, cuerpoHtml: params.cuerpoHtml }
  await db.outboxMensaje.create({
    data: {
      tipo: 'email_transaccional',
      destinatario: params.destinatario,
      payload: payload as unknown as Prisma.InputJsonValue,
    } as any,
  })
}

export async function encolarWhatsApp(
  db: TenantClient,
  params: { destinatario: string; cuerpo: string },
): Promise<void> {
  const payload: PayloadWhatsApp = { cuerpo: params.cuerpo }
  await db.outboxMensaje.create({
    data: {
      tipo: 'whatsapp',
      destinatario: params.destinatario,
      payload: payload as unknown as Prisma.InputJsonValue,
    } as any,
  })
}
