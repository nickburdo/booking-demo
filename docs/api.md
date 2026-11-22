# Booking API

Status: **v2–v5 — implemented** (2026-11-22); **v6 changes planned** (`docs/plans/v6-plan.md`):
the [AI chat engine](#ai-chat-v6) on the same chat endpoints. Examples below are real responses
from the live v2 API (the example reservation was cancelled afterwards).

The single backend for every booking interface: the form (v3), the admin (v4) and both chats
(v5–v6) go through these endpoints and these rules only.

- **Base URL (live):** `https://booking-demo-api.nick-burdo.workers.dev`
- **Base URL (local):** `http://localhost:8787` (`pnpm dev:api`)

## Conventions

- Request and response bodies are JSON (`Content-Type: application/json`).
- Dates are `YYYY-MM-DD`, times are `HH:MM`, both in **Kyiv local time** (Europe/Kyiv).
- Booking rules (hours, duration, lead time, horizon, party size) are listed in
  [`cafe.md` → Booking rules](cafe.md#booking-rules).
- **Errors** always have this shape; `code` is stable and in English, `message` is a
  human-readable English hint. Clients translate by `code`.

  ```json
  { "error": { "code": "SLOT_TAKEN", "message": "No table is free for 4 guests at 19:00." } }
  ```

  `VALIDATION` errors add `fields`: `{ "fieldName": "message" }` (first message per field):

  ```json
  {
    "error": {
      "code": "VALIDATION",
      "message": "Invalid request",
      "fields": {
        "time": "Invalid input: expected string, received undefined",
        "guests": "Too big: expected number to be <=4",
        "name": "Invalid input: expected string, received undefined",
        "phone": "Expected an international number with + or a Ukrainian number starting with 0"
      }
    }
  }
  ```

  A body that is not valid JSON → `400 VALIDATION` "Body is not valid JSON." (no `fields`).
  A body over 10 KB → `413 PAYLOAD_TOO_LARGE`. Any other unreadable body (e.g. unsupported
  charset) → `400 VALIDATION` "Request body could not be read."
- **CORS:** browser requests are allowed only from
  `https://booking-demo-web.nick-burdo.workers.dev` and `http://localhost:3000`.
- **Rate limit:** `POST /reservations` allows 10 requests per 60 seconds per client IP
  (counted per Cloudflare location, so approximate). Over the limit → `429 RATE_LIMITED`.
- **Bot protection (v3):** `POST /reservations` needs a Cloudflare Turnstile token from the
  site's widget (`turnstileToken`). The live API uses a production secret, which rejects
  Turnstile's test tokens, so **scripts and `curl` cannot create reservations on the live API**;
  they work against a local API that uses the Turnstile test secret (ADR-019). Reading
  availability, viewing and cancelling need no token.
- **Notifications (v3):** a new reservation and a guest cancellation each send a Telegram
  message to the owner in the background. Delivery is best effort: a Telegram failure never
  changes the API response (ADR-018).

### Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION` | Missing or malformed field / query parameter |
| 400 | `DATE_OUT_OF_RANGE` | Availability asked for a past date or beyond the 30-day horizon |
| 400 | `TIME_NOT_BOOKABLE` | Start time off the 30-min grid, outside hours, less than 1 h from now, or beyond the horizon |
| 400 | `VERIFICATION_FAILED` | Turnstile token missing, invalid, expired or already used (v3) |
| 401 | `UNAUTHORIZED` | Admin endpoint without a valid session token (missing, unknown or expired) (v4) |
| 401 | `INVALID_CREDENTIALS` | Admin login with a wrong username or password (v4) |
| 404 | `NOT_FOUND` | Unknown route, no reservation for this token, or (admin) no reservation with this id |
| 409 | `SLOT_TAKEN` | No table for this party size is free for the whole 90 minutes |
| 409 | `NOT_CANCELLABLE` | Reservation already cancelled, no-show, or already started |
| 409 | `NOT_ALLOWED` | Admin action not allowed for the reservation's current status or time (v4) |
| 409 | `DEMO_LIMIT` | 20 or more active demo reservations already exist (v4) |
| 401 | `CHAT_EXPIRED` | Chat request without a valid chat token (missing, unknown or silent for 2 hours) — start a new conversation (v5) |
| 409 | `CHAT_CONFLICT` | Two chat messages for the same step at once; reload the conversation (v5) |
| 409 | `CHAT_LIMIT` | The conversation reached 60 guest messages (v5; 20 in an AI conversation, v6) |
| 409 | `ORDER_NOT_ALLOWED` | Pre-order for a booking that is not `confirmed`, has started, or is already paid (v7) |
| 409 | `PAID_BOOKING` | Admin cancel of a booking with a paid pre-order (v7) |
| 400 | `WEBHOOK_SIGNATURE` | Stripe webhook with a missing or invalid signature (v7) |
| 413 | `PAYLOAD_TOO_LARGE` | Request body larger than 10 KB |
| 429 | `RATE_LIMITED` | Too many create (or, v4, admin login / demo data; v5, chat) requests from this IP |
| 500 | `INTERNAL` | Unexpected error (no details exposed) |
| 503 | `VERIFICATION_UNAVAILABLE` | Turnstile could not be reached; the booking is refused, try again (v3) |
| 503 | `PAYMENTS_UNAVAILABLE` | Stripe could not be reached, or the API has no test-mode key (`sk_test_…`) (v7) |

## Reservation object

```json
{
  "id": "6f1c2a7e-0b5d-4f0e-9a51-2d7c3e8b9f10",
  "date": "2026-12-05",
  "time": "19:00",
  "endTime": "20:30",
  "guests": 4,
  "name": "Olena",
  "phone": "+380671234567",
  "comment": "Window seat if possible",
  "status": "pending"
}
```

The table is assigned by the API and is not part of the guest-facing object.

From v4 the object also has `cancelledBy` (`"guest"`, `"owner"` or `null`) and `cancelReason`
(the café's optional reason, or `null`), and `status` can be `confirmed` or `no_show`:

```json
{ "…": "…", "status": "cancelled", "cancelledBy": "owner", "cancelReason": "Private event that evening" }
```

### Status lifecycle

```
v2:  pending ──(guest cancels, before start)──▶ cancelled
v4:  pending ──(owner confirms, before start)──▶ confirmed
     pending / confirmed ──(guest or owner cancels, before start)──▶ cancelled
     pending / confirmed ──(owner marks no-show, after start)──▶ no_show
```

`pending` and `confirmed` hold their table. `cancelled` and `no_show` are final and free it
(ADR-022).

## Endpoints

### `GET /health`

```bash
curl https://booking-demo-api.nick-burdo.workers.dev/health
```

`200` → `{ "ok": true }`

### `GET /availability?date=YYYY-MM-DD&guests=N`

Start times at which a party of `N` (1–4) can book on `date`. Times already less than 1 hour
away are not listed.

```bash
curl "https://booking-demo-api.nick-burdo.workers.dev/availability?date=2026-12-05&guests=4"
```

`200` →

```json
{"date":"2026-12-05","guests":4,"times":["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"]}
```

A time disappears once no fitting table is free for the whole 90 minutes starting then
(e.g. with all four 4-seat tables booked at 19:00, a party of 4 loses 18:00, 18:30, 19:00
and 19:30; a party of 2 still sees 19:00 on the 2-seat tables).

Errors: `400 VALIDATION`, `400 DATE_OUT_OF_RANGE`.

### `POST /reservations`

Body:

| Field | Type | Rules |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `time` | string | `HH:MM` on the 30-min grid |
| `guests` | integer | 1–4 |
| `name` | string | 1–80 characters after trimming |
| `phone` | string | International with `+` (spaces, dashes, brackets allowed), or Ukrainian local `0XXXXXXXXX`; stored as E.164 (`+380XXXXXXXXX`) |
| `comment` | string, optional | up to 500 characters |
| `turnstileToken` | string | (v3) Turnstile token from the site widget, up to 2048 characters; single use, valid 5 minutes |

Checks run in this order: rate limit → body validation → Turnstile → booking rules. A
Turnstile token is spent only on an otherwise valid request; after any response the client
gets a fresh token before trying again.

The example below is from v2 (no token). From v3 on, run it against a local API with
`"turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"` (Turnstile's test token).

```bash
curl -X POST https://booking-demo-api.nick-burdo.workers.dev/reservations \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-12-05","time":"19:00","guests":4,"name":"Olena","phone":"067 123 45 67"}'
```

`201` →

```json
{
  "reservation": { "id": "44c9f1de-7573-4509-a6c9-59f0650c7f35", "date": "2026-12-05",
                   "time": "19:00", "endTime": "20:30", "guests": 4, "name": "Olena",
                   "phone": "+380671234567", "comment": null, "status": "pending" },
  "token": "fL2o1pFoEFEQ9G-BpRRSEupi-5qyvrjLrK-A4uaXutM"
}
```

The `token` is shown **only once**. It is the guest's private key to view and cancel the
reservation; only its hash is stored.

Errors: `400 VALIDATION`, `400 TIME_NOT_BOOKABLE`, `400 VERIFICATION_FAILED`,
`409 SLOT_TAKEN`, `429 RATE_LIMITED`, `503 VERIFICATION_UNAVAILABLE`.

Side effect (v3): a Telegram message to the owner, sent after the response (best effort).

### `GET /reservations/:token`

```bash
curl https://booking-demo-api.nick-burdo.workers.dev/reservations/<token>
```

`200` → `{ "reservation": { … } }`. Errors: `404 NOT_FOUND`.

From v7 the answer also has `order` (the pre-order, or `null`), see
[Pre-order and prepayment (v7)](#pre-order-and-prepayment-v7). If the order is still `checkout`,
the API first asks Stripe for its Checkout Session and records the result (the return check).

### `POST /reservations/:token/cancel`

Allowed while the reservation is `pending` (from v4 also `confirmed`) and has not started.
Frees the table.

```bash
curl -X POST https://booking-demo-api.nick-burdo.workers.dev/reservations/<token>/cancel
```

`200` → `{ "reservation": { …, "status": "cancelled" } }`. Cancelling again:

```json
{"error":{"code":"NOT_CANCELLABLE","message":"This reservation is already cancelled or has already started."}}
```

Errors: `404 NOT_FOUND`, `409 NOT_CANCELLABLE`.

Side effect (v3): a Telegram message to the owner about the cancellation (best effort).

From v7: if the booking has a paid pre-order, the payment is refunded after the cancellation
(the same in the scripted and the AI chat).

## Admin (v4)

Endpoints for the café's admin area (ADR-020, ADR-021, ADR-022). The admin is a **public
demo**: the demo username and password are shown on the site's login page, and guest names
and phones are always returned masked.

**Session.** `POST /admin/login` returns a session token; every other admin endpoint needs it
as `Authorization: Bearer <token>`. Sessions last 8 hours; only the token's hash is stored.
Without a valid token → `401 UNAUTHORIZED`.

**Masking.** `name` → first word plus the initial of the second (`Olena K.`); `phone` → country
and operator code plus the last two digits (`+380 67 *** ** 67`). Full details reach the owner
only in Telegram.

**Transition rules** (anything else → `409 NOT_ALLOWED`, with the current status in `message`):

| Action | Allowed from | When |
|---|---|---|
| confirm | `pending` | before start |
| cancel | `pending`, `confirmed` | before start |
| no-show | `pending`, `confirmed` | after start |

Admin actions send **no** Telegram messages.

### `POST /admin/login`

Body: `{ "username": "demo", "password": "…" }` → `200 { "token": "…", "expiresAt": "2026-12-05T20:00:00.000Z" }`.
Errors: `400 VALIDATION`, `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED` (10 per 60 s per IP).

### `POST /admin/logout`

Ends the session → `200 { "ok": true }`.

### `GET /admin/reservations?date=YYYY-MM-DD`

All reservations of that day (every status), sorted by start time:

```json
{
  "date": "2026-12-05",
  "reservations": [
    { "id": "…", "date": "2026-12-05", "time": "19:00", "endTime": "20:30", "guests": 4,
      "table": "T5", "name": "Olena K.", "phone": "+380 67 *** ** 67",
      "comment": "Window seat if possible", "status": "pending",
      "cancelledBy": null, "cancelReason": null, "notified": true, "demo": false }
  ]
}
```

`notified`: the owner's Telegram message about the booking was delivered. `demo`: created by
the demo-data button. Errors: `400 VALIDATION`, `401 UNAUTHORIZED`.

### `POST /admin/reservations/:id/confirm`
### `POST /admin/reservations/:id/cancel`
### `POST /admin/reservations/:id/no-show`

`cancel` takes an optional body `{ "reason": "…" }` (up to 200 characters), shown to the guest
on the reservation page. Each returns `200 { "reservation": { … } }` (admin shape, as in the
list). Cancel and no-show free the table. Errors: `400 VALIDATION`, `401 UNAUTHORIZED`,
`404 NOT_FOUND`, `409 NOT_ALLOWED`.

From v7 each admin reservation also has `order` (as in [Order object](#order-object), or `null`),
and `cancel` of a booking with a paid order answers `409 PAID_BOOKING`; `no-show` stays allowed.

### `POST /admin/demo-reservations`

Adds up to 6 made-up reservations over the next 3 days at free times (normal booking rules,
no Telegram), marked as demo → `201 { "created": 6 }`. Errors: `401 UNAUTHORIZED`,
`409 DEMO_LIMIT` (20 or more active demo reservations), `429 RATE_LIMITED`.

## Chat (v5)

A scripted chat (no AI) for the landing page (ADR-023, ADR-024). The **server** runs the
dialogue: it keeps the state, writes every text in the guest's language and tells the widget
what input it expects. Bookings, lookups and cancellations go through the same services and
rules as the endpoints above; a booking from the chat sends the usual Telegram message.

**Conversation token.** `POST /chat/sessions` checks a Turnstile token once and returns a chat
token; the other chat endpoints need it as `Authorization: Bearer <token>`. Only its hash is
stored. After 2 hours without messages → `401 CHAT_EXPIRED` (the widget starts a new one).

**Bot turn** — every chat response has this shape:

```json
{
  "messages": [{ "text": "How many guests?" }],
  "input": { "kind": "choices", "options": [{ "id": "1", "label": "1" }, { "id": "2", "label": "2" }, { "id": "menu", "label": "Main menu" }] }
}
```

`input` is one of: `{ "kind": "choices", "options": [{ id, label }] }`,
`{ "kind": "text", "field": "name" | "phone" | "comment" | "link" | "question", "placeholder", "maxLength", "optional", "options": [{ id, label }] }`
(`options` are quick buttons next to the field, such as "Skip" or "Main menu"),
or `{ "kind": "none" }` (the conversation is over; the widget offers to start again).

**Limits:** 30 messages per 60 s per IP (`429 RATE_LIMITED`); 60 guest messages per
conversation (`409 CHAT_LIMIT`); "pass to a person" once per conversation; text answers up to
500 characters.

### `POST /chat/sessions`

Body: `{ "turnstileToken": "…", "locale": "en" | "ru" | "uk" }` →
`201 { "token": "…", "turn": { messages, input } }` (greeting and the main menu).
Errors: `400 VALIDATION`, `400 VERIFICATION_FAILED`, `429 RATE_LIMITED`,
`503 VERIFICATION_UNAVAILABLE`.

### `POST /chat/sessions/current/messages`

Body: `{ "choice": "<option id>" }` when the last turn offered choices, or
`{ "text": "…" }` when it asked for text → `200 { "turn": { messages, input } }`.
A choice that was not offered, or text when choices were expected → `400 VALIDATION`.
Errors: `400 VALIDATION`, `401 CHAT_EXPIRED`, `409 CHAT_CONFLICT`, `409 CHAT_LIMIT`,
`429 RATE_LIMITED`.

### `GET /chat/sessions/current`

The conversation so far (to continue after a page reload):
`200 { "messages": [{ "sender": "guest" | "bot", "text": "…" }], "input": { … } }`.
Errors: `401 CHAT_EXPIRED`.

### AI chat (v6)

`POST /chat/sessions` also takes `"engine": "scripted" | "ai"` (default `"scripted"`). With
`"ai"` the conversation is run by an open model on Cloudflare Workers AI with tool calling
(ADR-026); the endpoints, the bot-turn shape, the conversation token and the busy mark stay the
same.

- The guest writes free text: after an AI turn `input` is `{ "kind": "text", "field": "message", … }`.
- **Actions need a press.** When the AI proposes a booking, a cancellation or a message to the café,
  the turn shows a summary and `input` offers `confirm` / `change` choices (plus the text field).
  Only `{ "choice": "confirm" }` makes the server act — with no model involved — using the same
  services and rules as everywhere else; `change` returns to the conversation.
- A reservation link pasted by the guest is looked up by the server; the model sees only a summary
  and a short booking reference, never the token. Stored transcripts keep links as `#••••`.
- **Daily free limit.** The AI runs inside Cloudflare's free daily quota. When today's limit is used
  up (our own neuron budget, or Cloudflare's quota error), the turn says so, points to the scripted
  chat and has `input: { "kind": "none" }`. The same happens when the model is unavailable.
- Limits for AI conversations: 20 guest messages (`409 CHAT_LIMIT`), messages up to 500
  characters, at most 4 model calls per guest message, plus the chat limiter per IP.

### Admin: `GET /admin/chats` and `GET /admin/chats/:id`

Admin session required (see Admin). The list covers the last 7 days, newest first:
`{ "chats": [{ "id", "startedAt", "locale", "engine": "scripted" | "ai", "outcome": "booked" | "found" | "questions" | "person" | "left", "messages": 12 }] }`
(v6: `engine`; `?engine=ai` or `?engine=scripted` filters the list).
A transcript: `{ "chat": { …list fields, "reservationDate": "2026-12-05" | null }, "messages": [{ "sender", "text", "at" }] }`
— the guest's name and phone answers are masked like reservations; other text is shown as
written. In AI transcripts (v6) the names from proposals (whole words only) and any
phone-number-like text are masked, because the guest can type them anywhere. A name typed in free
text that never reaches a proposal cannot be found reliably, so the AI tab's demo notice says that
phones are hidden and asks for no personal details beyond the name and phone a booking needs
(v6 R3.6). Reservation tokens written anywhere in an AI message are stored as `••••` (v6 R3.1). Conversations older than 7 days are deleted. Errors: `401 UNAUTHORIZED`,
`404 NOT_FOUND`.

## Pre-order and prepayment (v7)

After the café confirms a booking, the guest can pre-order dishes on the reservation page and pay
online with **20% off**. Payments run on **Stripe Checkout in test mode** (Stripe's hosted page;
test cards only, no real money). Decisions: ADR-028, ADR-029.

### Order object

```json
{
  "status": "paid",
  "items": [
    { "id": "cappuccino", "name": "Cappuccino", "quantity": 2, "price": 75 },
    { "id": "croissant", "name": "Croissant", "quantity": 1, "price": 65 }
  ],
  "total": 215,
  "discountPercent": 20,
  "discounted": 172,
  "amount": 344,
  "currency": "eur",
  "rate": 50,
  "paidAt": "2026-11-28T09:12:00.000Z",
  "refundedAt": null
}
```

`price`, `total` and `discounted` are in hryvnias (menu prices; `discounted` after 20% off). The
charge is in **euros** at a fixed demo rate (`rate`: 1 € = 50 ₴, v7 R1): `amount` is in euro cents,
the sum of the lines, each `round(price × 0.8 / rate × 100)` × quantity. Stripe's page shows only
the euro amount (Adaptive Pricing is off).
Item names are stored in English and shown on the site from the menu in the page's language.

```
checkout ──(Stripe: completed)──▶ paid ──(guest cancels)──▶ refunded
                                          └─(refund fails)──▶ refund_failed
checkout ──(Stripe: expired, or a new "Pay")──▶ expired
```

A booking has at most one `paid` order. A paid order cannot be changed.

### `POST /reservations/:token/order`

Body: `{ "items": [{ "itemId": "cappuccino", "quantity": 2 }, …], "locale": "ru" }` — 1 to 10 of
each dish, at least one dish, ids from the menu (`packages/cafe-data`). Prices are taken on the
server; `locale` picks the language of Stripe's page and of the return URL. Allowed for a
`confirmed` booking that has not started and has no paid order; an unfinished `checkout` order is
replaced.

`200` → `{ "url": "https://checkout.stripe.com/…" }` — the guest's browser goes there and comes back
to the reservation page. The session expires after 30 minutes.

Errors: `400 VALIDATION`, `404 NOT_FOUND`, `409 ORDER_NOT_ALLOWED`, `503 PAYMENTS_UNAVAILABLE`.

### `POST /payments/stripe/webhook`

For Stripe only. The raw body is checked against the `Stripe-Signature` header with the webhook
secret. Handled events: `checkout.session.completed` (→ `paid`) and `checkout.session.expired`
(→ `expired`); others are acknowledged and ignored. Changes are conditional (`… WHERE status =
'checkout'`), so a repeated or late event changes nothing. `200 { "received": true }`; errors:
`400 WEBHOOK_SIGNATURE`.

### Side effects

- Paid while the booking is no longer active (cancelled meanwhile, or started): the payment is
  recorded and refunded at once.
- Telegram to the owner: 💳 order paid (dishes, amount), ↩️ refunded, ⚠️ refund failed.

## How double booking is prevented

Each reservation occupies three 30-minute cells `(table, slot)` in `reservation_slots`, whose
primary key is `(table_id, slot)`. The reservation row and its cells are written in one D1
`batch()`, which is a single SQL transaction. If any cell is already taken, the database
rejects the insert and the whole batch rolls back; the API then tries the next suitable table
and answers `409 SLOT_TAKEN` when none is left. See ADR-011.

**See it:** `apps/api/scripts/race.mjs` fires 8 concurrent bookings for 4 guests at one time
and cancels them afterwards. From v3 on it runs against a local API only (Turnstile, see
Conventions). A run against the live API in v2:

```
$ node scripts/race.mjs --base https://booking-demo-api.nick-burdo.workers.dev
Target: 2026-11-28 20:30, 4 guests, 8 concurrent requests

  request  1: 201  reservation d48196ff-…
  request  2: 201  reservation defa2782-…
  request  3: 409  SLOT_TAKEN
  request  4: 409  SLOT_TAKEN
  request  5: 409  SLOT_TAKEN
  request  6: 409  SLOT_TAKEN
  request  7: 201  reservation af5213d8-…
  request  8: 201  reservation e77fd5f9-…

4 booked, 4 SLOT_TAKEN, 0 RATE_LIMITED, 0 other — in 398 ms
OK: 4 booking(s), never more than 4 4-seat tables.
```

The four successful bookings landed on tables T5–T8, one each; no `(table, slot)` pair was
stored twice.
