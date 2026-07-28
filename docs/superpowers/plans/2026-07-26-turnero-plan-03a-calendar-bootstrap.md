---
title: Turnero — Plan 03a — Jobs infra + bootstrap-calendar
description: Plan 3a del Ciclo 1. Levanta pg-boss como cola de jobs en el mismo proceso Node, agrega el cliente autenticado de Google Calendar (con refresh token cifrado), y el job bootstrap-calendar que crea el calendario dedicado post-onboarding. Deja al usuario con su calendario "Turnero" listo en Google.
date: 2026-07-26
type: implementation-plan
project: turnero
ciclo: 1
plan_num: 3.1
status: draft
tags: [turnero, plan, calendar, jobs, pg-boss]
related:
  - "[[2026-07-24-turnero-nucleo-design]]"
  - "[[2026-07-25-turnero-plan-02-auth-onboarding]]"
  - "[[CLAUDE-turnero]]"
---

# Turnero — Plan 03a — Jobs + bootstrap-calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Después del onboarding, aparece automáticamente un calendario "Turnero" en el Google Calendar del profesional, y `IntegracionCalendar.calendar_id_dedicado` queda con su ID. Esa es la única salida verificable.

**Architecture:**
- **Jobs infra:** `pg-boss` corriendo en el mismo proceso Node que Next.js. Arrancado desde `instrumentation.ts`. Usa `DIRECT_URL` (superuser) para poder crear su schema propio (`pgboss`) y sus tablas.
- **Google Calendar client:** wrapper sobre `googleapis` que descifra el `refresh_token` de una `IntegracionCalendar`, construye un `OAuth2` client con auto-refresh, y devuelve el cliente `calendar` de la API.
- **Bootstrap job:** handler idempotente que crea el calendario dedicado (nombre "Turnero") si no existe, y actualiza `IntegracionCalendar.calendar_id_dedicado`.
- **Enqueue:** después de que `completarOnboarding` commit-ea la transacción, encolamos `bootstrap-calendar` con el `cuentaId`. Si falla el job (Google 401, red caída), reintenta con backoff exponencial. Si el usuario abre `/[slug]` y su calendar_id_dedicado sigue null, mostramos "Estamos preparando tu calendario…".

**Tech stack añadido:** `pg-boss@^10`, `googleapis@^144`.

**Fuera de scope (Plan 3b):**
- Watch channels registration + renovación cron.
- Webhook `/api/webhooks/google-calendar`.
- Jobs `sync-incremental` y `sync-completo`.
- Reglas de reconciliación (movido, borrado, adoptado, recurrentes).
- Reconnect flow completo (banner sí, re-OAuth va con 3b).

---

## File Structure

```
turnero/
├── package.json                                    (modificar: add deps)
├── instrumentation.ts                              (nuevo, boot pg-boss)
├── lib/
│   ├── jobs/
│   │   ├── boss.ts                                 (nuevo, singleton)
│   │   ├── registrar.ts                            (nuevo, handler registry)
│   │   ├── handlers/
│   │   │   └── bootstrap-calendar.ts               (nuevo)
│   │   └── enqueue.ts                              (nuevo, helper tipado)
│   ├── calendar/
│   │   └── google-client.ts                        (nuevo, OAuth2 authorized)
│   └── onboarding/
│       └── completar.ts                            (modificar: enqueue post-commit)
├── app/[slug]/
│   └── page.tsx                                    (modificar: banner si calendar_id_dedicado es null)
├── tests/
│   ├── unit/
│   │   └── google-client.test.ts                   (nuevo, mocked OAuth2)
│   └── integration/
│       └── bootstrap-calendar.test.ts              (nuevo, mocked googleapis + DB real)
└── CLAUDE.md                                       (modificar)
```

---

## Task 1: Instalar `pg-boss` y `googleapis`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install pg-boss@^10 googleapis@^144 --legacy-peer-deps
```

- [ ] **Step 2: Verify**

Run: `npm ls pg-boss googleapis 2>&1 | head -6`
Expected: both listed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: instalar pg-boss y googleapis"
```

---

## Task 2: Env var opcional para el modo del worker

**Files:**
- Modify: `.env.example`, `.env`
- Modify: `lib/shared/env.ts`

Contexto: en algunos setups (por ejemplo, tests unit) no queremos que arranque pg-boss al cargar el proceso. Agregamos `JOBS_ENABLED` (default `"true"`) que instrumentation.ts respeta.

- [ ] **Step 1: Append to `.env.example` and `.env`**

Append to both:
```
# Jobs (pg-boss). Poner "false" en tests que no lo requieran.
JOBS_ENABLED="true"
```

- [ ] **Step 2: Update `lib/shared/env.ts` schema**

Add to the Zod schema:
```typescript
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
```

Add after `RESEND_FROM` and before `NODE_ENV`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add .env.example lib/shared/env.ts
git commit -m "feat(env): JOBS_ENABLED para controlar boot de pg-boss"
```

---

## Task 3: pg-boss singleton

**Files:**
- `lib/jobs/boss.ts`

Contexto: pg-boss expone un `PgBoss` class que necesita `.start()` una vez. Usamos DIRECT_URL (superuser) porque pg-boss crea su propio schema y sus tablas.

- [ ] **Step 1: Create `lib/jobs/boss.ts`**

```typescript
import PgBoss from 'pg-boss'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

let instancia: PgBoss | null = null
let bootPromise: Promise<PgBoss> | null = null

/**
 * Devuelve el singleton de pg-boss. La primera llamada dispara .start(),
 * las siguientes esperan al mismo boot.
 *
 * Usa DIRECT_URL porque pg-boss crea su propio schema "pgboss" y sus tablas
 * (requiere CREATE SCHEMA privilege que turnero_app no tiene).
 */
export async function obtenerBoss(): Promise<PgBoss> {
  if (instancia) return instancia
  if (bootPromise) return bootPromise

  const connectionString = env.DIRECT_URL ?? env.DATABASE_URL

  bootPromise = (async () => {
    const boss = new PgBoss({
      connectionString,
      // Reintentos exponenciales por default: 1s→5s→30s→2min→10min (5 intentos)
      retryLimit: 5,
      retryDelay: 1,
      retryBackoff: true,
    })
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))
    await boss.start()
    logger.info('pg-boss iniciado')
    instancia = boss
    return boss
  })()

  return bootPromise
}

export async function detenerBoss(): Promise<void> {
  if (instancia) {
    await instancia.stop({ graceful: true, timeout: 5000 })
    instancia = null
    bootPromise = null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

If pg-boss v10 API differs (e.g., constructor takes different options), check `node_modules/pg-boss/dist/index.d.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add lib/jobs/boss.ts
git commit -m "feat(jobs): pg-boss singleton con DIRECT_URL"
```

---

## Task 4: Registry de handlers + helper de enqueue tipado

**Files:**
- `lib/jobs/registrar.ts`
- `lib/jobs/enqueue.ts`

Contexto: queremos un lugar único donde se registran los handlers y un helper para enqueue con tipos.

- [ ] **Step 1: Create `lib/jobs/registrar.ts`**

```typescript
import type PgBoss from 'pg-boss'
import { obtenerBoss } from './boss'
import { logger } from '@/lib/shared/logger'
import { handlerBootstrapCalendar, NOMBRE_JOB_BOOTSTRAP_CALENDAR, type PayloadBootstrapCalendar } from './handlers/bootstrap-calendar'

/**
 * Mapa de todos los jobs registrados. Extender acá cuando se agreguen jobs nuevos.
 */
const REGISTRO: Array<{
  nombre: string
  handler: (data: unknown) => Promise<void>
}> = [
  {
    nombre: NOMBRE_JOB_BOOTSTRAP_CALENDAR,
    handler: (data) => handlerBootstrapCalendar(data as PayloadBootstrapCalendar),
  },
]

let registrado = false

export async function registrarHandlers(): Promise<void> {
  if (registrado) return
  const boss = await obtenerBoss()
  for (const { nombre, handler } of REGISTRO) {
    await boss.work(nombre, async (job: PgBoss.Job<unknown> | Array<PgBoss.Job<unknown>>) => {
      const jobs = Array.isArray(job) ? job : [job]
      for (const j of jobs) {
        logger.info({ nombre, jobId: j.id }, 'ejecutando job')
        await handler(j.data)
      }
    })
    logger.info({ nombre }, 'handler registrado')
  }
  registrado = true
}
```

- [ ] **Step 2: Create `lib/jobs/enqueue.ts`**

```typescript
import { obtenerBoss } from './boss'
import {
  NOMBRE_JOB_BOOTSTRAP_CALENDAR,
  type PayloadBootstrapCalendar,
} from './handlers/bootstrap-calendar'

export async function enqueueBootstrapCalendar(payload: PayloadBootstrapCalendar): Promise<string> {
  const boss = await obtenerBoss()
  const jobId = await boss.send(NOMBRE_JOB_BOOTSTRAP_CALENDAR, payload, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
  })
  if (!jobId) throw new Error(`pg-boss no devolvió jobId para ${NOMBRE_JOB_BOOTSTRAP_CALENDAR}`)
  return jobId
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: falla porque `./handlers/bootstrap-calendar` todavía no existe. Ese es el próximo task; dejar acá el commit pendiente.

- [ ] **Step 4: NO commit todavía**

Vamos a crear el handler en Task 6. Después de eso, commit conjunto de Task 4+6 con typecheck verde.

---

## Task 5: Google Calendar client (OAuth2 autenticado por-cuenta)

**Files:**
- `tests/unit/google-client.test.ts` (TDD parcial — testeamos la parte pura)
- `lib/calendar/google-client.ts`

Contexto: dada una `IntegracionCalendar`, descifrar el `refresh_token` y devolver un cliente `calendar` de googleapis listo para usar. La parte del OAuth2 client es reusable en Plan 3b.

- [ ] **Step 1: Test — parte pura (descifrado del refresh_token)**

`tests/unit/google-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { descifrarRefreshToken } from '@/lib/calendar/google-client'

describe('descifrarRefreshToken', () => {
  const MASTER = Buffer.from('a'.repeat(64), 'utf-8').subarray(0, 32)
  const CUENTA_ID = '00000000-0000-0000-0000-000000000001'

  it('descifra un refresh_token cifrado con la misma cuentaId', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, CUENTA_ID)
    const cifrado = await cifrar('refresh-token-real', new Uint8Array(llave))
    const recuperado = await descifrarRefreshToken(
      Buffer.from(cifrado),
      CUENTA_ID,
      MASTER,
    )
    expect(recuperado).toBe('refresh-token-real')
  })

  it('falla con cuentaId distinta', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, CUENTA_ID)
    const cifrado = await cifrar('token-x', new Uint8Array(llave))
    await expect(
      descifrarRefreshToken(Buffer.from(cifrado), 'otra-cuenta', MASTER),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Falla**

Run: `npm test -- tests/unit/google-client.test.ts`

- [ ] **Step 3: Implement `lib/calendar/google-client.ts`**

```typescript
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { calendar_v3 } from 'googleapis'
import { descifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'
import { basePrisma } from '@/lib/db/base-prisma'

/**
 * Descifra el refresh_token guardado en IntegracionCalendar.refreshTokenCifrado.
 * Usa la master ENCRYPTION_KEY y HKDF con el cuentaId como info.
 */
export async function descifrarRefreshToken(
  cifrado: Buffer,
  cuentaId: string,
  master: Buffer,
): Promise<string> {
  const llave = await derivarLlavePorCuenta(master, cuentaId)
  return descifrar(new Uint8Array(cifrado), new Uint8Array(llave))
}

/**
 * Construye un OAuth2 client con el refresh_token seteado. googleapis
 * refresca el access_token automáticamente cuando expira.
 */
export function crearOAuth2Client(refreshToken: string): OAuth2Client {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT,
  )
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

/**
 * Devuelve el cliente calendar_v3 autenticado para una cuenta.
 * Lee la IntegracionCalendar, descifra el refresh_token, arma el OAuth2.
 *
 * Lanza si la cuenta no tiene IntegracionCalendar o si el descifrado falla.
 */
export async function obtenerCalendarClient(cuentaId: string): Promise<calendar_v3.Calendar> {
  const integracion = await basePrisma.integracionCalendar.findUnique({
    where: { cuentaId },
  })
  if (!integracion) {
    throw new Error(`IntegracionCalendar no existe para cuenta ${cuentaId}`)
  }

  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')
  const refreshToken = await descifrarRefreshToken(
    Buffer.from(integracion.refreshTokenCifrado),
    cuentaId,
    master,
  )
  const auth = crearOAuth2Client(refreshToken)
  return google.calendar({ version: 'v3', auth })
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- tests/unit/google-client.test.ts`
Expected: 2 passed.

Note: `basePrisma.integracionCalendar.findUnique` va contra RLS con `turnero_app`. La `IntegracionCalendar` tiene RLS y sin `app.cuenta_id` set devuelve null. La función `obtenerCalendarClient` va a ser llamada desde jobs (handlers) que necesitan operar sin el contexto tenant. Solución consistente con Plan 2: hacer un lookup vía función SQL `SECURITY DEFINER` o setear `app.cuenta_id` inline.

Como es el mismo patrón, usemos una función SQL dedicada. Definimos en la próxima migración.

- [ ] **Step 5: Crear migración para función `lookup_integracion_calendar`**

Run:
```bash
LATEST_TS=$(ls prisma/migrations/ | grep -E '^[0-9]{14}_' | sort | tail -1 | cut -d_ -f1)
NEW_TS=$(date -u +%Y%m%d%H%M%S)
if [ "$NEW_TS" -le "$LATEST_TS" ]; then NEW_TS=$((LATEST_TS + 1)); fi
mkdir -p "prisma/migrations/${NEW_TS}_funcion_lookup_integracion"
```

Contenido de `migration.sql`:

```sql
-- Función SECURITY DEFINER para lookup de IntegracionCalendar por cuentaId
-- desde código que no tiene tenant context establecido (por ejemplo, jobs
-- que reciben cuentaId como payload).

CREATE OR REPLACE FUNCTION lookup_integracion_calendar(p_cuenta_id uuid)
RETURNS TABLE (
  id uuid,
  cuenta_id uuid,
  refresh_token_cifrado bytea,
  calendar_id_dedicado text,
  calendar_id_primario text,
  estado estado_integracion
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, cuenta_id, refresh_token_cifrado, calendar_id_dedicado,
         calendar_id_primario, estado
  FROM integracion_calendar
  WHERE cuenta_id = p_cuenta_id;
$$;

GRANT EXECUTE ON FUNCTION lookup_integracion_calendar(uuid) TO turnero_app;
```

Aplicar: `npx prisma migrate deploy`

- [ ] **Step 6: Refactor `obtenerCalendarClient` a usar la función**

Reemplazar el cuerpo:

```typescript
interface IntegracionLookup {
  id: string
  cuenta_id: string
  refresh_token_cifrado: Buffer
  calendar_id_dedicado: string | null
  calendar_id_primario: string
  estado: 'conectado' | 'desconectado'
}

export async function obtenerIntegracionCalendar(cuentaId: string): Promise<IntegracionLookup | null> {
  const filas = await basePrisma.$queryRaw<IntegracionLookup[]>`
    SELECT * FROM lookup_integracion_calendar(${cuentaId}::uuid)
  `
  return filas[0] ?? null
}

export async function obtenerCalendarClient(cuentaId: string): Promise<calendar_v3.Calendar> {
  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    throw new Error(`IntegracionCalendar no existe para cuenta ${cuentaId}`)
  }

  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')
  const refreshToken = await descifrarRefreshToken(
    integracion.refresh_token_cifrado,
    cuentaId,
    master,
  )
  const auth = crearOAuth2Client(refreshToken)
  return google.calendar({ version: 'v3', auth })
}
```

Actualizar imports: eliminar `import { basePrisma }` si no se usa, o mantenerlo si se usa para `$queryRaw`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/calendar/google-client.ts tests/unit/google-client.test.ts prisma/migrations/
git commit -m "feat(calendar): google-client con OAuth2 autenticado por cuenta"
```

---

## Task 6: Handler `bootstrap-calendar` + tests

**Files:**
- `tests/integration/bootstrap-calendar.test.ts`
- `lib/jobs/handlers/bootstrap-calendar.ts`

Contexto: handler idempotente que crea el calendario dedicado en Google si no existe, y actualiza la fila.

### Idempotencia

El job puede correr múltiples veces por retries. Reglas:
1. Si `IntegracionCalendar.calendar_id_dedicado` ya está seteado, no hacer nada (early return).
2. Si el calendario ya existe en Google (por algún request previo que devolvió antes de guardar el ID), usarlo. Para simplificar MVP: siempre creamos uno nuevo. Si aparecen "Turnero (2)", "Turnero (3)" por retries, es un bug conocido — la observabilidad va a mostrar si pasa.

Realmente idempotente: guardamos el `calendar_id_dedicado` **antes de terminar la request Google**, no. Google no soporta idempotency keys en calendars. Compromiso: primer `list calendars` para buscar uno con summary "Turnero", si existe usarlo, si no crear uno nuevo.

- [ ] **Step 1: Test de integración**

`tests/integration/bootstrap-calendar.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'

// Mock googleapis
const listMock = vi.fn()
const insertMock = vi.fn()

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    calendar: vi.fn().mockImplementation(() => ({
      calendarList: { list: listMock },
      calendars: { insert: insertMock },
    })),
  },
}))

import { handlerBootstrapCalendar } from '@/lib/jobs/handlers/bootstrap-calendar'

describe('handlerBootstrapCalendar', () => {
  useTestDatabase()

  beforeEach(() => {
    listMock.mockReset()
    insertMock.mockReset()
  })

  async function crearIntegracion(cuentaId: string, calendarIdDedicado: string | null = null) {
    const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')
    const llave = await derivarLlavePorCuenta(master, cuentaId)
    const cifrado = await cifrar('refresh-de-test', new Uint8Array(llave))
    return basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
      return tx.integracionCalendar.create({
        data: {
          cuentaId,
          refreshTokenCifrado: Buffer.from(cifrado),
          calendarIdDedicado,
          calendarIdPrimario: 'primary',
        },
      })
    })
  }

  it('crea calendario dedicado y guarda el ID', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id)

    listMock.mockResolvedValue({ data: { items: [] } })
    insertMock.mockResolvedValue({ data: { id: 'cal-nuevo-123' } })

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(insertMock).toHaveBeenCalledOnce()
    expect(insertMock).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({ summary: 'Turnero' }),
    })

    const integracion = await basePrisma.$queryRaw<Array<{ calendar_id_dedicado: string }>>`
      SELECT calendar_id_dedicado FROM lookup_integracion_calendar(${cuenta.id}::uuid)
    `
    expect(integracion[0].calendar_id_dedicado).toBe('cal-nuevo-123')
  })

  it('es idempotente: si calendar_id_dedicado ya existe, no llama a Google', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id, 'cal-ya-existe')

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(listMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('reusa calendario existente si aparece en calendarList (retry recovery)', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    await crearIntegracion(cuenta.id)

    listMock.mockResolvedValue({
      data: { items: [{ id: 'cal-preexistente-777', summary: 'Turnero' }] },
    })

    await handlerBootstrapCalendar({ cuentaId: cuenta.id })

    expect(insertMock).not.toHaveBeenCalled()
    const integracion = await basePrisma.$queryRaw<Array<{ calendar_id_dedicado: string }>>`
      SELECT calendar_id_dedicado FROM lookup_integracion_calendar(${cuenta.id}::uuid)
    `
    expect(integracion[0].calendar_id_dedicado).toBe('cal-preexistente-777')
  })

  it('falla explícito si no hay IntegracionCalendar', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    // Sin crear integración

    await expect(handlerBootstrapCalendar({ cuentaId: cuenta.id })).rejects.toThrow(
      /IntegracionCalendar/,
    )
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: Falla**

Run: `npm test -- tests/integration/bootstrap-calendar.test.ts`

- [ ] **Step 3: Implement `lib/jobs/handlers/bootstrap-calendar.ts`**

```typescript
import { basePrisma } from '@/lib/db/base-prisma'
import { obtenerCalendarClient, obtenerIntegracionCalendar } from '@/lib/calendar/google-client'
import { logger } from '@/lib/shared/logger'

export const NOMBRE_JOB_BOOTSTRAP_CALENDAR = 'bootstrap-calendar'

export interface PayloadBootstrapCalendar {
  cuentaId: string
}

const NOMBRE_CALENDARIO_DEDICADO = 'Turnero'

export async function handlerBootstrapCalendar(payload: PayloadBootstrapCalendar): Promise<void> {
  const { cuentaId } = payload

  const integracion = await obtenerIntegracionCalendar(cuentaId)
  if (!integracion) {
    throw new Error(`IntegracionCalendar no existe para cuenta ${cuentaId}`)
  }

  if (integracion.calendar_id_dedicado) {
    logger.info(
      { cuentaId, calendarId: integracion.calendar_id_dedicado },
      'bootstrap-calendar: ya existe, skip',
    )
    return
  }

  const calendar = await obtenerCalendarClient(cuentaId)

  // Chequear si ya hay un calendario "Turnero" en la lista (recovery de retries previos)
  const lista = await calendar.calendarList.list({})
  const existente = lista.data.items?.find(
    (c) => c.summary === NOMBRE_CALENDARIO_DEDICADO && c.id,
  )

  let calendarId: string
  if (existente?.id) {
    calendarId = existente.id
    logger.info(
      { cuentaId, calendarId },
      'bootstrap-calendar: reusando calendario existente',
    )
  } else {
    const creado = await calendar.calendars.insert({
      requestBody: { summary: NOMBRE_CALENDARIO_DEDICADO },
    })
    if (!creado.data.id) {
      throw new Error('Google no devolvió id al crear calendario')
    }
    calendarId = creado.data.id
    logger.info({ cuentaId, calendarId }, 'bootstrap-calendar: calendario creado')
  }

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`
    await tx.integracionCalendar.update({
      where: { cuentaId },
      data: { calendarIdDedicado: calendarId },
    })
  })
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- tests/integration/bootstrap-calendar.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit (junto con Task 4)**

```bash
git add lib/jobs/ tests/integration/bootstrap-calendar.test.ts
git commit -m "feat(jobs): bootstrap-calendar handler + registry + enqueue helper"
```

Este commit incluye los archivos de Task 4 (`lib/jobs/registrar.ts`, `lib/jobs/enqueue.ts`) que estaban esperando por el handler.

---

## Task 7: Startup en `instrumentation.ts`

**Files:**
- `instrumentation.ts` (repo root)

Contexto: Next.js corre `register()` en `instrumentation.ts` una vez al arrancar el proceso Node. Ideal para bootstrapear pg-boss + registrar handlers.

- [ ] **Step 1: Create `instrumentation.ts`**

```typescript
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

export async function register() {
  // Solo corre en Node runtime (no en Edge middleware)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (!env.JOBS_ENABLED) {
    logger.info('JOBS_ENABLED=false — pg-boss NO se arranca')
    return
  }

  // Import dinámico para que Edge no lo intente cargar
  const { obtenerBoss } = await import('@/lib/jobs/boss')
  const { registrarHandlers } = await import('@/lib/jobs/registrar')

  try {
    await obtenerBoss()
    await registrarHandlers()
    logger.info('jobs infrastructure lista')
  } catch (err) {
    logger.error({ err }, 'Falló boot de jobs infrastructure')
    // No relanzar: no queremos que caiga el servidor si pg-boss no arranca.
    // El próximo intento de enqueue va a re-intentar obtenerBoss().
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(jobs): boot de pg-boss en instrumentation.ts de Next.js"
```

---

## Task 8: Enqueue post-onboarding

**Files:**
- Modify: `lib/onboarding/completar.ts`

Contexto: `completarOnboarding` termina exitosa la transacción. Después del commit, encolamos `bootstrap-calendar` con el `cuentaId`. Si el enqueue falla, logeamos pero NO fallamos el onboarding (el usuario ya tiene su cuenta lista, el calendario puede reintentarse manual desde config en el futuro).

- [ ] **Step 1: Modify `lib/onboarding/completar.ts`**

Al final de la función `completarOnboarding`, después del `return { cuenta, usuario }` que actualmente cierra la `$transaction`, cambiar la estructura para:
1. Guardar el resultado de la transacción en una variable.
2. Después del await de la transacción (fuera del scope), encolar el job.
3. Retornar el resultado.

Nueva versión:

```typescript
import { basePrisma } from '@/lib/db/base-prisma'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'
import { enqueueBootstrapCalendar } from '@/lib/jobs/enqueue'
import type { Cuenta, Usuario } from '@prisma/client'

export interface DatosPendingOnboarding {
  googleSub: string
  email: string
  nombre: string
  refreshToken: string
}

export interface DatosFormOnboarding {
  slug: string
  nombrePublico: string
  telefonoWhatsapp: string
  duracionMinutos: number
  horarios: Array<{ diaSemana: number; desde: string; hasta: string }>
}

export interface ResultadoOnboarding {
  cuenta: Cuenta
  usuario: Usuario
}

function timeToDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

export async function completarOnboarding(
  pending: DatosPendingOnboarding,
  form: DatosFormOnboarding,
): Promise<ResultadoOnboarding> {
  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')

  const resultado = await basePrisma.$transaction(async (tx) => {
    const cuenta = await tx.cuenta.create({
      data: {
        slug: form.slug,
        nombrePublico: form.nombrePublico,
        telefonoWhatsapp: form.telefonoWhatsapp,
      },
    })

    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuenta.id}, TRUE)`

    const usuario = await tx.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: pending.email,
        nombre: pending.nombre,
        googleSub: pending.googleSub,
        rol: 'owner',
      },
    })

    await tx.servicio.create({
      data: {
        cuentaId: cuenta.id,
        nombre: 'Consulta',
        duracionMinutos: form.duracionMinutos,
        esDefault: true,
      },
    })

    await tx.horarioSemanal.createMany({
      data: form.horarios.map((h) => ({
        cuentaId: cuenta.id,
        diaSemana: h.diaSemana,
        desde: timeToDate(h.desde),
        hasta: timeToDate(h.hasta),
      })),
    })

    const llave = await derivarLlavePorCuenta(master, cuenta.id)
    const refreshCifrado = await cifrar(pending.refreshToken, new Uint8Array(llave))

    await tx.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: Buffer.from(refreshCifrado),
        calendarIdPrimario: 'primary',
      },
    })

    return { cuenta, usuario }
  })

  // Post-commit: encolar bootstrap-calendar. Errores acá no rompen el onboarding.
  try {
    const jobId = await enqueueBootstrapCalendar({ cuentaId: resultado.cuenta.id })
    logger.info(
      { cuentaId: resultado.cuenta.id, jobId },
      'bootstrap-calendar encolado post-onboarding',
    )
  } catch (err) {
    logger.error(
      { err, cuentaId: resultado.cuenta.id },
      'Falló enqueue de bootstrap-calendar (el usuario puede reintentar manualmente)',
    )
  }

  return resultado
}
```

- [ ] **Step 2: Ajustar el test de `onboarding-completar` para no depender del job**

El test existente en `tests/integration/onboarding-completar.test.ts` no espera al job. Verificar que sigue pasando. Si el mock de pg-boss no está y falla el enqueue → como envolvemos en try/catch, no rompe el test. Los asserts existentes sobre las filas creadas siguen válidos.

Run: `npm test -- tests/integration/onboarding-completar.test.ts`
Expected: 3 passed (los mismos que antes).

Si el enqueue realmente intenta arrancar pg-boss durante el test y eso rompe: agregar `JOBS_ENABLED=false` al ambiente de test. Idealmente en `vitest.config.ts` bajo `test.env` o en un `setup` file:

Alternativa: mockear `enqueueBootstrapCalendar` en el test file:
```typescript
vi.mock('@/lib/jobs/enqueue', () => ({
  enqueueBootstrapCalendar: vi.fn().mockResolvedValue('mock-job-id'),
}))
```

Añadir el mock al principio del archivo `tests/integration/onboarding-completar.test.ts` si es necesario.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/onboarding/completar.ts tests/integration/onboarding-completar.test.ts
git commit -m "feat(onboarding): encolar bootstrap-calendar post-commit"
```

---

## Task 9: Banner en `/[slug]` mientras el calendario se prepara

**Files:**
- Modify: `app/[slug]/page.tsx`

- [ ] **Step 1: Update `app/[slug]/page.tsx`**

Modificar para mostrar un banner si `IntegracionCalendar.calendar_id_dedicado` es null. Necesita leer la integración vía la función SECURITY DEFINER (o vía el tenant client si RLS aplica — sí aplica: estamos dentro del contexto tenanted, `getTenant()` devuelve `db` con el cuentaId ya inyectado).

Nueva versión:

```typescript
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export default async function PanelHomePage() {
  const { cuenta, db } = await getTenant()
  const s = await getSession()
  if (!s) redirect('/login')

  const integracion = await db.integracionCalendar.findUnique({
    where: { cuentaId: cuenta.id },
  })
  const calendarListo = !!integracion?.calendarIdDedicado

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '2rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '1.5rem' }}>¡Bienvenida a {cuenta.nombrePublico}!</h1>

      {!calendarListo && (
        <p
          style={{
            background: '#fff3cd',
            border: '1px solid #ffe08a',
            padding: '0.75rem 1rem',
            borderRadius: 4,
            marginTop: '1rem',
          }}
        >
          Estamos preparando tu Google Calendar dedicado. Refrescá en un minuto.
        </p>
      )}

      <p style={{ color: '#555', marginTop: '1rem' }}>
        Tu agenda está lista. El panel completo (lista mobile + grilla desktop) llega en el
        Plan 4.
      </p>
      <p style={{ color: '#555' }}>
        Mientras tanto, podés verificar el estado del tenant en{' '}
        <a href={`/${cuenta.slug}/debug`}>/{cuenta.slug}/debug</a>.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: '1.5rem' }}>
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>
          Cerrar sesión
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/[slug]/page.tsx
git commit -m "feat(panel): banner 'preparando calendario' cuando calendar_id_dedicado es null"
```

---

## Task 10: Actualizar CLAUDE.md + CI + verificación final

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend `CLAUDE.md`**

Insertar una nueva sección después de la sección "Auth (Plan 2)":

```markdown
## Jobs infrastructure (Plan 3a)

- **`pg-boss` en el mismo proceso Node que Next.js.** Arrancado desde `instrumentation.ts`. Usa `DIRECT_URL` (superuser) porque crea su propio schema `pgboss`.
- **Handlers** viven en `lib/jobs/handlers/`. El registry está en `lib/jobs/registrar.ts`. Cada job nuevo se agrega ahí + un helper tipado en `lib/jobs/enqueue.ts`.
- **`JOBS_ENABLED=false`** deshabilita el boot (útil en tests unit que no requieren jobs).
- **Google Calendar client** (`lib/calendar/google-client.ts`) descifra el `refresh_token` cifrado por-cuenta con AES-256-GCM + HKDF, y devuelve un cliente `calendar_v3` autenticado. googleapis se encarga del refresh del access_token.
- **Bootstrap flow:** después de onboarding exitoso, `completarOnboarding` encola `bootstrap-calendar` con el `cuentaId`. El handler crea (o reusa si existe) un calendario `Turnero` en el Google del profesional y guarda su ID en `IntegracionCalendar.calendar_id_dedicado`. El banner en `/[slug]` avisa "preparando calendario…" hasta que el ID aparece.
- **Watch channels, sync bidireccional, webhook, reconciliación** → Plan 3b.
```

- [ ] **Step 2: Update `.github/workflows/ci.yml`**

Agregar `JOBS_ENABLED: "false"` al bloque `env:` del job `test` (evitamos que pg-boss cree su schema en cada corrida de CI — los tests ya mockean el enqueue):

Buscar el bloque `env:` y agregar:
```yaml
      JOBS_ENABLED: "false"
```

- [ ] **Step 3: Verificación final**

Run:
```bash
npx prisma migrate deploy
docker exec turnero-postgres psql -U turnero -d turnero -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO turnero_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO turnero_app;"
```

Then:
```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

Expected:
- Lint: clean.
- Typecheck: 0.
- Unit + integration: prev + 2 (google-client) + 4 (bootstrap-calendar) = ~63 tests passing.
- E2E: 8 passing (sin cambios).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .github/workflows/ci.yml
git commit -m "docs+ci: Plan 3a — jobs infra + bootstrap-calendar"
```

- [ ] **Step 5: Salida del plan (opcional smoke con Google real)**

Solo si tenés credenciales de Google configuradas:
1. `npm run dev`
2. Ir a `http://localhost:3000/login` y hacer login con Google.
3. Completar onboarding.
4. Aterrizar en `/<slug>` — banner "preparando calendario" visible.
5. Verificar en https://calendar.google.com que apareció un calendario "Turnero".
6. Refrescar `/<slug>` — el banner desaparece.

Si no tenés Google: los tests con mocks son la garantía. El flow manual queda para cuando se configure Google Cloud.

---

## Salida del Plan 3a

- ✅ pg-boss corriendo en el mismo proceso Node.
- ✅ `bootstrap-calendar` job idempotente, testeado con googleapis mockeado.
- ✅ Onboarding encola el job post-commit.
- ✅ Banner mientras el calendar_id_dedicado no aparece.
- ✅ Tests verdes (unit + integration + E2E existentes intactos).

Listo para Plan 3b: watch channels + webhook + sync bidireccional + reconciliación + reconnect.
