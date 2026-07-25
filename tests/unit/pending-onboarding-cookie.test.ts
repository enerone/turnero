import { describe, expect, it } from 'vitest'
import {
  serializarPendingOnboarding,
  deserializarPendingOnboarding,
  type PendingOnboarding,
} from '@/lib/auth/pending-onboarding'

const SECRET = 'x'.repeat(48)

describe('pending onboarding cookie', () => {
  const dato: PendingOnboarding = {
    googleSub: 'sub-123',
    email: 'ana@example.com',
    nombre: 'Ana Martínez',
    refreshToken: 'refresh-abc',
    creadoEn: new Date('2026-07-25T12:00:00Z').toISOString(),
  }

  it('serializa y deserializa un valor válido', async () => {
    const s = await serializarPendingOnboarding(dato, SECRET)
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(0)
    const back = await deserializarPendingOnboarding(s, SECRET)
    expect(back).toEqual(dato)
  })

  it('deserializar con secret distinto falla', async () => {
    const s = await serializarPendingOnboarding(dato, SECRET)
    await expect(
      deserializarPendingOnboarding(s, 'y'.repeat(48)),
    ).rejects.toThrow()
  })

  it('deserializar de basura falla', async () => {
    await expect(deserializarPendingOnboarding('no-es-una-cookie', SECRET)).rejects.toThrow()
  })
})
