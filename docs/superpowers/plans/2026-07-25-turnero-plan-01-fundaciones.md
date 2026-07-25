---
title: Turnero — Plan 01 — Fundaciones
description: Plan 1 del Ciclo 1 de Turnero. Bootstrap del repo Next.js + TypeScript, Postgres en Docker, schema Prisma completo, extension multi-tenant, RLS, middleware de resolución de tenant y CI. Salida verificable con tests de aislamiento.
date: 2026-07-25
type: implementation-plan
project: turnero
ciclo: 1
plan_num: 1
status: draft
tags: [turnero, plan, nucleo, multi-tenant, prisma, rls]
related:
  - "[[2026-07-24-turnero-nucleo-design]]"
  - "[[CLAUDE-turnero]]"
---

# Turnero — Plan 01 — Fundaciones (Ciclo 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el esqueleto del proyecto (Next.js + TypeScript + Postgres + Prisma) con enforcement multi-tenant de tres capas (extension de Prisma + RLS + middleware) verificado por tests de aislamiento reales.

**Architecture:** Next.js 15 App Router en Node runtime, Prisma con base client + tenant client factory que inyecta filtros `cuentaId` y envuelve cada query en transacciones con `SET LOCAL app.cuenta_id`. RLS en Postgres como defensa en profundidad. Resolución de tenant por subdominio (opt-in) o por primer segmento del path, propagada via header `x-tenant-slug`.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.6+, Prisma 6, Postgres 16, Vitest 2, Playwright, Docker Compose, GitHub Actions.

**Fuera de scope de este plan (van en planes siguientes):** auth con Google OAuth (Plan 2), sync bidireccional con Google Calendar (Plan 3), UI del panel operativo y config (Plan 4).

---

## File Structure

Archivos que se crean o modifican en este plan:

```
turnero/
├── package.json                              (nuevo)
├── tsconfig.json                             (nuevo)
├── next.config.ts                            (nuevo)
├── .gitignore                                (nuevo)
├── .env.example                              (nuevo)
├── .env                                      (nuevo, git-ignored)
├── .eslintrc.json                            (nuevo)
├── .prettierrc                               (nuevo)
├── vitest.config.ts                          (nuevo)
├── playwright.config.ts                      (nuevo)
├── docker-compose.dev.yml                    (nuevo)
├── .github/workflows/ci.yml                  (nuevo)
├── prisma/
│   ├── schema.prisma                         (nuevo)
│   ├── migrations/                           (generado por prisma)
│   └── seed.ts                                (nuevo)
├── app/
│   ├── layout.tsx                            (nuevo)
│   ├── page.tsx                              (nuevo, landing dummy)
│   └── [slug]/
│       ├── layout.tsx                        (nuevo, resuelve tenant)
│       └── _debug/
│           └── route.ts                      (nuevo, endpoint de verificación)
├── middleware.ts                             (nuevo, resolución de tenant)
├── lib/
│   ├── db/
│   │   ├── base-prisma.ts                    (nuevo, cliente sin extensions)
│   │   ├── tenant-client.ts                  (nuevo, factory + extension + RLS)
│   │   ├── tenant-models.ts                  (nuevo, lista de modelos tenant-scoped)
│   │   └── errors.ts                         (nuevo, tipos de error)
│   ├── tenant/
│   │   ├── resolve.ts                        (nuevo, getTenant() con cache)
│   │   ├── reserved-slugs.ts                 (nuevo)
│   │   ├── validate-slug.ts                  (nuevo)
│   │   └── slug-from-request.ts              (nuevo, parse hostname/path)
│   └── shared/
│       └── env.ts                            (nuevo, validación con Zod)
├── tests/
│   ├── unit/
│   │   ├── tenant-client-extension.test.ts   (nuevo)
│   │   ├── tenant-transaction-rls.test.ts    (nuevo)
│   │   ├── slug-from-request.test.ts         (nuevo)
│   │   ├── reserved-slugs.test.ts            (nuevo)
│   │   └── validate-slug.test.ts             (nuevo)
│   ├── integration/
│   │   ├── tenant-client-crud.test.ts        (nuevo)
│   │   ├── rls-blocks-bypass.test.ts         (nuevo)
│   │   └── helpers/
│   │       ├── db.ts                         (nuevo, setup/teardown)
│   │       └── fixtures.ts                   (nuevo, factory de datos)
│   └── e2e/
│       └── multi-tenant-isolation.spec.ts    (nuevo)
└── CLAUDE.md                                 (modificado: comandos + arquitectura)
```

---

## Task 1: Bootstrap del repo Next.js con TypeScript

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`, `.eslintrc.json`, `.prettierrc`
- Create: `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Crear `.gitignore`**

```gitignore
node_modules/
.next/
out/
dist/
build/

.env
.env*.local

*.log
npm-debug.log*
.DS_Store

playwright-report/
test-results/
coverage/

prisma/migrations/**/migration_lock.toml
!prisma/migrations/migration_lock.toml
```

- [ ] **Step 2: Crear `package.json`**

```json
{
  "name": "turnero",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:up": "docker compose -f docker-compose.dev.yml up -d",
    "db:down": "docker compose -f docker-compose.dev.yml down",
    "db:migrate": "prisma migrate dev",
    "db:reset": "prisma migrate reset --force",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@prisma/client": "^6.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "prisma": "^6.0.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "prettier": "^3.3.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 3: Instalar dependencias**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Crear `next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // pg-boss corre en el mismo proceso; asegurar que no se bundlee mal
    serverComponentsExternalPackages: ['@prisma/client'],
  },
}

export default nextConfig
```

- [ ] **Step 6: Crear `.env.example` y `.env`**

`.env.example`:

```
# Base de datos local (docker compose)
DATABASE_URL="postgresql://turnero:turnero@localhost:5433/turnero?schema=public"

# URLs de la app
PUBLIC_BASE_URL="http://localhost:3000"
```

Y copiar a `.env`:

Run: `cp .env.example .env`

- [ ] **Step 7: Crear `.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals",
  "rules": {
    "@next/next/no-html-link-for-pages": "off"
  }
}
```

- [ ] **Step 8: Crear `.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 9: Crear `app/layout.tsx`**

```typescript
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Turnero',
  description: 'Agenda con confirmación automática de turnos',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 10: Crear `app/page.tsx`**

```typescript
export default function LandingPage() {
  return (
    <main>
      <h1>Turnero</h1>
      <p>Agenda con confirmación automática de turnos.</p>
    </main>
  )
}
```

- [ ] **Step 11: Verificar que compila**

Run: `npm run typecheck`
Expected: exit 0, sin errores.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts .gitignore .env.example .eslintrc.json .prettierrc app/
git commit -m "chore: bootstrap next.js + typescript"
```

---

## Task 2: Postgres local vía Docker Compose

**Files:**
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Crear `docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: turnero-postgres
    environment:
      POSTGRES_USER: turnero
      POSTGRES_PASSWORD: turnero
      POSTGRES_DB: turnero
    ports:
      - '5433:5432'
    volumes:
      - turnero_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U turnero -d turnero']
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  turnero_pgdata:
```

- [ ] **Step 2: Levantar Postgres**

Run: `npm run db:up`
Expected: `Creating turnero-postgres ... done`.

- [ ] **Step 3: Verificar conexión**

Run: `docker exec turnero-postgres pg_isready -U turnero -d turnero`
Expected: `/var/run/postgresql:5432 - accepting connections`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "chore: postgres local via docker compose"
```

---

## Task 3: Prisma init + modelo `Cuenta` + primera migración

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db/base-prisma.ts`

- [ ] **Step 1: Correr `prisma init`**

Run: `npx prisma init --datasource-provider postgresql`
Expected: crea `prisma/schema.prisma`. Sobrescribimos en el siguiente step.

- [ ] **Step 2: Sobrescribir `prisma/schema.prisma` con el modelo `Cuenta`**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Cuenta {
  id                 String   @id @default(uuid()) @db.Uuid
  slug               String   @unique
  nombrePublico      String   @map("nombre_publico")
  color              String   @default("#0ea5e9")
  ubicacion          String?
  timezone           String   @default("America/Argentina/Buenos_Aires")
  telefonoWhatsapp   String?  @map("telefono_whatsapp")
  subdominioActivo   Boolean  @default(false) @map("subdominio_activo")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@map("cuenta")
}
```

- [ ] **Step 3: Crear primera migración**

Run: `npx prisma migrate dev --name init_cuenta`
Expected: crea `prisma/migrations/YYYYMMDDHHMMSS_init_cuenta/migration.sql`, aplica la migración, corre `prisma generate`.

- [ ] **Step 4: Crear `lib/db/base-prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined
}

export const basePrisma =
  globalForPrisma.basePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.basePrisma = basePrisma
}
```

- [ ] **Step 5: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/ lib/db/base-prisma.ts
git commit -m "feat(db): prisma init con modelo Cuenta"
```

---

## Task 4: Modelos restantes del schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Agregar los modelos restantes a `prisma/schema.prisma`**

Reemplazar el contenido completo del archivo por:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Cuenta {
  id                 String   @id @default(uuid()) @db.Uuid
  slug               String   @unique
  nombrePublico      String   @map("nombre_publico")
  color              String   @default("#0ea5e9")
  ubicacion          String?
  timezone           String   @default("America/Argentina/Buenos_Aires")
  telefonoWhatsapp   String?  @map("telefono_whatsapp")
  subdominioActivo   Boolean  @default(false) @map("subdominio_activo")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  usuarios             Usuario[]
  integracionCalendar  IntegracionCalendar?
  servicios            Servicio[]
  horariosSemanales    HorarioSemanal[]
  excepcionesHorario   ExcepcionHorario[]
  clientes             Cliente[]
  turnos               Turno[]
  eventosExternos      EventoExterno[]
  auditLogs            AuditLog[]
  invitaciones         Invitacion[]

  @@map("cuenta")
}

enum RolUsuario {
  owner
  secretaria

  @@map("rol_usuario")
}

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

enum EstadoIntegracion {
  conectado
  desconectado

  @@map("estado_integracion")
}

model IntegracionCalendar {
  id                        String            @id @default(uuid()) @db.Uuid
  cuentaId                  String            @unique @map("cuenta_id") @db.Uuid
  refreshTokenCifrado       Bytes             @map("refresh_token_cifrado")
  calendarIdDedicado        String?           @map("calendar_id_dedicado")
  calendarIdPrimario        String            @default("primary") @map("calendar_id_primario")
  watchChannelDedicadoId    String?           @map("watch_channel_dedicado_id")
  watchChannelDedicadoExpira DateTime?        @map("watch_channel_dedicado_expira")
  watchChannelPrimarioId    String?           @map("watch_channel_primario_id")
  watchChannelPrimarioExpira DateTime?        @map("watch_channel_primario_expira")
  syncTokenDedicado         String?           @map("sync_token_dedicado")
  syncTokenPrimario         String?           @map("sync_token_primario")
  estado                    EstadoIntegracion @default(conectado)
  createdAt                 DateTime          @default(now()) @map("created_at")
  updatedAt                 DateTime          @updatedAt @map("updated_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@map("integracion_calendar")
}

model Servicio {
  id                  String   @id @default(uuid()) @db.Uuid
  cuentaId            String   @map("cuenta_id") @db.Uuid
  nombre              String
  duracionMinutos     Int      @map("duracion_minutos")
  esDefault           Boolean  @default(false) @map("es_default")
  permiteSobreturnos  Boolean  @default(false) @map("permite_sobreturnos")
  activo              Boolean  @default(true)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  cuenta Cuenta  @relation(fields: [cuentaId], references: [id], onDelete: Cascade)
  turnos Turno[]

  @@index([cuentaId])
  @@map("servicio")
}

model HorarioSemanal {
  id         String   @id @default(uuid()) @db.Uuid
  cuentaId   String   @map("cuenta_id") @db.Uuid
  diaSemana  Int      @map("dia_semana")
  desde      DateTime @db.Time
  hasta      DateTime @db.Time
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@index([cuentaId, diaSemana])
  @@map("horario_semanal")
}

enum TipoExcepcion {
  cerrado
  horario_especial

  @@map("tipo_excepcion")
}

model ExcepcionHorario {
  id        String        @id @default(uuid()) @db.Uuid
  cuentaId  String        @map("cuenta_id") @db.Uuid
  fecha     DateTime      @db.Date
  tipo      TipoExcepcion
  desde     DateTime?     @db.Time
  hasta     DateTime?     @db.Time
  motivo    String        @default("")
  createdAt DateTime      @default(now()) @map("created_at")
  updatedAt DateTime      @updatedAt @map("updated_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@unique([cuentaId, fecha])
  @@map("excepcion_horario")
}

model Cliente {
  id        String   @id @default(uuid()) @db.Uuid
  cuentaId  String   @map("cuenta_id") @db.Uuid
  nombre    String
  telefono  String
  email     String?
  notas     String   @default("")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  cuenta Cuenta  @relation(fields: [cuentaId], references: [id], onDelete: Cascade)
  turnos Turno[]

  @@unique([cuentaId, telefono])
  @@index([cuentaId])
  @@map("cliente")
}

enum EstadoTurno {
  borrador
  confirmado
  cancelado
  completado
  no_asistio

  @@map("estado_turno")
}

enum OrigenTurno {
  turnero
  google_calendar

  @@map("origen_turno")
}

enum OrigenCancelacion {
  panel
  google_calendar
  cliente

  @@map("origen_cancelacion")
}

model Turno {
  id                 String             @id @default(uuid()) @db.Uuid
  cuentaId           String             @map("cuenta_id") @db.Uuid
  clienteId          String?            @map("cliente_id") @db.Uuid
  servicioId         String             @map("servicio_id") @db.Uuid
  inicio             DateTime           @db.Timestamptz(6)
  fin                DateTime           @db.Timestamptz(6)
  estado             EstadoTurno        @default(confirmado)
  googleEventId      String?            @map("google_event_id")
  googleEventEtag    String?            @map("google_event_etag")
  origen             OrigenTurno        @default(turnero)
  origenCancelacion  OrigenCancelacion? @map("origen_cancelacion")
  notas              String             @default("")
  createdAt          DateTime           @default(now()) @map("created_at")
  updatedAt          DateTime           @updatedAt @map("updated_at")

  cuenta   Cuenta    @relation(fields: [cuentaId], references: [id], onDelete: Cascade)
  cliente  Cliente?  @relation(fields: [clienteId], references: [id], onDelete: SetNull)
  servicio Servicio  @relation(fields: [servicioId], references: [id], onDelete: Restrict)

  @@index([cuentaId, inicio])
  @@index([cuentaId, googleEventId])
  @@map("turno")
}

model EventoExterno {
  id            String   @id @default(uuid()) @db.Uuid
  cuentaId      String   @map("cuenta_id") @db.Uuid
  googleEventId String   @map("google_event_id")
  inicio        DateTime @db.Timestamptz(6)
  fin           DateTime @db.Timestamptz(6)
  titulo        String?
  updatedAt     DateTime @updatedAt @map("updated_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@unique([cuentaId, googleEventId])
  @@index([cuentaId, inicio])
  @@map("evento_externo")
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  cuentaId   String   @map("cuenta_id") @db.Uuid
  usuarioId  String?  @map("usuario_id") @db.Uuid
  accion     String
  entidad    String
  entidadId  String?  @map("entidad_id") @db.Uuid
  payload    Json
  createdAt  DateTime @default(now()) @map("created_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@index([cuentaId, createdAt])
  @@map("audit_log")
}

model Invitacion {
  id         String    @id @default(uuid()) @db.Uuid
  cuentaId   String    @map("cuenta_id") @db.Uuid
  email      String
  token      String    @unique
  expiraEn   DateTime  @map("expira_en")
  aceptadaEn DateTime? @map("aceptada_en")
  createdAt  DateTime  @default(now()) @map("created_at")

  cuenta Cuenta @relation(fields: [cuentaId], references: [id], onDelete: Cascade)

  @@index([cuentaId])
  @@map("invitacion")
}
```

- [ ] **Step 2: Generar migración**

Run: `npx prisma migrate dev --name modelos_completos`
Expected: nueva migración aplicada, `prisma generate` corre automáticamente.

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(db): schema completo del Núcleo (10 modelos)"
```

---

## Task 5: Configurar Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/smoke.test.ts` (test provisorio para verificar setup)

- [ ] **Step 1: Crear `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    setupFiles: [],
    testTimeout: 10_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
```

- [ ] **Step 2: Crear un test smoke provisorio**

`tests/unit/smoke.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('vitest está configurado y corre', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Correr tests**

Run: `npm test`
Expected: 1 passed. Sin errores de config.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/unit/smoke.test.ts
git commit -m "chore(test): configurar vitest con smoke test"
```

---

## Task 6: Helper de tests con base de datos real

**Files:**
- Create: `tests/integration/helpers/db.ts`
- Create: `tests/integration/helpers/fixtures.ts`

Contexto: los tests de integración corren contra Postgres real (levantado por `docker-compose.dev.yml`). Cada test corre en su propia transacción que se rollea al final para aislamiento.

- [ ] **Step 1: Crear `tests/integration/helpers/db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

export const testPrisma = new PrismaClient({
  log: ['error'],
})

const TABLES_TO_TRUNCATE = [
  'invitacion',
  'audit_log',
  'evento_externo',
  'turno',
  'cliente',
  'excepcion_horario',
  'horario_semanal',
  'servicio',
  'integracion_calendar',
  'usuario',
  'cuenta',
]

export async function truncateAll(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`,
  )
}

export function useTestDatabase() {
  beforeAll(async () => {
    await testPrisma.$connect()
  })

  beforeEach(async () => {
    await truncateAll(testPrisma)
  })

  afterAll(async () => {
    await testPrisma.$disconnect()
  })
}
```

- [ ] **Step 2: Crear `tests/integration/helpers/fixtures.ts`**

```typescript
import type { PrismaClient } from '@prisma/client'

let cuentaCounter = 0

export async function crearCuentaFixture(
  prisma: PrismaClient,
  overrides: Partial<{ slug: string; nombrePublico: string }> = {},
) {
  cuentaCounter += 1
  const slug = overrides.slug ?? `cuenta-test-${cuentaCounter}-${Date.now()}`
  return prisma.cuenta.create({
    data: {
      slug,
      nombrePublico: overrides.nombrePublico ?? `Cuenta ${cuentaCounter}`,
    },
  })
}

export async function crearServicioFixture(
  prisma: PrismaClient,
  cuentaId: string,
  overrides: Partial<{ nombre: string; duracionMinutos: number; esDefault: boolean }> = {},
) {
  return prisma.servicio.create({
    data: {
      cuentaId,
      nombre: overrides.nombre ?? 'Consulta',
      duracionMinutos: overrides.duracionMinutos ?? 30,
      esDefault: overrides.esDefault ?? true,
    },
  })
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/helpers/
git commit -m "chore(test): helper de base y fixtures"
```

---

## Task 7: Lista de modelos tenant-scoped

**Files:**
- Create: `lib/db/tenant-models.ts`
- Create: `tests/unit/tenant-models.test.ts`

- [ ] **Step 1: Escribir el test primero**

`tests/unit/tenant-models.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { TENANT_SCOPED_MODELS } from '@/lib/db/tenant-models'

describe('TENANT_SCOPED_MODELS', () => {
  it('incluye todos los modelos con cuentaId excepto Cuenta', () => {
    const esperados = [
      'Usuario',
      'IntegracionCalendar',
      'Servicio',
      'HorarioSemanal',
      'ExcepcionHorario',
      'Cliente',
      'Turno',
      'EventoExterno',
      'AuditLog',
      'Invitacion',
    ]
    for (const m of esperados) {
      expect(TENANT_SCOPED_MODELS.has(m as never)).toBe(true)
    }
  })

  it('no incluye Cuenta (el tenant es Cuenta misma)', () => {
    expect(TENANT_SCOPED_MODELS.has('Cuenta' as never)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr test → falla**

Run: `npm test -- tests/unit/tenant-models.test.ts`
Expected: FAIL (`Cannot find module '@/lib/db/tenant-models'`).

- [ ] **Step 3: Crear `lib/db/tenant-models.ts`**

```typescript
import type { Prisma } from '@prisma/client'

export const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
  'Usuario',
  'IntegracionCalendar',
  'Servicio',
  'HorarioSemanal',
  'ExcepcionHorario',
  'Cliente',
  'Turno',
  'EventoExterno',
  'AuditLog',
  'Invitacion',
])
```

- [ ] **Step 4: Correr test → pasa**

Run: `npm test -- tests/unit/tenant-models.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/db/tenant-models.ts tests/unit/tenant-models.test.ts
git commit -m "feat(db): declarar modelos tenant-scoped con test de cobertura"
```

---

## Task 8: Errores del stack de tenant

**Files:**
- Create: `lib/db/errors.ts`

- [ ] **Step 1: Crear `lib/db/errors.ts`**

```typescript
export class NoTenantContextError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `Intento de ${operacion} sobre ${modelo} sin cuentaId en el contexto. ` +
        `Toda query sobre modelos tenant-scoped debe hacerse con createTenantClient(cuentaId).`,
    )
    this.name = 'NoTenantContextError'
  }
}

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`No existe una Cuenta con slug "${slug}".`)
    this.name = 'TenantNotFoundError'
  }
}

export class NoTenantInRequestError extends Error {
  constructor() {
    super('La request no tiene header x-tenant-slug. El middleware no resolvió tenant.')
    this.name = 'NoTenantInRequestError'
  }
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/db/errors.ts
git commit -m "feat(db): tipos de error para stack de tenant"
```

---

## Task 9: Tenant client — factory con extension + RLS binding

**Files:**
- Create: `lib/db/tenant-client.ts`
- Create: `tests/integration/tenant-client-crud.test.ts`

Contexto: el factory `createTenantClient(cuentaId)` devuelve un Prisma client extendido que:
1. Inyecta `where: { cuentaId }` en todas las lecturas.
2. Inyecta `data: { cuentaId }` en todos los `create`.
3. Envuelve cada operación en una transacción que setea `app.cuenta_id` (para que RLS también aplique).

- [ ] **Step 1: Escribir tests de integración primero**

`tests/integration/tenant-client-crud.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

describe('createTenantClient', () => {
  useTestDatabase()

  it('inyecta cuentaId en findMany', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    const cuentaB = await crearCuentaFixture(basePrisma)
    await crearServicioFixture(basePrisma, cuentaA.id, { nombre: 'A' })
    await crearServicioFixture(basePrisma, cuentaB.id, { nombre: 'B' })

    const dbA = createTenantClient(cuentaA.id)
    const servicios = await dbA.servicio.findMany()

    expect(servicios).toHaveLength(1)
    expect(servicios[0].nombre).toBe('A')
  })

  it('inyecta cuentaId en create sin pedirlo explícito', async () => {
    const cuenta = await crearCuentaFixture(basePrisma)
    const db = createTenantClient(cuenta.id)

    const servicio = await db.servicio.create({
      data: { nombre: 'Consulta', duracionMinutos: 30 },
    })

    expect(servicio.cuentaId).toBe(cuenta.id)
  })

  it('bloquea update de otro tenant vía findFirstOrThrow', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    const cuentaB = await crearCuentaFixture(basePrisma)
    const servicioB = await crearServicioFixture(basePrisma, cuentaB.id)

    const dbA = createTenantClient(cuentaA.id)

    await expect(
      dbA.servicio.update({
        where: { id: servicioB.id },
        data: { nombre: 'hackeado' },
      }),
    ).rejects.toThrow()

    const sinCambios = await basePrisma.servicio.findUnique({ where: { id: servicioB.id } })
    expect(sinCambios?.nombre).not.toBe('hackeado')
  })

  it('count respeta el filtro de tenant', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    const cuentaB = await crearCuentaFixture(basePrisma)
    await crearServicioFixture(basePrisma, cuentaA.id)
    await crearServicioFixture(basePrisma, cuentaB.id, { nombre: 'B1', esDefault: false })
    await crearServicioFixture(basePrisma, cuentaB.id, { nombre: 'B2', esDefault: false })

    const dbA = createTenantClient(cuentaA.id)
    const dbB = createTenantClient(cuentaB.id)

    expect(await dbA.servicio.count()).toBe(1)
    expect(await dbB.servicio.count()).toBe(2)
  })

  it('no toca modelos que no son tenant-scoped (Cuenta)', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    const dbA = createTenantClient(cuentaA.id)

    const todas = await dbA.cuenta.findMany()
    expect(todas.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Correr tests → fallan por module missing**

Run: `npm test -- tests/integration/tenant-client-crud.test.ts`
Expected: FAIL (`Cannot find module '@/lib/db/tenant-client'`).

- [ ] **Step 3: Crear `lib/db/tenant-client.ts`**

```typescript
import type { Prisma } from '@prisma/client'
import { basePrisma } from './base-prisma'
import { TENANT_SCOPED_MODELS } from './tenant-models'

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

const WRITE_WITH_WHERE = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
])

function injectTenantScope(operation: string, args: any, cuentaId: string): any {
  if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
    return {
      ...args,
      where: { ...(args?.where ?? {}), cuentaId },
    }
  }

  if (operation === 'create') {
    return {
      ...args,
      data: { ...(args?.data ?? {}), cuentaId },
    }
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = args?.data
    const nuevoData = Array.isArray(data)
      ? data.map((d: any) => ({ ...d, cuentaId }))
      : { ...(data ?? {}), cuentaId }
    return { ...args, data: nuevoData }
  }

  return args
}

export function createTenantClient(cuentaId: string) {
  return basePrisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model as Prisma.ModelName)) {
            return query(args)
          }

          const scoped = injectTenantScope(operation, args, cuentaId)

          const [, result] = await basePrisma.$transaction([
            basePrisma.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaId}, TRUE)`,
            query(scoped),
          ])

          return result
        },
      },
    },
  })
}

export type TenantClient = ReturnType<typeof createTenantClient>
```

- [ ] **Step 4: Correr tests → deberían pasar**

Run: `npm test -- tests/integration/tenant-client-crud.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/db/tenant-client.ts tests/integration/tenant-client-crud.test.ts
git commit -m "feat(db): tenant client con extension e integración de RLS"
```

---

## Task 10: Habilitar RLS en las tablas tenant-scoped

**Files:**
- Create: `prisma/migrations/YYYYMMDDHHMMSS_habilitar_rls/migration.sql` (manual, no via `prisma migrate dev`)

- [ ] **Step 1: Crear la carpeta de la migración manualmente**

Reemplazar `YYYYMMDDHHMMSS` con timestamp actual UTC.

Run:
```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p prisma/migrations/${TS}_habilitar_rls
```

- [ ] **Step 2: Crear `prisma/migrations/<timestamp>_habilitar_rls/migration.sql`**

```sql
-- Habilitar Row-Level Security en todas las tablas tenant-scoped.
-- La policy lee app.cuenta_id (un runtime parameter que setea el tenant client).

-- Nota: el owner de las tablas (usuario turnero) BYPASSEA RLS por default.
-- Para que RLS aplique al mismo usuario que corre queries desde la app,
-- forzamos con FORCE ROW LEVEL SECURITY.

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'usuario',
    'integracion_calendar',
    'servicio',
    'horario_semanal',
    'excepcion_horario',
    'cliente',
    'turno',
    'evento_externo',
    'audit_log',
    'invitacion'
  ];
BEGIN
  FOREACH t IN ARRAY tablas
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (cuenta_id = current_setting(''app.cuenta_id'', true)::uuid) '
      'WITH CHECK (cuenta_id = current_setting(''app.cuenta_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;
```

- [ ] **Step 3: Aplicar la migración**

Run: `npx prisma migrate dev`
Expected: Prisma detecta la migración manual, la aplica, `prisma generate` corre.

- [ ] **Step 4: Verificar RLS en Postgres**

Run:
```bash
docker exec turnero-postgres psql -U turnero -d turnero -c "SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('turno', 'servicio', 'cuenta') ORDER BY tablename"
```
Expected:
- `cuenta`: `rowsecurity = f` (no tenant-scoped).
- `servicio`, `turno`: `rowsecurity = t`, `forcerowsecurity = t`.

- [ ] **Step 5: Correr tests de integración anteriores → deberían seguir pasando**

Run: `npm test -- tests/integration/tenant-client-crud.test.ts`
Expected: 5 passed (el tenant client ya setea `app.cuenta_id`, RLS coopera).

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/
git commit -m "feat(db): RLS habilitado y forzado en tablas tenant-scoped"
```

---

## Task 11: Test que RLS bloquea bypass del extension

**Files:**
- Create: `tests/integration/rls-blocks-bypass.test.ts`

Contexto: si por bug alguien usa `basePrisma` directo (bypasseando el extension), RLS debe cortar. Este test simula ese caso.

- [ ] **Step 1: Escribir el test**

`tests/integration/rls-blocks-bypass.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { basePrisma } from '@/lib/db/base-prisma'
import { useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

describe('RLS bloquea bypass del extension', () => {
  useTestDatabase()

  it('con app.cuenta_id seteado a cuenta A, no se ven servicios de cuenta B via basePrisma', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    const cuentaB = await crearCuentaFixture(basePrisma)
    await crearServicioFixture(basePrisma, cuentaA.id, { nombre: 'A' })
    await crearServicioFixture(basePrisma, cuentaB.id, { nombre: 'B' })

    // Simulamos un query "hostil" que corre en el mismo pool
    // con app.cuenta_id seteado a cuentaA, pero pide TODOS los servicios.
    const resultado = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaA.id}, TRUE)`
      return tx.servicio.findMany()
    })

    expect(resultado).toHaveLength(1)
    expect(resultado[0].nombre).toBe('A')
  })

  it('sin app.cuenta_id seteado, RLS devuelve 0 filas', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)
    await crearServicioFixture(basePrisma, cuentaA.id)

    const resultado = await basePrisma.$transaction(async (tx) => {
      // No seteamos app.cuenta_id: current_setting(..., true) devuelve NULL
      // La policy compara con NULL::uuid → false → cero filas
      return tx.servicio.findMany()
    })

    expect(resultado).toHaveLength(0)
  })

  it('inserta directo sin cuentaId falla por RLS WITH CHECK', async () => {
    const cuentaA = await crearCuentaFixture(basePrisma)

    await expect(
      basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${cuentaA.id}, TRUE)`
        // Intentamos insertar con cuentaId distinto al seteado
        return tx.$executeRaw`
          INSERT INTO servicio (id, cuenta_id, nombre, duracion_minutos, es_default, permite_sobreturnos, activo, created_at, updated_at)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'hack', 30, false, false, true, now(), now())
        `
      }),
    ).rejects.toThrow(/row-level security/i)
  })
})
```

- [ ] **Step 2: Correr tests**

Run: `npm test -- tests/integration/rls-blocks-bypass.test.ts`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rls-blocks-bypass.test.ts
git commit -m "test(db): RLS bloquea bypass del extension"
```

---

## Task 12: Reserved slugs

**Files:**
- Create: `lib/tenant/reserved-slugs.ts`
- Create: `tests/unit/reserved-slugs.test.ts`

- [ ] **Step 1: Escribir el test primero**

`tests/unit/reserved-slugs.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, esReservado } from '@/lib/tenant/reserved-slugs'

describe('reserved slugs', () => {
  it('bloquea rutas del app', () => {
    for (const s of ['admin', 'api', 'app', 'www', 'login', 'signup', 'settings']) {
      expect(esReservado(s)).toBe(true)
    }
  })

  it('permite slugs de negocios reales', () => {
    for (const s of ['escribania-doe', 'dra-ana', 'consultorio-central']) {
      expect(esReservado(s)).toBe(false)
    }
  })

  it('es case-insensitive', () => {
    expect(esReservado('ADMIN')).toBe(true)
    expect(esReservado('Admin')).toBe(true)
  })

  it('la lista contiene al menos las rutas conocidas', () => {
    const rutasConocidas = ['admin', 'api', 'app', 'www', 'help', 'soporte', 'panel', 'settings']
    for (const r of rutasConocidas) {
      expect(RESERVED_SLUGS.has(r)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Correr test → falla**

Run: `npm test -- tests/unit/reserved-slugs.test.ts`
Expected: FAIL (`Cannot find module '@/lib/tenant/reserved-slugs'`).

- [ ] **Step 3: Crear `lib/tenant/reserved-slugs.ts`**

```typescript
export const RESERVED_SLUGS = new Set<string>([
  'admin',
  'api',
  'app',
  'www',
  'help',
  'soporte',
  'blog',
  'docs',
  'panel',
  'dashboard',
  'static',
  'assets',
  'favicon',
  'robots',
  'sitemap',
  'login',
  'logout',
  'signup',
  'cuenta',
  'cuentas',
  'settings',
  'auth',
  '_next',
  '_debug',
])

export function esReservado(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase())
}
```

- [ ] **Step 4: Correr test → pasa**

Run: `npm test -- tests/unit/reserved-slugs.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/reserved-slugs.ts tests/unit/reserved-slugs.test.ts
git commit -m "feat(tenant): reserved slugs con test"
```

---

## Task 13: Validación de formato de slug

**Files:**
- Create: `lib/tenant/validate-slug.ts`
- Create: `tests/unit/validate-slug.test.ts`

- [ ] **Step 1: Escribir test primero**

`tests/unit/validate-slug.test.ts`:

```typescript
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
    if (!esValido) {
      expect(resultado.razon).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Correr test → falla**

Run: `npm test -- tests/unit/validate-slug.test.ts`

- [ ] **Step 3: Crear `lib/tenant/validate-slug.ts`**

```typescript
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
```

- [ ] **Step 4: Correr test → pasa**

Run: `npm test -- tests/unit/validate-slug.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/validate-slug.ts tests/unit/validate-slug.test.ts
git commit -m "feat(tenant): validación de formato de slug"
```

---

## Task 14: Parser de slug desde request (subdominio o path)

**Files:**
- Create: `lib/tenant/slug-from-request.ts`
- Create: `tests/unit/slug-from-request.test.ts`

Contexto: el middleware recibe una request y necesita decidir de dónde sale el slug del tenant. Reglas:
- Si el hostname es `<slug>.turnero.app` (o `<slug>.<dominio>`), el slug viene de ahí.
- Si el hostname es el dominio raíz (`turnero.app` / `www.turnero.app` / `localhost`), el slug viene del primer segmento del path.
- Slugs reservados no cuentan como tenant.

- [ ] **Step 1: Escribir el test primero**

`tests/unit/slug-from-request.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'

const dominioBase = 'turnero.app'

describe('slugDesdeRequest', () => {
  it('extrae slug de subdominio', () => {
    expect(
      slugDesdeRequest({ hostname: 'escribania-doe.turnero.app', pathname: '/hoy' }, dominioBase),
    ).toEqual({ slug: 'escribania-doe', fuente: 'subdominio' })
  })

  it('extrae slug del path cuando el hostname es el dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'turnero.app', pathname: '/escribania-doe/hoy' }, dominioBase),
    ).toEqual({ slug: 'escribania-doe', fuente: 'path' })
  })

  it('trata www como dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'www.turnero.app', pathname: '/dra-ana' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })

  it('trata localhost como dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/dra-ana/hoy' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })

  it('devuelve null si el primer segmento del path es reservado', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/admin/x' }, dominioBase),
    ).toBeNull()
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/api/webhook' }, dominioBase),
    ).toBeNull()
  })

  it('devuelve null si el subdominio es reservado', () => {
    expect(
      slugDesdeRequest({ hostname: 'admin.turnero.app', pathname: '/x' }, dominioBase),
    ).toBeNull()
  })

  it('devuelve null si el path es raíz o sin slug reconocible', () => {
    expect(slugDesdeRequest({ hostname: 'turnero.app', pathname: '/' }, dominioBase)).toBeNull()
    expect(slugDesdeRequest({ hostname: 'turnero.app', pathname: '' }, dominioBase)).toBeNull()
  })

  it('ignora puertos en el hostname', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost:3000', pathname: '/dra-ana' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })
})
```

- [ ] **Step 2: Correr test → falla**

Run: `npm test -- tests/unit/slug-from-request.test.ts`

- [ ] **Step 3: Crear `lib/tenant/slug-from-request.ts`**

```typescript
import { esReservado } from './reserved-slugs'
import { validarSlug } from './validate-slug'

export type SlugResuelto = { slug: string; fuente: 'subdominio' | 'path' }

export interface RequestInfo {
  hostname: string
  pathname: string
}

const HOSTS_RAIZ = new Set(['localhost', 'www'])

export function slugDesdeRequest(req: RequestInfo, dominioBase: string): SlugResuelto | null {
  const hostSinPuerto = req.hostname.split(':')[0].toLowerCase()

  // Subdominio
  if (hostSinPuerto.endsWith('.' + dominioBase)) {
    const sub = hostSinPuerto.slice(0, -('.' + dominioBase).length)
    if (sub === 'www' || sub === '') {
      // Cae a lógica de path
    } else if (esReservado(sub)) {
      return null
    } else if (validarSlug(sub).valido) {
      return { slug: sub, fuente: 'subdominio' }
    } else {
      return null
    }
  }

  // Dominio raíz o localhost → primer segmento del path
  const esDominioRaiz =
    hostSinPuerto === dominioBase ||
    hostSinPuerto === 'www.' + dominioBase ||
    HOSTS_RAIZ.has(hostSinPuerto)

  if (!esDominioRaiz) return null

  const segmentos = req.pathname.split('/').filter(Boolean)
  const primero = segmentos[0]
  if (!primero) return null
  if (esReservado(primero)) return null
  if (!validarSlug(primero).valido) return null
  return { slug: primero, fuente: 'path' }
}
```

- [ ] **Step 4: Correr test → pasa**

Run: `npm test -- tests/unit/slug-from-request.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/slug-from-request.ts tests/unit/slug-from-request.test.ts
git commit -m "feat(tenant): parser de slug desde request"
```

---

## Task 15: Middleware que setea el header `x-tenant-slug`

**Files:**
- Create: `middleware.ts`
- Create: `lib/shared/env.ts`

- [ ] **Step 1: Crear `lib/shared/env.ts`**

```typescript
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
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

- [ ] **Step 2: Crear `middleware.ts` en la raíz**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'

const DOMINIO_BASE = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : 'localhost'

export function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const { pathname } = req.nextUrl

  // Rutas del app que nunca son tenant
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const resuelto = slugDesdeRequest({ hostname, pathname }, DOMINIO_BASE)

  if (!resuelto) {
    // Landing pública: sigue sin tenant
    return NextResponse.next()
  }

  // Si vino por subdominio, reescribimos el path para que Next.js matchee /[slug]/...
  if (resuelto.fuente === 'subdominio') {
    const nuevaUrl = req.nextUrl.clone()
    nuevaUrl.pathname = `/${resuelto.slug}${pathname === '/' ? '' : pathname}`
    const resp = NextResponse.rewrite(nuevaUrl)
    resp.headers.set('x-tenant-slug', resuelto.slug)
    return resp
  }

  const resp = NextResponse.next()
  resp.headers.set('x-tenant-slug', resuelto.slug)
  return resp
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts lib/shared/env.ts
git commit -m "feat(tenant): middleware que resuelve tenant desde host/path"
```

---

## Task 16: Helper `getTenant()` memoizado por request

**Files:**
- Create: `lib/tenant/resolve.ts`

- [ ] **Step 1: Crear `lib/tenant/resolve.ts`**

```typescript
import { headers } from 'next/headers'
import { cache } from 'react'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient, type TenantClient } from '@/lib/db/tenant-client'
import { NoTenantInRequestError, TenantNotFoundError } from '@/lib/db/errors'
import type { Cuenta } from '@prisma/client'

export interface TenantContext {
  cuenta: Cuenta
  db: TenantClient
}

export const getTenant = cache(async (): Promise<TenantContext> => {
  const h = await headers()
  const slug = h.get('x-tenant-slug')
  if (!slug) throw new NoTenantInRequestError()

  const cuenta = await basePrisma.cuenta.findUnique({ where: { slug } })
  if (!cuenta) throw new TenantNotFoundError(slug)

  return {
    cuenta,
    db: createTenantClient(cuenta.id),
  }
})
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/tenant/resolve.ts
git commit -m "feat(tenant): getTenant() memoizado por request con react cache"
```

---

## Task 17: Layout tenanted que verifica la existencia de la Cuenta

**Files:**
- Create: `app/[slug]/layout.tsx`

- [ ] **Step 1: Crear `app/[slug]/layout.tsx`**

```typescript
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getTenant } from '@/lib/tenant/resolve'
import { TenantNotFoundError, NoTenantInRequestError } from '@/lib/db/errors'

export default async function TenantLayout({ children }: { children: ReactNode }) {
  try {
    await getTenant()
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      notFound()
    }
    throw e
  }

  return <>{children}</>
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/[slug]/layout.tsx
git commit -m "feat(tenant): layout /[slug] valida existencia de la Cuenta"
```

---

## Task 18: Endpoint de debug para verificar resolución de tenant en E2E

**Files:**
- Create: `app/[slug]/_debug/route.ts`

Contexto: endpoint mínimo que retorna la cuenta resuelta + un count de servicios via el tenant client. Sirve para verificar en E2E que la resolución y el aislamiento funcionan sin necesidad de UI. Solo habilitado en dev/test.

- [ ] **Step 1: Crear `app/[slug]/_debug/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getTenant } from '@/lib/tenant/resolve'
import { NoTenantInRequestError, TenantNotFoundError } from '@/lib/db/errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const { cuenta, db } = await getTenant()
    const cantidadServicios = await db.servicio.count()
    const cantidadTurnos = await db.turno.count()

    return NextResponse.json({
      cuenta: {
        id: cuenta.id,
        slug: cuenta.slug,
        nombrePublico: cuenta.nombrePublico,
      },
      counts: {
        servicios: cantidadServicios,
        turnos: cantidadTurnos,
      },
    })
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof NoTenantInRequestError) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/[slug]/_debug/route.ts
git commit -m "feat(tenant): endpoint _debug para verificar resolución"
```

---

## Task 19: Configurar Playwright

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Instalar browsers de Playwright**

Run: `npx playwright install chromium`
Expected: descarga Chromium.

- [ ] **Step 2: Crear `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
```

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore(test): configurar playwright"
```

---

## Task 20: E2E — dos tenants, cero fuga de datos

**Files:**
- Create: `tests/e2e/multi-tenant-isolation.spec.ts`

- [ ] **Step 1: Crear el test E2E**

`tests/e2e/multi-tenant-isolation.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test.describe('aislamiento multi-tenant end-to-end', () => {
  const slugA = `e2e-a-${Date.now()}`
  const slugB = `e2e-b-${Date.now()}`
  let cuentaAId: string
  let cuentaBId: string

  test.beforeAll(async () => {
    const cuentaA = await prisma.cuenta.create({
      data: { slug: slugA, nombrePublico: 'Cuenta A' },
    })
    const cuentaB = await prisma.cuenta.create({
      data: { slug: slugB, nombrePublico: 'Cuenta B' },
    })
    cuentaAId = cuentaA.id
    cuentaBId = cuentaB.id

    await prisma.servicio.create({
      data: { cuentaId: cuentaAId, nombre: 'A1', duracionMinutos: 30, esDefault: true },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuentaBId, nombre: 'B1', duracionMinutos: 30, esDefault: true },
    })
    await prisma.servicio.create({
      data: { cuentaId: cuentaBId, nombre: 'B2', duracionMinutos: 45, esDefault: false },
    })
  })

  test.afterAll(async () => {
    await prisma.cuenta.deleteMany({ where: { id: { in: [cuentaAId, cuentaBId] } } })
    await prisma.$disconnect()
  })

  test('/[slugA]/_debug devuelve solo datos de A', async ({ request }) => {
    const resp = await request.get(`/${slugA}/_debug`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.cuenta.slug).toBe(slugA)
    expect(body.counts.servicios).toBe(1)
  })

  test('/[slugB]/_debug devuelve solo datos de B', async ({ request }) => {
    const resp = await request.get(`/${slugB}/_debug`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.cuenta.slug).toBe(slugB)
    expect(body.counts.servicios).toBe(2)
  })

  test('slug inexistente devuelve 404', async ({ request }) => {
    const resp = await request.get('/no-existe-esta-cuenta/_debug')
    expect(resp.status()).toBe(404)
  })

  test('slug reservado no matchea /[slug]', async ({ request }) => {
    const resp = await request.get('/admin/_debug')
    expect([404, 405]).toContain(resp.status())
  })
})
```

- [ ] **Step 2: Levantar Postgres (si no está)**

Run: `npm run db:up`
Expected: postgres running.

- [ ] **Step 3: Correr migraciones**

Run: `npm run db:migrate`
Expected: base al día.

- [ ] **Step 4: Correr tests E2E**

Run: `npm run test:e2e`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/multi-tenant-isolation.spec.ts
git commit -m "test(e2e): dos tenants, cero fuga de datos verificada"
```

---

## Task 21: Seed script mínimo

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (agregar `"prisma": { "seed": "tsx prisma/seed.ts" }`)

- [ ] **Step 1: Crear `prisma/seed.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const demo = await prisma.cuenta.upsert({
    where: { slug: 'demo' },
    create: {
      slug: 'demo',
      nombrePublico: 'Consultorio Demo',
      color: '#0ea5e9',
      ubicacion: 'Av. Corrientes 1234, CABA',
      telefonoWhatsapp: '+5491100000000',
    },
    update: {},
  })

  await prisma.servicio.upsert({
    where: {
      // Prisma no soporta upsert por compuesta directamente sin unique index dedicado;
      // usamos un create idempotente controlado
      id: '00000000-0000-0000-0000-000000000001',
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      cuentaId: demo.id,
      nombre: 'Consulta',
      duracionMinutos: 30,
      esDefault: true,
    },
    update: {},
  })

  console.log(`Seed OK. Cuenta demo: ${demo.slug}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Agregar bloque `prisma` a `package.json`**

Editar `package.json` para agregar:

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 3: Correr seed**

Run: `npm run db:seed`
Expected: `Seed OK. Cuenta demo: demo`.

- [ ] **Step 4: Verificar cuenta demo respondiendo**

Run: `npm run dev &` (o levantarlo en otra terminal)
Run: `curl -s http://localhost:3000/demo/_debug`
Expected: JSON con `cuenta.slug === "demo"`, `counts.servicios === 1`.

Detener el server (`kill %1` o Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts package.json
git commit -m "chore(db): seed script con cuenta demo"
```

---

## Task 22: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Crear `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: turnero
          POSTGRES_PASSWORD: turnero
          POSTGRES_DB: turnero
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U turnero -d turnero"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10

    env:
      DATABASE_URL: postgresql://turnero:turnero@localhost:5433/turnero?schema=public
      PUBLIC_BASE_URL: http://localhost:3000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Run migrations
        run: npx prisma migrate deploy

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Unit + integration tests
        run: npm test

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: E2E tests
        run: npm run test:e2e
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: pipeline con lint + typecheck + tests + e2e"
```

---

## Task 23: Actualizar CLAUDE.md con comandos y arquitectura

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Reemplazar la sección "Repository state" del `CLAUDE.md` por comandos reales y arquitectura**

Editar `CLAUDE.md`, reemplazar:

```markdown
## Repository state

Greenfield. No code, no build system, no tests yet. The only artifact is `CLAUDE-turnero.md`, the product-context document (Spanish). **Read it before proposing anything** — it encodes non-obvious business constraints that must shape architecture from day one, not be retrofitted.

When code lands, update this file with the actual build/lint/test commands.
```

Por:

```markdown
## Commands

- `npm run dev` — Next.js dev server en :3000
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript sin emit
- `npm test` — unit + integration (Vitest)
- `npm run test:watch` — Vitest en watch mode
- `npm run test:e2e` — Playwright E2E (levanta el dev server)
- `npm run db:up` / `db:down` — Postgres local (Docker Compose)
- `npm run db:migrate` — aplicar migraciones (dev)
- `npm run db:reset` — reset + seed
- `npm run db:seed` — cargar cuenta demo
- `npm run db:studio` — Prisma Studio en el navegador

Correr un test específico: `npm test -- tests/unit/validate-slug.test.ts`

## Architecture snapshot (Plan 1: Fundaciones)

- **Next.js 15 App Router** en Node runtime. Middleware en Edge para resolución de tenant.
- **Prisma 6** con dos clientes:
  - `basePrisma` (`lib/db/base-prisma.ts`): sin restricciones. Usar solo para lookup de `Cuenta` por slug, seed y scripts de plataforma.
  - `createTenantClient(cuentaId)` (`lib/db/tenant-client.ts`): factory que devuelve un Prisma extendido que inyecta `cuentaId` en filtros/creates y envuelve cada operación en una transacción con `SET LOCAL app.cuenta_id`. **Toda query de la app pasa por acá.**
- **Multi-tenant en 3 capas:**
  1. Middleware (`middleware.ts`) parsea subdominio o path, setea header `x-tenant-slug`.
  2. Extension de Prisma inyecta filtros de `cuentaId` en el tenant client.
  3. RLS en Postgres con policy `USING (cuenta_id = current_setting('app.cuenta_id')::uuid)`. Corta desde abajo si la app falla.
- **Resolución de tenant en Server Components:** `getTenant()` en `lib/tenant/resolve.ts`, memoizado con React `cache()`. Devuelve `{ cuenta, db }`.
- **Endpoint `/[slug]/_debug`** (solo dev/test) permite verificar la resolución sin UI.

## Naming

Modelos y carpetas de dominio en español: `Cuenta`, `Turno`, `Servicio`, `HorarioSemanal`, `ExcepcionHorario`, `Cliente`, `IntegracionCalendar`, `EventoExterno`, `AuditLog`, `Invitacion`. Nombres de framework en inglés (`middleware`, `route handler`, `server action`).
```

- [ ] **Step 2: Verificar que el archivo sigue sano**

Run: `wc -l CLAUDE.md`
Expected: sale un número razonable (no truncado).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: actualizar CLAUDE.md con comandos y arquitectura del Plan 1"
```

---

## Task 24: Verificación final del plan

- [ ] **Step 1: Reset limpio de la base**

Run: `npm run db:reset`
Expected: base recreada, migraciones aplicadas, seed corrido, cuenta `demo` presente.

- [ ] **Step 2: Correr TODA la suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: exit 0 en las tres.

- [ ] **Step 3: Correr E2E**

Run: `npm run test:e2e`
Expected: 4 passed.

- [ ] **Step 4: Verificación manual — el endpoint demo funciona**

Run: `npm run dev &` en una terminal.
Run: `curl -s http://localhost:3000/demo/_debug | jq .`
Expected:
```json
{
  "cuenta": {
    "id": "...",
    "slug": "demo",
    "nombrePublico": "Consultorio Demo"
  },
  "counts": {
    "servicios": 1,
    "turnos": 0
  }
}
```

Detener el server.

- [ ] **Step 5: Confirmar salida del plan**

Si todos los pasos anteriores dan verde, el Plan 1 está completo. Salida verificada:
- Repo Next.js + TypeScript compila y corre.
- Postgres local corre en Docker.
- Prisma con 10 modelos + Cuenta.
- Multi-tenant enforcement en 3 capas testeado (extension, RLS, middleware).
- Reserved slugs validados.
- Endpoint dev `/[slug]/_debug` responde correctamente por path y devuelve solo datos de esa cuenta.
- CI pipeline definido.
- `CLAUDE.md` actualizado.

Listo para arrancar Plan 2: Auth y onboarding.
