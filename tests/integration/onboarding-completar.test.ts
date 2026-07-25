import { describe, expect, it } from 'vitest'
import { testPrisma, useTestDatabase } from './helpers/db'
import { completarOnboarding } from '@/lib/onboarding/completar'

describe('completarOnboarding', () => {
  useTestDatabase()

  const pending = {
    googleSub: 'google-sub-1',
    email: 'ana@example.com',
    nombre: 'Ana Martínez',
    refreshToken: 'refresh-abc',
  }

  const form = {
    slug: 'dra-ana',
    nombrePublico: 'Dra. Ana Martínez',
    telefonoWhatsapp: '+5491100000000',
    duracionMinutos: 30,
    horarios: [
      { diaSemana: 0, desde: '09:00', hasta: '13:00' },
      { diaSemana: 0, desde: '15:00', hasta: '18:00' },
      { diaSemana: 1, desde: '09:00', hasta: '13:00' },
      { diaSemana: 1, desde: '15:00', hasta: '18:00' },
      { diaSemana: 2, desde: '09:00', hasta: '13:00' },
      { diaSemana: 2, desde: '15:00', hasta: '18:00' },
      { diaSemana: 3, desde: '09:00', hasta: '13:00' },
      { diaSemana: 3, desde: '15:00', hasta: '18:00' },
      { diaSemana: 4, desde: '09:00', hasta: '13:00' },
      { diaSemana: 4, desde: '15:00', hasta: '18:00' },
    ],
  }

  it('crea Cuenta + Usuario + Servicio + Horarios + IntegracionCalendar', async () => {
    const { cuenta, usuario } = await completarOnboarding(pending, form)

    expect(cuenta.slug).toBe('dra-ana')
    expect(usuario.rol).toBe('owner')
    expect(usuario.googleSub).toBe('google-sub-1')

    const servicios = await testPrisma.servicio.findMany({ where: { cuentaId: cuenta.id } })
    expect(servicios).toHaveLength(1)
    expect(servicios[0].nombre).toBe('Consulta')
    expect(servicios[0].duracionMinutos).toBe(30)
    expect(servicios[0].esDefault).toBe(true)

    const horarios = await testPrisma.horarioSemanal.findMany({ where: { cuentaId: cuenta.id } })
    expect(horarios).toHaveLength(10)

    const integracion = await testPrisma.integracionCalendar.findUnique({ where: { cuentaId: cuenta.id } })
    expect(integracion).not.toBeNull()
    expect(integracion?.calendarIdDedicado).toBeNull()
    expect(integracion?.refreshTokenCifrado.length).toBeGreaterThan(0)
  })

  it('falla si el slug ya existe', async () => {
    await completarOnboarding(pending, form)
    await expect(
      completarOnboarding({ ...pending, googleSub: 'otro' }, form),
    ).rejects.toThrow()
  })

  it('falla si el googleSub ya tiene Usuario', async () => {
    await completarOnboarding(pending, form)
    await expect(
      completarOnboarding(pending, { ...form, slug: 'dra-ana-2' }),
    ).rejects.toThrow()
  })
})
