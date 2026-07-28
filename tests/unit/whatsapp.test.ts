import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { normalizarTelefonoWA } from '@/lib/whatsapp'

describe('normalizarTelefonoWA', () => {
  it('quita espacios/guiones y normaliza a E.164 sin `+`', () => {
    expect(normalizarTelefonoWA('+54 9 11 4567-8900')).toBe('5491145678900')
    // formato local ARG con 0 → se prefija código país
    expect(normalizarTelefonoWA('(011) 4567 8900')).toBe('541145678900')
  })

  it('devuelve null para inputs vacíos o inválidos', () => {
    expect(normalizarTelefonoWA(null)).toBeNull()
    expect(normalizarTelefonoWA(undefined)).toBeNull()
    expect(normalizarTelefonoWA('')).toBeNull()
    expect(normalizarTelefonoWA('123')).toBeNull()
  })

  it('acepta números que ya vienen limpios', () => {
    expect(normalizarTelefonoWA('5491145678900')).toBe('5491145678900')
  })
})

describe('enviarWhatsAppTexto', () => {
  let originalFetch: typeof fetch
  const originalToken = process.env.WHATSAPP_TOKEN
  const originalPhone = process.env.WHATSAPP_PHONE_ID

  beforeEach(() => {
    originalFetch = global.fetch
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_ID = 'test-phone-id'
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.WHATSAPP_TOKEN = originalToken ?? ''
    process.env.WHATSAPP_PHONE_ID = originalPhone ?? ''
  })

  it('manda POST con Content-Type JSON y payload en la forma que espera Cloud API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'ok' })
    global.fetch = fetchMock as any

    const { enviarWhatsAppTexto } = await import('@/lib/whatsapp')
    await enviarWhatsAppTexto({ to: '+54 9 11 4567-8900', body: 'hola' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/test-phone-id/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(init.headers['Content-Type']).toBe('application/json')

    const payload = JSON.parse(init.body as string)
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5491145678900',
      type: 'text',
      text: { body: 'hola', preview_url: false },
    })
  })

  it('no hace fetch si las credenciales faltan', async () => {
    process.env.WHATSAPP_TOKEN = ''
    process.env.WHATSAPP_PHONE_ID = ''
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any

    const { enviarWhatsAppTexto } = await import('@/lib/whatsapp')
    await enviarWhatsAppTexto({ to: '+5491145678900', body: 'x' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tira error si la API responde no-ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid recipient',
    })
    global.fetch = fetchMock as any

    const { enviarWhatsAppTexto } = await import('@/lib/whatsapp')
    await expect(
      enviarWhatsAppTexto({ to: '+5491145678900', body: 'x' }),
    ).rejects.toThrow(/WhatsApp API 400/)
  })
})
