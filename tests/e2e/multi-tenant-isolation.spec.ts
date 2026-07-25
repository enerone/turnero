import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
})

test.describe('aislamiento multi-tenant end-to-end', () => {
  const slugA = `e2e-a-${Date.now()}`
  const slugB = `e2e-b-${Date.now()}`
  let cuentaAId: string
  let cuentaBId: string

  test.beforeAll(async () => {
    const cuentaA = await prisma.cuenta.create({
      data: { slug: slugA, nombrePublico: 'Cuenta A' },
    })
    const cuentaB = await prisma.cuenta.create({
      data: { slug: slugB, nombrePublico: 'Cuenta B' },
    })
    cuentaAId = cuentaA.id
    cuentaBId = cuentaB.id

    await prisma.servicio.create({
      data: { cuentaId: cuentaAId, nombre: 'A1', duracionMinutos: 30, esDefault: true },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuentaBId, nombre: 'B1', duracionMinutos: 30, esDefault: true },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuentaBId, nombre: 'B2', duracionMinutos: 45, esDefault: false },
    })
  })

  test.afterAll(async () => {
    await prisma.cuenta.deleteMany({ where: { id: { in: [cuentaAId, cuentaBId] } } })
    await prisma.$disconnect()
  })

  test('/[slugA]/debug devuelve solo datos de A', async ({ request }) => {
    const resp = await request.get(`/${slugA}/debug`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.cuenta.slug).toBe(slugA)
    expect(body.counts.servicios).toBe(1)
  })

  test('/[slugB]/debug devuelve solo datos de B', async ({ request }) => {
    const resp = await request.get(`/${slugB}/debug`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.cuenta.slug).toBe(slugB)
    expect(body.counts.servicios).toBe(2)
  })

  test('slug inexistente devuelve 404', async ({ request }) => {
    const resp = await request.get('/no-existe-esta-cuenta/debug')
    expect(resp.status()).toBe(404)
  })

  test('slug reservado no matchea /[slug]', async ({ request }) => {
    const resp = await request.get('/admin/debug')
    expect([404, 405]).toContain(resp.status())
  })
})
