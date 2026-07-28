import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url(),

  // Auth
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT: z.string().url(),

  // Crypto
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY requerido'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 chars'),

  // Email (opcional en dev)
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default('Turnero <onboarding@localhost>'),

  // WhatsApp Cloud API (opcional en dev — si falta no se envían mensajes)
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_ID: z.string().default(''),

  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

function parseEnv() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Variables de entorno inválidas:', parsed.error.flatten().fieldErrors)
    throw new Error('Config de entorno inválida')
  }
  return parsed.data
}

export const env = parseEnv()

export function dominioBase(): string {
  return new URL(env.PUBLIC_BASE_URL).hostname
}
