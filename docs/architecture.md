# Architecture

Status: **target architecture**. Parts are marked with the version that introduces them.
This file is updated at the end of every version to reflect what actually exists.

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
│   └── plans/      one plan per version
├── package.json
└── pnpm-workspace.yaml
```

## Web (v1)

- Nuxt 4, `nuxt generate` (static site generation), output `.output/public`.
- Deployed as a Cloudflare Worker with static assets only (no Worker script).
- i18n: `@nuxtjs/i18n`, locales `en` (default), `ru`, `uk`, strategy `prefix_except_default`
  (`/`, `/ru`, `/uk`); no browser detection; the chosen language is remembered in
  `localStorage` and restored on the English URL only (ADR-006).
- Styling: Tailwind CSS v4 via `@tailwindcss/vite`, own components.
- Map: Leaflet via `@nuxtjs/leaflet`, OpenStreetMap tiles, rendered client-side only.
- Content (menu, hours, address) comes from a typed data file in the app,
  mirroring `docs/cafe.md`.

## API (v2+)

To be designed in `docs/plans/v2-plan.md`. Known constraints already:

- Express runs on Workers via the `nodejs_compat` flag and `httpServerHandler`
  (official Cloudflare tutorial "Deploy an Express app").
- D1 has **no interactive transactions** (`BEGIN … COMMIT`); atomicity is available only
  through `batch()` and single statements. Double-booking protection must be designed
  around this (unique constraints and/or conditional single-statement inserts).
