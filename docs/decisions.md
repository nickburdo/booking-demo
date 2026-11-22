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

- **Status:** Accepted (2026-11-21); superseded by ADR-017 in v3 (the CTA now leads to the booking form)
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

## ADR-017 — Booking form in the landing page, reservation page by private link

- **Status:** Accepted (2026-11-21, v3 plan)
- **Decision:** The booking form replaces the "coming soon" text in `#booking`. Flow: date
  (native date input, today … +30) and party size → free start times from `GET /availability`
  as buttons → name, phone, comment → submit. After booking the guest gets a confirmation and a
  personal link `/reservation#<token>` (also `/ru`, `/uk`) to view and cancel the reservation.
- **Consequences:** The page stays a one-pager; taken times are never offered. The token lives
  in the URL hash, so the static host never receives it. Supersedes ADR-010.

## ADR-018 — Telegram notifications to the owner

- **Status:** Accepted (2026-11-21, v3 plan)
- **Decision:** A Telegram bot writes to the owner's private chat on every new reservation and
  guest cancellation: full details (date, time, guests, table, name, phone, comment) in
  Ukrainian. Messages are sent in the background (`waitUntil`) without retries; success is
  recorded in `notified_at` / `cancel_notified_at`.
- **Alternatives rejected:** synchronous sending (slow Telegram delays the guest); Cloudflare
  Queues with retries (more moving parts than a demo needs).
- **Consequences:** A Telegram outage never blocks a booking, but its message is lost; the v4
  admin can show reservations whose owner was not notified. Bot token and chat id are Worker
  secrets, never in the repo.
- **Message order (v3 plan, R4.4):** the two messages of one booking are separate background
  tasks. So that a quick cancel never reaches the owner before the "new booking" message, the
  cancel task waits until `notified_at` is set (polling every 500 ms, up to 10 s). If the first
  message failed, the cancel message is sent after the wait anyway. Best effort: the order is
  guaranteed only within that 10 s window.

## ADR-019 — Cloudflare Turnstile on reservation creation

- **Status:** Accepted (2026-11-21, v3 plan)
- **Context:** Each fake booking now also pings the owner in Telegram; the rate limit alone only
  slows a flood.
- **Decision:** `POST /reservations` requires a Turnstile token, verified with `siteverify`
  after body validation. If Turnstile cannot be reached the request is refused
  (`503 VERIFICATION_UNAVAILABLE`, fail closed).
- **Consequences:** The live API no longer accepts bookings from scripts: Turnstile's
  production secret rejects test tokens. `race.mjs` and `curl` create examples run against a
  local API with the test secret. The chats (v5–v6) will need their own answer to bot
  protection.

## ADR-020 — Admin sessions as bearer tokens

- **Status:** Accepted (2026-11-21, v4 plan)
- **Context:** The admin pages (web worker) and the API run on different `*.workers.dev`
  hosts. `workers.dev` is on the Public Suffix List, so they are different sites, and a session
  cookie set by the API would be a third-party cookie that browsers block.
- **Decision:** `POST /admin/login` checks one account (`ADMIN_USERNAME` var, `ADMIN_PASSWORD`
  secret, constant-time comparison, rate-limited) and returns a random token (32 bytes,
  base64url). The browser keeps it in `sessionStorage` and sends `Authorization: Bearer`.
  The API stores only its SHA-256 hash in `admin_sessions` with an 8-hour expiry; logout
  deletes it.
- **Alternatives rejected:** cookies (third-party, see context); a signed stateless token
  (cannot be revoked by logout without extra state); Cloudflare Access (ties the demo to a
  dashboard setup and hides the login flow the demo is meant to show).
- **Consequences:** Closing a browser tab ends the session on that side. A stolen token works
  until it expires or the owner logs out. Same hashing approach as guest tokens (ADR-013).

## ADR-021 — Public admin demo with masked guest data

- **Status:** Accepted (2026-11-21, v4 plan)
- **Context:** The project is a portfolio piece; visitors should be able to try the admin. The
  live site also takes bookings from real visitors, whose names and phones must not be shown
  to everyone.
- **Decision:** The demo credentials are printed on the login page. The admin API always
  masks guest names (`Olena K.`) and phones (`+380 67 *** ** 67`); full details go only to the
  owner's Telegram. Admin actions send no Telegram messages. A "demo reservations" endpoint
  creates up to 6 made-up reservations (phones `+380 00 …`, flagged `is_demo`) through the
  normal booking code, refused once 20 active demo reservations exist.
- **Consequences:** Anyone can confirm, cancel or mark reservations, including real ones; this
  is accepted for a demo. Closing the demo later means changing `ADMIN_PASSWORD` and removing
  the hint from the page; showing full data to a real owner would need a second role.

## ADR-022 — Reservation status model and transitions

- **Status:** Accepted (2026-11-21, v4 plan)
- **Decision:** Statuses `pending`, `confirmed`, `cancelled`, `no_show`. `pending` and
  `confirmed` hold their table slots; `cancelled` and `no_show` are final and free them.
  Allowed: confirm (`pending`, before start), cancel by the owner or the guest (`pending` /
  `confirmed`, before start, owner may add a reason), no-show (`pending` / `confirmed`, after
  start). Each transition is one `UPDATE … WHERE status IN (…)` in the same `batch()` as the
  slot release, so concurrent actions cannot both succeed. `cancelled_by` records who cancelled.
- **Alternatives rejected:** undoing a no-show (would have to re-take slots that may already be
  booked again); a separate `completed` status (nothing in the demo depends on it).
- **Consequences:** The `CHECK` constraint on `reservations.status` changes, which in SQLite
  means rebuilding the table (migration `0004`). Interfaces only show actions the API allows;
  the API stays the authority.

## ADR-023 — Scripted chat as a server-side state machine over the same services

- **Status:** Accepted (2026-11-22, v5 plan)
- **Context:** The roadmap adds booking interfaces one by one: form (v3), scripted chat (v5),
  AI chat (v6). The anti-goal is an interface that books around the validated backend.
- **Decision:** The chat dialogue runs on the server as an explicit state machine in
  `apps/api/src/chat/`, separate from HTTP and storage. It calls the same booking services as
  the form (`getAvailability`, `createReservation`, `getReservation`, `cancelByToken`). Each
  response is a "bot turn": messages written by the server in the guest's language plus the
  input it expects (choices, a text field, or none). The widget only renders turns.
- **Alternatives rejected:** a state machine in the browser calling the public endpoints
  (simpler now, but v6 needs the dialogue on the server for the AI key, and texts would be
  split); free-text rules (many "did not understand" replies — the problem v6 solves).
- **Consequences:** v6 adds an AI engine **next to** the scripted one (v5 plan, R1: the widget
  has "Scripted | AI" tabs, so both chats can be compared); the AI returns the same turn shape
  and calls the same services as tools. Chat texts live in the API, not in the site's locale files.
  The Turnstile check at the start of a conversation covers bookings made in it.

## ADR-024 — Chat conversations: storage, privacy and limits

- **Status:** Accepted (2026-11-22, v5 plan)
- **Decision:** Conversations are stored (`chat_sessions`, `chat_messages`) and shown in the
  admin. Guest answers that are personal (`name`, `phone`) are marked when saved and masked
  when shown (ADR-021); other text is shown as written. Reservation tokens are never stored in a
  conversation: links are saved as `…/reservation#••••` (ADR-013; v5 plan, R2.1). Conversations are deleted after 7 days
  (clean-up when a new conversation starts, no cron). A conversation needs Turnstile once at the
  start; then 30 messages per minute per IP, 60 guest messages per conversation, and one
  "pass to a person" Telegram message to the owner per conversation.
- **Consequences:** The public demo admin shows what guests wrote in free text (questions,
  comments); the widget says so before the first question. Limits keep a verified browser from
  flooding the owner's Telegram.

## ADR-025 — Café data in a shared workspace package

- **Status:** Accepted (2026-11-22, v5 plan)
- **Context:** The chat on the server answers about hours, address and menu, which so far lived
  only in the site (`apps/web/app/data/cafe.ts`); opening hours were also duplicated in the
  API's `config.ts`.
- **Decision:** A workspace package `packages/cafe-data` (TypeScript source, no build step)
  holds the café content in three languages. The site and the API import it; the API derives
  its booking hours from it. `docs/cafe.md` stays the source of truth for the content.
- **Consequences:** One place to change café content in code. Both bundlers (Vite for Nuxt,
  esbuild for Wrangler) compile the package from source.

