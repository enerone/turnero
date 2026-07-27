/**
 * Normaliza un teléfono a E.164 con `+` inicial. Devuelve null si el input
 * no es reconocible como número.
 *
 * Reglas (heurística argento-friendly):
 * - Si ya viene con `+`, se respetan los dígitos que siguen.
 * - Si empieza con `54`, se asume Argentina y se agrega `+`.
 * - Si empieza con `9` de 11 dígitos, se asume móvil ARG y se prefija `+54`.
 * - Si empieza con `0` (ej. 011-4567-8900), se quita el `0` de área y se
 *   prefija `+54` (0-11 → +54 11).
 * - Fallback: si tiene entre 8 y 15 dígitos y no encaja en lo anterior, se
 *   asume ya venir con código país y se agrega `+`.
 *
 * Devuelve null para longitudes fuera de [8, 15] (rango legal E.164).
 */
export function normalizarTelefonoE164(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const empiezaConPlus = trimmed.startsWith('+')
  const digitos = trimmed.replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 15) return null

  if (empiezaConPlus) return `+${digitos}`

  // Argentina heurística
  if (digitos.startsWith('54')) return `+${digitos}`
  if (digitos.startsWith('9') && digitos.length === 11) return `+54${digitos}`
  if (digitos.startsWith('0')) return `+54${digitos.slice(1)}`

  return `+${digitos}`
}
