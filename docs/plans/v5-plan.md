# v5 plan — Scripted chat on the same API

- **Status:** Approved (2026-11-22) — in progress
- **Scope:** stage v5 of the roadmap (`docs/overview.md`): a chat widget on the landing page.
  The dialogue runs **on the server** as a scripted state machine (no AI) and uses the same
  booking services and rules as the form. The guest answers with buttons and a few text
  fields. The chat can: book a table, show (and cancel) a booking from its link, answer
  frequent questions (hours, address, menu), and pass a question to a person (a Telegram
  message to the owner). Conversations are stored and shown in the admin, with guest data
  masked, and deleted after 7 days. The café data moves into a shared package used by the site
  and the API.
- **Out of scope:** AI / free-text understanding (v6); the chat on other pages (reservation
  page, admin); messages to guests; the chat in Telegram; operator replies inside the chat;
  payments (v7); automated tests for `apps/web` (ADR-016).
- **Testing:** the chat engine and endpoints get automated tests (ADR-016); the widget and the
  admin chat pages are checked by hand on the built site (`generate:local`), 375 / 768 / 1280 px,
  EN / RU / UK, mouse and keyboard. A code review of the branch runs before merge.

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | A chat **widget on the landing page** only: a round button in the corner opens the chat panel; full screen on phones | user |
| D2 | Guest input: **buttons** for choices (date shortcuts, guests, free times, menu items) and **simple fields** only for name, phone, comment, a pasted link and a question for a person | user |
| D3 | Skills: **book a table**; **show a booking by its link** (and cancel it); **frequent questions** (hours, address, menu); **pass to a person** | user |
| D4 | The dialogue logic runs **on the server** (`POST /chat/...`), which keeps the conversation state | user |
| D5 | Conversations are **stored** and shown in the **admin** | user |
| D6 | **Turnstile when the chat opens**: one check per conversation, before the first question | user |
| D7 | "Pass to a person" sends the guest's question and contact to the **owner's Telegram** | user |
| D8 | The **server writes the chat texts** in the guest's language (EN / RU / UK), as the AI will in v6 | user |
| D9 | The café data (name, address, hours, menu) moves into a **shared package** used by the site and the API | user |
| D10 | In the admin, guest names and phones inside conversations are **masked**; conversations are **deleted after 7 days** | user |
| D11 | Git: plan and docs on `main`; work on `feature/v5-chat` from up-to-date `main`; code review before merge | project rules |

### Proposed technical details (my calls — object if you disagree)

| # | Proposal | Rationale |
|---|---|---|
| P1 | **Endpoints:** `POST /chat/sessions` (body `{ turnstileToken, locale }`) starts a conversation and returns a chat token plus the first bot turn; `POST /chat/sessions/current/messages` (bearer chat token, body `{ choice }` or `{ text }`) returns the next bot turn; `GET /chat/sessions/current` returns the history (to continue after a reload) | Same conventions as the rest of the API; the chat token works like the admin session token (ADR-020): random, only its hash stored |
| P2 | **Bot turn format:** `{ messages: [{ text }], input: { kind: "choices", options: [{ id, label }] } \| { kind: "text", field, placeholder, maxLength } \| { kind: "none" } }`. Labels and texts come from the server in the guest's language (D8). v6 will produce the same shape | One format for the widget now and the AI later; the widget only renders |
| P3 | **Engine:** a pure state machine in `apps/api/src/chat/` (`state + input + now → new state + bot turn`), separated from HTTP and storage, so it is unit-testable. Flows: menu → book (date → guests → free time → name → phone → comment or skip → summary → confirm → link) · find booking (paste link → status → cancel or not) · questions (hours / address / menu) · person (question → name → phone → sent). "Start over" and "Menu" are offered at every step | Explicit states keep a scripted chat predictable; testable without D1 |
| P4 | **Same backend, in process:** the engine calls the existing services (`getAvailability`, `createReservation`, `getReservation`, `cancelByToken`) — the same validation, booking rules and double-booking guard as the form. A booking from the chat sends the usual Telegram message (ADR-018). The Turnstile check of the conversation (D6) replaces the per-booking token for bookings made in that conversation | The anti-goal "an interface that books around the validated backend" stays impossible; the chat is just another client of the same rules |
| P5 | **Storage** (migration `0005`): `chat_sessions (id, token_hash, locale, state JSON, outcome, reservation_id, created_at, updated_at)` and `chat_messages (id, session_id, seq, sender 'guest'/'bot', field, text, created_at)`. `field` marks guest answers that are personal (`name`, `phone`) so they can be masked when read (D10). Sessions expire after 2 hours of silence; rows older than 7 days are deleted whenever a new conversation starts (like the admin session clean-up) | No cron needed; masking stays one function (ADR-021) |
| P6 | **Limits:** a new Rate Limiting binding `CHAT_LIMITER` — 30 messages per 60 s per IP; a conversation ends after 60 guest messages; "pass to a person" works once per conversation; questions up to 500 characters | Turnstile stops scripts at the start; limits stop a verified browser from flooding the owner's Telegram |
| P7 | **Person hand-off message** (Telegram, Ukrainian, background, like ADR-018): "💬 Питання з чату" + question, name, phone. The chat tells the guest honestly that in this demo nobody will call back (R1 of v4) | Same notification path; no false promise |
| P8 | **Admin:** a "Chats" tab next to "Reservations": list of the last 7 days (time, language, outcome: booked / found booking / questions / sent to a person / left), and a transcript view with masked name and phone answers; free text (question, comment) shown as written. Links from a transcript to its reservation's day | D5, D10; reuses the admin login and masking |
| P9 | **Shared package** `packages/cafe-data` (TypeScript source, no build step; workspace `packages/*`): café name, address, coordinates, hours and menu in three languages, moved from `apps/web/app/data/cafe.ts`. The site and the API import it. The API's booking hours in `config.ts` are derived from it too, so hours live in one place | D9; removes the existing duplicate of opening hours |
| P10 | **Widget:** client-only `ChatWidget.vue` on `pages/index.vue`; panel 380 × 560 px on desktop, full screen below `md`; Turnstile shown in the panel before the first question; the chat token in `sessionStorage` (the conversation continues after a reload in the same tab); messages in an `aria-live` region, buttons as real buttons, focus moves to the new question | Same patterns as the booking form and the admin (v3/v4) |
| P11 | **Look:** a static mockup (closed button, open panel with a booking flow, phone view, admin chat list and transcript) approved before building (step 3.1), then `docs/design.md` gets a chat section | The look is the user's decision |
| P12 | **Docs:** `docs/api.md` (chat endpoints, turn format, errors), ADR-023 (scripted chat as a server-side state machine over the same services), ADR-024 (chat storage and privacy: masking, 7 days, limits), ADR-025 (shared café data package), `docs/architecture.md` | Docs before code (ADR-005) |

## Known risks

- **R1 — shared TypeScript package in both builds.** Nuxt (Vite) and Wrangler (esbuild) must
  both bundle `packages/cafe-data` from source. Checked first in step 2.1; if one of them needs
  more than a small config change → stop, plan revision.
- **R2 — Turnstile inside a widget that opens later.** The widget code from v3 renders on mount;
  in the chat it mounts when the panel opens. Checked in step 3.2.
- **R3 — state JSON in D1 and concurrent requests.** Two quick clicks may send two messages for
  the same state. The update is guarded by the expected step (`WHERE id = ? AND updated_at = ?`);
  the loser gets `409` and the widget reloads the conversation. Checked by a test in step 2.6.
- **R4 — public demo.** Anyone can read masked conversations in the admin and send a question
  to the owner (limited by Turnstile and P6). Accepted for the demo, like ADR-021.

## Phase 0 — Documentation (on `main`, before code; ADR-005)

### 0.1 This plan approved.
### 0.2 `docs/api.md`: chat section (P1, P2, P6), new errors.
### 0.3 `docs/decisions.md`: ADR-023, ADR-024, ADR-025.
### 0.4 `docs/architecture.md`: "v5 — planned".
- **Done when:** docs committed on `main` (ask first).

## Phase 1 — Setup

### 1.1 Branch `feature/v5-chat` from up-to-date `main` (warn first if a dev server runs).
### 1.2 `wrangler.jsonc`: `CHAT_LIMITER` binding; regenerate types.
### 1.3 Workspace: `packages/*` in `pnpm-workspace.yaml`.
- **Done when:** local API and site start.

## Phase 2 — API

### 2.1 `packages/cafe-data` (P9, R1): move the data; site and API import it; `config.ts`
  derives opening hours from it. **Done when:** site build and API tests unchanged.
### 2.2 Migration 0005 (P5). **Done when:** applies locally; existing tests green.
### 2.3 Chat texts in three languages and the turn format (P2, D8).
### 2.4 Engine (P3, P4): book, find booking, questions, person. **Done when:** unit tests per flow
  (happy paths, invalid name/phone, no free times, slot taken during the chat, link not found,
  cancel refused, start over).
### 2.5 Endpoints, Turnstile at start, chat token, limits, storage, clean-up (P1, P5, P6).
### 2.6 Hand-off Telegram message (P7) and concurrency guard (R3). **Done when:** tests.
### 2.7 Admin endpoints: chat list and transcript, masked (P8). **Done when:** tests.
### 2.8 Full suite + typecheck green.

## Phase 3 — Web

### 3.1 Mockup (P11) approved; `docs/design.md` chat section.
### 3.2 `ChatWidget.vue` + `useChatApi` (P10, R2): open/close, Turnstile, turns, inputs,
  errors (network, limits, expired conversation → start a new one), continue after reload.
### 3.3 Admin "Chats" tab: list and transcript (P8).
### 3.4 i18n for the widget chrome and admin texts (EN / RU / UK); the dialogue texts come
  from the server.
- **Done when:** works locally against the local API.

## Phase 4 — Manual verification (built site, `generate:local` + local API)

### 4.1 Responsive: 375 / 768 / 1280 × EN / RU / UK — closed button, open chat, admin chat pages.
### 4.2 Keyboard and screen reader basics: open/close, every input, focus moves to new turns.
### 4.3 Every flow end to end: book (then the reservation appears in the admin and in
  Telegram), find a booking by its link and cancel it, questions, person (Telegram message
  arrives), start over, expired conversation, limits.
### 4.4 Admin: chat list, transcript with masked answers, link to the reservation.
- **Done when:** all pass; issues fixed within scope or raised.

## Phase 5 — Deploy (ask before each)

### 5.1 Remote migration 0005 (backup first: `wrangler d1 export`).
### 5.2 Deploy API.
### 5.3 Deploy web (`pnpm run generate` checked for local values, then `wrangler deploy`).
### 5.4 Live check: a booking through the chat, the other flows, the admin chat pages.

## Phase 6 — Review and wrap-up

### 6.1 Code review of `main...feature/v5-chat`; fixes via plan revision.
### 6.2 README (status, chat, demo limitations), `docs/architecture.md` (v5 implemented,
  learned), this plan → Done.
### 6.3 Merge into `main`, push (ask first, separate commands); delete the branch.

## Revision R1 (2026-11-22) — scripted and AI chats side by side (approved)

**Trigger:** after the live check (5.4) the user proposed to keep the scripted chat in v6 and show
both chats, instead of replacing one with the other.

**Decision (user):**
- R1.1 The widget gets two tabs under its header: "Scripted" (default) and "AI".
- R1.2 The AI tab says "coming soon" (what it will do, that it is v6 of the roadmap) with a button
  back to the scripted chat; no bot check and no API calls there.
- R1.3 Texts in EN/RU/UK; tabs follow the tablist keyboard pattern (arrows, Tab); switching tabs
  keeps the scripted conversation.
- R1.4 ADR-023: v6 adds the AI engine next to the scripted one (not instead of it); the README
  mentions the second tab (6.2).

**Done when:** R1.1–R1.3 checked on the built site; ADR-023 updated; README in 6.2.


## Revision R2 (2026-11-22) — code review fixes (approved)

**Trigger:** Phase 6.1 review of `main...feature/v5-chat` found five issues; all confirmed in the
code.

**Decision (user):**
- R2.1 Reservation tokens are no longer stored in conversations: the booked-link bot message and
  a pasted link are saved as `…/reservation#••••` (ADR-013). The guest sees the full link in the
  response only; the bot asks to save it now, because it is hidden in the chat after a reload.
- R2.2 The step claim now also stores a "busy" mark in the state in the same write; a request that
  finds the mark gets `409 CHAT_CONFLICT`, so a booking cannot run twice. A mark older than 30 s is
  ignored (a request that died half-way).
- R2.3 If saving the turn fails after the action happened (booking, cancellation, message to the
  owner), the guest still gets the result and the owner is notified; the error is logged.
- R2.4 Admin chats: a slow transcript response no longer replaces the one of a chat clicked later.
- R2.5 Widget: an empty optional comment counts as "Skip" (no empty bubble).

**Done when:** API tests and typecheck green; R2.4/R2.5 checked on the built site; API and web
redeployed (ask first).
