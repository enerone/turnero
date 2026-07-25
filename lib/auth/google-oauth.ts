import { Google } from 'arctic'
import { env } from '@/lib/shared/env'

/**
 * Cliente Google OAuth para identity + Calendar.
 * Scopes:
 *  - openid, email, profile → identity
 *  - calendar               → Plan 3 usará el refresh_token para el sync
 */
export const google = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_OAUTH_REDIRECT,
)

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
]

export interface GoogleUserInfo {
  sub: string
  email: string
  name: string
  picture?: string
}

export async function obtenerUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) throw new Error(`Google userinfo devolvió ${resp.status}`)
  return resp.json()
}
