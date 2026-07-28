import { describe, it, expect } from 'vitest'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

describe('normalizarTelefonoE164', () => {
  it('respeta el + inicial y quita separadores', () => {
    expect(normalizarTelefonoE164('+54 9 11 4567-8900')).toBe('+5491145678900')
    expect(normalizarTelefonoE164('+1 (202) 555-0100')).toBe('+12025550100')
  })

  it('normaliza formato local ARG con 0 de área', () => {
    expect(normalizarTelefonoE164('011 4567 8900')).toBe('+541145678900')
    expect(normalizarTelefonoE164('0221-555-1234')).toBe('+542215551234')
  })

  it('prefija +54 en móviles ARG que empiezan con 9', () => {
    expect(normalizarTelefonoE164('91145678900')).toBe('+5491145678900')
  })

  it('respeta números que ya vienen con 54 y sin +', () => {
    expect(normalizarTelefonoE164('5491145678900')).toBe('+5491145678900')
  })

  it('devuelve null para entradas inválidas', () => {
    expect(normalizarTelefonoE164(null)).toBeNull()
    expect(normalizarTelefonoE164('')).toBeNull()
    expect(normalizarTelefonoE164('   ')).toBeNull()
    expect(normalizarTelefonoE164('123')).toBeNull()
    expect(normalizarTelefonoE164('1'.repeat(20))).toBeNull()
  })

  it('es idempotente: normalizar dos veces da lo mismo', () => {
    const raw = '011 4567 8900'
    const primera = normalizarTelefonoE164(raw)
    const segunda = normalizarTelefonoE164(primera)
    expect(primera).toBe(segunda)
  })
})
