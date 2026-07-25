import { esReservado } from './reserved-slugs'

const PATRON = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type ValidacionSlug = { valido: true } | { valido: false; razon: string }

export function validarSlug(slug: string): ValidacionSlug {
  if (slug.length < 2) return { valido: false, razon: 'muy corto (mínimo 2 caracteres)' }
  if (slug.length > 63) return { valido: false, razon: 'muy largo (máximo 63 caracteres)' }
  if (!PATRON.test(slug)) {
    return {
      valido: false,
      razon: 'solo minúsculas, números y guiones simples; sin empezar/terminar con guion',
    }
  }
  if (esReservado(slug)) return { valido: false, razon: 'slug reservado' }
  return { valido: true }
}
