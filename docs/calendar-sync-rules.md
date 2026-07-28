---
title: Reglas de sincronización Turnero ↔ Google Calendar
description: Contrato de resolución de conflictos entre la base del turnero y Google Calendar. Cubre last-write-wins por etag, cancelaciones, movimientos, eventos creados en Google, watches y recurring events.
date: 2026-07-27
tags: [plan-3b, calendar, sync, contract]
status: activo
---

# Reglas de sincronización bidireccional Turnero ↔ Google Calendar

Este documento fija las reglas de resolución de conflictos entre lo que hay
en la base del turnero y lo que hay en Google Calendar. Es un contrato de
comportamiento — cualquier cambio en cómo se sincroniza tiene que actualizar
este archivo *primero* y después el código.

## Contexto

Cada cuenta tiene dos calendarios watched:

- **Calendario dedicado**: creado por `bootstrap-calendar` con el nombre
  "Turnero". Cada turno confirmado en el sistema se pushea acá como evento
  con `Turno.googleEventId` guardado.
- **Calendario primario** (`calendarIdPrimario`, default `"primary"`): la
  agenda personal del profesional. NO se escribe desde el turnero. Se lee
  para importar bloqueos (reuniones personales, almuerzos, etc.) como
  `EventoExterno` — bloquean slots del booking público pero no son turnos.

## Regla #1 — last-write-wins por etag (updates)

Cuando el turnero updateaba un evento del calendario dedicado, envía
`ifMatch: etag`. Google responde:

- **200 OK**: pisamos, guardamos el nuevo etag.
- **412 Precondition Failed**: Google tiene una versión más nueva. Cedemos:
  no reintentamos el push, esperamos que el próximo pull traiga la versión
  de Google y la aplique.

Cuando el pull trae un update desde Google (etag distinto al nuestro),
aplicamos el cambio de Google. Si el etag es el mismo, no-op (evita
loops de sync).

## Regla #2 — cancelaciones se propagan

- Turno cancelado en el turnero (por cliente vía token, o por owner en el
  panel): `sync-turno-google delete` → borra el evento del dedicado en
  Google. Idempotente en 404/410.
- Evento del dedicado cancelado en Google: `pull-calendar-changes` con
  `status: cancelled` → `Turno.estado = cancelado`,
  `origenCancelacion = google_calendar`. Notifica al cliente por WhatsApp
  (pendiente — pasa por outbox una vez que el panel lo dispare).

## Regla #3 — movimientos (cambio de horario)

- Turno movido en Google: `Turno.inicio` y `Turno.fin` se actualizan al
  nuevo horario. Adicional: `recordatorio_enviado_en` se resetea a null,
  para que el próximo tick del cron mande recordatorio con el horario
  nuevo.
- Turno movido en el turnero (pendiente — no hay panel edit todavía):
  disparará `sync-turno-google upsert` → patch en Google.

## Regla #4 — eventos nuevos creados directamente en Google

- **Calendario primario**: se importan como `EventoExterno` (bloqueo de
  slot). Trivial: no compiten con nada del turnero.
- **Calendario dedicado**: NO se convierten en `Turno` — no tenemos cliente
  ni servicio para asociar. Se guardan como `EventoExterno` para que
  bloqueen el slot en el booking público. El profesional que quiera hacer
  el turno "formal" (con cliente, servicio, notificaciones) lo crea desde
  el panel del turnero.

Esta regla evita crear turnos huérfanos con `clienteId = null` que rompen
todas las notificaciones downstream.

## Regla #5 — eventos borrados en Google del calendario primario

Se eliminan del `EventoExterno`. Idempotente por
`@@unique([cuentaId, googleEventId])`.

## Regla #6 — recurring events

**Fuera de scope por ahora.** Google los expande a instancias con
`singleEvents: true` (que ya usamos en full-sync). Cada instancia se trata
como un evento individual. Las excepciones (una instancia movida) se
manejan como un update normal por etag.

Cuando el turnero soporte servicios recurrentes (algún día), esta regla
va a necesitar reescritura completa.

## Regla #7 — watch channels expirados

Google mata los watches a los ≤7 días. El cron `renovar-watch-channels`
(horario, minuto 15) renueva los que expiran en las próximas 24h.
`asegurarWatches` es idempotente: cierra el viejo si existe y crea uno
nuevo. Los `sync_token` NO se reinician (siguen sirviendo con el nuevo
watch).

Si un pull recibe **410 Gone en el sync_token**, `pull-calendar-changes`
reinicia con full-sync automáticamente y persiste el nuevo token.

## Regla #8 — el push es best-effort

`sync-turno-google` corre en pg-boss con retryLimit=5 y backoff exponencial.
Si Google está caído por más tiempo que eso, el job queda como failed y hay
que reintentar manualmente (pendiente: dashboard de failed jobs).

**El turno se persiste ANTES de encolar el push**, así que una caída del
sync no bloquea al cliente que reserva. La regla #1 y el pull se encargan
de reconciliar cuando el sync vuelva a la vida.

## Regla #9 — un solo worker

Todo pg-boss corre en el mismo proceso Node que Next.js (declarado en
`instrumentation.ts`). Si en el futuro escalamos a N réplicas, hay que:

- Cambiar `pull-calendar-changes` a `SELECT ... FOR UPDATE SKIP LOCKED`.
- Verificar que `asegurarWatches` no corra dos veces en paralelo (agregar
  advisory lock por `cuentaId`).
- Considerar mover jobs a un worker dedicado (Railway service separado).

## Referencias

- [[CLAUDE]] — reglas duras que constrainen la implementación del turnero.
- [[2026-07-26-turnero-plan-03a-calendar-bootstrap]] — plan previo (bootstrap del calendar).
