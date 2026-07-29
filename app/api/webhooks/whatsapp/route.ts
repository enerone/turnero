import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/shared/env'
import { basePrisma } from '@/lib/db/base-prisma'
import { procesarMensaje } from '@/lib/bot/motor'
import { enviarMensajeWhatsapp } from '@/lib/bot/whatsapp'
import { logger } from '@/lib/shared/logger'

export const dynamic = 'force-dynamic'

/**
 * GET: verificación del webhook de Meta.
 * Meta llama con hub.mode=subscribe, hub.verify_token y hub.challenge.
 * Devolvemos hub.challenge si el token coincide.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }

  return new NextResponse('Verificación fallida', { status: 403 })
}

/**
 * POST: recibe mensajes de WhatsApp Cloud API.
 * Devuelve 200 inmediatamente; el procesamiento es async.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('ok', { status: 200 })
  }

  // Procesar en background sin bloquear la respuesta
  procesarWebhookWA(body).catch((err) => {
    logger.error({ err }, 'Error procesando webhook WhatsApp')
  })

  return new NextResponse('ok', { status: 200 })
}

async function procesarWebhookWA(body: unknown) {
  const data = body as any
  const entry = data?.entry?.[0]
  const change = entry?.changes?.[0]
  const value = change?.value

  // Ignorar status updates (delivered, read, etc.)
  if (!value?.messages?.length) return

  const mensaje = value.messages[0]
  if (mensaje.type !== 'text') return

  const telefono: string = mensaje.from
  const texto: string = mensaje.text?.body ?? ''

  if (!texto.trim()) return

  if (!env.WHATSAPP_ACCOUNT_SLUG) {
    logger.warn('WHATSAPP_ACCOUNT_SLUG no configurado, no se puede enrutar el mensaje')
    return
  }

  const cuenta = await basePrisma.cuenta.findUnique({
    where: { slug: env.WHATSAPP_ACCOUNT_SLUG },
  })
  if (!cuenta) {
    logger.warn({ slug: env.WHATSAPP_ACCOUNT_SLUG }, 'Cuenta no encontrada para slug de WhatsApp bot')
    return
  }

  const accessToken = env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_TOKEN
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_PHONE_ID

  if (!accessToken || !phoneNumberId) {
    logger.warn('WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados')
    return
  }

  const respuesta = await procesarMensaje({
    cuentaId: cuenta.id,
    canal: 'whatsapp',
    externoId: telefono,
    texto,
  })

  await enviarMensajeWhatsapp(telefono, respuesta, phoneNumberId, accessToken)
}
