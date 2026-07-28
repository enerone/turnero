const TZ_DEFAULT = 'America/Argentina/Buenos_Aires'

/**
 * Formato humano de fecha en Rioplatense: "lunes 27 de julio".
 */
export function formatearFechaLocal(fecha: Date, timezone: string = TZ_DEFAULT): string {
  return fecha.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone,
  })
}

/**
 * Formato humano de hora 24h en el timezone del tenant: "14:30".
 */
export function formatearHoraLocal(fecha: Date, timezone: string = TZ_DEFAULT): string {
  return fecha.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  })
}

/**
 * "lunes 27 de julio a las 14:30" — atajo para mensajes de notificación.
 */
export function formatearFechaHoraLocal(fecha: Date, timezone: string = TZ_DEFAULT): string {
  return `${formatearFechaLocal(fecha, timezone)} a las ${formatearHoraLocal(fecha, timezone)}`
}
