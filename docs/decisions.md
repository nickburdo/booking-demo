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

## ADR-006 — Three languages, URL prefix strategy

- **Status:** Accepted (2026-11-21)
- **Decision:** `@nuxtjs/i18n`, locales `en` (default), `ru`, `uk`; strategy `prefix`;
  browser language detection with cookie, redirect on root only (`redirectOn: 'root'`).
- **Consequences:** Every page exists as `/en/…`, `/ru/…`, `/uk/…`. All UI text and content
  must exist in three languages.

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
