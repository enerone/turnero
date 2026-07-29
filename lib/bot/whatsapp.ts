import { logger } from '@/lib/shared/logger'

/**
 * Envía un mensaje de texto vía WhatsApp Cloud API (Meta Graph API v18).
 */
export async function enviarMensajeWhatsapp(
  para: string,
  texto: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { body: texto },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    logger.error({ status: res.status, para, detalle }, 'Error al enviar mensaje WhatsApp')
    throw new Error(`WhatsApp API error ${res.status}: ${detalle}`)
  }
}
