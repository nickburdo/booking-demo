# Decisions (ADR log)

Each record: context → decision → consequences. Status is `Accepted` once the user
has confirmed it in discussion.

## ADR-001 — Purpose: learning + portfolio, fictional coffee shop

- **Status:** Accepted (2026-11-21)
- **Context:** The starting point was a real freelance request (one-page coffee shop site
  with AI-chat booking). The goal is to understand how booking works, not to fulfil it.
- **Decision:** Build a demo for a fictional coffee shop in Kyiv with an invented name,
  menu and address.
- **Consequences:** No real brand or business data anywhere. Content lives in `docs/cafe.md`.

## ADR-002 — One version per stage (v1–v7)

- **Status:** Accepted (2026-11-21)
- **Decision:** v1 landing → v2 API+DB → v3 form+Telegram → v4 admin → v5 scripted chat →
  v6 AI chat → v7 prepayment. Each version is planned, implemented and deployed separately.
- **Consequences:** Plans for v2+ are written just before each version starts.

## ADR-003 — Hosting on Cloudflare; stack Nuxt + Express + D1

- **Status:** Accepted (2026-11-21)
- **Context:** Initial preference was FastAPI + Postgres. On Cloudflare that means either
  Python Workers (FastAPI supported, but sync-only SQLAlchemy, newer runtime) plus an external
  Postgres via Hyperdrive, or Cloudflare Containers (Workers Paid plan, $5/month).
- **Decision:** Nuxt for the web app, Express (on Workers, `nodejs_compat`) for the API,
  D1 for the database. Everything on Cloudflare, `*.workers.dev` domain.
- **Consequences:** No external DB provider, free tier is enough. D1 has no interactive
  transactions (see `architecture.md`).

## ADR-004 — Static site generation for the web app

- **Status:** Accepted (2026-11-21)
- **Decision:** `nuxt generate`; the site is served as static assets. Later versions call
  the API from the browser.
- **Consequences:** No server-side rendering at request time. Anything dynamic happens
  client-side or in the API.

## ADR-005 — Documentation before implementation

- **Status:** Accepted (2026-11-21)
- **Decision:** `docs/` is updated and the version plan approved before code is written.
  Deviations from an approved plan go back through plan revision.

## ADR-006 — Three languages, English at the root, remembered choice

- **Status:** Accepted (2026-11-21); revised 2026-11-21 (v1 plan, revision R1, approved)
- **Original decision:** strategy `prefix` with browser detection and redirect on `/`.
  Rejected after step 2.6: on a static host `/` has no page and answers HTTP 404 before a
  client-side redirect.
- **Decision:** `@nuxtjs/i18n`, locales `en` (default), `ru`, `uk`; strategy
  `prefix_except_default` (`/` = English, `/ru`, `/uk`); no browser-language detection.
  The language chosen with the switcher is saved in `localStorage`; on app start, only on the
  English (unprefixed) URL, the app switches to the saved language. Direct `/ru` / `/uk` links
  are never overridden.
- **Consequences:** All pages answer HTTP 200 without redirects. Returning RU/UK visitors briefly
  see the English page before the switch (accepted). All UI text and content must exist in
  three languages.

## ADR-007 — Map: Leaflet + OpenStreetMap

- **Status:** Accepted (2026-11-21)
- **Decision:** `@nuxtjs/leaflet` with OpenStreetMap standard tiles, client-only rendering.
- **Consequences:** No API keys. OSM attribution must be visible. The standard OSM tile
  server is acceptable for a low-traffic demo under its usage policy.

## ADR-008 — Styling: Tailwind CSS v4, own components

- **Status:** Accepted (2026-11-21)
- **Decision:** Tailwind CSS v4 via `@tailwindcss/vite`; no UI component library.

## ADR-009 — Monorepo with pnpm workspaces; public GitHub repo

- **Status:** Accepted (2026-11-21)
- **Decision:** `apps/web`, later `apps/api`; pnpm workspaces. The repository is published
  publicly on GitHub at the end of v1.

## ADR-010 — Booking CTA present from v1

- **Status:** Accepted (2026-11-21)
- **Decision:** v1 has a "Book a table" button leading to a "Booking coming soon" section,
  so the page structure is final from the start.

## ADR-011 — Time slots + unique key against double booking

- **Status:** Accepted (2026-11-21, v2 plan)
- **Context:** D1 has no interactive transactions, so "read, check, then write" in separate
  statements races. Atomicity is available through single statements and `batch()`, which D1
  documents as a SQL transaction that rolls back entirely when one statement fails.
- **Decision:** Reservations start on a 30-minute grid and last 90 minutes (3 slots). Each
  reservation writes its cells to `reservation_slots` with `PRIMARY KEY (table_id, slot)`; the
  reservation row and its cells are inserted in one `batch()`.
- **Alternatives rejected:** conditional `INSERT … WHERE NOT EXISTS (overlap)` — allows free
  start times, but correctness rests on the query, not on a constraint; a Durable Object per
  day as a lock — a second storage and concept for a problem the unique key already solves.
- **Consequences:** The database itself makes double booking impossible. Free start times
  and variable durations would need a different design.

## ADR-012 — Automatic table assignment, parties of 1–4

- **Status:** Accepted (2026-11-21, v2 plan)
- **Decision:** 8 tables (T1–T4 × 2 seats, T5–T8 × 4 seats). The guest gives date, time and
  party size; the API picks the smallest free table that fits, then the lowest id. A party of
  1–2 may get a 4-seat table. Larger parties cannot book online; tables are never combined.
- **Consequences:** Interfaces (form, chats) never deal with tables. Table ids are not exposed
  to guests.

## ADR-013 — Guest access by a secret token, stored hashed

- **Status:** Accepted (2026-11-21, v2 plan)
- **Decision:** On creation the API returns a random token (32 bytes, base64url) once; the guest
  views and cancels the reservation with it. Only its SHA-256 hash is stored.
- **Consequences:** No guest accounts. A leaked database does not expose working links. A lost
  token cannot be recovered (the owner can still act in v4).

## ADR-014 — Raw SQL with D1 migrations, no ORM

- **Status:** Accepted (2026-11-21, v2 plan)
- **Decision:** Schema as SQL files applied by `wrangler d1 migrations`; queries with D1
  `prepare/bind/batch`.
- **Consequences:** The double-booking logic is visible in plain SQL (a learning goal). Row
  types are written by hand.

## ADR-015 — Rate limiting and CORS for the public API

- **Status:** Accepted (2026-11-21, v2 plan)
- **Decision:** Workers Rate Limiting binding on `POST /reservations` (10 per 60 s per client IP;
  counters are per Cloudflare location). CORS allows only the live site and `localhost:3000`.
- **Consequences:** Floods of fake bookings are slowed down, not prevented absolutely; CORS
  only restricts browsers. Stronger measures (captcha, phone verification) are out of scope.

## ADR-016 — Automated tests for the API

- **Status:** Accepted (2026-11-21, v2 plan; user request)
- **Context:** The project default is no automated tests. v2 is the first version with real
  logic whose failure is silent (a double booking, a wrong time rule).
- **Decision:** `apps/api` has tests with Vitest and `@cloudflare/vitest-plugin`, running inside
  `workerd` against a local D1 with the real migrations. Tests are written after the code
  (no TDD). Manual verification stays. `apps/web` remains without tests.
- **Consequences:** Time rules take "now" as a parameter so tests are deterministic.
