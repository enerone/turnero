import { Resend } from 'resend'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

export async function enviarEmailInvitacion(params: {
  a: string
  cuentaNombre: string
  linkAceptar: string
}) {
  const { a, cuentaNombre, linkAceptar } = params
  const asunto = `${cuentaNombre} te invita a Turnero`
  const html = `
    <p>Hola,</p>
    <p><strong>${cuentaNombre}</strong> te invita a colaborar en su agenda en Turnero.</p>
    <p><a href="${linkAceptar}">Aceptar invitación</a></p>
    <p>El link expira en 7 días.</p>
  `

  if (!resend) {
    logger.info({ a, asunto, linkAceptar }, '[dev-email] invitación (RESEND_API_KEY no seteada)')
    return
  }

  await resend.emails.send({
    from: env.RESEND_FROM,
    to: a,
    subject: asunto,
    html,
  })
}
