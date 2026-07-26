import { basePrisma } from '@/lib/db/base-prisma'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { enqueueBootstrapCalendar } from '@/lib/jobs/enqueue'
import type { Cuenta, Usuario } from '@prisma/client'

export interface DatosPendingOnboarding {
  googleSub: string
  email: string
  nombre: string
  refreshToken: string
}

export interface DatosFormOnboarding {
  slug: string
  nombrePublico: string
  telefonoWhatsapp: string
  duracionMinutos: number
  horarios: Array<{ diaSemana: number; desde: string; hasta: string }>
}

export interface ResultadoOnboarding {
  cuenta: Cuenta
  usuario: Usuario
}

function timeToDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

export async function completarOnboarding(
  pending: DatosPendingOnboarding,
  form: DatosFormOnboarding,
): Promise<ResultadoOnboarding> {
  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')

  const resultado = await basePrisma.$transaction(async (tx) => {
    const cuenta = await tx.cuenta.create({
      data: {
        slug: form.slug,
        nombrePublico: form.nombrePublico,
        telefonoWhatsapp: form.telefonoWhatsapp,
      },
    })

    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuenta.id}, TRUE)`

    const usuario = await tx.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: pending.email,
        nombre: pending.nombre,
        googleSub: pending.googleSub,
        rol: 'owner',
      },
    })

    await tx.servicio.create({
      data: {
        cuentaId: cuenta.id,
        nombre: 'Consulta',
        duracionMinutos: form.duracionMinutos,
        esDefault: true,
      },
    })

    await tx.horarioSemanal.createMany({
      data: form.horarios.map((h) => ({
        cuentaId: cuenta.id,
        diaSemana: h.diaSemana,
        desde: timeToDate(h.desde),
        hasta: timeToDate(h.hasta),
      })),
    })

    const llave = await derivarLlavePorCuenta(master, cuenta.id)
    const refreshCifrado = await cifrar(pending.refreshToken, new Uint8Array(llave))

    await tx.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.from(refreshCifrado),
        calendarIdPrimario: 'primary',
      },
    })

    return { cuenta, usuario }
  })

  // Post-commit: encolar bootstrap-calendar. Errores acá no rompen el onboarding.
  try {
    const jobId = await enqueueBootstrapCalendar({ cuentaId: resultado.cuenta.id })
    logger.info(
      { cuentaId: resultado.cuenta.id, jobId },
      'bootstrap-calendar encolado post-onboarding',
    )
  } catch (err) {
    logger.error(
      { err, cuentaId: resultado.cuenta.id },
      'Falló enqueue de bootstrap-calendar (el usuario puede reintentar manualmente)',
    )
  }

  return resultado
}
