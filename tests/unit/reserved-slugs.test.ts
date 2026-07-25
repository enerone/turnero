import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, esReservado } from '@/lib/tenant/reserved-slugs'

describe('reserved slugs', () => {
  it('bloquea rutas del app', () => {
    for (const s of ['admin', 'api', 'app', 'www', 'login', 'signup', 'settings']) {
      expect(esReservado(s)).toBe(true)
    }
  })

  it('permite slugs de negocios reales', () => {
    for (const s of ['escribania-doe', 'dra-ana', 'consultorio-central']) {
      expect(esReservado(s)).toBe(false)
    }
  })

  it('es case-insensitive', () => {
    expect(esReservado('ADMIN')).toBe(true)
    expect(esReservado('Admin')).toBe(true)
  })

  it('la lista contiene al menos las rutas conocidas', () => {
    const rutasConocidas = ['admin', 'api', 'app', 'www', 'help', 'soporte', 'panel', 'settings']
    for (const r of rutasConocidas) {
      expect(RESERVED_SLUGS.has(r)).toBe(true)
    }
  })
})
