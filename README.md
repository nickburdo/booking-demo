# Linden Coffee — booking demo

A demo website for a fictional coffee shop in Kyiv, built step by step to learn how
online table booking (and, later, online purchase) works end to end.
The coffee shop is invented; the booking mechanics are the real subject.

**Live:** https://booking-demo-web.nick-burdo.workers.dev  
**API:** https://booking-demo-api.nick-burdo.workers.dev ([docs](docs/api.md))  
**Source:** https://github.com/nickburdo/booking-demo

## Status

v1 is live: a one-page landing with menu, opening hours, map and a booking section, in
English, Russian and Ukrainian.

v2 is live: the booking API — availability, create, view and cancel reservations, with
double booking prevented by the database itself (see [How double booking is prevented](docs/api.md#how-double-booking-is-prevented)).

v3 is live: the booking form on the site (date and guests → free times → contacts), a
private reservation page to view or cancel a booking, Telegram messages to the owner about
new and cancelled bookings, and a Cloudflare Turnstile bot check on booking.

v4 is live: an admin area at [/admin](https://booking-demo-web.nick-burdo.workers.dev/admin/login)
where the café sees reservations day by day and confirms, cancels (with an optional reason
for the guest) or marks a no-show. The guest's reservation page shows what the café did.
**Try it:** the admin is a public demo — username `demo`, password `linden-demo` (also shown
on the login page). Guest names and phones are partly hidden there, and a button adds
made-up demo reservations.

v5 is live: a **chat** on the landing page ("Chat with us" in the corner). It is scripted — no
AI — and runs on the server: it books a table, finds a booking from its link (and cancels it),
answers about hours, address and menu, and passes a question to the café. It uses the same
booking rules as the form. Conversations are shown in the admin ("Chats" tab), with names and
phones hidden.

v6 is live: the chat's second tab, **AI**, is an AI chat next to the scripted one, so the two can
be compared. The guest writes in their own words; an open model on **Cloudflare Workers AI**
(`gpt-oss-120b`, free daily quota) understands the request and uses tools that call the same
booking services: it books, finds and cancels a booking from its link, answers about hours,
address and menu, and passes a question to the café. **The AI only proposes** — nothing happens
until the guest presses Confirm on a summary the server writes. AI conversations are shown in the
admin next to the scripted ones, with a filter.

v7 is live: **pre-order with prepayment**. After the café confirms a booking, the guest can pick
dishes on the private reservation page and pay online with **20% off**, on **Stripe Checkout in
test mode** (test card `4242 4242 4242 4242`, no real money). The API takes the prices from the
menu, learns about the payment from Stripe's signed webhook and from a check when the guest returns,
and refunds automatically when the guest cancels. A paid booking cannot be cancelled by the café;
a no-show keeps the payment. The owner gets Telegram messages about payments and refunds.

## Demo limitations

This is a demo, so some things a real booking service would do are left out on purpose:

| In this demo | In a real project |
|---|---|
| The guest gets **no message** when the café confirms or cancels; the status is shown on the reservation page (open the link again) | An SMS or e-mail, or a Telegram bot the guest starts from a link in the confirmation (a bot cannot write to a `@username` on its own) |
| A booking can be found **only by its private link** | A guest account, or a lookup by phone confirmed with an SMS code — a lookup by phone alone would show other people's bookings |
| The **admin is open to everyone** (demo login) and shows guest data masked; anyone can confirm or cancel | A private login for the staff only, who see full guest details |
| **Telegram messages go only to the owner** (new and cancelled bookings), not for admin actions | Messages for the staff on every change, and to guests if they opted in |
| The chat's **"ask a person"** sends the question to the owner's Telegram, but **nobody calls back** | A real hand-off: staff answer in the chat or call the guest |
| **Chat conversations are visible in the public admin** (names and phones hidden) and deleted after 7 days | Only staff see them; retention follows a privacy policy |
| The **AI chat runs on a free daily quota** shared by all visitors; when it is used up, the AI tab says so until 00:00 UTC (the scripted tab keeps working) | A paid plan sized to real traffic |
| The AI is an **open model and can be wrong** (a demo notice says so); it only proposes, the guest confirms | A stronger model, evaluation on real conversations, and human review |
| In AI conversations **phones are masked in the admin, but a name written in free text may be shown**; the notice asks for no extra personal data | Only staff see conversations |
| **Payments are Stripe test mode only**: test cards, no real money; the test account is registered in Germany, so the charge is in **euros at a fixed demo rate** (1 € = 50 ₴) while the menu stays in hryvnias | A payment provider for the café's own country and currency, a live account, fiscal receipts |
| A pre-order exists **only with payment**, a paid one **cannot be changed**, refunds are always full | Unpaid pre-orders, changes with extra payments or partial refunds, cancellation fees |
| Stripe's page shows the café's name, but the **browser tab shows the sandbox's name** (it cannot be renamed without verifying a business) | A verified account with its own name and branding |

## Roadmap

| Version | Scope | Status |
|---|---|---|
| v1 | Landing: menu, hours, map, EN/RU/UK, responsive, deployed | ✅ Done |
| v2 | API + database: tables, slots, reservations, double-booking protection | ✅ Done |
| v3 | Booking form + Telegram notification to the owner | ✅ Done |
| v4 | Admin: list reservations, confirm/cancel | ✅ Done |
| v5 | Scripted chat (no AI) on the same API | ✅ Done |
| v6 | AI chat calling the same API via tool calls | ✅ Done |
| v7 | Prepayment in a payment provider's test mode | ✅ Done |

## Stack

- **Web:** [Nuxt 4](https://nuxt.com) with static generation, Vue 3, TypeScript
- **Languages:** `@nuxtjs/i18n` — English at `/`, Russian at `/ru`, Ukrainian at `/uk`;
  the chosen language is remembered in the browser
- **Styling:** Tailwind CSS v4, self-hosted fonts (Unbounded, Golos Text via Fontsource)
- **Map:** Leaflet with OpenStreetMap tiles
- **Hosting:** Cloudflare Workers static assets (`*.workers.dev`), deployed with Wrangler
- **API:** Express 5 on Cloudflare Workers (`nodejs_compat`), Cloudflare D1 (SQLite) with raw SQL
  and migrations, zod validation, Workers Rate Limiting
- **Notifications and bot check:** Telegram Bot API, Cloudflare Turnstile
- **AI chat:** Cloudflare Workers AI (`@cf/openai/gpt-oss-120b`) with tool calling, through the `AI` binding
- **Payments:** Stripe Checkout (hosted page) in test mode, the official `stripe` package; signed webhooks
- **Tests (API):** Vitest with `@cloudflare/vitest-plugin`, running inside `workerd` on a local D1
- **Repo:** pnpm workspaces monorepo (`apps/web`, `apps/api`)

## Repository layout

```
apps/
  web/        Nuxt site: landing (v1), booking form and reservation page (v3), admin (v4), chat widget (v5)
  api/        Express booking API on Workers + D1 (v2), Telegram + Turnstile (v3), admin API (v4), chat (v5)
packages/
  cafe-data/  café content (name, address, hours, menu) shared by the site and the API (v5)
docs/
  overview.md       goals and roadmap
  api.md            booking API contract and examples
  architecture.md   components and what exists now
  decisions.md      architecture decision records
  setup-integrations.md  one-time Telegram bot, Turnstile and admin password setup
  design.md         visual design: palette, type, layout
  cafe.md           the fictional coffee shop's content
  plans/            one implementation plan per version
```

## Run locally

Requirements: Node.js 24, pnpm.

Local config (git-ignored files; the templates next to them are committed):

```sh
cp apps/web/.env.example apps/web/.env.local     # site → local API, Turnstile test key
cp apps/api/.dev.vars.example apps/api/.dev.vars  # API → Turnstile test secret
```

They use Cloudflare's Turnstile test keys, so the bot check always passes locally.
Telegram messages from the local API are optional: see section 5 of
[docs/setup-integrations.md](docs/setup-integrations.md).

```sh
pnpm install
pnpm dev          # http://localhost:3000 (reads apps/web/.env.local)
```

Booking API (local D1 in `.wrangler/`):

```sh
cd apps/api
npx wrangler d1 migrations apply booking-demo-db --local   # once, and after new migrations
cd ../..
pnpm dev:api      # http://localhost:8787
pnpm test:api     # Vitest suite
```

Race demo — concurrent bookings of one slot (cancels what it creates). Local API only:
since v3 the live API requires a real Turnstile token.

```sh
node apps/api/scripts/race.mjs
```

Build the static site:

```sh
pnpm generate                          # live config, output: apps/web/.output/public
pnpm --filter web generate:local       # same, with the local values from .env.local
```

## Deploy

Requires a Cloudflare account and `wrangler login` (run once, from `apps/web`).
Before the first deploy, create the Telegram bot and the Turnstile widget and store the API
secrets (`TURNSTILE_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_PASSWORD`):
[docs/setup-integrations.md](docs/setup-integrations.md).

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
