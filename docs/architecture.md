# Architecture

Status: **target architecture; v1, v2 and v3 implemented** (2026-11-21). Parts are marked with the
version that introduces them. This file is updated at the end of every version to reflect
what actually exists.

## Components

```
Browser
  │
  ├── web  (Nuxt, statically generated)            ── v1
  │     served as static assets by a Cloudflare Worker
  │     *.workers.dev
  │
  └── api  (Express on Cloudflare Workers)          ── v2
        ├── D1 (SQLite) — tables, slots, reservations  ── v2
        ├── Telegram Bot API — owner notifications     ── v3
        ├── Cloudflare Turnstile — bot check on create  ── v3
        ├── LLM provider — AI chat tool calls          ── v6
        └── Payment provider (test mode)               ── v7
```

## Repository layout

pnpm workspaces monorepo:

```
booking-demo/
├── apps/
│   ├── web/        Nuxt app (v1)
│   └── api/        Express Worker (v2)
├── docs/
│   ├── overview.md
│   ├── architecture.md
│   ├── api.md      booking API contract (v2)
│   ├── decisions.md
│   ├── setup-integrations.md  Telegram bot + Turnstile setup (v3)
│   ├── cafe.md     fictional coffee shop content (source of truth)
│   ├── design.md   visual design (v1)
│   └── plans/      one plan per version
├── README.md
├── package.json
└── pnpm-workspace.yaml
```

## Web (v1) — implemented

Live: https://booking-demo-web.nick-burdo.workers.dev


- Nuxt 4, `nuxt generate` (static site generation), output `.output/public`.
- Deployed as a Cloudflare Worker with static assets only (no Worker script).
- i18n: `@nuxtjs/i18n`, locales `en` (default), `ru`, `uk`, strategy `prefix_except_default`
  (`/`, `/ru`, `/uk`); no browser detection; the chosen language is remembered in
  `localStorage` and restored on the English URL only (ADR-006).
- Styling: Tailwind CSS v4 via `@tailwindcss/vite`, own components.
- Map: Leaflet via `@nuxtjs/leaflet`, OpenStreetMap tiles, rendered client-side only.
- Content (menu, hours, address) comes from a typed data file in the app,
  mirroring `docs/cafe.md`.

What exists in `apps/web` after v1:
- `app/data/cafe.ts` — typed content; `app/data/site.ts` — repo link, photo credit.
- `app/components/` — one component per section: `SiteHeader` (sticky, nav, language
  switcher, mobile menu), `HeroSection`, `MenuSection`, `HoursSection`, `LocationSection`
  (map in `<ClientOnly>`), `BookingSection`, `SiteFooter`.
- `app/plugins/remember-locale.client.ts` — saves the switched language, restores it on `/`.
- `app/app.vue` — per-locale head via `useLocaleHead` (`lang`, title, description,
  absolute `hreflang` and canonical links thanks to `i18n.baseUrl`).
- `app/assets/css/main.css` — Tailwind `@theme` tokens from `docs/design.md`, fonts
  from `@fontsource-variable/*`, smooth scrolling unless reduced motion is requested.
- `public/images/hero-*.webp` — hero photo in two widths, served with `srcset`.
- `wrangler.jsonc` — assets-only Worker `booking-demo-web`: `not_found_handling: "404-page"`,
  `html_handling: "drop-trailing-slash"`. Deploy: `pnpm deploy` from the repo root.

Learned in v1:
- A static host has no page for `/` under the i18n `prefix` strategy → switched to
  `prefix_except_default` (plan revision R1).
- Workers static assets add a trailing slash to folder pages by default; Nuxt links have none →
  `drop-trailing-slash` (R2). Checked locally with `wrangler dev`, which emulates the host.
- The server never sees `#hash`; links that depend on it must change only after hydration.

## API (v2) — implemented

Plan: `docs/plans/v2-plan.md`. Contract: `docs/api.md`. Decisions: ADR-011 … ADR-016.

- Express on Workers: `nodejs_compat` flag, app exported via `httpServerHandler` from
  `cloudflare:node`; bindings read with `import { env } from "cloudflare:workers"`.
- Worker `booking-demo-api` (`https://booking-demo-api.nick-burdo.workers.dev`),
  D1 database `booking-demo-db` (binding `DB`), rate limiter binding `CREATE_LIMITER`.
- D1 has **no interactive transactions** (`BEGIN … COMMIT`); atomicity comes from single
  statements and `batch()` (one SQL transaction, rolled back if any statement fails).

What exists in `apps/api` after v2:

```
apps/api/
├── migrations/        0001_init.sql (schema), 0002_seed_tables.sql
├── src/
│   ├── index.ts       Express app, routes, CORS, error handler, httpServerHandler export
│   ├── config.ts      opening hours and booking rules (mirrors docs/cafe.md)
│   ├── clock.ts       single source of "now" (pinned in tests)
│   ├── errors.ts      HttpError and error codes (docs/api.md)
│   ├── time.ts        Kyiv time helpers and time rules (take "now" as a parameter)
│   ├── validation.ts  zod schemas, phone normalisation
│   ├── token.ts       token generation and hashing
│   ├── repo.ts        raw SQL (prepare/bind/batch)
│   └── booking.ts     availability, create, cancel
├── test/              Vitest + @cloudflare/vitest-plugin (unit, HTTP, concurrency)
├── scripts/race.mjs   concurrent-booking demo against a running API
└── wrangler.jsonc
```

Data model: `tables` (8 rows), `reservations` (status `pending`/`cancelled`, token hash),
`reservation_slots` (`PRIMARY KEY (table_id, slot)` — the double-booking guard). Times are
stored as Kyiv-local strings (`YYYY-MM-DD`, `HH:MM`, slot `YYYY-MM-DDTHH:MM`).

Booking: validate → check time rules → compute the 3 slot keys → read free fitting tables
(smallest first) → `batch(insert reservation + 3 slot rows)`; on a primary-key conflict try
the next table; none left → `409 SLOT_TAKEN`. Cancel: `batch(update status, delete slots)`;
the delete only runs if the reservation is cancelled in the same transaction.

Learned in v2:
- D1 `batch()` really is all-or-nothing: a failing slot insert leaves no reservation row
  behind (checked by a test against the real migrations).
- The Workers Vitest integration runs the Express app as is: `exports.default.fetch()` reaches
  the `httpServerHandler` export; the Rate Limiting binding is simulated too, so the `429` path
  is tested. Spying on `clock.now` in a test also changes "now" inside the Worker (same isolate).
- Concurrency: 8 parallel bookings of one slot give exactly 4 successes both locally (10 test
  runs) and on the live API (`scripts/race.mjs`); losers of a race retry on the next table.
- pnpm's `minimumReleaseAge` policy rejects packages published less than a day ago; pin the
  previous release (here `wrangler@4.165.0`, `@cloudflare/vitest-plugin@1.8.5`) instead of
  adding exclusions.

## Booking form, notifications, bot check (v3) — implemented

Plan: `docs/plans/v3-plan.md`. Decisions: ADR-017 … ADR-019. One-time setup of the bot and
Turnstile: `docs/setup-integrations.md`.

Web (`apps/web`):
- `BookingSection.vue` hosts `BookingForm.vue`: date + guests → free times → contacts →
  Turnstile → `POST /reservations` → confirmation with the personal link.
- `pages/reservation.vue`: reads the token from the URL hash in the browser (after hydration,
  see "Learned"), shows the reservation, offers cancellation; `noindex`.
- `TurnstileWidget.client.vue` (explicit render), `composables/useBookingApi.ts`,
  `composables/useKyivDate.ts`.
- Config baked in at `nuxt generate`: `runtimeConfig.public.apiBase` and `turnstileSiteKey`
  in `nuxt.config.ts` hold the live values; `pnpm dev` and `pnpm --filter web generate:local`
  override them from git-ignored `apps/web/.env.local` (local API, Turnstile test key).

API (`apps/api`):
- `src/turnstile.ts`: `siteverify` check after body validation; fail closed.
- `src/telegram.ts`: Ukrainian message builder (HTML-escaped) and `sendMessage` call.
- `src/notify.ts`: runs the notification via `waitUntil` from `cloudflare:workers` after
  create and cancel; success stamps `notified_at` / `cancel_notified_at` (migration `0003`);
  the cancel message waits for the "new booking" one (up to 10 s, ADR-018).
- Secrets (`wrangler secret put`): `TURNSTILE_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`;
  local values in git-ignored `apps/api/.dev.vars` (Turnstile test secret, optional Telegram).

Learned in v3:
- A prerendered Nuxt 4 page that is opened with a different URL (here `/reservation#token`)
  first hydrates with the prerendered route and restores the real one on
  `app:suspense:resolve` ("deferred route"). Code in `onMounted` still sees the URL without
  the hash. Read such values in `onNuxtReady` from `useRoute()`. Dev mode has no prerender,
  so test this kind of page on a built site (`generate:local`).
- `nuxt generate` reads `.env` like `nuxt dev` does, so local values in `.env` end up in the
  production build. Local values now live in `.env.local`, loaded only by explicit scripts.
- Turnstile: with a script injected at runtime, wait for its `onload`; `turnstile.ready()`
  throws for async scripts. The production secret rejects Cloudflare's dummy test token, so
  scripts (e.g. `race.mjs`) can only create bookings on a local API.
- `waitUntil` works with Express on Workers and in the Vitest integration; spying on
  `globalThis.fetch` in a test intercepts the Worker's outbound calls (same isolate).
- Two background tasks of one booking are unordered; Date.now() does not advance during I/O
  in Workers, so the wait for the first message counts attempts instead of reading the clock.
