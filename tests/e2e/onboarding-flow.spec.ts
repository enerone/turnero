import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
})

test.describe('flujo de onboarding y sesión', () => {
  const slug = `e2e-onb-${Date.now()}`
  let cuentaId: string
  let usuarioId: string

  test.beforeAll(async () => {
    const cuenta = await prisma.cuenta.create({
      data: { slug, nombrePublico: 'E2E Onboarding' },
    })
    const usuario = await prisma.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: 'e2e@example.com',
        nombre: 'E2E User',
        googleSub: `gs-e2e-${Date.now()}`,
        rol: 'owner',
      },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuenta.id, nombre: 'Consulta', duracionMinutos: 30, esDefault: true },
    })
    cuentaId = cuenta.id
    usuarioId = usuario.id
  })

  test.afterAll(async () => {
    await prisma.cuenta.delete({ where: { id: cuentaId } })
    await prisma.$disconnect()
  })

  test('/login carga sin sesión', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Turnero' })).toBeVisible()
    await expect(page.getByRole('link', { name: /continuar con google/i })).toBeVisible()
  })

  test('/[slug] sin sesión redirige a /login', async ({ page }) => {
    await page.goto(`/${slug}`)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('login test-mode → /[slug] muestra bienvenida', async ({ page }) => {
    const resp = await page.request.post('/test/login-as', {
      data: { usuarioId, cuentaId },
    })
    expect(resp.status()).toBe(200)

    await page.goto(`/${slug}`)
    await expect(page.getByRole('heading', { name: /bienvenida/i })).toBeVisible()
    await expect(page.getByText(/E2E Onboarding/)).toBeVisible()
    await expect(page.getByRole('button', { name: /cerrar sesión/i })).toBeVisible()
  })

  test('logout limpia la sesión', async ({ page }) => {
    await page.request.post('/test/login-as', { data: { usuarioId, cuentaId } })
    await page.goto(`/${slug}`)
    await page.getByRole('button', { name: /cerrar sesión/i }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
