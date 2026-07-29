import { logger } from '@/lib/shared/logger'

/**
 * Envía un mensaje de texto vía Telegram Bot API.
 */
export async function enviarMensajeTelegram(
  chatId: string,
  texto: string,
  botToken: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const body = {
    chat_id: chatId,
    text: texto,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    logger.error({ status: res.status, chatId, detalle }, 'Error al enviar mensaje Telegram')
    throw new Error(`Telegram API error ${res.status}: ${detalle}`)
  }
}
