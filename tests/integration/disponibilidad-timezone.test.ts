import { describe, it, expect } from 'vitest'
import { calcularDisponibilidad } from '@/lib/public-booking/disponibilidad'
import { createTenantClient } from '@/lib/db/tenant-client'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

const TZ_AR = 'America/Argentina/Buenos_Aires'

describe('calcularDisponibilidad — timezone-aware', () => {
  useTestDatabase()

  it('respeta el day-of-week local (23:00 ARG del sábado NO es domingo)', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const servicio = await crearServicioFixture(testPrisma, cuenta.id, { duracionMinutos: 30 })

    // Horario los sábados 22:00-23:30 ARG → dia_semana = 6 (sábado)
    await testPrisma.horarioSemanal.create({
      data: {
        cuentaId: cuenta.id,
        diaSemana: 6,
        desde: new Date('1970-01-01T22:00:00.000Z'),
        hasta: new Date('1970-01-01T23:30:00.000Z'),
      },
    })

    const db = createTenantClient(cuenta.id)
    // Sábado 2027-03-06 en ARG. Aunque las 22:00 ARG = 01:00 UTC del domingo,
    // el algoritmo tiene que reconocer que estamos en sábado local.
    const desde = new Date('2027-03-06T00:00:00-03:00')
    const hasta = new Date('2027-03-06T23:59:59-03:00')

    const disp = await calcularDisponibilidad(db, {
      desde, hasta, servicioId: servicio.id, timezone: TZ_AR,
    })

    expect(disp).toHaveLength(1)
    expect(disp[0].slots.length).toBeGreaterThan(0)
    // Los slots deben empezar a las 22 y 22:30 ARG.
    const horasARG = disp[0].slots.map((s) =>
      s.inicio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ_AR }),
    )
    expect(horasARG).toContain('22:00')
    expect(horasARG).toContain('22:30')
  })

  it('filtra slots que colisionan con EventoExterno (bloqueo de Google Calendar)', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const servicio = await crearServicioFixture(testPrisma, cuenta.id, { duracionMinutos: 30 })

    // Horario lunes 10:00-11:00 ARG
    await testPrisma.horarioSemanal.create({
      data: {
        cuentaId: cuenta.id,
        diaSemana: 1,
        desde: new Date('1970-01-01T10:00:00.000Z'),
        hasta: new Date('1970-01-01T11:00:00.000Z'),
      },
    })

    // Bloqueo externo 10:00-10:30 ARG del lunes 2027-03-08
    const bloqueoInicio = new Date('2027-03-08T10:00:00-03:00')
    const bloqueoFin = new Date('2027-03-08T10:30:00-03:00')
    await testPrisma.eventoExterno.create({
      data: {
        cuentaId: cuenta.id,
        googleEventId: 'evt-bloqueo-1',
        inicio: bloqueoInicio,
        fin: bloqueoFin,
      },
    })

    const db = createTenantClient(cuenta.id)
    const desde = new Date('2027-03-08T00:00:00-03:00')
    const hasta = new Date('2027-03-08T23:59:59-03:00')

    const disp = await calcularDisponibilidad(db, {
      desde, hasta, servicioId: servicio.id, timezone: TZ_AR,
    })

    expect(disp).toHaveLength(1)
    const horas = disp[0].slots.map((s) =>
      s.inicio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ_AR }),
    )
    // 10:00 debe estar bloqueado, 10:30 debe estar libre
    expect(horas).not.toContain('10:00')
    expect(horas).toContain('10:30')
  })

  it('no muestra slots del pasado', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const servicio = await crearServicioFixture(testPrisma, cuenta.id, { duracionMinutos: 30 })
    await testPrisma.horarioSemanal.create({
      data: {
        cuentaId: cuenta.id,
        diaSemana: new Date().getDay(),
        desde: new Date('1970-01-01T00:00:00.000Z'),
        hasta: new Date('1970-01-01T23:30:00.000Z'),
      },
    })

    const db = createTenantClient(cuenta.id)
    const desde = new Date()
    desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)

    const disp = await calcularDisponibilidad(db, {
      desde, hasta, servicioId: servicio.id, timezone: TZ_AR,
    })

    for (const dia of disp) {
      for (const slot of dia.slots) {
        expect(slot.inicio.getTime()).toBeGreaterThan(Date.now())
      }
    }
  })
})
