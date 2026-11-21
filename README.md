# Linden Coffee — booking demo

A demo website for a fictional coffee shop in Kyiv, built step by step to learn how
online table booking (and, later, online purchase) works end to end.
The coffee shop is invented; the booking mechanics are the real subject.

**Live:** https://booking-demo-web.nick-burdo.workers.dev  
**API:** https://booking-demo-api.nick-burdo.workers.dev ([docs](docs/api.md))  
**Source:** https://github.com/nickburdo/booking-demo

## Status

v1 is live: a one-page landing with menu, opening hours, map and a "booking coming soon"
section, in English, Russian and Ukrainian.

v2 is live: the booking API — availability, create, view and cancel reservations, with
double booking prevented by the database itself (see [How double booking is prevented](docs/api.md#how-double-booking-is-prevented)).
The booking form on the site arrives in v3.

## Roadmap

| Version | Scope | Status |
|---|---|---|
| v1 | Landing: menu, hours, map, EN/RU/UK, responsive, deployed | ✅ Done |
| v2 | API + database: tables, slots, reservations, double-booking protection | ✅ Done |
| v3 | Booking form + Telegram notification to the owner | Planned |
| v4 | Admin: list reservations, confirm/cancel | Planned |
| v5 | Scripted chat (no AI) on the same API | Planned |
| v6 | AI chat calling the same API via tool calls | Planned |
| v7 | Prepayment in a payment provider's test mode | Planned |

## Stack

- **Web:** [Nuxt 4](https://nuxt.com) with static generation, Vue 3, TypeScript
- **Languages:** `@nuxtjs/i18n` — English at `/`, Russian at `/ru`, Ukrainian at `/uk`;
  the chosen language is remembered in the browser
- **Styling:** Tailwind CSS v4, self-hosted fonts (Unbounded, Golos Text via Fontsource)
- **Map:** Leaflet with OpenStreetMap tiles
- **Hosting:** Cloudflare Workers static assets (`*.workers.dev`), deployed with Wrangler
- **API:** Express 5 on Cloudflare Workers (`nodejs_compat`), Cloudflare D1 (SQLite) with raw SQL
  and migrations, zod validation, Workers Rate Limiting
- **Tests (API):** Vitest with `@cloudflare/vitest-plugin`, running inside `workerd` on a local D1
- **Repo:** pnpm workspaces monorepo (`apps/web`, `apps/api`)

## Repository layout

```
apps/
  web/        Nuxt landing (v1)
  api/        Express booking API on Workers + D1 (v2)
docs/
  overview.md       goals and roadmap
  api.md            booking API contract and examples
  architecture.md   components and what exists now
  decisions.md      architecture decision records
  design.md         visual design: palette, type, layout
  cafe.md           the fictional coffee shop's content
  plans/            one implementation plan per version
```

## Run locally

Requirements: Node.js 24, pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:3000
```

Booking API (local D1 in `.wrangler/`):

```sh
cd apps/api
npx wrangler d1 migrations apply booking-demo-db --local   # once, and after new migrations
cd ../..
pnpm dev:api      # http://localhost:8787
pnpm test:api     # Vitest suite
```

Race demo — concurrent bookings of one slot (cancels what it creates):

```sh
node apps/api/scripts/race.mjs                                    # local API
node apps/api/scripts/race.mjs --base https://booking-demo-api.nick-burdo.workers.dev
```

Build the static site:

```sh
pnpm generate     # output: apps/web/.output/public
```

## Deploy

Requires a Cloudflare account and `wrangler login` (run once, from `apps/web`).

```sh
pnpm deploy       # web: nuxt generate + wrangler deploy
pnpm deploy:api   # API worker
```

API database migrations on Cloudflare (from `apps/api`):

```sh
npx wrangler d1 migrations apply booking-demo-db --remote
```

Hosting rules live in `apps/web/wrangler.jsonc`: unknown paths get the 404 page,
and `/ru/` redirects to `/ru`.

## Credits

- Hero photo: [Kris Atomic](https://unsplash.com/photos/round-brown-wooden-table-with-french-press-on-top-with-white-ceramic-teacup-beside-3b2tADGAWnU) on Unsplash (Unsplash License)
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Fonts: Unbounded and Golos Text (SIL Open Font License)

## License

Code: [MIT](LICENSE). The hero photo stays under the Unsplash License.

Linden Coffee and its address are fictional. Any resemblance to a real place is coincidental.
