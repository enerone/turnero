import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

export async function register() {
  // Solo corre en Node runtime (no en Edge middleware)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (!env.JOBS_ENABLED) {
    logger.info('JOBS_ENABLED=false — pg-boss NO se arranca')
    return
  }

  // Import dinámico para que Edge no lo intente cargar
  const { obtenerBoss } = await import('@/lib/jobs/boss')
  const { registrarHandlers } = await import('@/lib/jobs/registrar')

  try {
    await obtenerBoss()
    await registrarHandlers()
    logger.info('jobs infrastructure lista')
  } catch (err) {
    logger.error({ err }, 'Falló boot de jobs infrastructure')
    // No relanzar: no queremos que caiga el servidor si pg-boss no arranca.
  }
}
