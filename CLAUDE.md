# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Next.js dev server (default :3000; use `PORT=3100` si el 3000 está ocupado)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript sin emit
- `npm test` — unit + integration (Vitest)
- `npm run test:watch` — Vitest en watch
- `npm run test:e2e` — Playwright E2E (levanta el dev server automáticamente en 3100)
- `npm run db:up` / `db:down` — Postgres local (Docker Compose, puerto 5433)
- `npm run db:migrate` — aplicar migraciones (dev)
- `npm run db:reset` — reset + seed
- `npm run db:seed` — cargar cuenta demo
- `npm run db:studio` — Prisma Studio

Correr un test específico: `npm test -- tests/unit/validate-slug.test.ts`

## Setup local desde cero

```bash
npm install
npm run db:up
# El init script docker/postgres/init/01-app-role.sql crea el rol turnero_app
# solo en volumen FRESCO. Si tenías un volumen anterior:
#   npm run db:down && docker volume rm turnero_turnero_pgdata && npm run db:up
npx prisma migrate deploy
npm run db:seed
npm run dev
# Verificar: curl http://localhost:3000/demo/debug
```

## Env vars (dos URLs por diseño)

- `DATABASE_URL` — apunta al rol `turnero_app` (NOSUPERUSER, NOBYPASSRLS). Es el rol que usa la app en runtime. RLS aplica.
- `DIRECT_URL` — apunta al rol `turnero` (superuser). Solo para migraciones (Prisma) y seed. **Nunca** usar desde código de app.
- `PUBLIC_BASE_URL` — usada por middleware para saber el dominio base (`turnero.app` en prod, `localhost` en dev).

## Architecture snapshot (Plan 1: Fundaciones)

- **Next.js 15 App Router** en Node runtime. Middleware (Edge) para resolución de tenant.
- **Prisma 6** con dos clientes:
  - `basePrisma` (`lib/db/base-prisma.ts`): sin restricciones. Usar solo para lookup de `Cuenta` por slug, seed y scripts de plataforma. Va contra `DATABASE_URL` (turnero_app) — RLS aplica igual, cuidado en operaciones sensibles.
  - `createTenantClient(cuentaId)` (`lib/db/tenant-client.ts`): factory que devuelve un Prisma extendido que inyecta `cuentaId` en filtros/creates y envuelve cada operación en una transacción con `SET LOCAL app.cuenta_id`. **Toda query de la app pasa por acá.**
- **Multi-tenant en 3 capas:**
  1. Middleware (`middleware.ts`) parsea subdominio o path, setea header `x-tenant-slug` sobre la REQUEST (no la response) para que `headers()` en Server Components/route handlers pueda leerlo.
  2. Extension de Prisma inyecta filtros de `cuentaId` en el tenant client.
  3. RLS en Postgres con policy `USING (cuenta_id = NULLIF(current_setting('app.cuenta_id', true), '')::uuid)`. Aplica al rol `turnero_app` (NOBYPASSRLS + FORCE). Corta desde abajo si la app falla.
- **Resolución de tenant en Server Components:** `getTenant()` en `lib/tenant/resolve.ts`, memoizado con React `cache()`. Devuelve `{ cuenta, db }`.
- **Endpoint `/[slug]/debug`** (solo `NODE_ENV !== 'production'`) permite verificar la resolución sin UI. Nota: el nombre `_debug` NO se puede usar — Next.js App Router excluye folders con `_`.

## Limitaciones conocidas del tenant client

Documentadas en el JSDoc de `createTenantClient`:

1. **Nested writes NO reciben inyección de cuentaId.** No hacer `db.turno.create({ data: { cliente: { create: {...} } } })`. RLS actúa como red de seguridad pero el error va a ser en runtime.
2. **`$queryRaw` y `$executeRaw` no son interceptados.** RLS los cubre. Evitar raw SQL sobre modelos tenant-scoped.

## Naming

Modelos y carpetas de dominio en español: `Cuenta`, `Turno`, `Servicio`, `HorarioSemanal`, `ExcepcionHorario`, `Cliente`, `IntegracionCalendar`, `EventoExterno`, `AuditLog`, `Invitacion`. Nombres de framework en inglés (`middleware`, `route handler`, `server action`).

## Product in one line

Turnero (appointment scheduler) with automatic confirmations for Argentine professional practices (notaries, law/accounting firms, clinics). Distributed via a partner's ~2000-SME channel. The number that justifies the price is no-show reduction (from ~20% to ~8%).

## Architectural boundary that must not be crossed

Turnero is the **entry product of a modular platform**. A separate conversational assistant will consume its API. **The turnero exposes the scheduling API; the assistant consumes it. Never duplicate agenda logic on the assistant side.** Any code that leaks calendar rules outside this repo is a mistake.

## Hard rules that constrain implementation

These are not preferences — violating them breaks the business.

- **Multi-tenant isolation lives in the query filter**, never in the prompt, never in the presentation layer. Data leakage between tenants ends the deal with the distribution channel. Enforce from commit one, when it's free.
- **All datetimes are timezone-aware in `America/Argentina/Buenos_Aires`.** Never naive. Always render in the professional's zone and label it — someone will book from another province or abroad.
- **Reminders are derived from the turno, not stored as independent rows.** If the turno moves, the reminder recalculates. Independent records produce orphan/duplicate reminders for months. This is the module most likely to hurt — treat it carefully.
- **Client confirmation is a signed-token link, never an account.** Registration to confirm = lost confirmation.
- **Cancellation frees the slot automatically.** The end-to-end circuit (reserve → remind → confirm → cancel → free) is the ROI being sold.
- **Google Calendar sync is bidirectional and non-negotiable.** Watch channels expire (schedule renewal); recurring events are the hard case; simultaneous-edit conflicts need an explicit written rule, not emergent behavior.
- **WhatsApp: official Cloud API only.** Never Baileys, whatsapp-web.js, or any unofficial library. A ban kills the client's commercial channel and the relationship with the entire distribution partner.

## UX surface priorities (frequency-of-use order)

1. **Public booking page** — most used, must be simplest. No login. Mobile-first for old Androids on bad signal. Fast load matters here more than anywhere else. Also a marketing surface — carries the practice's name.
2. **Daily operation** — two *distinct* layouts, not one responsive shrink. Mobile: list ("what do I have today"), next turno on top, one-tap phone. Desktop: dense weekly grid with drag-to-move. A shrunken weekly grid on mobile is unreadable — don't attempt it.
3. **Configuration** — least used (three visits in a lifetime). Complete and clear, basic responsive. Do not invest mobile effort here.

## Language and naming conventions

- **All user-facing text in Rioplatense Spanish, voseo, direct tone.** No "usted", no literal translations from English.
- **Domain names in Spanish:** `turno`, `disponibilidad`, `recordatorio`, etc. Do not mix English and Spanish inside a module.
- User messages are short — must fit a WhatsApp notification or it doesn't serve.

## Explicitly out of scope

Do not add even if easy or requested:

- Native app / Flutter (PWA if "app feel" is needed later).
- Visual customization of the booking link beyond name + color.
- Configuration via WhatsApp (that's a form and always will be).
- Clinical records (health-data obligations this team can't cover).
- Microservices, Kubernetes, distributed queues — a jobs table and a cron are enough at this scale.

## Onboarding principle for any config UI

Ask only three things on day one: business hours, typical duration, notification number. **Derive everything else** (calendar via OAuth, contacts from first turno per person, duration from user corrections). An almost-empty config panel at start is a sign of good design here, not missing functionality.

## Build order (staged, with exit criteria)

1. **Core** — data model, multi-tenant, Google Calendar sync, web panel with grid + list. *Exit:* the agenda works on its own.
2. **End-client circuit** — public booking page, reminders, confirmation-by-reply, auto-release on cancel. *Exit:* one turno end-to-end with no manual step.
3. **Closing** — weekly summary to the professional, contact/turno attachments, self-serve onboarding. *Exit:* a new client signs up without a call.

The conversational layer does **not** belong here — it's the follow-on product, built after this one works.
