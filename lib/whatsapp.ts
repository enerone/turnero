import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

const WA_API_VERSION = 'v20.0'

/**
 * Normaliza a formato WhatsApp Cloud API: E.164 sin `+`. Delega la parte
 * dura a `normalizarTelefonoE164` y sólo saca el prefijo.
 */
export function normalizarTelefonoWA(input: string | null | undefined): string | null {
  const e164 = normalizarTelefonoE164(input)
  return e164 ? e164.slice(1) : null
}

export async function enviarWhatsAppTexto(params: {
  to: string
  body: string
}): Promise<void> {
  const token = env.WHATSAPP_TOKEN
  const phoneId = env.WHATSAPP_PHONE_ID
  const to = normalizarTelefonoWA(params.to)

  if (!token || !phoneId) {
    logger.info({ to, body: params.body }, '[dev-wa] WHATSAPP_TOKEN/PHONE_ID no seteados, no se envía')
    return
  }
  if (!to) {
    logger.warn({ inputTelefono: params.to }, 'Teléfono inválido para WhatsApp, no se envía')
    return
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneId}/messages`
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: params.body, preview_url: false },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`WhatsApp API ${res.status}: ${errText}`)
  }
}
