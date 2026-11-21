# Architecture

Status: **target architecture; v1 implemented** (2026-11-21). Parts are marked with the
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
│   ├── decisions.md
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

## API (v2+)

To be designed in `docs/plans/v2-plan.md`. Known constraints already:

- Express runs on Workers via the `nodejs_compat` flag and `httpServerHandler`
  (official Cloudflare tutorial "Deploy an Express app").
- D1 has **no interactive transactions** (`BEGIN … COMMIT`); atomicity is available only
  through `batch()` and single statements. Double-booking protection must be designed
  around this (unique constraints and/or conditional single-statement inserts).
