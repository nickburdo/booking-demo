# v4 plan — Admin: reservation lifecycle

- **Status:** Approved (2026-11-21) — in progress
- **Scope:** stage v4 of the roadmap (`docs/overview.md`): an admin area on the website where the
  owner sees reservations day by day and confirms, cancels (optionally with a reason) or marks
  "no-show". New statuses `confirmed` and `no_show`. A public **demo login** so that portfolio
  visitors can try the admin, with guest names and phones masked. A button that adds made-up
  demo reservations. The guest reservation page shows the new statuses.
- **Out of scope:** Telegram buttons / webhook (the bot still only notifies); messages to guests
  (e-mail, SMS); several admin users or roles; editing a reservation (time, table, guests);
  undoing a "no-show"; statistics; chats (v5–v6); payments (v7); automated tests for `apps/web`
  (ADR-016).
- **Testing:** API changes get automated tests (ADR-016) plus manual checks. The admin and the
  guest page are checked by hand in a browser (mouse, keyboard, 375/768/1280 px, EN/RU/UK),
  **on the built site** (`generate:local`), not only in dev (lesson of v3 R3). A code review of
  the branch runs before merge.

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | The admin lives on the same Nuxt site under `/admin` (`/ru/admin`, `/uk/admin`); Telegram stays notification-only | user |
| D2 | **Demo login for everyone**: a real login form (username + password) checked by the API; the demo credentials are printed on the login page and a button fills them in. Admin API endpoints answer `401` without a valid session | user |
| D3 | Guest **names and phones are masked** in the admin (e.g. `Olena K.`, `+380 67 *** ** 67`); the API masks them before sending. Full details still reach the owner in Telegram | user |
| D4 | Owner actions: **confirm** (`pending → confirmed`), **cancel** with an **optional reason** (`pending`/`confirmed → cancelled`), **mark no-show** (`pending`/`confirmed → no_show`) | user |
| D5 | "No-show" is possible only **after the reservation's start time** and is final (no undo); it frees the table for the rest of the slot | user |
| D6 | **No Telegram messages for admin actions** (demo visitors would spam the chat); Telegram keeps v3 behaviour: new booking and guest cancellation | user |
| D7 | A guest can cancel a **confirmed** reservation too, until it starts (as for `pending`); the owner gets "❌ Скасовано" in Telegram | user |
| D8 | Admin texts in **EN/RU/UK** with the site's language switcher | user |
| D9 | Day view: date picker (default: today in Kyiv) with previous/next day buttons; the day's reservations sorted by time; filter by status | user |
| D10 | A button **"Add demo reservations"** creates a few made-up reservations for the next days through the normal booking code, without Telegram; limited so that demo data never fills the café | user |
| D11 | Git: plan and docs on `main`; work on `feature/v4-admin` from up-to-date `main`; code review before merge | project rules |

### Proposed technical details (my calls — object if you disagree)

| # | Proposal | Rationale |
|---|---|---|
| P1 | **Session as a bearer token**, not a cookie. `POST /admin/login` returns a random token (32 bytes, base64url, like guest tokens); the web keeps it in `sessionStorage` and sends `Authorization: Bearer <token>`. Only its SHA-256 hash is stored, in a new table `admin_sessions (token_hash, created_at, expires_at)`; lifetime 8 h; `POST /admin/logout` deletes it | Web and API are different `*.workers.dev` hosts; `workers.dev` is on the Public Suffix List, so they are different *sites* and a session cookie would be a third-party cookie that browsers block (to verify in step 2.3, risk R1). Same hashing approach as ADR-013 |
| P2 | Credentials: `ADMIN_USERNAME` (plain var in `wrangler.jsonc`, `demo`) and `ADMIN_PASSWORD` (Worker secret, value printed on the login page as long as the demo is open). Comparison in constant time. Wrong login → `401 INVALID_CREDENTIALS` | One account; closing the demo later = change the secret and remove the hint from the page |
| P3 | Login is rate-limited with a second Workers Rate Limiting binding `LOGIN_LIMITER` (10 / 60 s per IP), like `CREATE_LIMITER` | Basic brute-force protection, same mechanism as v2 |
| P4 | Migration `0004_admin.sql`. SQLite cannot change a `CHECK` constraint, so `reservations` is rebuilt (new table → copy → drop → rename, indexes recreated) with `status IN ('pending','confirmed','cancelled','no_show')` and new columns `confirmed_at`, `no_show_at`, `cancelled_by` (`guest`/`owner`), `cancel_reason`, `is_demo` (0/1). Plus `admin_sessions`. Foreign keys from `reservation_slots` keep working because the table name and ids stay the same | The documented way to change constraints in SQLite; tested against the real migrations (risk R2) |
| P5 | Admin API (all under `/admin`, all need the bearer token except login): `POST /admin/login`, `POST /admin/logout`, `GET /admin/reservations?date=YYYY-MM-DD` (all statuses of that day, with table label, masked name/phone, comment, status, times, `notified`), `POST /admin/reservations/:id/confirm`, `POST /admin/reservations/:id/cancel` (body `{ reason? }`, max 200 chars), `POST /admin/reservations/:id/no-show`, `POST /admin/demo-reservations` | Same Worker, same conventions and error format as `docs/api.md`. Status filter is done in the browser (one day is small) |
| P6 | Transition rules in the API (the web only hides buttons): confirm — `pending`, before start; cancel — `pending`/`confirmed`, before start; no-show — `pending`/`confirmed`, after start; anything else → `409 NOT_ALLOWED` with the current status. Cancel and no-show free the slots in the same `batch()` as the status change (as guest cancel does). Each update has `WHERE status IN (...)`, so two admins clicking at once cannot both win | Keeps the double-booking guard and the "single statement" atomicity of v2 |
| P7 | Guest cancel (`POST /reservations/:token/cancel`) accepts `pending` and `confirmed` before start (D7); sets `cancelled_by = 'guest'` | D7 |
| P8 | Guest reservation object gains: status `confirmed` / `no_show`; `cancelledBy` (`guest`/`owner`) and `cancelReason` when cancelled by the café. The page shows "Confirmed", "Cancelled by the café: <reason>", "Marked as no-show" | Guests see owner actions without e-mail |
| P9 | Masking (D3) in one API function: name → first word + initial of the second (`Olena K.`); phone → country/operator code and last two digits visible (`+380 67 *** ** 67`). The admin API never returns full values while the demo is open (no separate owner role, per the user's choice) | One place to change when the demo is closed |
| P10 | Demo reservations (D10): each click creates up to 6 reservations spread over the next 3 days at free times, with made-up Ukrainian names and phones `+380 00 …` (not a real operator), `is_demo = 1`, through `createReservation` (same slot guard), **no Telegram**. Refused with `409 DEMO_LIMIT` when 20 or more active demo reservations already exist. Rate-limited by the same `LOGIN_LIMITER` (P3) | Fills the admin for visitors without taking all tables (8 tables × 24 slots a day) |
| P11 | Web: `pages/admin/index.vue` (day view) and `pages/admin/login.vue`, client-only data; a small `useAdminApi` composable (adds the bearer header, on `401` goes to login). `noindex`. Link to the admin: in the footer ("Admin demo") — not in the main navigation | Admin is a demo feature, not part of the café's public menu |
| P12 | Admin look follows `docs/design.md` tokens (milk background, espresso text, linden for "confirmed", cobalt buttons); a static mockup of the login and the day view is approved before building (step 3.1), then `docs/design.md` gets an admin section | The look is the user's decision, as in v1/v3 |
| P13 | Docs: `docs/api.md` (statuses, admin endpoints, errors), ADR-020 (admin auth: bearer sessions), ADR-021 (demo mode: public login, masking, demo data), ADR-022 (status model and transitions), `docs/architecture.md` | Docs before code (ADR-005) |

## Known risks

- **R1 — cross-site session.** If `workers.dev` were *not* treated as a public suffix, a cookie
  would also be possible; the bearer token works in both cases, so this only confirms P1. Checked
  in step 2.3 against the Public Suffix List; no change expected.
- **R2 — rebuilding `reservations` in D1.** `PRAGMA foreign_keys` and table rename behaviour in
  D1 migrations must keep `reservation_slots` valid. Checked in step 2.1 locally and with a test
  against the real migrations; the remote migration runs only after that (5.1). If it fails →
  stop, plan revision.
- **R3 — `sessionStorage` + prerendered admin pages.** The admin pages are prerendered shells;
  data and session are read in the browser after hydration (`onNuxtReady`, v3 R3 lesson).
  Checked on the built site in Phase 4.
- **R4 — public demo abuse.** Anyone can cancel or mark reservations. Accepted for a demo (D2);
  real guests' data stays masked (D3); demo data can be re-added (D10).

## Phase 0 — Documentation (on `main`, before code; ADR-005)

### 0.1 This plan approved.
### 0.2 `docs/api.md`: statuses and transitions, guest object fields (P8), admin section (P5, P6),
  new errors (`401 UNAUTHORIZED`, `401 INVALID_CREDENTIALS`, `409 NOT_ALLOWED`, `409 DEMO_LIMIT`).
### 0.3 `docs/decisions.md`: ADR-020, ADR-021, ADR-022.
### 0.4 `docs/architecture.md`: "v4 — planned" section.
- **Done when:** docs committed on `main` (ask first).

## Phase 1 — Setup

### 1.1 Branch `feature/v4-admin` from up-to-date `main` (warn first if a dev server runs).
### 1.2 `ADMIN_PASSWORD`: local value in `apps/api/.dev.vars` (+ `.dev.vars.example`); the
  production value is set by the user with `wrangler secret put ADMIN_PASSWORD` (instructions
  added to `docs/setup-integrations.md`). Because it is a demo password, it may be shared in the
  chat and on the page.
### 1.3 `wrangler.jsonc`: `ADMIN_USERNAME` var, `LOGIN_LIMITER` binding; regenerate types.
- **Done when:** local API starts with them.

## Phase 2 — API

### 2.1 Migration 0004 (P4, R2)
- Rebuild `reservations` with the new `CHECK` and columns; `admin_sessions`.
- **Done when:** applies locally on a copy with existing rows; existing tests green.

### 2.2 Status model in code
- Types, DTO (P8), availability/slot logic unchanged for `pending`/`confirmed` (both hold slots).
- **Done when:** typecheck green.

### 2.3 Auth (P1–P3)
- Login / logout / `requireAdmin` middleware; R1 check.
- **Done when:** tests: wrong password → 401, rate limit → 429, valid → token; protected route
  without / with expired / with valid token.

### 2.4 Admin list (P5, P9)
- `GET /admin/reservations?date=` with masking.
- **Done when:** tests: one day only, all statuses, masked fields, table label, `notified`.

### 2.5 Owner actions (P6)
- confirm / cancel (reason) / no-show, slots freed for cancel and no-show.
- **Done when:** tests for every allowed and refused transition; time rules (before / after
  start); freed slot can be booked again; concurrent confirm + cancel → one wins.

### 2.6 Guest side (P7, P8)
- Guest cancel of `confirmed`; DTO fields; Telegram unchanged (D6).
- **Done when:** tests: guest cancels confirmed → Telegram called; owner actions → no Telegram.

### 2.7 Demo reservations (P10)
- **Done when:** tests: creates ≤ 6, `is_demo`, no Telegram, `DEMO_LIMIT` at 20.

### 2.8 Full suite + typecheck green.

## Phase 3 — Web

### 3.1 Mockup (P12): login page and day view (desktop + 375 px), approved by the user; then
  `docs/design.md` admin section.
### 3.2 `useAdminApi` + session handling (P11, R3).
### 3.3 Login page (demo hint + "Fill in" button; errors: wrong credentials, rate limited, network).
### 3.4 Day view: date picker + prev/next, status filter, reservation cards with masked data,
  status pill, actions by rules (P6) with a confirm step; cancel dialog with optional reason;
  "Add demo reservations"; logout; empty and error states.
### 3.5 Guest reservation page: new statuses and the café's cancel reason (P8); cancel button
  also for `confirmed`.
### 3.6 i18n EN/RU/UK for all new texts; footer link "Admin demo".
- **Done when:** works locally against the local API.

## Phase 4 — Manual verification (built site, `generate:local` + local API)

### 4.1 Responsive: 375 / 768 / 1280 × EN/RU/UK — login, day view, guest page.
### 4.2 Keyboard and states: login errors, 401 → back to login, every action and refusal (forced
  where needed), empty day, API down.
### 4.3 Full lifecycle with a **real token on the built site**: guest books → admin confirms →
  guest page shows "Confirmed" → guest cancels → Telegram "❌"; second booking → admin cancels
  with a reason → guest page shows it; no-show after start (time pinned locally if needed).
### 4.4 Demo data button and its limit.
- **Done when:** all pass; issues fixed within scope or raised.

## Phase 5 — Deploy (ask before each)

### 5.1 Remote migration 0004 (backup first: `wrangler d1 export`).
### 5.2 `ADMIN_PASSWORD` secret set by the user; deploy API.
### 5.3 Deploy web (`pnpm run generate` checked for local values, then `wrangler deploy`).
### 5.4 Live check: demo login, add demo reservations, confirm / cancel / no-show, guest page
  reflects owner actions, logout.

## Phase 6 — Review and wrap-up

### 6.1 Code review of `main...feature/v4-admin`; fixes via plan revision.
### 6.2 README (status, admin demo credentials, setup), `docs/architecture.md` (v4 implemented,
  learned), this plan → Done.
### 6.3 Merge into `main`, push (ask first, separate commands); delete the branch.

## Revision R1 (2026-11-22) — demo limitations made visible (approved)

**Trigger:** in 5.4 the user checked the guest side live and found that a guest gets no
feedback when the café confirms or cancels, and cannot find a booking without the link. Guest
notifications and booking lookup were discussed and **not** built: with a public admin, any
visitor could trigger messages to real guests, a bot cannot write to a `@username`, and a lookup
by phone alone would expose other people's bookings. Instead the demo states its limits.
Also found in 5.4: demo reservations show "⚠ Telegram not delivered", although they never
notify by design (ADR-021).

**Decision (user):**
- R1.1 `AdminReservationRow.vue`: no "Telegram not delivered" warning on demo reservations.
- R1.2 A one-line demo note (EN/RU/UK) in the booking confirmation and on the reservation page
  while the booking is waiting: a real café would send an SMS or messenger message; here the
  guest opens the link again to see the status.
- R1.3 README section "Demo limitations" (done in 6.2): no guest notifications, lookup only by
  link, open admin with masked data, Telegram only for the owner — each with how a real project
  solves it.

**Done when:** R1.1–R1.2 checked on the built site; R1.3 in the README.
