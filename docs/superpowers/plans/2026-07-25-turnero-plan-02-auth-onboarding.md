---
title: Turnero — Plan 02 — Auth y onboarding
description: Plan 2 del Ciclo 1 de Turnero. Google OAuth como identity, Lucia sesiones en Postgres, cifrado AES-256-GCM de refresh_token, form de onboarding (3 preguntas del MD), invitación de secretaria por email vía Resend, permisos y routing por estado de sesión.
date: 2026-07-25
type: implementation-plan
project: turnero
ciclo: 1
plan_num: 2
status: draft
tags: [turnero, plan, auth, onboarding, lucia, oauth]
related:
  - "[[2026-07-24-turnero-nucleo-design]]"
  - "[[2026-07-25-turnero-plan-01-fundaciones]]"
  - "[[CLAUDE-turnero]]"
---

# Turnero — Plan 02 — Auth y onboarding (Ciclo 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario nuevo pueda entrar con Google, completar el form de onboarding (3 preguntas del MD), y quedar con su Cuenta lista para operar (sin Calendar todavía — eso es Plan 3).

**Architecture:** Google OAuth como único identity provider (scopes `openid email profile calendar` para preparar Plan 3). Lucia 3 con adapter Prisma para sesiones en `Session` table. Estado intermedio del onboarding (después del OAuth, antes de completar el form) va en cookie firmada + cifrada con AES-256-GCM. Post-onboarding: transacción única que crea `Cuenta` + `Usuario` (owner) + `Servicio` default + `HorarioSemanal` (L-V 9-13 y 15-18 por default) + `IntegracionCalendar` con `refresh_token` cifrado y `calendar_id_dedicado = null` (Plan 3 lo llena). Invitación de secretaria por email (Resend) con token de un solo uso. Middleware routea según estado: sin sesión → `/login`, con sesión sin Cuenta → `/onboarding`, con sesión con Cuenta → `/[slug]`.

**Tech Stack añadido en este plan:** `lucia@^3`, `@lucia-auth/adapter-prisma`, `arctic` (Google OAuth), `resend`, `iron-session` para cookie de pending-onboarding, `oslo` (viene con Lucia). Testing con mocks de arctic (sin llamadas reales a Google).

**Fuera de scope de este plan (van en Plan 3):**
- pg-boss e infra de jobs.
- `bootstrap-calendar` job (creación del calendario dedicado en Google).
- Watch channels y sync bidireccional.
- Reconnect flow real (el banner sí, la re-autenticación completa va con Plan 3).

---

## File Structure

Archivos que se crean o modifican:

```
turnero/
├── package.json                                    (modificar: add deps)
├── .env.example                                    (modificar: add OAuth + secrets)
├── .env                                            (modificar: add local values)
├── prisma/
│   └── schema.prisma                               (modificar: add Session)
├── prisma/migrations/<ts>_lucia_session/
│   └── migration.sql                               (generado)
├── app/
│   ├── login/
│   │   └── page.tsx                                (nuevo)
│   ├── onboarding/
│   │   ├── page.tsx                                (nuevo)
│   │   └── actions.ts                              (nuevo, server action)
│   ├── aceptar-invitacion/
│   │   └── [token]/
│   │       └── page.tsx                            (nuevo)
│   ├── api/auth/
│   │   ├── google/
│   │   │   ├── route.ts                            (nuevo, inicio OAuth)
│   │   │   └── callback/route.ts                   (nuevo, callback)
│   │   └── logout/route.ts                         (nuevo)
│   └── [slug]/
│       └── page.tsx                                (nuevo, placeholder Plan 4)
├── middleware.ts                                   (modificar: routing por sesión)
├── lib/
│   ├── auth/
│   │   ├── lucia.ts                                (nuevo, Lucia setup)
│   │   ├── google-oauth.ts                         (nuevo, Arctic client)
│   │   ├── session.ts                              (nuevo, getSession helpers)
│   │   ├── pending-onboarding.ts                   (nuevo, cookie state)
│   │   └── puede.ts                                (nuevo, permisos)
│   ├── crypto/
│   │   ├── aes-gcm.ts                              (nuevo, cifrado)
│   │   └── hkdf.ts                                 (nuevo, derivación)
│   ├── invitaciones/
│   │   ├── crear.ts                                (nuevo)
│   │   ├── aceptar.ts                              (nuevo)
│   │   └── email.ts                                (nuevo, Resend wrapper)
│   ├── onboarding/
│   │   └── completar.ts                            (nuevo, transacción)
│   └── shared/
│       ├── env.ts                                  (modificar: nuevas vars)
│       └── logger.ts                               (nuevo, pino wrapper)
├── tests/
│   ├── unit/
│   │   ├── aes-gcm.test.ts                         (nuevo)
│   │   ├── hkdf.test.ts                            (nuevo)
│   │   ├── puede.test.ts                           (nuevo)
│   │   └── pending-onboarding-cookie.test.ts       (nuevo)
│   ├── integration/
│   │   ├── oauth-callback.test.ts                  (nuevo, mocked arctic)
│   │   ├── onboarding-completar.test.ts            (nuevo)
│   │   ├── invitacion-flow.test.ts                 (nuevo)
│   │   └── helpers/
│   │       └── auth.ts                             (nuevo, test-mode login)
│   └── e2e/
│       └── onboarding-flow.spec.ts                 (nuevo, con /test/login-as)
├── app/test/
│   └── login-as/route.ts                           (nuevo, solo NODE_ENV!=prod)
└── CLAUDE.md                                       (modificar)
```

---

## Task 1: Instalar dependencias de auth y email

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install deps**

Run:
```bash
npm install lucia @lucia-auth/adapter-prisma@^4 arctic@^1 oslo@^1 iron-session@^8 resend@^4 pino@^9 pino-pretty@^11
```

Note on versions: Lucia 3 pairs with `arctic ^1` and `oslo ^1`. Adapter-prisma 4 supports Lucia 3. If npm complains about peer deps, use `--legacy-peer-deps` and note it.

- [ ] **Step 2: Verify installs**

Run: `npm ls lucia arctic iron-session resend pino 2>&1 | head -10`
Expected: all listed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: instalar deps de auth (lucia, arctic, iron-session, resend, pino)"
```

---

## Task 2: Variables de entorno adicionales

**Files:**
- Modify: `.env.example`, `.env`
- Modify: `lib/shared/env.ts`

- [ ] **Step 1: Add to `.env.example`**

Append (do NOT touch the existing DATABASE_URL / DIRECT_URL / PUBLIC_BASE_URL lines):

```
# Google OAuth (crear en https://console.cloud.google.com → APIs & Services → Credentials)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_OAUTH_REDIRECT="http://localhost:3000/api/auth/google/callback"

# Cifrado (32 bytes base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
ENCRYPTION_KEY=""

# Cookie de sesión / pending-onboarding (32 bytes base64)
SESSION_SECRET=""

# Email transaccional (Resend). En dev queda opcional; si vacío, los emails se loggean.
RESEND_API_KEY=""
RESEND_FROM="Turnero <onboarding@turnero.app>"
```

- [ ] **Step 2: Generate local secrets and update `.env`**

Run (once):
```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))" >> .env
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('base64'))" >> .env
```

Then edit `.env` manually to add the other keys (leave GOOGLE_CLIENT_ID/SECRET empty for now — real values come from the user's Google Cloud Console; tests will mock them). Ensure `.env` also has:
```
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_OAUTH_REDIRECT="http://localhost:3000/api/auth/google/callback"
RESEND_API_KEY=""
RESEND_FROM="Turnero <onboarding@localhost>"
```

- [ ] **Step 3: Update `lib/shared/env.ts` schema**

Replace the current schema block with:

```typescript
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url(),

  // Auth
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT: z.string().url(),

  // Crypto
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY requerido'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 chars'),

  // Email (opcional en dev)
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default('Turnero <onboarding@localhost>'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

function parseEnv() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Variables de entorno inválidas:', parsed.error.flatten().fieldErrors)
    throw new Error('Config de entorno inválida')
  }
  return parsed.data
}

export const env = parseEnv()

export function dominioBase(): string {
  return new URL(env.PUBLIC_BASE_URL).hostname
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add .env.example lib/shared/env.ts
git commit -m "feat(env): variables para OAuth, cifrado, sesión y email"
```

Do NOT commit `.env` (it's git-ignored). Verify with `git status`.

---

## Task 3: Modelo `Session` para Lucia + migración

**Files:**
- Modify: `prisma/schema.prisma` (add Session model + relation to Usuario)

- [ ] **Step 1: Add `Session` model**

Append to `prisma/schema.prisma` (at the end, before the last blank line):

```prisma
model Session {
  id        String   @id
  usuarioId String   @map("usuario_id") @db.Uuid
  expiresAt DateTime @map("expires_at") @db.Timestamptz(6)

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@map("session")
}
```

Then modify the existing `Usuario` model to add the back-relation. Find:

```prisma
model Usuario {
  id        String     @id @default(uuid()) @db.Uuid
  cuentaId  String     @map("cuenta_id") @db.Uuid
  email     String
  nombre    String
  googleSub String     @unique @map("google_sub")
  rol       RolUsuario
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@unique([cuentaId, email])
  @@index([cuentaId])
  @@map("usuario")
}
```

Add `sessions Session[]` after the `cuenta` relation line:

```prisma
  cuenta   Cuenta    @relation(fields: [cuentaId], references: [id], onDelete: Cascade)
  sessions Session[]
```

- [ ] **Step 2: Create migration**

Run: `npx prisma migrate dev --name lucia_session`
Expected: migration created and applied.

- [ ] **Step 3: Manually add RLS to session table**

`Session` is tenant-related (indirectly, via Usuario → Cuenta) but Lucia queries by session id without knowing the cuentaId. **We do NOT put session under RLS** — it's queried by session-id which is the "capability token" itself. If someone leaks a session ID, they can already act as that user regardless of RLS. So session doesn't need tenant isolation.

However, we DO need to grant `turnero_app` permissions on the new table. Run:
```bash
docker exec turnero-postgres psql -U turnero -d turnero -c "GRANT SELECT, INSERT, UPDATE, DELETE ON session TO turnero_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO turnero_app;"
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(db): modelo Session para Lucia + back-relation en Usuario"
```

---

## Task 4: HKDF derivación de llaves por-cuenta

**Files:**
- `tests/unit/hkdf.test.ts` (TDD first)
- `lib/crypto/hkdf.ts`

Contexto: para cifrar el `refresh_token` de cada `IntegracionCalendar`, derivamos una llave por-cuenta a partir de la master `ENCRYPTION_KEY` usando HKDF. Info string: `cuentaId`. Si algún día rotamos la master, re-derivamos en batch.

- [ ] **Step 1: Write the test**

`tests/unit/hkdf.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'

const MASTER = Buffer.from('a'.repeat(64), 'utf-8').subarray(0, 32) // 32 bytes

describe('derivarLlavePorCuenta', () => {
  it('devuelve 32 bytes', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, 'cuenta-123')
    expect(llave.byteLength).toBe(32)
  })

  it('es determinística para el mismo cuentaId', async () => {
    const a1 = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    const a2 = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    expect(Buffer.from(a1).equals(Buffer.from(a2))).toBe(true)
  })

  it('cuentas distintas producen llaves distintas', async () => {
    const a = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    const b = await derivarLlavePorCuenta(MASTER, 'cuenta-xyz')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test → falla**

Run: `npm test -- tests/unit/hkdf.test.ts`

- [ ] **Step 3: Implement**

`lib/crypto/hkdf.ts`:

```typescript
import { hkdf } from 'node:crypto'
import { promisify } from 'node:util'

const hkdfAsync = promisify(hkdf)

const INFO_PREFIX = 'turnero.cuenta.'

export async function derivarLlavePorCuenta(
  master: Buffer,
  cuentaId: string,
): Promise<ArrayBuffer> {
  const salt = Buffer.alloc(0)
  const info = Buffer.from(INFO_PREFIX + cuentaId, 'utf-8')
  return hkdfAsync('sha256', master, salt, info, 32)
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- tests/unit/hkdf.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/crypto/hkdf.ts tests/unit/hkdf.test.ts
git commit -m "feat(crypto): HKDF derivación de llaves por-cuenta"
```

---

## Task 5: AES-256-GCM cifrado de tokens

**Files:**
- `tests/unit/aes-gcm.test.ts` (TDD)
- `lib/crypto/aes-gcm.ts`

- [ ] **Step 1: Test**

`tests/unit/aes-gcm.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { cifrar, descifrar } from '@/lib/crypto/aes-gcm'

const LLAVE = new Uint8Array(32).fill(7)

describe('AES-256-GCM', () => {
  it('cifra y descifra un texto', async () => {
    const plano = 'refresh_token_de_ejemplo_muy_secreto'
    const cifrado = await cifrar(plano, LLAVE)
    const recuperado = await descifrar(cifrado, LLAVE)
    expect(recuperado).toBe(plano)
  })

  it('cada cifrado usa IV distinto (mismo texto → salida distinta)', async () => {
    const plano = 'texto-repetido'
    const a = await cifrar(plano, LLAVE)
    const b = await cifrar(plano, LLAVE)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('descifrar con llave distinta falla', async () => {
    const plano = 'secreto'
    const cifrado = await cifrar(plano, LLAVE)
    const otra = new Uint8Array(32).fill(8)
    await expect(descifrar(cifrado, otra)).rejects.toThrow()
  })

  it('cifrado tamperado falla en descifrado (autenticación)', async () => {
    const plano = 'auth-check'
    const cifrado = await cifrar(plano, LLAVE)
    const tampered = new Uint8Array(cifrado)
    tampered[tampered.length - 1] ^= 0x01
    await expect(descifrar(tampered, LLAVE)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run → falla**

Run: `npm test -- tests/unit/aes-gcm.test.ts`

- [ ] **Step 3: Implement**

`lib/crypto/aes-gcm.ts`:

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const IV_LEN = 12 // GCM standard
const TAG_LEN = 16

/**
 * Cifra `plano` con AES-256-GCM. Devuelve un buffer con:
 * [ IV (12 bytes) || CIPHERTEXT || TAG (16 bytes) ]
 */
export async function cifrar(plano: string, llave: Uint8Array): Promise<Uint8Array> {
  if (llave.byteLength !== 32) throw new Error('AES-256-GCM requiere llave de 32 bytes')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', llave, iv)
  const cipherText = Buffer.concat([cipher.update(plano, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, cipherText, tag])
}

/**
 * Descifra un buffer producido por `cifrar()`. Lanza si el tag no valida
 * (integridad + autenticación).
 */
export async function descifrar(cifrado: Uint8Array, llave: Uint8Array): Promise<string> {
  if (llave.byteLength !== 32) throw new Error('AES-256-GCM requiere llave de 32 bytes')
  const buf = Buffer.from(cifrado)
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Cifrado inválido: demasiado corto')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const cipherText = buf.subarray(IV_LEN, buf.length - TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', llave, iv)
  decipher.setAuthTag(tag)
  const plano = Buffer.concat([decipher.update(cipherText), decipher.final()])
  return plano.toString('utf-8')
}
```

- [ ] **Step 4: Run → pasa**

Run: `npm test -- tests/unit/aes-gcm.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/crypto/aes-gcm.ts tests/unit/aes-gcm.test.ts
git commit -m "feat(crypto): AES-256-GCM cifrado autenticado"
```

---

## Task 6: Logger estructurado con pino

**Files:**
- `lib/shared/logger.ts`

- [ ] **Step 1: Create `lib/shared/logger.ts`**

```typescript
import pino from 'pino'
import { env } from './env'

const esDev = env.NODE_ENV !== 'production'

export const logger = pino({
  level: esDev ? 'debug' : 'info',
  redact: {
    paths: [
      'password',
      'refreshToken',
      'refresh_token',
      '*.password',
      '*.refreshToken',
      '*.refresh_token',
      'authorization',
      'cookie',
    ],
    censor: '[REDACTED]',
  },
  transport: esDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      }
    : undefined,
})
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/shared/logger.ts
git commit -m "feat(shared): logger estructurado con pino (redacts tokens en logs)"
```

---

## Task 7: Lucia setup con adapter Prisma

**Files:**
- `lib/auth/lucia.ts`

- [ ] **Step 1: Create `lib/auth/lucia.ts`**

```typescript
import { Lucia } from 'lucia'
import { PrismaAdapter } from '@lucia-auth/adapter-prisma'
import { basePrisma } from '@/lib/db/base-prisma'
import { env } from '@/lib/shared/env'

const adapter = new PrismaAdapter(basePrisma.session, basePrisma.usuario)

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    expires: false,
    attributes: {
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: env.NODE_ENV === 'production' ? '.' + new URL(env.PUBLIC_BASE_URL).hostname : undefined,
    },
  },
  getUserAttributes: (usuario) => ({
    email: usuario.email,
    nombre: usuario.nombre,
    cuentaId: usuario.cuentaId,
    rol: usuario.rol,
    googleSub: usuario.googleSub,
  }),
})

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia
    DatabaseUserAttributes: {
      email: string
      nombre: string
      cuentaId: string
      rol: 'owner' | 'secretaria'
      googleSub: string
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If Lucia's adapter API differs slightly, adjust — the `PrismaAdapter(sessionModel, userModel)` signature is standard for `@lucia-auth/adapter-prisma@^4`.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/lucia.ts
git commit -m "feat(auth): Lucia con adapter Prisma"
```

---

## Task 8: Google OAuth client con Arctic

**Files:**
- `lib/auth/google-oauth.ts`

- [ ] **Step 1: Create `lib/auth/google-oauth.ts`**

```typescript
import { Google } from 'arctic'
import { env } from '@/lib/shared/env'

/**
 * Cliente Google OAuth para identity + Calendar.
 * Scopes:
 *  - openid, email, profile → identity
 *  - calendar               → Plan 3 usará el refresh_token para el sync
 */
export const google = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_OAUTH_REDIRECT,
)

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
]

export interface GoogleUserInfo {
  sub: string
  email: string
  name: string
  picture?: string
}

export async function obtenerUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) throw new Error(`Google userinfo devolvió ${resp.status}`)
  return resp.json()
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/google-oauth.ts
git commit -m "feat(auth): cliente Google OAuth (Arctic) + userinfo"
```

---

## Task 9: Cookie de pending-onboarding

**Files:**
- `tests/unit/pending-onboarding-cookie.test.ts`
- `lib/auth/pending-onboarding.ts`

Contexto: post-OAuth callback, si el `google_sub` no tiene `Usuario`, guardamos el estado (google_sub, email, nombre, refresh_token) en una cookie firmada + cifrada de 15 min. La página `/onboarding` la lee, muestra el form, y en el submit crea Cuenta+Usuario+... y borra la cookie.

Usamos `iron-session` (cookie firmada + cifrada con el `SESSION_SECRET`).

- [ ] **Step 1: Test**

`tests/unit/pending-onboarding-cookie.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  serializarPendingOnboarding,
  deserializarPendingOnboarding,
  type PendingOnboarding,
} from '@/lib/auth/pending-onboarding'

const SECRET = 'x'.repeat(48)

describe('pending onboarding cookie', () => {
  const dato: PendingOnboarding = {
    googleSub: 'sub-123',
    email: 'ana@example.com',
    nombre: 'Ana Martínez',
    refreshToken: 'refresh-abc',
    creadoEn: new Date('2026-07-25T12:00:00Z').toISOString(),
  }

  it('serializa y deserializa un valor válido', async () => {
    const s = await serializarPendingOnboarding(dato, SECRET)
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(0)
    const back = await deserializarPendingOnboarding(s, SECRET)
    expect(back).toEqual(dato)
  })

  it('deserializar con secret distinto falla', async () => {
    const s = await serializarPendingOnboarding(dato, SECRET)
    await expect(
      deserializarPendingOnboarding(s, 'y'.repeat(48)),
    ).rejects.toThrow()
  })

  it('deserializar de basura falla', async () => {
    await expect(deserializarPendingOnboarding('no-es-una-cookie', SECRET)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run → falla**

Run: `npm test -- tests/unit/pending-onboarding-cookie.test.ts`

- [ ] **Step 3: Implement**

`lib/auth/pending-onboarding.ts`:

```typescript
import { sealData, unsealData } from 'iron-session'

export interface PendingOnboarding {
  googleSub: string
  email: string
  nombre: string
  refreshToken: string
  /** ISO timestamp, para chequear TTL de 15 min al deserializar */
  creadoEn: string
}

const TTL_SEG = 15 * 60

export async function serializarPendingOnboarding(
  dato: PendingOnboarding,
  secret: string,
): Promise<string> {
  return sealData(dato, { password: secret, ttl: TTL_SEG })
}

export async function deserializarPendingOnboarding(
  sealed: string,
  secret: string,
): Promise<PendingOnboarding> {
  const data = (await unsealData(sealed, { password: secret, ttl: TTL_SEG })) as PendingOnboarding
  if (!data.googleSub || !data.email) {
    throw new Error('Cookie de onboarding inválida')
  }
  return data
}

export const NOMBRE_COOKIE_PENDING = 'turnero_pending_onboarding'
```

- [ ] **Step 4: Run → pasa**

Run: `npm test -- tests/unit/pending-onboarding-cookie.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/pending-onboarding.ts tests/unit/pending-onboarding-cookie.test.ts
git commit -m "feat(auth): cookie firmada/cifrada de pending onboarding con TTL"
```

---

## Task 10: Session helpers

**Files:**
- `lib/auth/session.ts`

- [ ] **Step 1: Create `lib/auth/session.ts`**

```typescript
import { cookies } from 'next/headers'
import { cache } from 'react'
import { lucia } from './lucia'
import type { Session, User } from 'lucia'

export interface SessionInfo {
  session: Session
  user: User
}

/**
 * Lee la cookie de sesión y valida contra la base.
 * Memoizado por-request con React cache().
 * Refresca la cookie si Lucia la marca "fresh".
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null
  if (!sessionId) return null

  const { session, user } = await lucia.validateSession(sessionId)

  try {
    if (session && session.fresh) {
      const sessionCookie = lucia.createSessionCookie(session.id)
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }
    if (!session) {
      const sessionCookie = lucia.createBlankSessionCookie()
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }
  } catch {
    // cookies() no permite escribir fuera de handlers/actions; ignorar
  }

  if (!session || !user) return null
  return { session, user }
})

export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession()
  if (!s) throw new Error('No hay sesión activa')
  return s
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/session.ts
git commit -m "feat(auth): session helpers (getSession, requireSession)"
```

---

## Task 11: Permisos `puede()`

**Files:**
- `tests/unit/puede.test.ts` (TDD)
- `lib/auth/puede.ts`

- [ ] **Step 1: Test**

`tests/unit/puede.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { puede, type UsuarioAuth } from '@/lib/auth/puede'

const owner: UsuarioAuth = { rol: 'owner', cuentaId: 'c1' }
const secretaria: UsuarioAuth = { rol: 'secretaria', cuentaId: 'c1' }

describe('puede', () => {
  it('owner puede todo', () => {
    expect(puede(owner, 'ver_turno')).toBe(true)
    expect(puede(owner, 'crear_turno')).toBe(true)
    expect(puede(owner, 'editar_config')).toBe(true)
    expect(puede(owner, 'invitar_usuario')).toBe(true)
    expect(puede(owner, 'desconectar_calendar')).toBe(true)
  })

  it('secretaria puede operar la agenda pero no tocar config', () => {
    expect(puede(secretaria, 'ver_turno')).toBe(true)
    expect(puede(secretaria, 'crear_turno')).toBe(true)
    expect(puede(secretaria, 'mover_turno')).toBe(true)
    expect(puede(secretaria, 'cancelar_turno')).toBe(true)
    expect(puede(secretaria, 'ver_cliente')).toBe(true)
    expect(puede(secretaria, 'editar_config')).toBe(false)
    expect(puede(secretaria, 'invitar_usuario')).toBe(false)
    expect(puede(secretaria, 'desconectar_calendar')).toBe(false)
  })
})
```

- [ ] **Step 2: Fail**

Run: `npm test -- tests/unit/puede.test.ts`

- [ ] **Step 3: Implement**

`lib/auth/puede.ts`:

```typescript
export type Rol = 'owner' | 'secretaria'

export interface UsuarioAuth {
  rol: Rol
  cuentaId: string
}

export type Accion =
  | 'ver_turno'
  | 'crear_turno'
  | 'mover_turno'
  | 'cancelar_turno'
  | 'completar_turno'
  | 'ver_cliente'
  | 'crear_cliente'
  | 'editar_cliente'
  | 'editar_config'
  | 'invitar_usuario'
  | 'desconectar_calendar'
  | 'ver_audit_log'

const PERMISOS_SECRETARIA = new Set<Accion>([
  'ver_turno',
  'crear_turno',
  'mover_turno',
  'cancelar_turno',
  'completar_turno',
  'ver_cliente',
  'crear_cliente',
  'editar_cliente',
])

export function puede(usuario: UsuarioAuth, accion: Accion): boolean {
  if (usuario.rol === 'owner') return true
  if (usuario.rol === 'secretaria') return PERMISOS_SECRETARIA.has(accion)
  return false
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- tests/unit/puede.test.ts`
Expected: 2 passed (multiple assertions each).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/puede.ts tests/unit/puede.test.ts
git commit -m "feat(auth): función puede() con dos roles y matriz explícita"
```

---

## Task 12: Ruta `/api/auth/google` (inicio OAuth)

**Files:**
- `app/api/auth/google/route.ts`

- [ ] **Step 1: Create route**

`app/api/auth/google/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateState, generateCodeVerifier } from 'arctic'
import { google, GOOGLE_SCOPES } from '@/lib/auth/google-oauth'
import { env } from '@/lib/shared/env'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'
const COOKIE_TTL = 60 * 10 // 10 min

export async function GET() {
  if (!env.GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Google OAuth no está configurado en este entorno' },
      { status: 500 },
    )
  }

  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: GOOGLE_SCOPES,
  })
  // Google necesita access_type=offline y prompt=consent para devolver refresh_token
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  const cookieStore = await cookies()
  const secure = env.NODE_ENV === 'production'
  cookieStore.set(COOKIE_STATE, state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL,
  })
  cookieStore.set(COOKIE_VERIFIER, codeVerifier, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL,
  })

  return NextResponse.redirect(url)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/google/route.ts
git commit -m "feat(auth): ruta /api/auth/google (inicio OAuth con PKCE)"
```

---

## Task 13: Ruta `/api/auth/google/callback`

**Files:**
- `app/api/auth/google/callback/route.ts`

- [ ] **Step 1: Create callback**

`app/api/auth/google/callback/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { OAuth2RequestError } from 'arctic'
import { google, obtenerUserInfo } from '@/lib/auth/google-oauth'
import { basePrisma } from '@/lib/db/base-prisma'
import { lucia } from '@/lib/auth/lucia'
import {
  NOMBRE_COOKIE_PENDING,
  serializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const err = searchParams.get('error')

  if (err) {
    logger.warn({ err }, 'Google OAuth callback con error')
    return NextResponse.redirect(new URL('/login?error=denied', env.PUBLIC_BASE_URL))
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(COOKIE_STATE)?.value ?? null
  const storedVerifier = cookieStore.get(COOKIE_VERIFIER)?.value ?? null

  if (!code || !state || !storedState || !storedVerifier || state !== storedState) {
    logger.warn('OAuth callback: state/code missing o no matchea')
    return NextResponse.redirect(new URL('/login?error=state', env.PUBLIC_BASE_URL))
  }

  try {
    const tokens = await google.validateAuthorizationCode(code, storedVerifier)
    const userInfo = await obtenerUserInfo(tokens.accessToken)

    // Buscar Usuario existente por googleSub
    const existente = await basePrisma.usuario.findUnique({
      where: { googleSub: userInfo.sub },
      include: { cuenta: true },
    })

    // Limpiar cookies de state/verifier
    cookieStore.delete(COOKIE_STATE)
    cookieStore.delete(COOKIE_VERIFIER)

    if (existente) {
      // Login normal: crear session, redirigir a su cuenta
      const session = await lucia.createSession(existente.id, {})
      const sessionCookie = lucia.createSessionCookie(session.id)
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
      return NextResponse.redirect(
        new URL(`/${existente.cuenta.slug}`, env.PUBLIC_BASE_URL),
      )
    }

    // Usuario nuevo → guardar pending onboarding en cookie y mandar al form
    if (!tokens.refreshToken) {
      logger.warn(
        { googleSub: userInfo.sub },
        'Google no devolvió refresh_token; probablemente el usuario ya había consentido',
      )
      // Sin refresh_token no podemos hacer Calendar. Forzar re-consent.
      return NextResponse.redirect(new URL('/login?error=no_refresh', env.PUBLIC_BASE_URL))
    }

    const sealed = await serializarPendingOnboarding(
      {
        googleSub: userInfo.sub,
        email: userInfo.email,
        nombre: userInfo.name,
        refreshToken: tokens.refreshToken,
        creadoEn: new Date().toISOString(),
      },
      env.SESSION_SECRET,
    )
    cookieStore.set(NOMBRE_COOKIE_PENDING, sealed, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    })
    return NextResponse.redirect(new URL('/onboarding', env.PUBLIC_BASE_URL))
  } catch (e) {
    if (e instanceof OAuth2RequestError) {
      logger.warn({ err: e.message }, 'OAuth2RequestError en callback')
      return NextResponse.redirect(new URL('/login?error=oauth', env.PUBLIC_BASE_URL))
    }
    logger.error({ err: e }, 'Error inesperado en OAuth callback')
    return NextResponse.redirect(new URL('/login?error=server', env.PUBLIC_BASE_URL))
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/google/callback/route.ts
git commit -m "feat(auth): ruta callback de Google OAuth (login o pending onboarding)"
```

---

## Task 14: Ruta `/api/auth/logout`

**Files:**
- `app/api/auth/logout/route.ts`

- [ ] **Step 1: Create**

`app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { lucia } from '@/lib/auth/lucia'
import { getSession } from '@/lib/auth/session'
import { env } from '@/lib/shared/env'

export async function POST() {
  const s = await getSession()
  if (s) {
    await lucia.invalidateSession(s.session.id)
  }
  const blank = lucia.createBlankSessionCookie()
  const cookieStore = await cookies()
  cookieStore.set(blank.name, blank.value, blank.attributes)
  return NextResponse.redirect(new URL('/login', env.PUBLIC_BASE_URL), { status: 303 })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/logout/route.ts
git commit -m "feat(auth): ruta /api/auth/logout"
```

---

## Task 15: Página `/login`

**Files:**
- `app/login/page.tsx`

- [ ] **Step 1: Create**

`app/login/page.tsx`:

```typescript
type Props = { searchParams: Promise<{ error?: string }> }

const MENSAJES_ERROR: Record<string, string> = {
  denied: 'Cancelaste el acceso. Podés intentar de nuevo cuando quieras.',
  state: 'La sesión de login expiró. Probá de nuevo.',
  no_refresh: 'Necesitamos permiso para acceder a tu Google Calendar. Aceptá los permisos cuando Google te pregunte.',
  oauth: 'Google rechazó el login. Probá de nuevo.',
  server: 'Algo se rompió de nuestro lado. Intentá de nuevo en un rato.',
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Turnero</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>
        Agenda con confirmación automática de turnos.
      </p>

      {error && MENSAJES_ERROR[error] && (
        <p style={{ background: '#fee', border: '1px solid #f88', padding: '0.75rem 1rem', borderRadius: 4, marginBottom: '1rem' }}>
          {MENSAJES_ERROR[error]}
        </p>
      )}

      <a
        href="/api/auth/google"
        style={{
          display: 'inline-block',
          padding: '0.75rem 1.5rem',
          background: '#0ea5e9',
          color: 'white',
          textDecoration: 'none',
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        Continuar con Google
      </a>

      <p style={{ marginTop: '2rem', color: '#888', fontSize: '0.875rem' }}>
        Usamos tu cuenta de Google para el login y para sincronizar los turnos con tu Google Calendar.
      </p>
    </main>
  )
}
```

Nota: styles inline en MVP; Plan 4 introduce Tailwind + Radix para todas las pantallas.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(auth): página /login con botón de Google y errores legibles"
```

---

## Task 16: `completarOnboarding` — transacción de creación

**Files:**
- `tests/integration/onboarding-completar.test.ts` (TDD)
- `lib/onboarding/completar.ts`

Contexto: función pura de dominio que recibe los datos del form + del pending onboarding y crea todo en una transacción. Devuelve la `Cuenta` creada + el `Usuario` owner. Testeable sin HTTP.

- [ ] **Step 1: Test (integración)**

`tests/integration/onboarding-completar.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { useTestDatabase } from './helpers/db'
import { completarOnboarding } from '@/lib/onboarding/completar'

describe('completarOnboarding', () => {
  useTestDatabase()

  const pending = {
    googleSub: 'google-sub-1',
    email: 'ana@example.com',
    nombre: 'Ana Martínez',
    refreshToken: 'refresh-abc',
  }

  const form = {
    slug: 'dra-ana',
    nombrePublico: 'Dra. Ana Martínez',
    telefonoWhatsapp: '+5491100000000',
    duracionMinutos: 30,
    horarios: [
      { diaSemana: 0, desde: '09:00', hasta: '13:00' },
      { diaSemana: 0, desde: '15:00', hasta: '18:00' },
      { diaSemana: 1, desde: '09:00', hasta: '13:00' },
      { diaSemana: 1, desde: '15:00', hasta: '18:00' },
      { diaSemana: 2, desde: '09:00', hasta: '13:00' },
      { diaSemana: 2, desde: '15:00', hasta: '18:00' },
      { diaSemana: 3, desde: '09:00', hasta: '13:00' },
      { diaSemana: 3, desde: '15:00', hasta: '18:00' },
      { diaSemana: 4, desde: '09:00', hasta: '13:00' },
      { diaSemana: 4, desde: '15:00', hasta: '18:00' },
    ],
  }

  it('crea Cuenta + Usuario + Servicio + Horarios + IntegracionCalendar', async () => {
    const { cuenta, usuario } = await completarOnboarding(pending, form)

    expect(cuenta.slug).toBe('dra-ana')
    expect(usuario.rol).toBe('owner')
    expect(usuario.googleSub).toBe('google-sub-1')

    const servicios = await basePrisma.servicio.findMany({ where: { cuentaId: cuenta.id } })
    expect(servicios).toHaveLength(1)
    expect(servicios[0].nombre).toBe('Consulta')
    expect(servicios[0].duracionMinutos).toBe(30)
    expect(servicios[0].esDefault).toBe(true)

    const horarios = await basePrisma.horarioSemanal.findMany({ where: { cuentaId: cuenta.id } })
    expect(horarios).toHaveLength(10)

    const integracion = await basePrisma.integracionCalendar.findUnique({ where: { cuentaId: cuenta.id } })
    expect(integracion).not.toBeNull()
    expect(integracion?.calendarIdDedicado).toBeNull()
    expect(integracion?.refreshTokenCifrado.length).toBeGreaterThan(0)
  })

  it('falla si el slug ya existe', async () => {
    await completarOnboarding(pending, form)
    await expect(
      completarOnboarding({ ...pending, googleSub: 'otro' }, form),
    ).rejects.toThrow()
  })

  it('falla si el googleSub ya tiene Usuario', async () => {
    await completarOnboarding(pending, form)
    await expect(
      completarOnboarding(pending, { ...form, slug: 'dra-ana-2' }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Fail**

Run: `npm test -- tests/integration/onboarding-completar.test.ts`

- [ ] **Step 3: Implement**

`lib/onboarding/completar.ts`:

```typescript
import { basePrisma } from '@/lib/db/base-prisma'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { env } from '@/lib/shared/env'
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
  // Prisma @db.Time acepta cualquier Date; usa solo la parte hora
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

export async function completarOnboarding(
  pending: DatosPendingOnboarding,
  form: DatosFormOnboarding,
): Promise<ResultadoOnboarding> {
  const master = Buffer.from(env.ENCRYPTION_KEY, 'base64')

  return basePrisma.$transaction(async (tx) => {
    const cuenta = await tx.cuenta.create({
      data: {
        slug: form.slug,
        nombrePublico: form.nombrePublico,
        telefonoWhatsapp: form.telefonoWhatsapp,
      },
    })

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
        // calendarIdDedicado queda null hasta Plan 3
        // watch channels y sync tokens quedan null hasta Plan 3
      },
    })

    return { cuenta, usuario }
  })
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- tests/integration/onboarding-completar.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/completar.ts tests/integration/onboarding-completar.test.ts
git commit -m "feat(onboarding): completar en transacción única (Cuenta+Usuario+Servicio+Horarios+Integ)"
```

---

## Task 17: Página `/onboarding` + server action

**Files:**
- `app/onboarding/page.tsx`
- `app/onboarding/actions.ts`

- [ ] **Step 1: Server action `app/onboarding/actions.ts`**

```typescript
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { validarSlug } from '@/lib/tenant/validate-slug'
import {
  NOMBRE_COOKIE_PENDING,
  deserializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { completarOnboarding } from '@/lib/onboarding/completar'
import { lucia } from '@/lib/auth/lucia'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const schemaForm = z.object({
  slug: z.string(),
  nombrePublico: z.string().min(2).max(120),
  telefonoWhatsapp: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Formato E.164'),
  duracionMinutos: z.coerce.number().int().min(5).max(240),
})

const HORARIOS_DEFAULT = [0, 1, 2, 3, 4].flatMap((diaSemana) => [
  { diaSemana, desde: '09:00', hasta: '13:00' },
  { diaSemana, desde: '15:00', hasta: '18:00' },
])

export type EstadoOnboarding =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string }

export async function completarOnboardingAction(
  _prev: EstadoOnboarding | null,
  formData: FormData,
): Promise<EstadoOnboarding> {
  const cookieStore = await cookies()
  const pendingCookie = cookieStore.get(NOMBRE_COOKIE_PENDING)?.value
  if (!pendingCookie) {
    return { ok: false, error: 'La sesión de onboarding expiró. Volvé a entrar con Google.' }
  }

  let pending
  try {
    pending = await deserializarPendingOnboarding(pendingCookie, env.SESSION_SECRET)
  } catch {
    return { ok: false, error: 'La sesión de onboarding es inválida. Volvé a entrar con Google.' }
  }

  const parsed = schemaForm.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors).flat()[0]
    return { ok: false, error: firstError ?? 'Datos inválidos' }
  }

  const slugCheck = validarSlug(parsed.data.slug)
  if (!slugCheck.valido) {
    return { ok: false, error: `Slug: ${slugCheck.razon}` }
  }

  try {
    const { cuenta, usuario } = await completarOnboarding(
      {
        googleSub: pending.googleSub,
        email: pending.email,
        nombre: pending.nombre,
        refreshToken: pending.refreshToken,
      },
      {
        slug: parsed.data.slug,
        nombrePublico: parsed.data.nombrePublico,
        telefonoWhatsapp: parsed.data.telefonoWhatsapp,
        duracionMinutos: parsed.data.duracionMinutos,
        horarios: HORARIOS_DEFAULT,
      },
    )

    const session = await lucia.createSession(usuario.id, {})
    const sessionCookie = lucia.createSessionCookie(session.id)
    cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    cookieStore.delete(NOMBRE_COOKIE_PENDING)

    logger.info({ cuentaId: cuenta.id, usuarioId: usuario.id }, 'onboarding completado')
    return { ok: true, redirectTo: `/${cuenta.slug}` }
  } catch (e: unknown) {
    logger.warn({ err: e }, 'completarOnboarding falló')
    const msg = e instanceof Error ? e.message : 'error desconocido'
    if (msg.includes('Unique constraint') || msg.includes('unique constraint')) {
      return { ok: false, error: 'Ese slug ya está tomado. Elegí otro.' }
    }
    return { ok: false, error: 'No pudimos crear tu cuenta. Reintentá en un rato.' }
  }
}

export async function redirectDespuesDeOnboarding(destino: string) {
  redirect(destino)
}
```

- [ ] **Step 2: Page `app/onboarding/page.tsx`**

```typescript
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  NOMBRE_COOKIE_PENDING,
  deserializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  const cookieStore = await cookies()
  const pendingCookie = cookieStore.get(NOMBRE_COOKIE_PENDING)?.value
  if (!pendingCookie) redirect('/login')

  let pending
  try {
    pending = await deserializarPendingOnboarding(pendingCookie, env.SESSION_SECRET)
  } catch {
    redirect('/login?error=state')
  }

  return (
    <main style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Configurá tu agenda, {pending.nombre.split(' ')[0]}</h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Tres datos y ya podés operar. Todo lo demás se ajusta después.
      </p>
      <OnboardingForm />
    </main>
  )
}
```

- [ ] **Step 3: Form component `app/onboarding/OnboardingForm.tsx`**

```typescript
'use client'

import { useActionState } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { completarOnboardingAction, type EstadoOnboarding } from './actions'

const estilo = {
  campo: { display: 'block', marginBottom: '1rem' } as const,
  label: { display: 'block', fontSize: '0.875rem', color: '#333', marginBottom: 4 } as const,
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: '1rem',
  } as const,
  hint: { fontSize: '0.75rem', color: '#888', marginTop: 4 } as const,
  boton: {
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    background: '#0ea5e9',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
  } as const,
  error: {
    background: '#fee',
    border: '1px solid #f88',
    padding: '0.75rem',
    borderRadius: 4,
    marginBottom: '1rem',
  } as const,
}

export function OnboardingForm() {
  const [estado, action, pending] = useActionState<EstadoOnboarding | null, FormData>(
    completarOnboardingAction,
    null,
  )
  const router = useRouter()

  useEffect(() => {
    if (estado?.ok) router.push(estado.redirectTo)
  }, [estado, router])

  return (
    <form action={action}>
      {estado && !estado.ok && <div style={estilo.error}>{estado.error}</div>}

      <div style={estilo.campo}>
        <label htmlFor="nombrePublico" style={estilo.label}>Nombre público del estudio o consultorio</label>
        <input id="nombrePublico" name="nombrePublico" required style={estilo.input} placeholder="Dra. Ana Martínez" />
        <p style={estilo.hint}>Es lo que ven tus clientes en el link de reserva.</p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="slug" style={estilo.label}>Slug (URL)</label>
        <input id="slug" name="slug" required style={estilo.input} placeholder="dra-ana" pattern="[a-z0-9-]+" />
        <p style={estilo.hint}>turnero.app/<strong>tu-slug</strong>. Minúsculas, guiones, sin espacios.</p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="telefonoWhatsapp" style={estilo.label}>WhatsApp del estudio (formato +54...)</label>
        <input id="telefonoWhatsapp" name="telefonoWhatsapp" required style={estilo.input} placeholder="+5491100000000" />
        <p style={estilo.hint}>Solo para los avisos automáticos. Nunca se muestra al cliente.</p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="duracionMinutos" style={estilo.label}>Duración típica de un turno (min)</label>
        <input id="duracionMinutos" name="duracionMinutos" required type="number" min="5" max="240" defaultValue={30} style={estilo.input} />
        <p style={estilo.hint}>Lo podés cambiar cuando quieras.</p>
      </div>

      <button type="submit" disabled={pending} style={{ ...estilo.boton, opacity: pending ? 0.6 : 1 }}>
        {pending ? 'Creando…' : 'Crear mi agenda'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/
git commit -m "feat(onboarding): página + server action + form con 3 preguntas del MD"
```

---

## Task 18: Placeholder de panel `/[slug]/page.tsx`

**Files:**
- `app/[slug]/page.tsx`

- [ ] **Step 1: Create placeholder**

`app/[slug]/page.tsx`:

```typescript
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export default async function PanelHomePage() {
  const { cuenta } = await getTenant()
  const s = await getSession()
  if (!s) redirect('/login')

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '1.5rem' }}>¡Bienvenida a {cuenta.nombrePublico}!</h1>
      <p style={{ color: '#555' }}>
        Tu agenda está lista. El panel completo (lista mobile + grilla desktop) llega en el Plan 4.
      </p>
      <p style={{ color: '#555' }}>
        Mientras tanto, podés verificar el estado del tenant en{' '}
        <a href={`/${cuenta.slug}/debug`}>/{cuenta.slug}/debug</a>.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: '1.5rem' }}>
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>Cerrar sesión</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/[slug]/page.tsx
git commit -m "feat(panel): placeholder /[slug] con bienvenida y logout (Plan 4 reemplaza)"
```

---

## Task 19: Middleware — routing por estado de sesión

**Files:**
- Modify: `middleware.ts`

Contexto: el middleware actual solo setea `x-tenant-slug`. Agregamos routing según sesión:
- Rutas públicas: `/login`, `/api/auth/*`, `/_next/*`, `/api/webhooks/*`, `/favicon.ico`. Pasan directo.
- Cookie de pending onboarding sin sesión → `/onboarding` (redirect si están en otra ruta).
- Sesión válida sin tenant en URL → redirect a `/[slug del usuario]`.
- Sin sesión y sin cookie pending → `/login`.

**Importante:** el middleware NO puede tocar la base (Edge runtime). Solo puede leer cookies. Para saber si hay sesión, chequeamos existencia de la cookie de sesión de Lucia. Para saber a qué slug redirigir cuando la sesión existe, NO podemos — necesitaríamos DB. Solución: cuando entran a `/` sin slug pero con cookie, el server component en `/page.tsx` (que actualmente muestra "Turnero") hace el redirect a `/[slug]` usando la DB.

Simplificación pragmática: middleware solo maneja las redirecciones simples de cookie-based. Server components hacen las que requieren DB.

- [ ] **Step 1: Update `middleware.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'
import { NOMBRE_COOKIE_PENDING } from '@/lib/auth/pending-onboarding'

const DOMINIO_BASE = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : 'localhost'

const RUTAS_PUBLICAS_SIN_TENANT = new Set([
  '/login',
  '/onboarding',
])

function esRutaSistema(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/test/') // test-only endpoints
  )
}

// El nombre de la cookie de sesión de Lucia es 'auth_session' por default en v3
const COOKIE_SESION = 'auth_session'

export function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const { pathname } = req.nextUrl

  if (esRutaSistema(pathname)) return NextResponse.next()

  // Rutas públicas sin tenant: /login, /onboarding, /aceptar-invitacion/*
  if (
    RUTAS_PUBLICAS_SIN_TENANT.has(pathname) ||
    pathname.startsWith('/aceptar-invitacion/')
  ) {
    return NextResponse.next()
  }

  const resuelto = slugDesdeRequest({ hostname, pathname }, DOMINIO_BASE)

  // Landing sin slug
  if (!resuelto) {
    // Si tiene cookie de pending onboarding, mandarlo a /onboarding
    if (req.cookies.get(NOMBRE_COOKIE_PENDING)) {
      return NextResponse.redirect(new URL('/onboarding', req.url))
    }
    // Sin sesión → /login; con sesión pero sin slug → dejar que /page.tsx haga redirect a su slug
    if (!req.cookies.get(COOKIE_SESION) && pathname !== '/') {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    return NextResponse.next()
  }

  // Con slug: setear header y (si vino por subdominio) rewrite
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-tenant-slug', resuelto.slug)

  if (resuelto.fuente === 'subdominio') {
    const nuevaUrl = req.nextUrl.clone()
    nuevaUrl.pathname = `/${resuelto.slug}${pathname === '/' ? '' : pathname}`
    return NextResponse.rewrite(nuevaUrl, { request: { headers: requestHeaders } })
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Update landing `app/page.tsx` — redirect si hay sesión**

Replace `app/page.tsx` with:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { basePrisma } from '@/lib/db/base-prisma'

export default async function LandingPage() {
  const s = await getSession()
  if (s) {
    const usuario = await basePrisma.usuario.findUnique({
      where: { id: s.user.id },
      include: { cuenta: { select: { slug: true } } },
    })
    if (usuario) redirect(`/${usuario.cuenta.slug}`)
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '2rem' }}>Turnero</h1>
      <p style={{ color: '#555' }}>Agenda con confirmación automática de turnos.</p>
      <p style={{ marginTop: '2rem' }}>
        <a
          href="/login"
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            background: '#0ea5e9',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          Entrar
        </a>
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/page.tsx
git commit -m "feat(auth): routing por sesión en middleware y landing"
```

---

## Task 20: Módulo de invitaciones + email vía Resend

**Files:**
- `lib/invitaciones/email.ts`
- `lib/invitaciones/crear.ts`
- `lib/invitaciones/aceptar.ts`
- `tests/integration/invitacion-flow.test.ts`

- [ ] **Step 1: Test (integración)**

`tests/integration/invitacion-flow.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'
import { crearInvitacion } from '@/lib/invitaciones/crear'
import { aceptarInvitacion } from '@/lib/invitaciones/aceptar'

describe('invitación de secretaria', () => {
  useTestDatabase()

  it('crear invitación devuelve token y expira en 7 días', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    const inv = await crearInvitacion(cuenta.id, 'secretaria@example.com')
    expect(inv.token).toHaveLength(43) // base64url de 32 bytes
    const diff = inv.expiraEn.getTime() - Date.now()
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000)
  })

  it('aceptar invitación válida crea Usuario secretaria', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    const inv = await crearInvitacion(cuenta.id, 'sec@example.com')
    const usuario = await aceptarInvitacion(inv.token, {
      googleSub: 'gs-secretaria',
      email: 'sec@example.com',
      nombre: 'Sec',
    })
    expect(usuario.rol).toBe('secretaria')
    expect(usuario.cuentaId).toBe(cuenta.id)

    const invUpdated = await basePrisma.invitacion.findUnique({ where: { id: inv.id } })
    expect(invUpdated?.aceptadaEn).not.toBeNull()
  })

  it('aceptar invitación ya usada falla', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    const inv = await crearInvitacion(cuenta.id, 'sec@example.com')
    await aceptarInvitacion(inv.token, { googleSub: 'gs1', email: 'sec@example.com', nombre: 'S' })
    await expect(
      aceptarInvitacion(inv.token, { googleSub: 'gs2', email: 'sec@example.com', nombre: 'S' }),
    ).rejects.toThrow(/ya (fue|aceptada)/i)
  })

  it('aceptar con token inválido falla', async () => {
    await expect(
      aceptarInvitacion('token-inexistente', { googleSub: 'x', email: 'x@x', nombre: 'X' }),
    ).rejects.toThrow(/no existe|inválid/i)
  })
})
```

- [ ] **Step 2: Fail**

Run: `npm test -- tests/integration/invitacion-flow.test.ts`

- [ ] **Step 3: Implement `lib/invitaciones/crear.ts`**

```typescript
import { randomBytes } from 'node:crypto'
import { basePrisma } from '@/lib/db/base-prisma'
import type { Invitacion } from '@prisma/client'

const TTL_DIAS = 7

export function generarToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function crearInvitacion(cuentaId: string, email: string): Promise<Invitacion> {
  const token = generarToken()
  const expiraEn = new Date(Date.now() + TTL_DIAS * 24 * 60 * 60 * 1000)
  return basePrisma.invitacion.create({
    data: { cuentaId, email: email.toLowerCase(), token, expiraEn },
  })
}
```

- [ ] **Step 4: Implement `lib/invitaciones/aceptar.ts`**

```typescript
import { basePrisma } from '@/lib/db/base-prisma'
import type { Usuario } from '@prisma/client'

export interface DatosGoogleParaAceptar {
  googleSub: string
  email: string
  nombre: string
}

export async function aceptarInvitacion(
  token: string,
  google: DatosGoogleParaAceptar,
): Promise<Usuario> {
  return basePrisma.$transaction(async (tx) => {
    const inv = await tx.invitacion.findUnique({ where: { token } })
    if (!inv) throw new Error('Invitación no existe o es inválida')
    if (inv.aceptadaEn) throw new Error('Invitación ya fue aceptada')
    if (inv.expiraEn < new Date()) throw new Error('Invitación expirada')

    const usuario = await tx.usuario.create({
      data: {
        cuentaId: inv.cuentaId,
        googleSub: google.googleSub,
        email: google.email.toLowerCase(),
        nombre: google.nombre,
        rol: 'secretaria',
      },
    })

    await tx.invitacion.update({
      where: { id: inv.id },
      data: { aceptadaEn: new Date() },
    })

    return usuario
  })
}
```

- [ ] **Step 5: Implement `lib/invitaciones/email.ts`**

```typescript
import { Resend } from 'resend'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

export async function enviarEmailInvitacion(params: {
  a: string
  cuentaNombre: string
  linkAceptar: string
}) {
  const { a, cuentaNombre, linkAceptar } = params
  const asunto = `${cuentaNombre} te invita a Turnero`
  const html = `
    <p>Hola,</p>
    <p><strong>${cuentaNombre}</strong> te invita a colaborar en su agenda en Turnero.</p>
    <p><a href="${linkAceptar}">Aceptar invitación</a></p>
    <p>El link expira en 7 días.</p>
  `

  if (!resend) {
    logger.info({ a, asunto, linkAceptar }, '[dev-email] invitación (RESEND_API_KEY no seteada)')
    return
  }

  await resend.emails.send({
    from: env.RESEND_FROM,
    to: a,
    subject: asunto,
    html,
  })
}
```

- [ ] **Step 6: Pass**

Run: `npm test -- tests/integration/invitacion-flow.test.ts`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add lib/invitaciones/ tests/integration/invitacion-flow.test.ts
git commit -m "feat(invitaciones): crear + aceptar + email via Resend (dev-mode logs)"
```

---

## Task 21: Ruta `/aceptar-invitacion/[token]`

**Files:**
- `app/aceptar-invitacion/[token]/page.tsx`

Contexto: cuando la secretaria hace click en el link del email, cae acá. La página valida el token exista y esté activo, y muestra un botón "Continuar con Google". El OAuth callback, si ve una cookie con el token, sabe que es una aceptación y llama `aceptarInvitacion` en vez de mandar a onboarding.

Para no explotar el callback existente, cambiamos el approach: la página seta una cookie firmada con el token de invitación, después redirige a `/api/auth/google?intent=invitacion`. El callback la lee.

- [ ] **Step 1: Add helper for invitation cookie**

Modify `lib/auth/pending-onboarding.ts` to also export helpers for an invitation cookie (or create a new file). For simplicity, add a helper here for a signed invitation token cookie.

Add to `lib/auth/pending-onboarding.ts`:

```typescript
export const NOMBRE_COOKIE_INVITACION = 'turnero_invitacion_token'

export interface PendingInvitacion {
  token: string
  creadoEn: string
}

export async function serializarPendingInvitacion(
  dato: PendingInvitacion,
  secret: string,
): Promise<string> {
  return sealData(dato, { password: secret, ttl: 10 * 60 })
}

export async function deserializarPendingInvitacion(
  sealed: string,
  secret: string,
): Promise<PendingInvitacion> {
  const data = (await unsealData(sealed, { password: secret, ttl: 10 * 60 })) as PendingInvitacion
  if (!data.token) throw new Error('Cookie de invitación inválida')
  return data
}
```

- [ ] **Step 2: Create page `app/aceptar-invitacion/[token]/page.tsx`**

```typescript
import { basePrisma } from '@/lib/db/base-prisma'

type Props = { params: Promise<{ token: string }> }

export default async function AceptarInvitacionPage({ params }: Props) {
  const { token } = await params

  const inv = await basePrisma.invitacion.findUnique({
    where: { token },
    include: { cuenta: { select: { nombrePublico: true } } },
  })

  if (!inv || inv.aceptadaEn || inv.expiraEn < new Date()) {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
        <h1>Invitación no válida</h1>
        <p>Este link ya se usó o expiró. Pedile al owner que te mande uno nuevo.</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Te invitaron a Turnero</h1>
      <p><strong>{inv.cuenta.nombrePublico}</strong> te invita a colaborar en su agenda.</p>
      <p style={{ marginTop: '1.5rem' }}>
        <a
          href={`/api/auth/google?intent=invitacion&token=${encodeURIComponent(token)}`}
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            background: '#0ea5e9',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          Continuar con Google
        </a>
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Update `/api/auth/google` to accept intent + token via signed cookie**

Modify `app/api/auth/google/route.ts` — replace the body of `GET` to also handle invitation intent:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { generateState, generateCodeVerifier } from 'arctic'
import { google, GOOGLE_SCOPES } from '@/lib/auth/google-oauth'
import { serializarPendingInvitacion } from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'

const COOKIE_STATE = 'google_oauth_state'
const COOKIE_VERIFIER = 'google_code_verifier'
const COOKIE_INTENT_INVITACION = 'turnero_invitacion_pending'
const COOKIE_TTL = 60 * 10

export async function GET(req: NextRequest) {
  if (!env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google OAuth no configurado' }, { status: 500 })
  }

  const intent = req.nextUrl.searchParams.get('intent')
  const invitacionToken = req.nextUrl.searchParams.get('token')

  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: GOOGLE_SCOPES,
  })
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  const cookieStore = await cookies()
  const secure = env.NODE_ENV === 'production'
  const opts = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: COOKIE_TTL }
  cookieStore.set(COOKIE_STATE, state, opts)
  cookieStore.set(COOKIE_VERIFIER, codeVerifier, opts)

  if (intent === 'invitacion' && invitacionToken) {
    const sealed = await serializarPendingInvitacion(
      { token: invitacionToken, creadoEn: new Date().toISOString() },
      env.SESSION_SECRET,
    )
    cookieStore.set(COOKIE_INTENT_INVITACION, sealed, opts)
  }

  return NextResponse.redirect(url)
}
```

- [ ] **Step 4: Update callback to handle invitation cookie**

Modify `app/api/auth/google/callback/route.ts` — after successful OAuth token exchange + userinfo, check for the invitation cookie BEFORE the existing "Usuario existente / pending onboarding" branch:

Add after `const userInfo = await obtenerUserInfo(tokens.accessToken)` and before `const existente = await basePrisma.usuario.findUnique(...)`:

```typescript
// Chequear si viene de una invitación
const COOKIE_INTENT_INVITACION = 'turnero_invitacion_pending'
const invitacionSealed = cookieStore.get(COOKIE_INTENT_INVITACION)?.value
if (invitacionSealed) {
  cookieStore.delete(COOKIE_INTENT_INVITACION)
  try {
    const { deserializarPendingInvitacion } = await import('@/lib/auth/pending-onboarding')
    const { aceptarInvitacion } = await import('@/lib/invitaciones/aceptar')
    const pendingInv = await deserializarPendingInvitacion(invitacionSealed, env.SESSION_SECRET)
    const usuario = await aceptarInvitacion(pendingInv.token, {
      googleSub: userInfo.sub,
      email: userInfo.email,
      nombre: userInfo.name,
    })
    const cuenta = await basePrisma.cuenta.findUniqueOrThrow({ where: { id: usuario.cuentaId } })
    const session = await lucia.createSession(usuario.id, {})
    const sessionCookie = lucia.createSessionCookie(session.id)
    cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    cookieStore.delete(COOKIE_STATE)
    cookieStore.delete(COOKIE_VERIFIER)
    return NextResponse.redirect(new URL(`/${cuenta.slug}`, env.PUBLIC_BASE_URL))
  } catch (e) {
    logger.warn({ err: e }, 'Aceptar invitación falló')
    return NextResponse.redirect(new URL('/login?error=invitacion', env.PUBLIC_BASE_URL))
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/aceptar-invitacion/ lib/auth/pending-onboarding.ts app/api/auth/google/
git commit -m "feat(invitaciones): flow completo de aceptación via OAuth"
```

---

## Task 22: Test-mode login endpoint (para E2E)

**Files:**
- `app/test/login-as/route.ts`

Contexto: E2E de onboarding necesita crear sesión sin depender del OAuth real. Este endpoint (guardado en `NODE_ENV !== 'production'`) recibe un `usuarioId` y setea la cookie de sesión.

- [ ] **Step 1: Create**

`app/test/login-as/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { lucia } from '@/lib/auth/lucia'
import { basePrisma } from '@/lib/db/base-prisma'
import { env } from '@/lib/shared/env'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const usuarioId = body?.usuarioId as string | undefined
  if (!usuarioId) return NextResponse.json({ error: 'usuarioId requerido' }, { status: 400 })

  const usuario = await basePrisma.usuario.findUnique({ where: { id: usuarioId } })
  if (!usuario) return NextResponse.json({ error: 'usuario no existe' }, { status: 404 })

  const session = await lucia.createSession(usuario.id, {})
  const sessionCookie = lucia.createSessionCookie(session.id)
  const cookieStore = await cookies()
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
  return NextResponse.json({ ok: true, sessionId: session.id })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/test/
git commit -m "test(auth): endpoint /test/login-as para E2E (solo dev/test)"
```

---

## Task 23: E2E — flujo de onboarding y login

**Files:**
- `tests/e2e/onboarding-flow.spec.ts`

- [ ] **Step 1: E2E test**

`tests/e2e/onboarding-flow.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
})

test.describe('flujo de onboarding y sesión', () => {
  const slug = `e2e-onboarding-${Date.now()}`
  let cuentaId: string
  let usuarioId: string

  test.beforeAll(async () => {
    // Simulamos que ya pasó el OAuth: creamos la cuenta y el usuario "a mano",
    // después probamos que /test/login-as les da sesión y llegan al panel.
    const cuenta = await prisma.cuenta.create({
      data: { slug, nombrePublico: 'E2E Onboarding' },
    })
    const usuario = await prisma.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: 'e2e@example.com',
        nombre: 'E2E User',
        googleSub: `gs-e2e-${Date.now()}`,
        rol: 'owner',
      },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuenta.id, nombre: 'Consulta', duracionMinutos: 30, esDefault: true },
    })
    cuentaId = cuenta.id
    usuarioId = usuario.id
  })

  test.afterAll(async () => {
    await prisma.cuenta.delete({ where: { id: cuentaId } })
    await prisma.$disconnect()
  })

  test('/login carga sin sesión', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Turnero' })).toBeVisible()
    await expect(page.getByRole('link', { name: /continuar con google/i })).toBeVisible()
  })

  test('/[slug] sin sesión redirige a /login', async ({ page }) => {
    await page.goto(`/${slug}`)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('login test-mode → /[slug] muestra bienvenida', async ({ page, request }) => {
    const resp = await request.post('/test/login-as', {
      data: { usuarioId },
    })
    expect(resp.status()).toBe(200)

    await page.goto(`/${slug}`)
    await expect(page.getByRole('heading', { name: /bienvenida/i })).toBeVisible()
    await expect(page.getByText(/E2E Onboarding/)).toBeVisible()
    await expect(page.getByRole('button', { name: /cerrar sesión/i })).toBeVisible()
  })

  test('logout limpia la sesión', async ({ page, request }) => {
    // Re-login
    await request.post('/test/login-as', { data: { usuarioId } })
    await page.goto(`/${slug}`)
    await page.getByRole('button', { name: /cerrar sesión/i }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
```

- [ ] **Step 2: Run**

Run: `npm run test:e2e -- onboarding-flow`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/onboarding-flow.spec.ts
git commit -m "test(e2e): flujo de onboarding y sesión (test-mode login)"
```

---

## Task 24: Actualizar CLAUDE.md + CI

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend `CLAUDE.md` — agregar sección de Auth y actualizar comandos**

Add after the existing "Env vars" section, before "Architecture snapshot":

```markdown
## Auth (Plan 2)

- **Único identity provider: Google OAuth.** No hay email/password.
- Scopes: `openid email profile https://www.googleapis.com/auth/calendar`. El calendar scope se pide en el mismo consent aunque Plan 2 no lo use — Plan 3 lo va a necesitar y así el usuario da todos los permisos una sola vez.
- Sesiones: **Lucia 3** con adapter Prisma. Cookie `auth_session` HttpOnly + Secure en prod.
- Roles: `owner` (todo) y `secretaria` (opera agenda, no toca config). Chequear con `puede(usuario, accion)` en `lib/auth/puede.ts`.
- Estado pending-onboarding: cookie firmada+cifrada `turnero_pending_onboarding` con TTL 15 min (iron-session + `SESSION_SECRET`).
- `refresh_token` de Google: cifrado con AES-256-GCM. Llave por-cuenta derivada de `ENCRYPTION_KEY` vía HKDF-SHA256 con info `turnero.cuenta.<cuentaId>`.

## Setup de Google OAuth (dev)

1. En [Google Cloud Console](https://console.cloud.google.com), creá un proyecto y andá a APIs & Services → Credentials.
2. Consent screen: External, con tu email como test user.
3. Create OAuth client ID → Web application.
4. Authorized redirect URI: `http://localhost:3000/api/auth/google/callback` (o el puerto que uses).
5. Pegá client ID y secret en `.env`.
6. Habilitá la **Google Calendar API** en la misma consola (Plan 3 la usa).

En dev sin OAuth real: no podés hacer login vía UI, pero podés usar `/test/login-as` con un `usuarioId` para setear una sesión (útil para desarrollar el panel sin auth real). Solo disponible con `NODE_ENV !== 'production'`.

## Onboarding

Tres preguntas al usuario:
1. Nombre público (visible en el link).
2. Slug (validado en vivo contra `validarSlug` + reservados).
3. WhatsApp E.164 del estudio + duración típica de turno.

Todo lo demás se deriva. Los horarios default son L-V 9-13 y 15-18. La `IntegracionCalendar` se crea con `calendar_id_dedicado = null`; Plan 3 (bootstrap-calendar job) la completa.
```

Actualizar la sección "Commands" agregando:

```markdown
- `PORT=3200 npm run dev` — dev server en otro puerto si 3000 está ocupado
```

- [ ] **Step 2: Update `.github/workflows/ci.yml`**

Agregar las env vars necesarias para tests. Buscar el bloque `env:` del job `test` y reemplazarlo por:

```yaml
    env:
      DATABASE_URL: postgresql://turnero_app:turnero_app@localhost:5433/turnero?schema=public
      DIRECT_URL: postgresql://turnero:turnero@localhost:5433/turnero?schema=public
      PUBLIC_BASE_URL: http://localhost:3000
      GOOGLE_CLIENT_ID: test-client-id
      GOOGLE_CLIENT_SECRET: test-client-secret
      GOOGLE_OAUTH_REDIRECT: http://localhost:3000/api/auth/google/callback
      ENCRYPTION_KEY: dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=
      SESSION_SECRET: test-session-secret-32-chars-or-more-please-yes
      RESEND_API_KEY: ""
      NODE_ENV: test
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .github/workflows/ci.yml
git commit -m "docs: actualizar CLAUDE.md y CI con auth + onboarding (Plan 2)"
```

---

## Task 25: Verificación final del plan

- [ ] **Step 1: Migrations up-to-date + grants**

Run:
```bash
npx prisma migrate deploy
docker exec turnero-postgres psql -U turnero -d turnero -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO turnero_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO turnero_app;"
```

- [ ] **Step 2: Full test suite**

Run: `npm run lint && npm run typecheck && npm test && npm run test:e2e`
Expected: all green. Plan 2 agrega ~15 tests unit/integration (aes-gcm 4, hkdf 3, puede 2, pending-onboarding 3, onboarding-completar 3, invitacion-flow 4) + 4 E2E nuevos = ~60 tests totales.

- [ ] **Step 3: Manual smoke (opcional, requiere OAuth real)**

Solo si configuraste Google OAuth con credenciales reales:
1. `npm run dev`
2. Abrir `http://localhost:3000/login`
3. "Continuar con Google" → consent screen → callback → `/onboarding`
4. Completar form → aterrizar en `/<slug>` con bienvenida
5. "Cerrar sesión" → volver a `/login`

Si no configuraste Google OAuth: el endpoint `/api/auth/google` devuelve 500 con mensaje explícito. El resto de la app (endpoints, tests) funciona sin credenciales reales.

- [ ] **Step 4: Confirmar salida del plan**

Todos los criterios de salida cumplidos:
- ✅ `/login` renderiza con botón Google
- ✅ Callback maneja: usuario nuevo (→ onboarding), usuario existente (→ /slug), invitación (→ /slug de la cuenta que invita)
- ✅ Onboarding crea Cuenta+Usuario+Servicio+HorarioSemanal+IntegracionCalendar en una transacción
- ✅ Refresh token cifrado con AES-256-GCM + llave derivada por-cuenta
- ✅ Roles owner/secretaria con matriz de permisos testeada
- ✅ Invitación por email (o log en dev) + aceptación via OAuth
- ✅ Logout limpia sesión
- ✅ Middleware routea por estado de cookie
- ✅ Test-mode login para E2E
- ✅ CI actualizado con env vars

Listo para Plan 3 (Google Calendar integration).
