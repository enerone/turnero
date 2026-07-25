import { sealData, unsealData } from 'iron-session'

export interface PendingOnboarding {
  googleSub: string
  email: string
  nombre: string
  refreshToken: string
  /** ISO timestamp, para chequear TTL de 15 min al deserializar */
  creadoEn: string
}

const TTL_SEG = 15 * 60

export async function serializarPendingOnboarding(
  dato: PendingOnboarding,
  secret: string,
): Promise<string> {
  return sealData(dato, { password: secret, ttl: TTL_SEG })
}

export async function deserializarPendingOnboarding(
  sealed: string,
  secret: string,
): Promise<PendingOnboarding> {
  const data = (await unsealData(sealed, {
    password: secret,
    ttl: TTL_SEG,
  })) as PendingOnboarding
  if (!data.googleSub || !data.email) {
    throw new Error('Cookie de onboarding inválida')
  }
  return data
}

export const NOMBRE_COOKIE_PENDING = 'turnero_pending_onboarding'

export const NOMBRE_COOKIE_INVITACION = 'turnero_invitacion_pending'

export interface PendingInvitacion {
  token: string
  creadoEn: string
}

export async function serializarPendingInvitacion(
  dato: PendingInvitacion,
  secret: string,
): Promise<string> {
  return sealData(dato, { password: secret, ttl: 10 * 60 })
}

export async function deserializarPendingInvitacion(
  sealed: string,
  secret: string,
): Promise<PendingInvitacion> {
  const data = (await unsealData(sealed, { password: secret, ttl: 10 * 60 })) as PendingInvitacion
  if (!data.token) throw new Error('Cookie de invitación inválida')
  return data
}
