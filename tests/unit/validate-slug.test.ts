import { describe, expect, it } from 'vitest'
import { validarSlug } from '@/lib/tenant/validate-slug'

describe('validarSlug', () => {
  it.each([
    ['escribania-doe', true],
    ['dra-ana-martinez', true],
    ['a', false], // muy corto (min 2)
    ['ab', true],
    ['a'.repeat(63), true],
    ['a'.repeat(64), false], // muy largo
    ['MAYUS', false], // solo lowercase
    ['con espacios', false],
    ['con_underscore', false],
    ['-empieza-guion', false],
    ['termina-guion-', false],
    ['doble--guion', false],
    ['ñombre', false], // ASCII only
    ['123-solo-numeros', true],
    ['admin', false], // reservado
  ])('slug "%s" → válido=%s', (input, esValido) => {
    const resultado = validarSlug(input)
    expect(resultado.valido).toBe(esValido)
    if (!resultado.valido) {
      expect(resultado.razon).toBeTruthy()
    }
  })
})
