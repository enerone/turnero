/**
 * Parsea texto libre del usuario a intenciones concretas para el motor conversacional.
 */

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
}

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

const NUMEROS_ESCRITOS: Record<string, number> = {
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
}

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * Devuelve medianoche en el timezone dado para una fecha representada como
 * año/mes/día locales. DST-aware via Intl.
 */
function medianocheTz(year: number, month: number, day: number, tz: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 3, 0, 0)
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcGuess))
  const map: Record<string, string> = {}
  for (const p of partes) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // Offset en minutos entre UTC y el tz en esa fecha
  const localHour = Number(map.hour)
  const localMin = Number(map.minute)
  const offsetMin = 3 * 60 - (localHour * 60 + localMin)
  return new Date(Date.UTC(year, month - 1, day) + offsetMin * 60_000)
}

function hoyEnTz(tz: string): { year: number; month: number; day: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const map: Record<string, string> = {}
  for (const p of partes) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  }
}

function weekdayEnTz(date: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[s] ?? 0
}

/**
 * Parsea texto libre a una Date (medianoche en `tz`).
 * Entiende: 'hoy', 'mañana', 'pasado mañana', nombres de días de semana,
 * 'próximo lunes', 'dd/mm', 'dd-mm-aaaa', 'dd de mes'.
 * Devuelve null si no entiende.
 */
export function parsearDia(texto: string, tz: string): Date | null {
  const norm = normalizarTexto(texto)
  const hoy = hoyEnTz(tz)
  const ahora = medianocheTz(hoy.year, hoy.month, hoy.day, tz)

  if (norm === 'hoy') return ahora

  if (norm === 'manana' || norm.includes('mañana') && !norm.includes('pasado')) {
    return new Date(ahora.getTime() + 86_400_000)
  }

  if (norm.includes('pasado') && (norm.includes('manana') || norm.includes('mañana'))) {
    return new Date(ahora.getTime() + 2 * 86_400_000)
  }

  // "próximo lunes", "el lunes", o solo "lunes"
  const esProximo = norm.includes('proximo') || norm.includes('siguiente') || norm.includes('que viene')
  for (const [nombre, num] of Object.entries(DIAS_SEMANA)) {
    if (norm.includes(nombre)) {
      const hoyWd = weekdayEnTz(ahora, tz)
      let diff = num - hoyWd
      if (diff <= 0 || esProximo) diff += 7
      return new Date(ahora.getTime() + diff * 86_400_000)
    }
  }

  // dd/mm o dd-mm
  const matchCorto = norm.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (matchCorto) {
    const d = parseInt(matchCorto[1], 10)
    const m = parseInt(matchCorto[2], 10)
    const y = m < hoy.month ? hoy.year + 1 : hoy.year
    const fecha = medianocheTz(y, m, d, tz)
    return fecha >= ahora ? fecha : null
  }

  // dd/mm/aaaa o dd-mm-aaaa
  const matchLargo = norm.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (matchLargo) {
    const d = parseInt(matchLargo[1], 10)
    const m = parseInt(matchLargo[2], 10)
    const y = parseInt(matchLargo[3], 10)
    const fecha = medianocheTz(y, m, d, tz)
    return fecha >= ahora ? fecha : null
  }

  // "15 de agosto", "5 de octubre"
  const matchEscrito = norm.match(/^(\d{1,2})\s+de\s+([a-záéíóúñü]+)/)
  if (matchEscrito) {
    const d = parseInt(matchEscrito[1], 10)
    const mesNorm = matchEscrito[2]
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    const m = MESES[mesNorm]
    if (m) {
      const y = m < hoy.month ? hoy.year + 1 : hoy.year
      const fecha = medianocheTz(y, m, d, tz)
      return fecha >= ahora ? fecha : null
    }
  }

  return null
}

/**
 * Parsea una opción numérica (1-max). Devuelve índice 0-based o null.
 */
export function parsearOpcionNumerica(texto: string, max: number): number | null {
  const norm = normalizarTexto(texto)

  // Número escrito
  const escrito = NUMEROS_ESCRITOS[norm]
  if (escrito !== undefined && escrito >= 1 && escrito <= max) {
    return escrito - 1
  }

  // Dígito
  const match = norm.match(/^(\d+)$/)
  if (match) {
    const n = parseInt(match[1], 10)
    if (n >= 1 && n <= max) return n - 1
  }

  return null
}

/**
 * Detecta intención de cancelar la conversación.
 */
export function detectarCancelar(texto: string): boolean {
  const norm = normalizarTexto(texto)
  return /\b(cancelar|cancel|salir|exit|no|nada|chau|adios|adiós|stop)\b/.test(norm)
}

/**
 * Detecta que el usuario quiere ver la semana siguiente.
 */
export function detectarSiguienteSemana(texto: string): boolean {
  const norm = normalizarTexto(texto)
  return (
    norm.includes('siguiente semana') ||
    norm.includes('proxima semana') ||
    norm.includes('la semana que viene') ||
    norm.includes('semana siguiente') ||
    norm.includes('semana proxima') ||
    norm === 'siguiente'
  )
}
