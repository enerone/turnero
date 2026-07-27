import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const WA_API_VERSION = 'v20.0'

/**
 * Normaliza un teléfono a formato E.164 sin `+` (WhatsApp Cloud API espera
 * "5491145678900", no "+54 9 11 4567-8900"). Devuelve null si el número
 * quedó vacío o obviamente inválido.
 */
export function normalizarTelefonoWA(input: string | null | undefined): string | null {
  if (!input) return null
  const soloDigitos = input.replace(/\D/g, '')
  if (soloDigitos.length < 8) return null
  return soloDigitos
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
