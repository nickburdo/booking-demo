# Booking API

Status: **v2 and v3 — implemented** (2026-11-21); **v4 changes planned**
(`docs/plans/v4-plan.md`): statuses `confirmed` and `no_show`, the [admin endpoints](#admin-v4)
and new fields on the reservation object. Examples below are real responses from the live v2
API (the example reservation was cancelled afterwards).

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
| 413 | `PAYLOAD_TOO_LARGE` | Request body larger than 10 KB |
| 429 | `RATE_LIMITED` | Too many create (or, v4, admin login / demo data) requests from this IP |
| 500 | `INTERNAL` | Unexpected error (no details exposed) |
| 503 | `VERIFICATION_UNAVAILABLE` | Turnstile could not be reached; the booking is refused, try again (v3) |

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

### `POST /admin/demo-reservations`

Adds up to 6 made-up reservations over the next 3 days at free times (normal booking rules,
no Telegram), marked as demo → `201 { "created": 6 }`. Errors: `401 UNAUTHORIZED`,
`409 DEMO_LIMIT` (20 or more active demo reservations), `429 RATE_LIMITED`.

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
