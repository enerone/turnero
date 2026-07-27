import { enviarWhatsAppTexto } from '@/lib/whatsapp'
import { logger } from '@/lib/shared/logger'

export interface EnviarWAConfirmacionParams {
  to: string
  cuentaNombre: string
  confirmUrl: string
  servicio: string
  fecha: string
  hora: string
}

export interface EnviarWARecordatorioParams {
  to: string
  cuentaNombre: string
  servicio: string
  fecha: string
  hora: string
  cancelUrl: string
}

export async function enviarWhatsAppConfirmacion(params: EnviarWAConfirmacionParams): Promise<void> {
  const { to, cuentaNombre, confirmUrl, servicio, fecha, hora } = params
  const body = `Hola! Tenés un turno pendiente de confirmación en ${cuentaNombre}.\n\n${servicio}\n${fecha} a las ${hora}\n\nConfirmá acá: ${confirmUrl}\n\nEl link expira en 30 min. Si no vas a venir, cancelalo desde el mismo link.`
  try {
    await enviarWhatsAppTexto({ to, body })
  } catch (err) {
    logger.warn({ err, to }, 'No se pudo enviar WhatsApp de confirmación')
  }
}

export async function enviarWhatsAppRecordatorio(params: EnviarWARecordatorioParams): Promise<void> {
  const { to, cuentaNombre, servicio, fecha, hora, cancelUrl } = params
  const body = `Recordatorio: tu turno en ${cuentaNombre} es ${fecha} a las ${hora} (${servicio}).\n\nSi no podés venir, cancelalo acá para liberar el horario: ${cancelUrl}`
  try {
    await enviarWhatsAppTexto({ to, body })
  } catch (err) {
    logger.warn({ err, to }, 'No se pudo enviar WhatsApp de recordatorio')
  }
}
