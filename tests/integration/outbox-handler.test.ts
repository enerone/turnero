import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'
import { createTenantClient } from '@/lib/db/tenant-client'
import { encolarEmail, encolarWhatsApp } from '@/lib/outbox/encolar'

// Mockeamos los senders para controlar success/failure sin red externa.
const sendEmailSpy = vi.fn()
const sendWhatsappSpy = vi.fn()

vi.mock('@/lib/public-booking/email', async () => ({
  enviarEmailAviso: (...args: unknown[]) => sendEmailSpy(...args),
  enviarEmailConfirmacion: vi.fn().mockResolvedValue(undefined),
  enviarEmailRecordatorio: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp', () => ({
  enviarWhatsAppTexto: (...args: unknown[]) => sendWhatsappSpy(...args),
  normalizarTelefonoWA: (x: string) => x.replace(/\D/g, ''),
}))

describe('procesar-outbox handler', () => {
  useTestDatabase()

  beforeEach(() => {
    sendEmailSpy.mockReset()
    sendWhatsappSpy.mockReset()
  })

  it('procesa mensajes pendientes vencidos y los marca como procesado', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)
    await encolarEmail(db, { destinatario: 'a@b.com', asunto: 'X', cuerpoHtml: '<p>hi</p>' })
    await encolarWhatsApp(db, { destinatario: '+5491100000000', cuerpo: 'hola' })

    sendEmailSpy.mockResolvedValue(undefined)
    sendWhatsappSpy.mockResolvedValue(undefined)

    const { handler } = await import('@/lib/jobs/handlers/procesar-outbox')
    await handler()

    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
    expect(sendWhatsappSpy).toHaveBeenCalledTimes(1)

    const filas = await testPrisma.outboxMensaje.findMany({ where: { cuentaId: cuenta.id } })
    expect(filas.every((f) => f.estado === 'procesado')).toBe(true)
    expect(filas.every((f) => f.procesadoEn !== null)).toBe(true)
  })

  it('reintenta con backoff y marca fallado tras 5 intentos', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)
    await encolarEmail(db, { destinatario: 'a@b.com', asunto: 'X', cuerpoHtml: '<p>x</p>' })

    sendEmailSpy.mockRejectedValue(new Error('Resend timeout'))

    const { handler } = await import('@/lib/jobs/handlers/procesar-outbox')

    // Cinco corridas: cada una hace un intento. Después de la 5ta debería quedar fallado.
    for (let i = 0; i < 5; i++) {
      // Forzar siguienteIntento al pasado para que el próximo run lo procese
      await testPrisma.outboxMensaje.updateMany({
        where: { cuentaId: cuenta.id, estado: 'pendiente' },
        data: { siguienteIntento: new Date(Date.now() - 60_000) },
      })
      await handler()
    }

    const fila = await testPrisma.outboxMensaje.findFirst({ where: { cuentaId: cuenta.id } })
    expect(fila?.estado).toBe('fallado')
    expect(fila?.intentos).toBe(5)
    expect(fila?.ultimoError).toContain('Resend timeout')
  })

  it('respeta siguiente_intento: no procesa mensajes con backoff activo', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const db = createTenantClient(cuenta.id)
    await encolarEmail(db, { destinatario: 'a@b.com', asunto: 'X', cuerpoHtml: '<p>x</p>' })

    // Empujar siguienteIntento al futuro (backoff hipotético)
    await testPrisma.outboxMensaje.updateMany({
      where: { cuentaId: cuenta.id },
      data: { siguienteIntento: new Date(Date.now() + 60 * 60 * 1000) },
    })

    sendEmailSpy.mockResolvedValue(undefined)
    const { handler } = await import('@/lib/jobs/handlers/procesar-outbox')
    await handler()

    expect(sendEmailSpy).not.toHaveBeenCalled()
    const fila = await testPrisma.outboxMensaje.findFirst({ where: { cuentaId: cuenta.id } })
    expect(fila?.estado).toBe('pendiente')
    expect(fila?.intentos).toBe(0)
  })
})
