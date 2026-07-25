import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
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
