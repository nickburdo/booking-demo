# v3 plan — Booking form and Telegram notifications

- **Status:** Done (2026-11-21) — live; revisions R1–R4
- **Scope:** stage v3 of the roadmap (`docs/overview.md`): a booking form on the landing page
  (`#booking`) that uses the v2 API; a guest reservation page (view + cancel by private link);
  Telegram notifications to the owner on new and cancelled reservations; Cloudflare Turnstile
  on reservation creation.
- **Out of scope:** owner actions / admin, `confirmed` status (v4); chats (v5–v6); payments (v7);
  e-mail or SMS to guests; notification retries / queues; changing an existing reservation;
  automated tests for `apps/web` (ADR-016 keeps the web app without tests).
- **Testing:** API changes get automated tests (ADR-016) plus manual checks; the web form and
  reservation page are verified manually in a browser (click, keyboard, 375/768/1280 px,
  EN/RU/UK). A code review of the branch runs before merge (agreed after v2).

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | The form replaces the "coming soon" text inside the `#booking` section of the landing page; all "Book a table" buttons keep pointing there | user |
| D2 | Step flow: date + party size → free start times (from `GET /availability`) as buttons → name, phone, comment → submit. Taken times are never offered | user |
| D3 | Date picked with a native `<input type="date">`, `min` = today, `max` = today + 30 (Kyiv dates) | user |
| D4 | After booking: a confirmation with the details and a **personal link** to a reservation page where the guest can view and cancel. Token travels in the URL hash: `/reservation#<token>` (`/ru/…`, `/uk/…`) — never sent to the static host or its logs | user |
| D5 | Telegram bot (created by the user in @BotFather) writes to the **user's private chat** | user |
| D6 | Notify on **new reservation and on guest cancellation** | user |
| D7 | Message: full reservation (date, time–end, guests, table, name, phone, comment), **in Ukrainian** regardless of the guest's language | user |
| D8 | Notification is sent **in the background** (`waitUntil`), **no retries**. A Telegram failure never fails the booking; it is logged and recorded in the DB (`notified_at` stays empty) | user |
| D9 | **Cloudflare Turnstile** protects `POST /reservations` | user; Turnstile docs |
| D10 | With Turnstile, scripts can no longer create reservations on the live API (production secret rejects test tokens). `race.mjs` and the `curl` create examples run **locally only**, where the API uses Turnstile's test secret (always passes) | user; Turnstile docs ("Production secret keys … reject dummy tokens") |
| D11 | Git: plan and docs on `main`; work on `feature/v3-booking-form` from up-to-date `main`; code review before merge | project rules, agreement after v2 |

### Proposed technical details (my calls — object if you disagree)

| # | Proposal | Rationale |
|---|---|---|
| P1 | `POST /reservations` takes the Turnstile token in the body as `turnstileToken`. Order: rate limit → body validation → Turnstile `siteverify` (with `remoteip` = `CF-Connecting-IP`) → booking | Validate cheap things first; a Turnstile token is single-use, so it is spent only on otherwise valid requests |
| P2 | New error codes: `400 VERIFICATION_FAILED` (missing/invalid/expired token); `503 VERIFICATION_UNAVAILABLE` when `siteverify` cannot be reached (fail closed) | A bot check that fails open is no check; the form shows "try again" |
| P3 | Secrets via `wrangler secret put`: `TURNSTILE_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Locally: `apps/api/.dev.vars` (git-ignored) with Turnstile test secret `1x0000000000000000000000000000000AA`; Telegram vars optional locally — if missing, notifications are skipped with a log line | No secrets in the repo; local dev works without a bot |
| P4 | Migration `0003_notifications.sql`: `reservations.notified_at`, `reservations.cancel_notified_at` (ISO UTC, nullable), set when Telegram accepted the message | D8 asks for the DB mark; v4 admin can show "owner not notified" |
| P5 | Telegram via plain `fetch` to `https://api.telegram.org/bot<token>/sendMessage`, `parse_mode: "HTML"` with escaping of guest text; no Telegram library | One HTTP call; guest input must not break or inject markup |
| P6 | Background work via `waitUntil` imported from `cloudflare:workers` (present in the generated runtime types); see risk R3 | Express handlers have no `ctx` |
| P7 | Web reads `runtimeConfig.public.apiBase` and `runtimeConfig.public.turnstileSiteKey` (env `NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_TURNSTILE_SITE_KEY`), baked in at `nuxt generate`. Defaults: live API URL / real site key; local dev uses `http://localhost:8787` and test site key `1x00000000000000000000AA` via `apps/web/.env` (git-ignored) | Static site: config is fixed at build time |
| P8 | Turnstile widget rendered explicitly (`render=explicit`) in a client-only component; widget language follows the page locale; widget is reset after every submit attempt (tokens are single-use, valid 5 min) | SPA-friendly; a spent token must not be resent |
| P9 | Form error handling by `error.code`: `VALIDATION` → message under each field (`fields`); `SLOT_TAKEN` → message + availability reloaded; `TIME_NOT_BOOKABLE` → reload times; `RATE_LIMITED`, `VERIFICATION_*`, network/500 → general message. All texts in EN/RU/UK | Error codes were designed for this (v2 P6) |
| P10 | Reservation page `pages/reservation.vue`: client-only data load from the hash token; shows details + status; "Cancel reservation" with a confirm step; states: loading, not found, cancelled, already started; `noindex` | The link holds a secret; nothing to index |
| P11 | Confirmation offers the link with a "Copy link" button; no e-mail / storage of the token on the device | Simple; the guest saves the link themselves |
| P12 | Client-side checks mirror the API only where cheap (required fields, phone pattern from O1 of v2); the API remains the authority | Faster feedback without duplicating rules |
| P13 | Form look follows `docs/design.md` tokens on the espresso section (milk text, cobalt primary button, linden accents); a static mockup of the form is approved by the user before the component is built (step 3.1), then `docs/design.md` §6 is updated | The look is the user's decision, as in v1 |

## Known risks

- **R1 — Turnstile widget in a statically generated Nuxt page.** Script must load client-side
  only and render explicitly. Checked first in step 3.2 with the test site key; if it cannot be
  made to work cleanly → stop, plan revision.
- **R2 — `Intl` Ukrainian month/weekday names in `workerd`** for the Telegram text. Checked in
  step 2.4; fallback (my proposal if needed): numeric date `05.12.2026 (сб)` from a small table.
- **R3 — `waitUntil` from `cloudflare:workers` under Express and in the Vitest integration.**
  Checked in step 2.5 with a smoke test; if it does not work → stop, plan revision.
- **R4 — mocking outbound `fetch` (Telegram, `siteverify`) in tests.** The main Worker shares
  the test isolate, so `vi.spyOn(globalThis, "fetch")` is expected to work; checked in step 2.6.

## API changes (summary for `docs/api.md`)

- `POST /reservations` body gains required `turnstileToken` (string ≤ 2048).
- New errors: `400 VERIFICATION_FAILED`, `503 VERIFICATION_UNAVAILABLE`.
- No change to responses, to other endpoints, or to booking rules.
- Side effects: Telegram message on create and on cancel (background, best effort).

Telegram message (create; cancel uses "❌ Скасовано бронювання" and the same body):

```
🆕 Нове бронювання
сб, 5 грудня · 19:00–20:30
4 гості · стіл T5
Олена · +380671234567
«Біля вікна, якщо можна»
```

## Phase 0 — Documentation (on `main`, before code; ADR-005)

### 0.1 `docs/api.md`
- `turnstileToken` field, new error codes, notifications as side effects, note that creating
  reservations on the live API needs the site's Turnstile widget (scripts: local only, D10).
- **Done when:** matches "API changes" above.

### 0.2 `docs/decisions.md`
- ADR-017 Booking form in `#booking`, step flow, reservation page with token in the hash (D1–D4).
- ADR-018 Telegram notifications: private chat, create + cancel, Ukrainian, background, no retry,
  DB mark (D5–D8, P4).
- ADR-019 Turnstile on reservation creation, fail closed; live scripts no longer create
  reservations (D9, D10, P2).
- ADR-010 marked as superseded by ADR-017.
- **Done when:** written, status Accepted.

### 0.3 `docs/architecture.md`
- v3 parts marked "planned": Telegram, Turnstile, web form, reservation page, config/secrets.
- **Done when:** section matches this plan.

### 0.4 Commit on `main` (ask first)
- **Done when:** committed.

## Phase 1 — Setup (user steps marked)

### 1.1 Branch
- `feature/v3-booking-form` from up-to-date `main` (warn first if a dev server is running).
- **Done when:** on the branch.

### 1.2 Telegram bot (user)
- Steps: [`docs/setup-integrations.md`](../setup-integrations.md) (added in R2).
- User creates a bot in @BotFather and sends it `/start` from their account; I give exact steps.
  User reads their `chat_id` (I provide a `curl …/getUpdates` command to run locally).
- Token and chat id are **not** pasted into the chat; the user stores them with
  `npx wrangler secret put TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from `apps/api` in their own
  terminal (and optionally in `apps/api/.dev.vars` for local tests).
- **Done when:** `wrangler secret list` shows both names.

### 1.3 Turnstile widget (user)
- Steps: [`docs/setup-integrations.md`](../setup-integrations.md) (added in R2).
- User creates a widget in the Cloudflare dashboard (Turnstile → Add widget), hostnames
  `booking-demo-web.nick-burdo.workers.dev` and `localhost`, mode "Managed". Site key may be
  shared in the chat (it is public); secret goes via `wrangler secret put TURNSTILE_SECRET`.
- **Done when:** site key known; `TURNSTILE_SECRET` listed.

### 1.4 Local config files
- `apps/api/.dev.vars` (Turnstile test secret), `apps/web/.env` (local API base, test site key);
  both git-ignored (check `.gitignore` covers `.env*` and `.dev.vars*`); `.example` files committed.
- **Done when:** local API and site start with them.

## Phase 2 — API

### 2.1 Migration 0003
- `ALTER TABLE reservations ADD COLUMN notified_at TEXT; … cancel_notified_at TEXT;`
- **Done when:** applies locally; schema test still green.

### 2.2 Turnstile verification `src/turnstile.ts`
- `verifyTurnstile(token, ip)` → ok / failed / unavailable (P1, P2); `turnstileToken` in the zod body.
- **Done when:** type-checks.

### 2.3 Wire into `POST /reservations`
- Order per P1; error codes per P2; `ErrorCode` extended.
- **Done when:** local `curl` with the test token creates; without token → `400 VERIFICATION_FAILED`.

### 2.4 Telegram message `src/telegram.ts`
- Message builder (Ukrainian date via `Intl` `uk-UA`, R2), HTML escaping; `sendTelegram(text)`
  returning ok/failed; skip with a log line if not configured (P3).
- **Done when:** builder output matches the sample above for the sample data.

### 2.5 Background sending (R3)
- On create and on cancel: `waitUntil(notify…)`; on success set `notified_at` /
  `cancel_notified_at`; on failure `console.error` only.
- **Done when:** smoke test proves the background task runs in the test runtime (or R3 triggers
  a revision); a local booking with real bot vars (if the user put them in `.dev.vars`) arrives
  in Telegram.

### 2.6 Tests
- Unit: message builder (create/cancel, escaping of `<`, `&`, quotes; no comment), Ukrainian date.
- Integration (fetch spied, R4): create without token → 400; failing `siteverify` → 400; network
  error → 503; valid → 201 and Telegram called with the expected text; Telegram failure → still
  201, `notified_at` empty; cancel → Telegram called, `cancel_notified_at` set.
- Existing tests updated to send a token (helper).
- **Done when:** full suite + typecheck green.

### 2.7 Race script
- `race.mjs` sends the Turnstile test token; doc comment: local only (D10). Run locally.
- **Done when:** local run OK.

## Phase 3 — Web

### 3.1 Form mockup (user approval)
- Static mockup of the `#booking` form (desktop + mobile, empty / times loaded / error / success)
  shown to the user before building (P13).
- **Done when:** user approves a variant.

### 3.2 Turnstile component (R1)
- `TurnstileWidget.vue` (client-only, explicit render, locale, `reset()` exposed, emits token).
- **Done when:** with the test site key the widget renders and emits the dummy token in dev.

### 3.3 Config and API client
- `runtimeConfig.public` (P7); `composables/useBookingApi.ts` (availability, create, get, cancel;
  typed responses; error → `{ code, message, fields }`).
- **Done when:** type-checks; manual call against local API works.

### 3.4 i18n strings
- Form labels, hints, time-step texts, all error codes (P9), confirmation, reservation page
  texts in EN/RU/UK.
- **Done when:** no missing keys in any locale.

### 3.5 Booking form component
- `BookingForm.vue` in `BookingSection.vue`: date (D3), guests 1–4, times (loading / empty /
  error), contacts, Turnstile, submit with busy state, per-field errors, confirmation with link +
  copy (P11). Kyiv "today" for `min`/`max`.
- **Done when:** a booking can be made end to end against the local API in all three languages.

### 3.6 Reservation page
- `pages/reservation.vue` (P10), locale-aware link from the confirmation.
- **Done when:** view and cancel work; unknown token, cancelled, started states render.

### 3.7 Docs for the look
- `docs/design.md` §6/§7 updated (form, reservation page); ADR-010 note already in 0.2.
- **Done when:** design doc matches the built UI.

## Phase 4 — Manual verification (local, built site under `wrangler dev`)

### 4.1 Responsive: 375×812, 768×1024, 1280×800 × EN/RU/UK — no horizontal scroll, no overflow.
### 4.2 Interaction: mouse and keyboard only (Tab/Enter/Space, date input), screen-reader labels,
  focus visible; error states by forcing each code (validation, slot taken, verification failed,
  API down).
### 4.3 Reservation page: open link in a new tab, cancel, reload, wrong token, other language.
  With a **real token on the built site** (added in R3: the prerendered page behaves differently from dev).
### 4.4 Telegram: real messages for create and cancel arrive with correct Ukrainian text.
- **Done when:** all pass; issues fixed within scope or raised.

## Phase 5 — Deploy (ask before each)

### 5.1 Remote migration 0003.
### 5.2 Deploy API (requires `TURNSTILE_SECRET`; from now on scripts cannot create live bookings).
### 5.3 Deploy web (`NUXT_PUBLIC_*` defaults = live values).
### 5.4 Live check: book via the live site, Telegram message arrives, open link, cancel, Telegram
  cancel message arrives.
- **Done when:** all of 5.4 works.

## Phase 6 — Review and wrap-up

### 6.1 Code review of `main...feature/v3-booking-form`; findings discussed; fixes via plan revision.
### 6.2 README (how to run with `.env.local` / `.dev.vars`, link to `docs/setup-integrations.md`), `docs/architecture.md`
  (v3 implemented, learned), this plan → Done.
### 6.3 Merge into `main`, push (ask first).

## Revision R1 (2026-11-21) — local site config must not reach the production build (approved)

**Trigger:** after Phase 3, `nuxt generate` was found to read `apps/web/.env` too: the build
baked in `apiBase: "http://localhost:8787"` and the Turnstile test site key. `pnpm deploy`
would have shipped them. Nothing was deployed.

**Decision (user):** local values live in `apps/web/.env.local`, loaded only explicitly:
- `dev` script → `nuxt dev --dotenv .env.local`;
- new `generate:local` script → `nuxt generate --dotenv .env.local` (local built-site checks);
- `generate` / `deploy` load no env file, so they use the live defaults from `nuxt.config.ts`;
- `.env.example` (committed) now says "copy to `.env.local`".
Rejected: setting `NUXT_PUBLIC_*` in the deploy script (needs `cross-env` on Windows; a plain
`pnpm generate` would still pick up `.env`).

**Also decided (user):** Phase 4 runs on the built site (`generate:local`) served by
`wrangler dev` on port 3000 (the only local origin the API allows); the user stops their dev
server for it.

**Done when:** `pnpm generate` output contains the live `apiBase` and no test site key;
`generate:local` output contains the local values.

## Revision R2 (2026-11-21) — setup steps as a separate doc (approved)

**Trigger:** the Telegram/Turnstile setup steps were only given in the chat and were hard to find.

**Decision (user):** the steps live in `docs/setup-integrations.md` (bot, chat id, Turnstile widget,
`wrangler secret put`, optional local `.dev.vars`). Phase 1.2/1.3 and 6.2 link to it; the README
links to it instead of repeating the steps.

**Done when:** the file exists and is linked from this plan (now) and the README (6.2).

## Revision R3 (2026-11-21) — reservation page lost the token on the live site (approved)

**Trigger:** in 5.4 the link from the confirmation opened `/reservation#<token>` with
"Booking not found" and no API request. Cause: the page is prerendered for `/reservation`;
when hydrating a different URL, Nuxt 4.6 first shows the prerendered route and restores the real
one on `app:suspense:resolve` ("deferred route", `nuxt/dist/pages/runtime/plugins/router.js`).
`onMounted` ran in between and read an empty `window.location.hash`. Dev mode has no prerender,
and Phase 4 tested only wrong/empty tokens on the built site, so this was missed.

**Decision (user):**
- `reservation.vue` reads the token in `onNuxtReady` from `useRoute().hash`.
- Re-test on the built site (`generate:local`): book → open link → view → cancel → switch
  language; wrong and empty token. Phase 4.3 now names the real-token check explicitly.
- Redeploy web (repeat 5.3), then 5.4.

**Done when:** the live link opens the booking and cancel works.

## Revision R4 (2026-11-21) — code review fixes (approved)

**Trigger:** Phase 6.1 review of `main...feature/v3-booking-form` found 7 issues; all were
confirmed in the code. The user chose to fix all of them, including the notification order.

### R4.1 Form: API errors for `date` / `guests` are never shown (`BookingForm.vue`)
- Show `fieldErrors.date` under the date input and `fieldErrors.guests` under the guests group
  (same `field-error` style, `aria-invalid` / `aria-describedby` like the other fields).

### R4.2 Form: clearing the date keeps the old times and the selected time
- `loadTimes`: when the date is empty, clear `times` and `time`, set `timesState` to `idle`.
- `checkLocally`: an empty date is a local error (`booking.fieldErrors.date`, key exists).

### R4.3 Form: "Book another" reuses the spent Turnstile token
- `bookAnother` sets `turnstileToken` to `null` and `turnstileFailed` to `false`; the remounted
  widget issues a new token.

### R4.4 API: the cancel message can arrive before the new-booking message (`notify.ts`)
- Before sending a "cancelled" message, the background task re-reads the row and waits until
  `notified_at` is set: check every 500 ms, up to 10 s (well inside the `waitUntil` limit).
  If it is still empty after that (the first message failed), send the cancel message anyway.
- If Telegram is not configured, nothing changes (both are skipped).
- Tests (`apps/api/test/v3.test.ts`): cancel right after create sends "created" first, then
  "cancelled"; cancel still sends after the wait when the "created" message failed.
- ADR-018: describe the ordering rule and its limit (best effort, 10 s).

### R4.5 Reservation page: a malformed hash leaves it on "Loading…" forever (`reservation.vue`)
- Wrap the token decode in `try/catch`; on failure show "Booking not found".

### R4.6 Form: "bot check could not load" comes back after the widget recovered
- Set `turnstileFailed` to `false` when a non-null token arrives.

### R4.7 Form: `DATE_OUT_OF_RANGE` shows a generic error / a useless "Try again"
- New i18n key `booking.errors.DATE_OUT_OF_RANGE` (en/ru/uk): "This date is no longer
  available. Pick another date."
- On this code (from availability or create): recompute the bookable range, move the date to
  the new first day if it fell out, show the message, reload times.

### Verification
- API: `pnpm --filter api test` and typecheck green.
- Web, on the built site (`generate:local` + local API): R4.1 / R4.7 by forcing the API answer
  (as in Phase 4), R4.2 / R4.3 / R4.5 / R4.6 by hand; R4.4 locally with real Telegram
  (book → cancel at once → order in the chat).
- Then redeploy API and web (ask first), short live check.

**Done when:** all of the above pass; review findings closed.

