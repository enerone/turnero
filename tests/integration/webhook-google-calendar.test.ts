import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/webhooks/google-calendar/route'

const enqueueSpy = vi.fn()

vi.mock('@/lib/jobs/enqueue', () => ({
  enqueuePullCalendarChanges: (...args: unknown[]) => enqueueSpy(...args),
}))

const lookupSpy = vi.fn()

vi.mock('@/lib/calendar/google-client', async () => {
  const mod = await vi.importActual<typeof import('@/lib/calendar/google-client')>(
    '@/lib/calendar/google-client',
  )
  return {
    ...mod,
    obtenerIntegracionPorChannel: (...args: unknown[]) => lookupSpy(...args),
  }
})

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/google-calendar', {
    method: 'POST',
    headers,
  })
}

describe('webhook /api/webhooks/google-calendar', () => {
  beforeEach(() => {
    enqueueSpy.mockReset()
    lookupSpy.mockReset()
  })

  it('devuelve 400 sin channel-id', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('devuelve 200 sin enqueue en el ping "sync" inicial', async () => {
    const res = await POST(req({
      'x-goog-channel-id': 'ch_1',
      'x-goog-resource-state': 'sync',
    }))
    expect(res.status).toBe(200)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('devuelve 410 cuando el channel no está registrado', async () => {
    lookupSpy.mockResolvedValue(null)
    const res = await POST(req({
      'x-goog-channel-id': 'ch_desconocido',
      'x-goog-resource-state': 'exists',
    }))
    expect(res.status).toBe(410)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('devuelve 401 con token mismatch', async () => {
    lookupSpy.mockResolvedValue({
      cuenta_id: 'aaa',
      tipo: 'dedicado',
      calendar_id: 'cal',
      sync_token: null,
      token: 'secreto_correcto',
    })
    const res = await POST(req({
      'x-goog-channel-id': 'ch_1',
      'x-goog-channel-token': 'secreto_incorrecto',
      'x-goog-resource-state': 'exists',
    }))
    expect(res.status).toBe(401)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('encola pull y devuelve 200 con token correcto', async () => {
    lookupSpy.mockResolvedValue({
      cuenta_id: 'cuenta-abc',
      tipo: 'primario',
      calendar_id: 'primary',
      sync_token: 'x',
      token: 'secreto',
    })
    enqueueSpy.mockResolvedValue('job-id-123')

    const res = await POST(req({
      'x-goog-channel-id': 'ch_2',
      'x-goog-channel-token': 'secreto',
      'x-goog-resource-state': 'exists',
    }))

    expect(res.status).toBe(200)
    expect(enqueueSpy).toHaveBeenCalledWith({ cuentaId: 'cuenta-abc', tipo: 'primario' })
  })
})
