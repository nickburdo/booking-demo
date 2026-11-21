# Booking API

Status: **v2 — planned** (contract approved with `docs/plans/v2-plan.md`; examples are
finalised with real responses at the end of v2).

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

  `VALIDATION` errors add `fields`: `{ "fieldName": "message" }`.
- **CORS:** browser requests are allowed only from
  `https://booking-demo-web.nick-burdo.workers.dev` and `http://localhost:3000`.
- **Rate limit:** `POST /reservations` allows 10 requests per 60 seconds per client IP
  (counted per Cloudflare location, so approximate). Over the limit → `429 RATE_LIMITED`.

### Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION` | Missing or malformed field / query parameter |
| 400 | `DATE_OUT_OF_RANGE` | Availability asked for a past date or beyond the 30-day horizon |
| 400 | `TIME_NOT_BOOKABLE` | Start time off the 30-min grid, outside hours, less than 1 h from now, or beyond the horizon |
| 404 | `NOT_FOUND` | Unknown route, or no reservation for this token |
| 409 | `SLOT_TAKEN` | No table for this party size is free for the whole 90 minutes |
| 409 | `NOT_CANCELLABLE` | Reservation already cancelled or already started |
| 429 | `RATE_LIMITED` | Too many create requests from this IP |
| 500 | `INTERNAL` | Unexpected error (no details exposed) |

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

### Status lifecycle

```
v2:  pending ──(guest cancels)──▶ cancelled
v4:  pending ──(owner confirms)──▶ confirmed
     pending / confirmed ──(owner cancels)──▶ cancelled
```

A `pending` reservation already holds its table.

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
{ "date": "2026-12-05", "guests": 4, "times": ["09:00", "09:30", "10:00", "…", "20:30"] }
```

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

```bash
curl -X POST https://booking-demo-api.nick-burdo.workers.dev/reservations \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-12-05","time":"19:00","guests":4,"name":"Olena","phone":"067 123 45 67"}'
```

`201` →

```json
{
  "reservation": { "id": "…", "date": "2026-12-05", "time": "19:00", "endTime": "20:30",
                   "guests": 4, "name": "Olena", "phone": "+380671234567",
                   "comment": null, "status": "pending" },
  "token": "q3J5mY…43 characters…"
}
```

The `token` is shown **only once**. It is the guest's private key to view and cancel the
reservation; only its hash is stored.

Errors: `400 VALIDATION`, `400 TIME_NOT_BOOKABLE`, `409 SLOT_TAKEN`, `429 RATE_LIMITED`.

### `GET /reservations/:token`

```bash
curl https://booking-demo-api.nick-burdo.workers.dev/reservations/<token>
```

`200` → `{ "reservation": { … } }`. Errors: `404 NOT_FOUND`.

### `POST /reservations/:token/cancel`

Allowed while the reservation is `pending` and has not started. Frees the table.

```bash
curl -X POST https://booking-demo-api.nick-burdo.workers.dev/reservations/<token>/cancel
```

`200` → `{ "reservation": { …, "status": "cancelled" } }`.
Errors: `404 NOT_FOUND`, `409 NOT_CANCELLABLE`.

## How double booking is prevented

Each reservation occupies three 30-minute cells `(table, slot)` in `reservation_slots`, whose
primary key is `(table_id, slot)`. The reservation row and its cells are written in one D1
`batch()`, which is a single SQL transaction. If any cell is already taken, the database
rejects the insert and the whole batch rolls back; the API then tries the next suitable table
and answers `409 SLOT_TAKEN` when none is left. See ADR-011.
