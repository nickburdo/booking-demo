# v2 plan — Booking API and database

- **Status:** Done (2026-11-21) — API live at https://booking-demo-api.nick-burdo.workers.dev;
  64 automated tests green; revision R1 (code review fixes) implemented and redeployed.
  Notes at the end of this file.
- **Scope:** stage v2 of the roadmap (`docs/overview.md`): `apps/api` — Express on Cloudflare
  Workers with a D1 database: tables, time slots, reservations, double-booking protection;
  public guest endpoints (availability, create, view, cancel); deployed to `*.workers.dev`.
- **Out of scope:** any UI (the booking form is v3), Telegram notifications (v3), owner/admin
  endpoints, `confirmed` status and owner cancellation (v4), chats (v5–v6), payments (v7),
  e-mail, parties larger than 4, combining tables, shared code package between `web` and `api`.
- **Testing:** automated tests for `apps/api` (user request, 2026-11-21 — exception to the
  global "no tests" rule for this version), **plus** manual verification in each step under
  "Done when". Tests are written after the code of each phase (no TDD). The race script
  (step 6.2) is a demo against a real deployment, separate from the test suite.

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | Express on Workers (`nodejs_compat`, `httpServerHandler` from `cloudflare:node`, bindings via `import { env } from "cloudflare:workers"`), D1 database | ADR-003; checked against the Cloudflare tutorial "Deploy an Express app" |
| D2 | **Fixed 30-minute slots.** A reservation always lasts 90 min = 3 consecutive slots | user |
| D3 | **Double-booking protection:** table `reservation_slots` with `PRIMARY KEY (table_id, slot)`; a reservation row and its 3 slot rows are inserted in one `DB.batch()`. D1 docs: "Batched statements are SQL transactions… If a statement in the sequence fails… it aborts or rolls back the entire sequence" → an occupied slot makes the whole booking fail atomically | user (approach), D1 docs |
| D4 | **Table is assigned automatically:** the guest gives date, time and number of guests; the API picks the smallest free table that fits (then lowest id) | user |
| D5 | **Layout:** 8 tables, 24 seats — T1–T4 for 2 guests, T5–T8 for 4 guests. Parties of 1–4 only. A party of 1–2 may get a 4-seat table if all 2-seat tables are taken | user (layout); fallback to larger table — my proposal |
| D6 | **Time rules (Europe/Kyiv wall clock):** start times from opening to closing − 90 min (Mon–Fri 08:00–19:30, Sat–Sun 09:00–20:30); start ≥ now + 1 h; date ≤ today + 30 days | user |
| D7 | **Guest data:** name (required), phone (required, normalised to E.164: `+` and 8–15 digits; local `0XXXXXXXXX` → `+380XXXXXXXXX`, see O1), comment (optional) | user |
| D8 | **Guest actions:** create; view and cancel via a secret token returned on creation. Cancellation frees the slots | user |
| D9 | **Statuses:** new reservations are `pending` and hold their slots. v2 transitions: `pending → cancelled` (by guest). v4 adds `confirmed` and owner actions | user |
| D10 | **DB access:** raw SQL with D1 `prepare/bind/batch`; schema via `wrangler d1 migrations` (SQL files) | user |
| D11 | **Abuse protection:** Workers Rate Limiting binding on `POST /reservations`, key = client IP (`CF-Connecting-IP`); CORS allows only the live site origin and `http://localhost:3000` | user; Rate Limiting docs (`simple`, period 10 or 60 s, per-location counters) |
| D12 | **Demo of v2:** `docs/api.md` with `curl` examples against the live API + a race script that fires concurrent bookings at one slot | user |
| D13 | Worker `booking-demo-api`, D1 database `booking-demo-db`, URL `https://booking-demo-api.nick-burdo.workers.dev` | my proposal (mirrors v1 D8) |
| D14 | Git: this plan and docs committed on `main`; v2 work on branch `feature/v2-api` from up-to-date `main` | v1 D11 pattern |
| D15 | **Automated tests + manual checks.** Vitest ≥ 4.1 with `@cloudflare/vitest-plugin`: tests run inside `workerd`; D1 migrations applied via `readD1Migrations`/`applyD1Migrations`; HTTP tests via `exports.default.fetch()` from `cloudflare:workers`; storage isolated per test file | user; Cloudflare "Vitest integration" docs |

### Proposed technical details (my calls — object if you disagree)

| # | Proposal | Rationale |
|---|---|---|
| P1 | TypeScript; request validation with `zod` | Typed input boundary; small, common, Workers-compatible |
| P2 | CORS via the `cors` Express middleware | Standard for Express; no hand-rolled header logic |
| P3 | Times stored as Kyiv-local strings: `date` `YYYY-MM-DD`, `start_time` `HH:MM`, slot `YYYY-MM-DDTHH:MM` | The cafe works on the local wall clock; DST switches happen at night, outside opening hours; no UTC conversion bugs in slot keys. "Now" is computed with `Intl.DateTimeFormat(…, { timeZone: "Europe/Kyiv" })` |
| P4 | Token: 32 random bytes, base64url, returned once; only its SHA-256 hash is stored | A leaked DB does not expose working cancel links; costs one `crypto.subtle` call |
| P5 | Reservation id: `crypto.randomUUID()`; table id is **not** exposed to guests | Guests do not choose tables (D4) |
| P6 | Errors as JSON `{ "error": { "code": "SLOT_TAKEN", "message": "…" } }`; `code` is stable and English; translation is the client's job (v3) | One format for form and chats |
| P7 | Rate limit: 10 requests / 60 s per IP for `POST /reservations` | Enough for one race-script run (8 requests), stops floods |
| P8 | Opening hours and table rules live in an API config module (`src/config.ts`), mirroring `docs/cafe.md` (like `apps/web/app/data/cafe.ts`) | No shared package yet (out of scope); `docs/cafe.md` stays the source of truth |
| P9 | Cancellation allowed while status is `pending` and the start time is in the future | Cancelling a past visit makes no sense |
| P10 | Time-rule functions take `now` as a parameter; services get it from one `clock()` function | Tests can check lead time / horizon / "today" deterministically without depending on when they run |
| P11 | Test scope: unit — `time.ts`, `validation.ts` (incl. phone normalisation), `token.ts`; integration over HTTP — every endpoint, every documented error code, CORS, table fallback, cancel → re-book, and a concurrency test (8 parallel creates → exactly 4 × `201`) | Covers the booking rules and the double-booking guarantee, which are what v2 is about |

### Resolved questions

- **O1 — local phone format (resolved by user, 2026-11-21).** A 10-digit number starting with
  `0` (typical Ukrainian local input, e.g. `0671234567`) is normalised to `+380671234567`.
  Any other input without a leading `+` is rejected. Spaces, dashes and brackets are stripped
  before the check.

### Known risks

- **R-T1 — Express inside the Vitest integration.** The docs show `exports.default.fetch()` for
  Workers in general; Express via `httpServerHandler` is not shown in the testing docs. Step 1.7
  checks it first with a smoke test. If it does not work → stop, plan revision (no improvised
  workaround).
- **R-T2 — rate limiter in tests.** Not confirmed that the `ratelimits` binding is simulated by
  the test runtime. Step 4.10 checks it; if not supported, the 429 case stays manual only
  (step 4.7) — to be confirmed with the user at that point.
- **R-T3 — what the concurrency test proves.** Locally, D1 is a single SQLite file, so the test
  proves the constraint + retry logic, not behaviour under real distributed load. The live race
  script (6.2) covers the deployed case.

## Design

### Approaches considered (double-booking protection on D1)

D1 has no interactive transactions, so "read, check, then write" in separate statements races.

1. **Slot cells + unique key (chosen).** Each reservation occupies 3 rows `(table_id, slot)`
   under a primary key; the database itself rejects the second booking. Atomic via `batch()`.
   Simple, easy to show, correctness enforced by a constraint.
2. **Conditional insert.** One `INSERT … SELECT … WHERE NOT EXISTS (overlapping interval)`.
   Allows arbitrary start times and durations, but correctness rests on the query being right,
   not on a constraint. Rejected: free start times were not wanted (D2).
3. **Durable Object as a per-day lock.** Serialises bookings in one object. Strong, but adds a
   second storage and concept for a problem the unique key already solves. Rejected.

### Data model (`migrations/0001_init.sql`)

```sql
CREATE TABLE tables (
  id    INTEGER PRIMARY KEY,
  label TEXT    NOT NULL UNIQUE,          -- "T1".."T8"
  seats INTEGER NOT NULL CHECK (seats > 0)
);

CREATE TABLE reservations (
  id           TEXT PRIMARY KEY,          -- UUID
  table_id     INTEGER NOT NULL REFERENCES tables(id),
  date         TEXT NOT NULL,             -- YYYY-MM-DD, Kyiv
  start_time   TEXT NOT NULL,             -- HH:MM, Kyiv
  guests       INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 4),
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,             -- E.164
  comment      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'cancelled')),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,             -- ISO 8601 UTC
  cancelled_at TEXT
);

CREATE TABLE reservation_slots (
  table_id       INTEGER NOT NULL REFERENCES tables(id),
  slot           TEXT NOT NULL,           -- YYYY-MM-DDTHH:MM, Kyiv
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  PRIMARY KEY (table_id, slot)
);

CREATE INDEX reservation_slots_by_reservation ON reservation_slots(reservation_id);
```

Seed (`migrations/0002_seed_tables.sql`): T1–T4 with 2 seats, T5–T8 with 4 seats.
The `status` CHECK is widened in v4 with a new migration.

### Booking algorithm (`POST /reservations`)

1. Validate body (zod), normalise phone.
2. Check time rules (D6): valid start time on the 30-min grid within opening hours for that
   weekday, ≥ now + 1 h, ≤ today + 30 days.
3. Compute the 3 slot keys.
4. Read tables with `seats ≥ guests` that have none of those slots taken, ordered by
   `seats, id`.
5. For each candidate: `DB.batch([INSERT reservation, INSERT slot ×3])`.
   - success → `201` with reservation and token;
   - primary-key conflict (lost a race) → try the next candidate.
6. No candidate left → `409 SLOT_TAKEN`.

### Cancellation (`POST /reservations/:token/cancel`)

`DB.batch([UPDATE reservations SET status='cancelled', cancelled_at=… WHERE id=? AND status='pending', DELETE FROM reservation_slots WHERE reservation_id=?])`.

### API contract (full version goes into `docs/api.md`)

| Method & path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /health` | Liveness | `200 {ok:true}` | — |
| `GET /availability?date=YYYY-MM-DD&guests=N` | Start times bookable for that party on that date | `200 {date, guests, times:["08:00",…]}` | `400 VALIDATION`, `400 DATE_OUT_OF_RANGE` |
| `POST /reservations` body `{date, time, guests, name, phone, comment?}` | Create | `201 {reservation:{id,date,time,endTime,guests,name,phone,comment,status}, token}` | `400 VALIDATION`, `400 TIME_NOT_BOOKABLE`, `409 SLOT_TAKEN`, `429 RATE_LIMITED` |
| `GET /reservations/:token` | View own reservation | `200 {reservation}` | `404 NOT_FOUND` |
| `POST /reservations/:token/cancel` | Cancel | `200 {reservation}` (status `cancelled`) | `404 NOT_FOUND`, `409 NOT_CANCELLABLE` |

Unknown routes → `404 NOT_FOUND`; unexpected errors → `500 INTERNAL` (no stack traces in responses).

## Phase 0 — Documentation (on `main`, before code; ADR-005)

### 0.1 `docs/cafe.md` — tables and booking rules
- Add "Tables" (T1–T4 × 2 seats, T5–T8 × 4 seats) and "Booking rules" (D2, D5, D6, D9) sections;
  replace the "~24 seats… defined in the v2 plan" note.
- **Done when:** section content matches this plan.

### 0.2 `docs/api.md` — API contract
- New file: base URL, conventions (JSON, error format, CORS, rate limit), every endpoint from the
  contract table with request/response examples and error codes; status lifecycle.
- **Done when:** a reader can call every endpoint from it alone.

### 0.3 `docs/decisions.md` — new ADRs
- ADR-011 Slot model + unique key for double-booking protection (D2, D3, alternatives).
- ADR-012 Automatic table assignment, parties 1–4 (D4, D5).
- ADR-013 Guest access by secret token, hashed (D8, P4).
- ADR-014 Raw SQL + D1 migrations (D10).
- ADR-015 Rate limiting + CORS (D11).
- ADR-016 Automated tests for the API with the Workers Vitest integration (D15) — scoped to
  `apps/api`; the web app stays without tests.
- **Done when:** ADRs written with status Accepted.

### 0.4 `docs/architecture.md` — API section
- Replace "To be designed in v2-plan" with the target API design (layout of `apps/api`, data
  model, booking algorithm summary), marked "v2 — planned".
- **Done when:** section matches this plan.

### 0.5 Commit docs on `main`
- Commit this plan and steps 0.1–0.4 on `main` (ask first).
- **Done when:** committed.

## Phase 1 — Project setup

### 1.1 Branch
- Create `feature/v2-api` from up-to-date `main`. Warn first if a dev server is running.
- **Done when:** on the new branch.

### 1.2 Scaffold `apps/api`
- `package.json` (name `api`, `type: module`), `tsconfig.json`, `src/index.ts` with the Express
  health endpoint exported via `httpServerHandler`. Dependencies: `express`, `zod`, `cors`;
  dev: `wrangler`, `typescript`, `@types/express`, `@types/cors`. Exact versions checked at install.
- **Done when:** `pnpm install` succeeds; workspace sees `apps/api`.

### 1.3 Wrangler config (without D1 yet)
- `apps/api/wrangler.jsonc`: `name: "booking-demo-api"`, `main: "src/index.ts"`, current
  `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`.
- **Done when:** `wrangler dev` serves `GET /health` → `200 {ok:true}`.

### 1.4 Root scripts
- Root `package.json`: `dev:api`, `deploy:api` (filter `api`); keep existing web scripts unchanged.
- **Done when:** `pnpm dev:api` starts the API.

### 1.5 Type generation
- `wrangler types` script; generated env types used in code.
- **Done when:** `tsc --noEmit` passes.

### 1.6 Test setup
- Dev deps: `vitest` (≥ 4.1), `@cloudflare/vitest-plugin` (exact versions checked at install).
  `apps/api/vitest.config.ts` with `cloudflareTest(...)` using `wrangler.jsonc`; scripts `test`
  in `apps/api` and `test:api` at the root.
- **Done when:** `pnpm test:api` runs (zero tests is fine).

### 1.7 Smoke test — Express in the test runtime (R-T1)
- `test/health.test.ts`: `exports.default.fetch("https://api.test/health")` → `200 {ok:true}`.
- **Done when:** passes. If it cannot be made to pass with the documented setup → stop, plan revision.

## Phase 2 — Database

### 2.1 Create D1 database (user's Cloudflare account)
- `wrangler d1 create booking-demo-db` (ask first); add the `d1_databases` binding `DB` to
  `wrangler.jsonc` with `migrations_dir: "migrations"`.
- **Done when:** binding present; `wrangler types` includes `DB`.

### 2.2 Migration 0001 — schema
- SQL from "Data model" above.
- **Done when:** `wrangler d1 migrations apply booking-demo-db --local` succeeds.

### 2.3 Migration 0002 — seed tables
- T1–T4 (2 seats), T5–T8 (4 seats).
- **Done when:** local `SELECT * FROM tables` returns 8 rows.

### 2.3a Migrations in tests
- `vitest.config.ts`: `readD1Migrations("migrations")` → test binding `TEST_MIGRATIONS`;
  `test/apply-migrations.ts` setup file calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
- `test/schema.test.ts`: 8 tables seeded; duplicate `(table_id, slot)` insert fails; a `batch`
  with one failing slot insert leaves no reservation row (automated version of 2.4).
- **Done when:** passes.

### 2.4 Manual constraint check (local)
- Via `wrangler d1 execute --local`: insert a reservation + slot, then a second slot row with the
  same `(table_id, slot)` → must fail; a `batch` with one failing slot insert leaves no
  reservation row behind (confirms D3 locally).
- **Done when:** both behave as expected; test rows removed.

## Phase 3 — Domain logic (no HTTP)

### 3.1 `src/config.ts`
- Opening hours per weekday, slot length 30, duration 90, lead time 60 min, horizon 30 days,
  max guests 4, time zone `Europe/Kyiv` (P8).
- **Done when:** values match `docs/cafe.md`.

### 3.2 `src/time.ts` — Kyiv time helpers
- Current Kyiv date/time; weekday of a date; list of valid start times for a date; slot keys for a
  start; end time; "is start bookable now" (D6).
- **Done when:** spot-checked in `wrangler dev` via a temporary log for a weekday, a weekend day,
  today (lead time cuts early times) and day 31 (rejected); temporary code removed.

### 3.3 `src/validation.ts` — zod schemas
- Availability query; reservation body (name 1–80 chars trimmed, phone normalised to E.164,
  comment ≤ 500 chars, guests 1–4, date/time formats).
- **Done when:** invalid examples produce field-level messages.

### 3.4 `src/token.ts`
- Generate token (P4), SHA-256 hash.
- **Done when:** token is base64url, 43 chars; hash is stable for the same token.

### 3.5 `src/repo.ts` — SQL access
- `findFreeTables(slots, guests)`, `insertReservation(batch)`, `occupiedSlotsByTable(date)`,
  `findByTokenHash`, `cancel(batch)`. Raw prepared statements only.
- **Done when:** type-checks; exercised through the endpoints in Phase 4.

### 3.6 `src/booking.ts` — booking and availability services
- Availability: per start time, does any fitting table have all 3 slots free.
- Create: algorithm steps 1–6; detect primary-key conflict from the D1 error and try the next table.
- Cancel: rules P9.
- **Done when:** type-checks; behaviour verified in Phase 4.

### 3.7 Unit tests — `time.ts`
- Fixed `now` values (P10): weekday start times 08:00…19:30; weekend 09:00…20:30; lead time cuts
  starts earlier than now + 1 h; day +30 allowed, day +31 rejected; off-grid time rejected;
  slot keys and end time for a start.
- **Done when:** passes.

### 3.8 Unit tests — `validation.ts`
- Valid body passes; each field's invalid cases (empty/long name, guests 0 and 5, bad date/time
  format, long comment); phone: `+380 67 123 45 67` → `+380671234567`, local `0…` per O1,
  garbage rejected.
- **Done when:** passes.

### 3.9 Unit tests — `token.ts`
- Token length/alphabet; two tokens differ; hash stable for the same token.
- **Done when:** passes.

## Phase 4 — HTTP layer

### 4.1 Error format and handlers
- `HttpError` with `code`; JSON 404 for unknown routes; error middleware → P6 format, `500 INTERNAL`
  without details.
- **Done when:** unknown route and a thrown error return the documented JSON.

### 4.2 `GET /availability`
- **Done when:** returns expected times for an empty day; a booked time disappears once all fitting
  tables are taken.

### 4.3 `POST /reservations`
- **Done when:** `201` with token; 5th booking of a 4-guest party at the same time → `409 SLOT_TAKEN`;
  time off the grid / outside hours / < 1 h ahead / > 30 days → `400 TIME_NOT_BOOKABLE`;
  bad body → `400 VALIDATION`.

### 4.4 `GET /reservations/:token`
- **Done when:** valid token → reservation; unknown token → `404`.

### 4.5 `POST /reservations/:token/cancel`
- **Done when:** first call → `cancelled` and the time is available again; second call →
  `409 NOT_CANCELLABLE`.

### 4.6 CORS
- `cors` with origins `https://booking-demo-web.nick-burdo.workers.dev`, `http://localhost:3000`.
- **Done when:** preflight from an allowed origin passes; another origin gets no CORS headers.

### 4.7 Rate limiting
- `ratelimits` binding `CREATE_LIMITER` (`simple: {limit: 10, period: 60}`, own `namespace_id`);
  checked in `POST /reservations` with key = `CF-Connecting-IP`; `429 RATE_LIMITED`.
- **Done when:** 11th create within a minute locally → `429`.

### 4.8 Integration tests — endpoints (`test/api.test.ts`)
- Via `exports.default.fetch()`, clock fixed (P10):
  - `GET /availability`: empty day; validation errors; time disappears when all fitting tables
    are booked.
  - `POST /reservations`: `201` + token; `400 VALIDATION`; `400 TIME_NOT_BOOKABLE` (off-grid,
    outside hours, < 1 h, > 30 days); 5th 4-guest booking at the same time → `409 SLOT_TAKEN`;
    party of 2 gets a 4-seat table when T1–T4 are full (checked in DB).
  - `GET /reservations/:token`: found; unknown → `404`.
  - `POST /reservations/:token/cancel`: → `cancelled`, slots freed, time re-bookable; repeat →
    `409 NOT_CANCELLABLE`.
  - Unknown route → `404 NOT_FOUND` JSON.
- **Done when:** passes.

### 4.9 Integration test — concurrency (`test/race.test.ts`)
- 8 parallel `POST /reservations` (4 guests, same date/time) → exactly 4 × `201`, 4 × `409`;
  `reservation_slots` has no duplicates and exactly 12 rows (R-T3).
- **Done when:** passes on 10 consecutive runs.

### 4.10 Integration tests — CORS and rate limit
- CORS: allowed origin gets `Access-Control-Allow-Origin`; other origin does not.
- Rate limit (R-T2): 11th create from one IP → `429`, if the test runtime simulates the binding;
  otherwise drop this case and keep 4.7 manual (confirm with the user).
- **Done when:** passes (or the R-T2 fallback is agreed).

### 4.11 Full suite
- `pnpm test:api` and `tsc --noEmit`.
- **Done when:** both green.

## Phase 5 — Deploy

### 5.1 Apply migrations remotely
- `wrangler d1 migrations apply booking-demo-db --remote` (ask first).
- **Done when:** remote `tables` has 8 rows.

### 5.2 Deploy the Worker
- `pnpm deploy:api` (ask first).
- **Done when:** `GET https://booking-demo-api.nick-burdo.workers.dev/health` → `200`.

### 5.3 Live smoke check
- Run every `curl` example from `docs/api.md` against the live URL; cancel the created test reservations.
- **Done when:** all responses match the documentation.

## Phase 6 — Demo and verification

### 6.1 `curl` examples finalised in `docs/api.md`
- Replace placeholders with real (anonymised) responses from 5.3.
- **Done when:** examples copy-paste and work.

### 6.2 Race script `apps/api/scripts/race.mjs`
- Node script: picks a bookable time tomorrow (or `--date/--time`), sends N (default 8) concurrent
  `POST /reservations` for 4 guests, prints a summary (expected: 4 × `201`, 4 × `409`), then
  cancels the created reservations. Base URL by argument (local or live).
- **Done when:** run locally and live, both show exactly 4 successes; no slot double-booked
  (checked with a SQL query on `reservation_slots`).

### 6.3 Edge cases manual pass
- Weekend vs weekday hours; last start time (19:30 / 20:30); party of 2 falling back to a 4-seat
  table when T1–T4 are full; cancelled slot re-bookable; phone formats (`+380 67 123 45 67`,
  `0671234567` → handled per O1).
- **Done when:** all behave as documented.

## Phase 7 — Wrap-up

### 7.1 README
- Add the API: live URL, link to `docs/api.md`, how to run locally (`pnpm dev:api`, local migrations),
  how to run tests (`pnpm test:api`) and the race script; roadmap row v2 marked done.
- **Done when:** README updated.

### 7.2 Docs
- `docs/architecture.md`: API section → "v2 — implemented", what was learned.
- This plan: status → Done, with notes on any approved revisions.
- **Done when:** docs reflect reality.

### 7.3 Merge and push
- Commit; merge `feature/v2-api` into `main`; push to GitHub (ask first).
- **Done when:** `main` on GitHub contains v2.

## Implementation notes (2026-11-21)

No plan revisions were needed. Small ordering/how-to differences inside the approved scope:

- **Versions (1.2, 1.6):** pnpm's `minimumReleaseAge` rejected `wrangler@4.166.0` and
  `@cloudflare/vitest-plugin@1.9.0` (published < 1 day earlier). The first install silently
  added exclusions to `pnpm-workspace.yaml`; that change was reverted, and the previous
  releases were pinned: `wrangler@4.165.0`, `@cloudflare/vitest-plugin@1.8.5` (built for it),
  `vitest@5.1.1`.
- **2.4:** the duplicate-slot rejection was checked manually with `wrangler d1 execute`; the
  `batch()` rollback was checked by the automated test in 2.3a, because `d1 execute` does not
  go through the `batch()` API.
- **3.2:** the manual spot-check ran through the real `/availability` under `wrangler dev`
  (first start today = first time ≥ now + 1 h), no temporary logging needed.
- **3.6 / 4.1:** `HttpError` (`src/errors.ts`) and `src/clock.ts` were created in Phase 3,
  since the services throw/use them.
- **R-T1, R-T2:** both resolved positively — Express and the rate limiter work in the test
  runtime. **R-T3** handled by the live race run (4 × `201`, tables T5–T8, no duplicate cells).

## Revision R1 (2026-11-21) — code review fixes (approved)

**Trigger:** first code review of `main...feature/v2-api` (before merge, step 7.3).
4 findings, none in the booking core. User approved all four fixes as proposed.

**Changes:**
- **R1.1 (important):** body errors raised by `express.json()` other than malformed JSON
  (`entity.too.large`, unsupported charset/encoding, aborted request) fell through to
  `500 INTERNAL`. Now: body over 10 KB → `413 PAYLOAD_TOO_LARGE` (new error code); any other
  client body error (http-errors status < 500) → `400 VALIDATION`. `docs/api.md` updated;
  integration test added.
- **R1.2 (nit):** keep the `"unknown"` rate-limit key for requests without `CF-Connecting-IP`
  (Cloudflare always sets it; only local/test calls lack it) — document why in a code comment.
- **R1.3 (nit):** `race.mjs` success check: OK only if every response is `201` or `SLOT_TAKEN`
  and at least one booking succeeded; warn when fewer than 4 succeeded (time already partly
  booked).
- **R1.4 (nit):** `race.mjs` validates `--n` (integer 1–10) and counts `429 RATE_LIMITED`
  separately from other failures.

**Steps:** R1.1–R1.4 implemented and committed on `feature/v2-api`; full suite + typecheck;
redeploy the API (ask first); re-run the live race script; then 7.3.

**R1 result (2026-11-21):** implemented in `75a2e01` (R1.1, R1.2) and `b69494c` (R1.3, R1.4);
64 tests green; API redeployed; live checks: body over 10 KB → `413 PAYLOAD_TOO_LARGE`,
`charset=koi8-r` → `400 VALIDATION`; live race run 4 × `201`, 4 × `SLOT_TAKEN`, exit 0.
Addition inside R1.3 (same script): `process.exitCode` instead of `process.exit()`, because
exiting while fetch sockets close intermittently aborted Node on Windows
(`UV_HANDLE_CLOSING` assertion); not seen again in 5 runs after the change.
