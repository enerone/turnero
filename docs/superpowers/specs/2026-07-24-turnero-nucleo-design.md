---
title: Turnero — Diseño del Núcleo (Ciclo 1)
description: Diseño del Ciclo 1 de Turnero: modelo multi-tenant, sync bidireccional con Google Calendar, panel operativo (lista mobile + grilla desktop) y config. Stack Next.js + Prisma + Postgres + pg-boss en Railway.
date: 2026-07-24
type: design-spec
project: turnero
ciclo: 1
status: draft
tags: [turnero, spec, nucleo, multi-tenant, calendar-sync]
related:
  - "[[CLAUDE-turnero]]"
  - "[[CLAUDE]]"
---

# Turnero — Diseño del Núcleo (Ciclo 1)

**Fecha:** 2026-07-24
**Alcance:** Ciclo 1 del roadmap definido en [[CLAUDE-turnero]] → "Orden de construcción" → 1. Núcleo.
**Documentos hermanos:** [[CLAUDE]] (guía operativa del repo), [[CLAUDE-turnero]] (contexto de producto).
**Criterio de salida:** "La agenda funciona sola". El profesional puede crear/mover/cancelar turnos desde el panel, todo se refleja en su Google Calendar dedicado, y los eventos que carga fuera de Turnero le bloquean disponibilidad correctamente.

---

## 1. Contexto

Turnero es el producto de entrada de una plataforma modular para estudios profesionales argentinos (escribanías, estudios jurídicos y contables, consultorios). Se distribuye a ~2000 pymes vía un socio comercial. Equipo: dos personas a tiempo parcial. El diferencial es la reducción del ausentismo del ~20% al ~8% mediante confirmación automática por WhatsApp — pero eso vive en el Ciclo 2.

Este ciclo entrega la **agenda funcionando sola**: modelo de datos multi-tenant, sync bidireccional con Google Calendar, y el panel operativo para el profesional/secretaria (lista mobile + grilla desktop). Sin página pública, sin recordatorios, sin WhatsApp — todavía.

El turnero expone la API que un asistente conversacional consumirá más adelante. **Nunca duplicar lógica de agenda del otro lado.** Esta regla determina el diseño desde el día uno.

---

## 2. Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Prisma** + **Postgres** (con Row-Level Security como red de seguridad)
- **pg-boss** para jobs y cron (cola de trabajos en Postgres, sin Redis)
- **Lucia** para auth (sesiones en base, no JWT)
- **googleapis** (Node) para Google Calendar
- **Tailwind + Radix UI** para las tres superficies
- **Zod** en todos los bordes (input público, webhooks)
- **Vitest + Playwright** para tests
- **pino** para logging estructurado, **Sentry** para errores
- Deploy: **Railway** (app + Postgres en un solo proyecto)

Razones y contrapuntos: ver `2026-07-24-turnero-nucleo-design.md` sección "Decisión de stack" al final. En resumen: el asistente futuro será TS, el ecosistema de Calendar sync está más maduro en Node, la pública tiene que ser rápida en Android viejo, y el admin de Django (la razón principal para elegirlo) se convierte en footgun dada la regla "recordatorios derivados del turno, no copiados".

---

## 3. Modelo de datos

Todos los timestamps en `timestamptz` (UTC). Horarios de atención como `time` local (semánticamente locales). Fechas de excepción como `date`. Todos los modelos tenant-scoped llevan `cuentaId` NOT NULL.

### Entidades

```
Cuenta (tenant)
  id, slug (unique), nombre_publico, color, ubicacion, timezone
  telefono_whatsapp (E.164), subdominio_activo (bool)
  timestamps

Usuario
  id, cuenta_id, email, nombre, google_sub (unique), rol
  (rol ∈ {owner, secretaria})
  timestamps

IntegracionCalendar (1:1 con Cuenta)
  cuenta_id (unique), refresh_token (cifrado AES-256-GCM),
  calendar_id_dedicado, calendar_id_primario,
  watch_channel_dedicado_id, watch_channel_dedicado_expira,
  watch_channel_primario_id, watch_channel_primario_expira,
  sync_token_dedicado, sync_token_primario,
  estado (∈ {conectado, desconectado}), timestamps

Servicio
  id, cuenta_id, nombre, duracion_minutos,
  es_default (bool), permite_sobreturnos (bool, default false),
  activo (bool)

HorarioSemanal
  id, cuenta_id, dia_semana (0-6, lunes=0), desde (time), hasta (time)
  (varias filas por día para ventanas partidas: 9-13, 15-18)

ExcepcionHorario
  id, cuenta_id, fecha, tipo (∈ {cerrado, horario_especial}),
  desde (time?), hasta (time?), motivo (text)

Cliente
  id, cuenta_id, nombre, telefono (E.164), email?, notas
  unique(cuenta_id, telefono)

Turno
  id, cuenta_id, cliente_id?, servicio_id, inicio (timestamptz), fin (timestamptz),
  estado (∈ {borrador, confirmado, cancelado, completado, no_asistio}),
  google_event_id?, google_event_etag?,
  origen (∈ {turnero, google_calendar}),
  origen_cancelacion? (∈ {panel, google_calendar, cliente}),
  notas, timestamps
  index (cuenta_id, inicio)

EventoExterno (busy blocks leídos del primario)
  id, cuenta_id, google_event_id (unique por cuenta), inicio, fin,
  titulo?, updated_at

AuditLog
  id, cuenta_id, usuario_id?, accion, entidad, entidad_id, payload (jsonb),
  created_at

Invitacion
  id, cuenta_id, email, token, expira_en, aceptada_en?, created_at
```

### Puntos no obvios

- **`fin` de Turno materializado**, no calculado. Simplifica queries de overlap y de rango. Se computa al momento de crear/mover el turno como `inicio + servicio.duracion_minutos`.
- **NO hay constraint `EXCLUDE USING gist` sobre Turno.** Los sobreturnos son un patrón real (médicos que sobreagendan para compensar ausentismo). El solape se controla a nivel aplicación con reglas distintas según origen (ver sección 6).
- **`EventoExterno` es tabla separada de Turno.** Un turno tiene cliente, servicio, estado; un evento externo es solo un bloque busy. Mezclarlos ensucia todas las queries.
- **`origen` en Turno** permite trazar quién creó cada uno: `turnero` (panel) o `google_calendar` (adoptado de un evento cargado directo en el calendario dedicado).
- **`Recordatorio` no aparece.** Es del ciclo 2 y será una vista/query derivada sobre `Turno`, no una tabla — como pide el MD ("los recordatorios se derivan del turno, no se copian").
- **`AuditLog`** desde día uno: cada acción sensible (cancelar, mover, cambiar config, sync-conflict) genera una fila. Requerido para soporte y para debuggear los conflictos de reconciliación.

---

## 4. Multi-tenant: aislamiento por defecto

Tres capas activas desde el commit uno. Datos de un cliente apareciendo en la vista de otro termina el negocio con el canal de distribución — el costo de prevenirlo hoy es mínimo.

### Capa 1 — Contexto por request

Middleware Next.js resuelve la `Cuenta` desde subdominio (opt-in) o path (`/[slug]/*`) y setea `cuentaId` en una `AsyncLocalStorage`. Todo lo que corre bajo ese request tiene acceso al `cuentaId` sin pasarlo por parámetro. Si no hay `cuentaId` resuelto, la request es 404 antes de tocar la base.

### Capa 2 — Prisma Extension

Una extensión de Prisma intercepta cada query sobre modelos con `cuentaId`:

1. Inyecta `where: { cuentaId }` en `find*`, `update*`, `delete*`, `count`, `aggregate`.
2. Inyecta `data: { cuentaId }` en `create` si no está presente.
3. Lanza excepción si detecta una query sin `cuentaId` en contexto sobre un modelo tenant-scoped.

Test unitario por modelo que verifica que la extensión falla sin contexto. Se rompe si alguien agrega un modelo nuevo y se olvida del pattern.

### Capa 3 — Row-Level Security en Postgres

Cada tabla tenant-scoped tiene RLS activada:

```sql
CREATE POLICY tenant_isolation ON turno
  USING (cuenta_id = current_setting('app.cuenta_id')::uuid);
```

El pool de Prisma emite `SET LOCAL app.cuenta_id = '...'` al empezar cada transacción. Si la capa 2 falla, Postgres corta el acceso desde abajo.

### Superusuario de plataforma

Rol de Postgres separado que bypassea RLS, usado **solo** desde un CLI aparte (`scripts/plataforma-cli.ts`), nunca desde la app web. Cada acción con ese rol se registra en `AuditLog` con `usuario_id = null` y `payload.origen = 'plataforma_cli'`.

### Lo que no hacemos

- No hay `schema-per-tenant`. Para 2000 cuentas es una masacre de migraciones.
- No hay database-per-tenant. Overkill.
- No confiamos en la capa de presentación para filtrar.

### Tests obligatorios

- E2E que crea 2 cuentas, hace login como una, y verifica que ninguna query devuelve datos de la otra (paginación y counts incluidos).
- Test que intenta bypassear la extensión de Prisma y verifica que RLS corta.
- Test que verifica que una migración nueva sobre una tabla sin RLS falla el pipeline.

---

## 5. Sync bidireccional con Google Calendar

El componente que el MD flaggeó como el más doloroso. Las reglas van escritas, no emergentes.

### Setup en el onboarding

OAuth scopes: `openid email profile https://www.googleapis.com/auth/calendar`. `access_type=offline` + `prompt=consent` en el primer flow para asegurar `refresh_token`.

Post-onboarding, el job `bootstrap-calendar` corre y:
1. Crea el calendario dedicado (`summary: "Turnero"`, color de la cuenta) y guarda `calendar_id_dedicado`.
2. Guarda `calendar_id_primario = 'primary'`.
3. Cifra el `refresh_token` con AES-256-GCM (llave por-cuenta derivada de master key en env via HKDF).
4. Ejecuta el primer full sync de ambos calendarios y guarda `sync_token`.
5. Registra watch channels en ambos calendarios.

### Sync incremental

- Watch channel activo en cada calendario, TTL de 7 días.
- Job `renovar-watch-channels` corre cada 6 horas y renueva los que expiran en <24h. Expiración siempre en horario de oficina argentina.
- Webhook llega a `/api/webhooks/google-calendar` con `X-Goog-Channel-Id` y `X-Goog-Resource-Id`. Se verifican contra `IntegracionCalendar`, se encola job `sync-incremental` con `cuentaId`. **El handler del webhook no toca la base más allá del enqueue** — idempotente por diseño.
- Job `sync-incremental` hace `events.list` con `sync_token`, procesa el delta, actualiza el token. Si Google devuelve `410 Gone` (token expirado), fallback a `sync-completo`.

### Reglas de reconciliación

**Calendario dedicado (nuestro):**

| Evento observado | Acción |
|---|---|
| Creado por nosotros (eco del sync) | Ignorar |
| Movido en Google Calendar UI | Actualizar `Turno.inicio/fin`, log en `AuditLog` |
| Borrado en Google Calendar UI | `Turno.estado = cancelado`, `origen_cancelacion = google_calendar`. **NO borramos el Turno** |
| Creado directamente en Google Calendar UI | Adoptar como `Turno` con `origen = google_calendar`, `cliente_id = null`, `servicio_id = servicio_default` |
| Recurrente | Expandimos cada instancia (`singleEvents=true`), guardamos como turnos individuales. El master no se guarda |

**Calendario primario:**

| Evento observado | Acción |
|---|---|
| Cualquier evento | Upsert en `EventoExterno` |
| Borrado | Borrar `EventoExterno` |
| Recurrente | Expandir e insertar filas individuales |

### Conflictos de edición simultánea

**Regla: last-write-wins por el `etag` de Google.** Cuando escribimos, guardamos el `etag` devuelto. Cuando llega un sync, si el `etag` remoto ≠ el guardado, aplicamos el estado remoto y logueamos el conflicto al `AuditLog` con ambas versiones. Nunca merge automático — decidir merges sin contexto humano crea bugs invisibles.

### Errores y retry

- Cliente Google con reintentos exponenciales (3 intentos: 1s, 3s, 10s) sobre 5xx y 429.
- `refresh_token` revocado (401) → `IntegracionCalendar.estado = 'desconectado'`, se encola aviso (email en ciclo 1, WhatsApp en ciclo 2), se bloquean nuevos turnos.

### Tests

Fixtures con respuestas mockeadas de Google Calendar para cada escenario: movido, borrado, adoptado, recurrente, conflicto, 410, 401. Sin llamados reales a Google en tests.

---

## 6. Servicios y disponibilidad

### Servicios

Cada cuenta arranca con un servicio auto-creado en onboarding: nombre "Consulta", duración = respuesta del onboarding, `es_default = true`, `permite_sobreturnos = false`. Config permite agregar más (nombre + duración + flag de sobreturnos). El servicio default nunca se puede borrar; se puede renombrar o cambiar duración. Servicios adicionales se archivan (`activo = false`) en vez de borrarse.

### Cálculo de slots disponibles

Función pura en `lib/agenda/disponibilidad.ts`, sin efectos, sin fetch. Recibe datos ya cargados:

```
disponibilidad(cuenta, servicio, desde, hasta,
               horarios, excepciones, turnos, eventosExternos)
  → Array<{ inicio, fin, disponible }>

para cada día en el rango:
  ventanas = excepcion(día).tipo === 'cerrado'    → []
           | excepcion(día).tipo === 'horario_especial' → [(desde, hasta)]
           | sin excepción                                → horarios(diaSemana)

  restar de ventanas:
    - Turnos con estado ∈ (borrador, confirmado)
    - EventoExterno del primario
    - buffer configurable (MVP: 0)

  slicear en slots de servicio.duracion_minutos, alineados al inicio de ventana
```

Fixtures de test cubren: día cerrado, ventana partida, turno solapado, evento externo solapado, servicio de duración que no divide la ventana (queda resto sin usar), buffer > 0.

### Reglas de solape (por origen)

**Desde el panel operativo** (profesional o secretaria):

| Situación | Acción |
|---|---|
| Solape con otro Turno | Warning, se puede confirmar (sobreturno explícito) |
| Solape con EventoExterno | Warning, se puede confirmar |
| Fuera de horario configurado | Warning, se puede confirmar |

El dueño del calendario siempre puede overrider.

**Desde la página pública** (ciclo 2, mencionada para consistencia):

| Situación | Acción |
|---|---|
| Solape con Turno del mismo servicio y `permite_sobreturnos = true` | Slot disponible |
| Solape con Turno y `permite_sobreturnos = false` | Slot no aparece |
| Solape con EventoExterno | Slot no aparece |
| Fuera de horario | Slot no aparece |

### Protección contra doble-booking accidental

Sin constraint de base, dos clientes que abren la pública al mismo tiempo podrían reservar el mismo slot. Solución application-level: transacción con `SELECT ... FOR UPDATE` sobre los turnos de la ventana, verificación dentro del lock, insert atómico. Cuando `permite_sobreturnos = true`, el lock deja pasar el segundo — lo que queremos. Test de concurrencia real cubre este caso.

### Zona horaria

`HorarioSemanal.desde/hasta` son `time` locales. Al combinarse con una fecha se hace explícito con `Cuenta.timezone` (siempre `America/Argentina/Buenos_Aires` en MVP). Nunca `new Date()` sin zona. Librería: `date-fns-tz`.

### Días festivos

No los precargamos automáticamente. Se cargan como `ExcepcionHorario` manualmente. Precargarlos choca con casos reales donde el estudio SÍ abre feriados (guardias, urgencias notariales). Config derivada de la realidad del usuario.

---

## 7. Auth y onboarding

### Autenticación

**Solo Google OAuth.** Sin email/password. Calendar es no-negociable, la sesión ya requiere Google. Duplicar credenciales agrega superficie de bugs sin ganancia.

Sesiones con **Lucia**, en Postgres (no JWT — queremos revocar sin esperar expiración). Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.turnero.app` en prod para cubrir subdominio opt-in.

### Roles

Dos: `owner` y `secretaria`. Permisos simples:
- `owner` puede todo.
- `secretaria` puede crear/mover/cancelar turnos, ver clientes, ver grilla y lista.
- `secretaria` **no** puede tocar config, integración de Calendar, invitar usuarios, o desactivar la cuenta.

Función pura `puede(usuario, accion, recurso)` centralizada. Verificada en cada server action y route handler — nunca solo en la UI.

### Invitación de secretaria

El owner desde config invita por email. Se crea una `Invitacion` con token y expiración de 7 días. El invitado abre el link, hace Google OAuth con su cuenta, queda linkeado como `secretaria`. Sin roles custom ni permisos granulares en MVP.

### Onboarding — solo las tres preguntas del MD

Flujo:

1. Landing → botón "Empezá gratis" → Google OAuth.
2. Callback: si el `google_sub` ya tiene `Cuenta`, redirect al panel. Si no, seguir.
3. Página de onboarding, un solo form:
   - **Nombre público** (obligatorio, ej: "Escribanía Doe" o "Dra. Ana Martínez").
   - **Slug** (auto-sugerido del nombre, editable, validación de unicidad y reserved list en vivo).
   - **Horario de atención** (default L-V, 9-13 y 15-18; editable con selector simple).
   - **Duración típica** (default 30 min).
   - **Número WhatsApp del estudio** (validación E.164 formato AR).
4. On submit, en una sola transacción:
   - INSERT `Cuenta` (slug, nombre, timezone `America/Argentina/Buenos_Aires`).
   - INSERT `Usuario` (owner, google_sub, email del OAuth).
   - INSERT `Servicio` (nombre "Consulta", duración, `es_default = true`, `permite_sobreturnos = false`).
   - INSERT `HorarioSemanal` (una fila por ventana por día).
   - INSERT `IntegracionCalendar` con `refresh_token` cifrado, `calendar_id_primario = 'primary'`, `calendar_id_dedicado = NULL` todavía.
   - Encolar job `bootstrap-calendar`.
5. Redirect al panel. Banner "Estamos preparando tu agenda" mientras el job corre (típicamente <5s).

### Reserved slugs

Lista dura en código: `admin`, `api`, `app`, `www`, `help`, `soporte`, `blog`, `docs`, `panel`, `dashboard`, `static`, `assets`, `favicon`, `robots`, `sitemap`, `login`, `logout`, `signup`, `cuenta`, `cuentas`, `settings`. Test que verifica que la lista tapa todas las rutas del app.

### Reconnect

`refresh_token` revocado → `IntegracionCalendar.estado = desconectado`. En el próximo login del owner, banner rojo con "Reconectar Google Calendar" que dispara OAuth nuevamente. Sesión sigue válida, solo la integración necesita re-consent.

### Cifrado de refresh_token

AES-256-GCM. Master key en env (`ENCRYPTION_KEY`), derivación por-cuenta con HKDF usando `cuentaId` como info. Rotar la master key es procedimiento documentado (re-cifrar en batch).

---

## 8. UI del panel operativo y config

### Reglas transversales

- **Layouts distintos por dispositivo, no responsive-shrink.**
- **Cero animación gratis.** Transiciones cortas (≤150ms) o nada. Old Android + mala señal = respetar el hardware.
- **Tenant siempre en la URL:** `/[slug]/hoy`, `/[slug]/semana`, `/[slug]/config`.
- **Rioplatense voseo** en toda la copy. Sin "usted".

### Lista mobile — `/[slug]/hoy`

Vista dominante en el celular de la secretaria.

1. Header sticky con la fecha y flechas ‹ › para saltar día. Tap en la fecha abre mini-selector.
2. Card del próximo turno (grande, siempre arriba, aunque haya pasado la hora si sigue sin marcar completado). Contiene nombre del cliente, servicio, hora, **botones grandes: llamar y WhatsApp** (`tel:` y `https://wa.me/`). Tap en la card abre detalle.
3. Lista de turnos restantes del día ordenados por hora. Cada ítem: hora, nombre, servicio, chip de estado. Sobreturnos como ítems consecutivos con la misma hora. Tap abre detalle.
4. Botón flotante "+" abajo a la derecha para crear turno rápido.
5. Eventos externos intercalados como ítems grises no-tapeables ("Reunión personal · 14:00-15:00").

Detalle = drawer que sube desde abajo. Editar hora, editar cliente, cancelar, marcar completado, marcar no-asistió.

### Grilla desktop — `/[slug]/semana`

Vista de la secretaria en escritorio. Columnas = días, filas = franjas de 30 min de 7:00 a 22:00 (rango fijo en MVP).

- Turnos como bloques con altura proporcional a la duración. Color por servicio (hash `servicio_id` → paleta acotada).
- **Sobreturnos apilados horizontalmente** dentro del mismo slot.
- Eventos externos como bloques grises rayados, no arrastrables, con título si el usuario dio permiso.
- Fuera de horario con background más oscuro (tramado suave), pero clickeable con warning.
- Click en slot vacío → modal crear turno con hora precargada.
- Click en turno → modal editar (mismo modal que drawer mobile, centrado).
- **Drag para mover**: agarrás, tirás a otro slot, validación dispara warnings, confirmación con Enter o click. Bloque fantasma mientras arrastrás. **Undo con Cmd/Ctrl+Z durante 10s post-move.**
- Navegación: ‹ ›, tecla "hoy". Atajos: `←` `→` semana, `t` hoy, `n` nuevo turno.

Sin drag-to-resize en MVP. Cambiar duración = abrir el turno.

### Config — `/[slug]/config`

Layout desktop-first, básica-responsive. Tabs verticales:

- **Cuenta**: nombre público, slug, color, ubicación, timezone (readonly), teléfono WhatsApp.
- **Horarios**: editor semanal con ventanas partidas. Botón "+ excepción" para días cerrados u horario especial.
- **Servicios**: lista con nombre, duración, `permite_sobreturnos`. Botón "+ servicio". Default no borrable; otros archivables.
- **Google Calendar**: estado (conectado/desconectado), botón "Desconectar y reconectar".
- **Equipo**: dueño listado, botón "Invitar secretaria". Lista de invitaciones pendientes con "reenviar" y "revocar".
- **Subdominio (opt-in)**: campo con `<slug>.turnero.app`, botón "Activar" que marca la cuenta como habilitada.

Feedback de guardado: al blur o al toggle, toast breve. Sin botón "Guardar" gigante.

**Vacío intencional después del onboarding:** un solo servicio, L-V ya cargado, un solo usuario. Ese vacío es señal de buen diseño según el MD, no un TODO.

---

## 9. Jobs, testing, estructura y deploy

### Jobs (`pg-boss`)

Un solo proceso Node corre web + worker.

| Cola | Descripción | Trigger |
|---|---|---|
| `bootstrap-calendar` | Post-onboarding: crea calendario dedicado, primer sync, registra watch channels | Enqueued por onboarding |
| `sync-incremental` | Procesa cambios delta con `syncToken` | Webhook Google |
| `renovar-watch-channels` | Renueva channels que expiran en <24h | Cron cada 6h |
| `sync-completo` | Fallback cuando `syncToken` se pierde (410) | Enqueued por `sync-incremental` |
| `notificar-desconexion` | Email al owner cuando OAuth se rompe | Enqueued por handler de 401 |

Reglas transversales:
- Idempotentes por diseño.
- Reintentos exponenciales: 1s, 5s, 30s, 2min, 10min (5 intentos).
- Después del 5º intento → `dead_letter` con alerta.
- Cada log incluye `cuentaId`, `jobId`, `traceId`.

### Testing

- **Vitest** para unit e integration. **Playwright** para e2e crítico.
- **Unit puro**: disponibilidad, autorización, slug validation, cifrado, reglas de reconciliación de Calendar. Sin base.
- **Integration**: repositorios contra Postgres en Docker. Cada test en transacción rolleada. Suite completa <60s.
- **E2E multi-tenant**: crear 2 cuentas, login como una, verificar aislamiento total (paginación y counts incluidos).
- **Sync con Google**: mock de `googleapis` con fixtures por escenario. Sin llamados reales.
- **Concurrencia**: 2 requests simultáneos reservando el mismo slot, uno gana.
- **RLS**: setear `app.cuenta_id`, intentar leer datos de otra cuenta directo por SQL, verificar 0 filas.

Nada se mergea sin verde.

### Estructura del repo

```
turnero/
├── app/                      Next.js App Router
│   ├── (marketing)/          landing pública
│   ├── (auth)/               login, onboarding, callback OAuth
│   ├── [slug]/               ruta tenanted
│   │   ├── hoy/              lista mobile
│   │   ├── semana/           grilla desktop
│   │   ├── config/           settings
│   │   └── layout.tsx        resuelve tenant, seta contexto
│   └── api/
│       └── webhooks/
│           └── google-calendar/route.ts
├── lib/
│   ├── db/                   prisma client + extension multi-tenant
│   ├── agenda/               disponibilidad, reglas de dominio
│   ├── calendar/             cliente Google + reconciliación
│   ├── auth/                 lucia setup, permisos
│   ├── jobs/                 pg-boss setup + handlers
│   ├── crypto/               cifrado de tokens
│   └── shared/               tipos, utilidades
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/
│   └── plataforma-cli.ts     acciones de soporte con rol privilegiado
└── docker-compose.dev.yml    postgres local
```

Nombres de modelos y carpetas en español, siguiendo el MD.

### Deploy — Railway

Un proyecto Railway con:
1. **App Node** (Next.js + worker `pg-boss` en el mismo proceso). Auto-deploy desde `main`.
2. **Postgres** managed.
3. Health-check externo periódico (Cronitor o similar).

Env mínimas: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `WEBHOOK_BASE_URL`, `SENTRY_DSN`, `RESEND_API_KEY`.

Email transaccional: **Resend** (más simple que SendGrid para equipo chico, buena DX en TS).

### Observabilidad

- **pino** con `cuentaId`, `usuarioId?`, `requestId`, `traceId` en cada log. Sin PII (nombres, teléfonos redacted).
- **Sentry** para errores no-manejados y jobs fallidos.
- **Health endpoint** `/api/health` chequea DB + últimos jobs con éxito.
- No agregamos Grafana/Prometheus/OpenTelemetry en MVP.

### CI (GitHub Actions)

Pipeline: install → lint (ESLint + Prettier) → typecheck → tests (unit + integration + e2e) → build. Sin merge sin verde.

---

## 10. Fuera de alcance de este ciclo

Va al ciclo 2 aunque parezca fácil:

- Página pública de reserva.
- Recordatorios y confirmaciones automáticas.
- WhatsApp Cloud API (ni provisioning de número ni envíos).
- Auto-liberación de slot al cancelar (parcial: el ciclo 1 ya libera cuando el profesional cancela desde panel; el ciclo 2 agrega la cancelación por link del cliente).
- API pública para el asistente conversacional (esperar a definir contrato con ese equipo).
- Resumen semanal por email/WhatsApp.
- Onboarding autoservicio "cero-toque" (ciclo 3).

También fuera, según el MD (no agregar aunque el cliente lo pida):

- App nativa / Flutter. Solo web + WhatsApp. PWA si más adelante hace falta.
- Personalización visual del link más allá de nombre y color.
- Configuración por WhatsApp.
- Historias clínicas.
- Microservicios, Kubernetes, colas distribuidas.

---

## 11. Criterios de salida del ciclo

Todo esto tiene que ser verdad para pasar al ciclo 2:

1. Un usuario nuevo puede completar onboarding en <2 minutos con las 3 preguntas.
2. Post-onboarding, el calendario dedicado existe en su Google, la agenda del panel muestra los eventos existentes de su primario como busy.
3. Puede crear un turno desde el panel (mobile o desktop), aparece en su Google Calendar en <10s.
4. Puede mover un turno con drag en la grilla desktop, se actualiza en Google Calendar.
5. Si mueve un evento en Google Calendar UI, aparece movido en el panel en <30s (webhook + job).
6. Si borra un evento en Google Calendar UI, el turno queda `cancelado` con `origen_cancelacion = google_calendar`.
7. Si crea un evento directo en el calendario dedicado, aparece como Turno adoptado con `cliente_id = null`.
8. Puede invitar una secretaria por email; ella hace OAuth y ve la misma agenda con permisos reducidos.
9. Multi-tenant: dos cuentas paralelas, cero fuga de datos verificada por tests E2E.
10. RLS: intento de bypass a nivel SQL bloqueado por policy.
11. Test suite completa verde en CI. Cobertura de reglas de reconciliación de Calendar al 100% (todos los escenarios).
12. Deploy en Railway funcionando con dominio productivo, watch channels renovándose automáticamente.

---

## Apéndice A — Decisión de stack (resumen del brainstorming)

Alternativas consideradas:
- **Django + HTMX + Postgres**: descartado. Admin gratis se convierte en footgun con la regla "recordatorios derivados del turno"; ecosistema de Calendar sync menos maduro que Node; assistant futuro es TS y compartir types cross-language es peor.
- **Rails 7 + Turbo/Stimulus**: descartado por razones similares (productividad no compensa el mismatch con el consumidor TS del asistente).
- **Next.js + Prisma + Postgres + pg-boss**: elegido. Cubre pública rápida (RSC + streaming), Calendar sync con ecosistema maduro, jobs sin Redis, deploy simple.

## Apéndice B — Convenciones de código

- Nombres de dominio en español: `Cuenta`, `Turno`, `Servicio`, `HorarioSemanal`, `ExcepcionHorario`, `Cliente`, `IntegracionCalendar`, `EventoExterno`.
- Nombres de infra y framework en inglés (estándar del ecosistema): `middleware`, `route handler`, `server action`.
- Comentarios en el código solo cuando el "por qué" no sea obvio. Nunca comentarios de "qué hace" — el nombre lo dice.
- Copy al usuario: rioplatense, voseo, breve. Cabe en una notificación de WhatsApp o no sirve.
