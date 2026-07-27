import { Resend } from 'resend'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

export interface EnviarConfirmacionParams {
  to: string
  cuentaNombre: string
  confirmUrl: string
  servicio: string
  fecha: string
  hora: string
}

export interface EnviarRecordatorioParams {
  to: string
  cuentaNombre: string
  servicio: string
  fecha: string
  hora: string
  cancelUrl: string
}

export async function enviarEmailConfirmacion(params: EnviarConfirmacionParams): Promise<void> {
  const { to, cuentaNombre, confirmUrl, servicio, fecha, hora } = params

  if (!to) {
    logger.info({ cuentaNombre, servicio, fecha, hora }, '[dev-email] Sin email, no se envía confirmación')
    return
  }

  const asunto = `Confirmá tu turno en ${cuentaNombre}`
  const html = `
    <p>Hola,</p>
    <p>Tenés un turno pendiente de confirmación en <strong>${cuentaNombre}</strong>.</p>
    <p><strong>${servicio}</strong> · ${fecha} a las ${hora}</p>
    <p><a href="${confirmUrl}" style="display:inline-block;padding:0.75rem 1.5rem;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">Confirmar mi turno</a></p>
    <p>El link expira en 30 minutos. Si no podés ir, cancelá desde el mismo link para liberar el horario.</p>
  `

  if (!resend) {
    logger.info({ to, asunto }, '[dev-email] confirmación (RESEND_API_KEY no seteada)')
    return
  }

  await resend.emails.send({
    from: env.RESEND_FROM,
    to,
    subject: asunto,
    html,
  })
}

export async function enviarEmailRecordatorio(params: EnviarRecordatorioParams): Promise<void> {
  const { to, cuentaNombre, servicio, fecha, hora, cancelUrl } = params

  if (!to) {
    logger.info({ cuentaNombre, servicio, fecha, hora }, '[dev-email] Sin email, no se envía recordatorio')
    return
  }

  const asunto = `Tu turno en ${cuentaNombre} está confirmado`
  const html = `
    <p>Hola,</p>
    <p>Tu turno en <strong>${cuentaNombre}</strong> fue confirmado.</p>
    <p><strong>${servicio}</strong> · ${fecha} a las ${hora}</p>
    <p>Si no podés ir, cancelá desde <a href="${cancelUrl}">este link</a> y liberás el horario para otra persona.</p>
    <p>Gracias por avisar.</p>
  `

  if (!resend) {
    logger.info({ to, asunto }, '[dev-email] recordatorio (RESEND_API_KEY no seteada)')
    return
  }

  await resend.emails.send({
    from: env.RESEND_FROM,
    to,
    subject: asunto,
    html,
  })
}
