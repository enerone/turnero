import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { calendar_v3 } from 'googleapis'
import { descifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'
import { basePrisma } from '@/lib/db/base-prisma'

/**
 * Descifra el refresh_token guardado en IntegracionCalendar.refreshTokenCifrado.
 * Usa la master ENCRYPTION_KEY y HKDF con el cuentaId como info.
 */
export async function descifrarRefreshToken(
  cifrado: Buffer,
  cuentaId: string,
  master: Buffer,
): Promise<string> {
  const llave = await derivarLlavePorCuenta(master, cuentaId)
  return descifrar(new Uint8Array(cifrado), new Uint8Array(llave))
}

/**
 * Construye un OAuth2 client con el refresh_token seteado. googleapis
 * refresca el access_token automáticamente cuando expira.
 */
export function crearOAuth2Client(refreshToken: string): OAuth2Client {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT,
  )
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

export interface IntegracionLookup {
  id: string
  cuenta_id: string
  refresh_token_cifrado: Buffer
  calendar_id_dedicado: string | null
  calendar_id_primario: string
  estado: 'conectado' | 'desconectado'
  watch_channel_dedicado_id: string | null
  watch_channel_dedicado_resource_id: string | null
  watch_channel_dedicado_token: string | null
  watch_channel_dedicado_expira: Date | null
  watch_channel_primario_id: string | null
  watch_channel_primario_resource_id: string | null
  watch_channel_primario_token: string | null
  watch_channel_primario_expira: Date | null
  sync_token_dedicado: string | null
  sync_token_primario: string | null
}

export interface IntegracionPorChannel {
  cuenta_id: string
  tipo: 'dedicado' | 'primario'
  calendar_id: string
  sync_token: string | null
  token: string | null
}

export async function obtenerIntegracionPorChannel(
  channelId: string,
): Promise<IntegracionPorChannel | null> {
  const filas = await basePrisma.$queryRaw<IntegracionPorChannel[]>`
    SELECT * FROM lookup_integracion_por_channel(${channelId})
  `
  return filas[0] ?? null
}

/**
 * Lookup de IntegracionCalendar via función SECURITY DEFINER
 * (bypasea RLS solo para este SELECT, con GRANT explícito a turnero_app).
 * Necesario porque los jobs reciben cuentaId como payload y no tienen tenant
 * context establecido.
 */
export async function obtenerIntegracionCalendar(
  cuentaId: string,
): Promise<IntegracionLookup | null> {
  const filas = await basePrisma.$queryRaw<IntegracionLookup[]>`
    SELECT * FROM lookup_integracion_calendar(${cuentaId}::uuid)
  `
  return filas[0] ?? null
}

/**
 * Devuelve el cliente calendar_v3 autenticado para una cuenta.
 * Lee la IntegracionCalendar, descifra el refresh_token, arma el OAuth2.
 *
 * Lanza si la cuenta no tiene IntegracionCalendar o si el descifrado falla.
 */
export async function obtenerCalendarClient(cuentaId: string): Promise<calendar_v3.Calendar> {
  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    throw new Error(`IntegracionCalendar no existe para cuenta ${cuentaId}`)
  }

  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')
  const refreshToken = await descifrarRefreshToken(
    integracion.refresh_token_cifrado,
    cuentaId,
    master,
  )
  const auth = crearOAuth2Client(refreshToken)
  return google.calendar({ version: 'v3', auth })
}
