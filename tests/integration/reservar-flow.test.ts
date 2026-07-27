import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST as postReservar } from '@/app/[slug]/api/reservar/crear/route'
import { POST as postConfirmar, DELETE as deleteConfirmar } from '@/app/[slug]/api/confirmar/[token]/route'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'
import { NextRequest } from 'next/server'

// El circuito público no dispara email/WhatsApp reales en test: no hay creds
// seteadas → los helpers hacen no-op y loguean. Igual mockeamos por si acaso.
vi.mock('@/lib/public-booking/email', () => ({
  enviarEmailConfirmacion: vi.fn().mockResolvedValue(undefined),
  enviarEmailRecordatorio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/public-booking/whatsapp', () => ({
  enviarWhatsAppConfirmacion: vi.fn().mockResolvedValue(undefined),
  enviarWhatsAppRecordatorio: vi.fn().mockResolvedValue(undefined),
}))

// getTenant() lee `x-tenant-slug` de `headers()` (Server Component API). Para
// route handlers en test, mockeamos `next/headers` con el slug de turno.
let currentSlug = ''
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-tenant-slug' ? currentSlug : null),
  }),
}))

function makePost(body: unknown, url = 'http://localhost/x/api/reservar/crear'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Circuito público de reserva', () => {
  useTestDatabase()

  it('reservar → confirmar → cancelar libera el slot', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug
    const servicio = await crearServicioFixture(testPrisma, cuenta.id, { duracionMinutos: 30 })

    const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000)
    inicio.setMinutes(0, 0, 0)
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000)

    // 1. Reservar
    const resCrear = await postReservar(makePost({
      servicioId: servicio.id,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      cliente: { nombre: 'Ana Perez', telefono: '+5491100000001', email: 'ana@example.com' },
    }))
    const dataCrear = await resCrear.json()
    expect(resCrear.status).toBe(200)
    expect(dataCrear.ok).toBe(true)
    expect(dataCrear.confirmUrl).toContain(`/${cuenta.slug}/confirmar/`)

    const token = dataCrear.confirmUrl.split('/').pop() as string
    const turnos = await testPrisma.turno.findMany({ where: { cuentaId: cuenta.id } })
    expect(turnos).toHaveLength(1)
    expect(turnos[0].estado).toBe('borrador')

    // Debe haber un TokenConfirmacion vivo
    const tokensPre = await testPrisma.tokenConfirmacion.findMany({ where: { cuentaId: cuenta.id } })
    expect(tokensPre).toHaveLength(1)
    expect(tokensPre[0].usadaEn).toBeNull()

    // 2. Confirmar
    const reqConfirmar = new NextRequest(`http://localhost/${cuenta.slug}/api/confirmar/${token}`, {
      method: 'POST',
    })
    const resConfirmar = await postConfirmar(reqConfirmar, { params: Promise.resolve({ token }) })
    expect(resConfirmar.status).toBe(200)

    const turnoConfirmado = await testPrisma.turno.findUnique({ where: { id: turnos[0].id } })
    expect(turnoConfirmado?.estado).toBe('confirmado')

    // El token debe estar marcado como usado
    const tokensPost = await testPrisma.tokenConfirmacion.findMany({ where: { cuentaId: cuenta.id } })
    expect(tokensPost[0].usadaEn).not.toBeNull()

    // 3. Cancelar — reservamos otro turno con nuevo token
    const inicio2 = new Date(inicio.getTime() + 2 * 60 * 60 * 1000)
    const fin2 = new Date(inicio2.getTime() + 30 * 60 * 1000)
    const res2 = await postReservar(makePost({
      servicioId: servicio.id,
      inicio: inicio2.toISOString(),
      fin: fin2.toISOString(),
      cliente: { nombre: 'Ana Perez', telefono: '+5491100000001' },
    }))
    const data2 = await res2.json()
    const token2 = data2.confirmUrl.split('/').pop() as string

    const reqDel = new NextRequest(`http://localhost/${cuenta.slug}/api/confirmar/${token2}`, {
      method: 'DELETE',
    })
    const resDel = await deleteConfirmar(reqDel, { params: Promise.resolve({ token: token2 }) })
    expect(resDel.status).toBe(200)

    const turnos2 = await testPrisma.turno.findMany({
      where: { cuentaId: cuenta.id },
      orderBy: { inicio: 'asc' },
    })
    expect(turnos2[1].estado).toBe('cancelado')
    expect(turnos2[1].origenCancelacion).toBe('cliente')

    // AuditLog registró las 4 mutations: 2 creados + 1 confirmado + 1 cancelado
    const audit = await testPrisma.auditLog.findMany({
      where: { cuentaId: cuenta.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map((a) => a.accion)).toEqual([
      'turno_creado',
      'turno_confirmado',
      'turno_creado',
      'turno_cancelado',
    ])
  })

  it('la exclusion constraint bloquea reservas concurrentes en el mismo slot', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)

    const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000)
    inicio.setMinutes(0, 0, 0)
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000)

    const body = {
      servicioId: servicio.id,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      cliente: { nombre: 'A', telefono: '+5491199999901' },
    }
    // Disparar 2 requests concurrentes al mismo slot
    const [r1, r2] = await Promise.all([
      postReservar(makePost(body)),
      postReservar(makePost({ ...body, cliente: { nombre: 'B', telefono: '+5491199999902' } })),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 409])

    const turnos = await testPrisma.turno.findMany({ where: { cuentaId: cuenta.id } })
    expect(turnos).toHaveLength(1)
  })

  it('rechaza reserva con horario ya tomado', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug
    const servicio = await crearServicioFixture(testPrisma, cuenta.id)

    const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000)
    inicio.setMinutes(0, 0, 0)
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000)

    const body = {
      servicioId: servicio.id,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      cliente: { nombre: 'A', telefono: '+5491100000001' },
    }
    const r1 = await postReservar(makePost(body))
    expect(r1.status).toBe(200)

    const r2 = await postReservar(makePost({ ...body, cliente: { nombre: 'B', telefono: '+5491100000002' } }))
    expect(r2.status).toBe(409)
  })

  it('rechaza body inválido con 400', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug

    const res = await postReservar(makePost({
      servicioId: 'no-es-uuid',
      inicio: 'no-es-fecha',
      fin: 'x',
      cliente: {},
    }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/inválidos/i)
  })

  it('token inválido devuelve 404 en confirmar', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug

    const req = new NextRequest('http://localhost/x/api/confirmar/xxx', { method: 'POST' })
    const res = await postConfirmar(req, { params: Promise.resolve({ token: 'xxx' }) })
    expect(res.status).toBe(404)
  })
})
