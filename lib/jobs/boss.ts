import PgBoss from 'pg-boss'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

let instancia: PgBoss | null = null
let bootPromise: Promise<PgBoss> | null = null

/**
 * Devuelve el singleton de pg-boss. La primera llamada dispara .start(),
 * las siguientes esperan al mismo boot.
 *
 * Usa DIRECT_URL porque pg-boss crea su propio schema "pgboss" y sus tablas
 * (requiere CREATE SCHEMA privilege que turnero_app no tiene).
 */
export async function obtenerBoss(): Promise<PgBoss> {
  if (instancia) return instancia
  if (bootPromise) return bootPromise

  const connectionString = env.DIRECT_URL ?? env.DATABASE_URL

  bootPromise = (async () => {
    const boss = new PgBoss({
      connectionString,
      retryLimit: 5,
      retryDelay: 1,
      retryBackoff: true,
    })
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))
    await boss.start()
    logger.info('pg-boss iniciado')
    instancia = boss
    return boss
  })()

  return bootPromise
}

export async function detenerBoss(): Promise<void> {
  if (instancia) {
    await instancia.stop({ graceful: true, timeout: 5000 })
    instancia = null
    bootPromise = null
  }
}
