import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/shared/env'
import { basePrisma } from '@/lib/db/base-prisma'
import { procesarMensaje } from '@/lib/bot/motor'
import { enviarMensajeTelegram } from '@/lib/bot/telegram'
import { logger } from '@/lib/shared/logger'

export const dynamic = 'force-dynamic'

/**
 * POST: recibe updates de Telegram Bot API (vía webhook configurado con setWebhook).
 * Devuelve 200 inmediatamente; el procesamiento es async.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('ok', { status: 200 })
  }

  procesarWebhookTelegram(body).catch((err) => {
    logger.error({ err }, 'Error procesando webhook Telegram')
  })

  return new NextResponse('ok', { status: 200 })
}

async function procesarWebhookTelegram(body: unknown) {
  const update = body as any
  const mensaje = update?.message
  if (!mensaje) return

  const chatId: string = String(mensaje.chat?.id ?? '')
  const texto: string = mensaje.text ?? ''

  if (!chatId || !texto.trim()) return

  if (!env.TELEGRAM_ACCOUNT_SLUG) {
    logger.warn('TELEGRAM_ACCOUNT_SLUG no configurado, no se puede enrutar el mensaje')
    return
  }

  const cuenta = await basePrisma.cuenta.findUnique({
    where: { slug: env.TELEGRAM_ACCOUNT_SLUG },
  })
  if (!cuenta) {
    logger.warn({ slug: env.TELEGRAM_ACCOUNT_SLUG }, 'Cuenta no encontrada para slug de Telegram bot')
    return
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN no configurado')
    return
  }

  const respuesta = await procesarMensaje({
    cuentaId: cuenta.id,
    canal: 'telegram',
    externoId: chatId,
    texto,
  })

  await enviarMensajeTelegram(chatId, respuesta, env.TELEGRAM_BOT_TOKEN)
}
