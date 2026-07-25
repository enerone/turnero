# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

Greenfield. No code, no build system, no tests yet. The only artifact is `CLAUDE-turnero.md`, the product-context document (Spanish). **Read it before proposing anything** — it encodes non-obvious business constraints that must shape architecture from day one, not be retrofitted.

When code lands, update this file with the actual build/lint/test commands.

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
