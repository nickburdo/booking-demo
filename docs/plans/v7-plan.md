# v7 plan — Pre-order with prepayment in Stripe test mode

- **Status:** Approved (2026-11-22) — in progress
- **Scope:** stage v7 of the roadmap (`docs/overview.md`): the bridge from booking to purchase. After
  the café **confirms** a booking, the guest can **pre-order dishes** from the menu on the private
  reservation page and **pay online with a 20% discount**. Payment runs on **Stripe Checkout in test
  mode** (Stripe's hosted payment page, test cards only, no real money). After payment the café can
  no longer cancel the booking; a guest's cancellation **refunds** the payment automatically; a
  no-show keeps it. The aim is the general payment mechanism — create a payment, pay at the
  provider, signed notification, our status, refund — not the business rules of a real café.
- **Out of scope:** real payments (live mode is never used); a pre-order without payment; changing
  a paid order (cancel and book again instead); partial refunds; paying in the chats (they only
  remind); tips, delivery, takeaway; fiscal receipts and e-mail receipts; other providers; automated
  tests for `apps/web` (ADR-016).
- **Testing:** the API's Stripe calls go through one adapter that tests replace (like the AI model
  in v6); webhook signatures are tested with Stripe's own test-header helper. Real test-mode
  payments run in the manual checks (Phase 5) and on the live site. Pages checked by hand on the
  built site, 375 / 768 / 1280 px, EN / RU / UK. Code review before merge.

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | **What is paid:** a pre-order of dishes from the menu, with a **20% discount** for paying online. Only together with payment: no unpaid pre-orders | user |
| D2 | **When:** on the private reservation page, **after the café confirmed** the booking | user |
| D3 | **Reminder at booking:** wherever the guest learns the booking was made, a short note says that after the café confirms, dishes can be pre-ordered and paid with 20% off | user |
| D4 | **After payment the café cannot cancel** the booking (no "Cancel" in the admin for a paid one) | user |
| D5 | **Guest cancels a paid booking** (before it starts, as today) → **full refund** | user |
| D6 | **No-show keeps the payment**; "No-show" stays available to the café for a paid booking | user (agreed proposal) |
| D7 | **A paid order cannot be changed**: cancel (refund) and book again | user (agreed proposal) |
| D8 | Provider: **Stripe**, **test mode only** | user |
| D9 | Integration: **Stripe Checkout, hosted page** (redirect to Stripe and back) — the same create → pay at the provider → signed notification → our status pattern most providers use | user |
| D10 | Git: plan and docs on `main`; work on `feature/v7-prepayment` from up-to-date `main`; code review before merge | project rules |

### Proposed technical details (my calls — object if you disagree)

| # | Proposal | Rationale |
|---|---|---|
| P1 | **SDK:** the official `stripe` npm package in `apps/api`, created with `Stripe.createFetchHttpClient()`; webhooks verified with `stripe.webhooks.constructEventAsync` and `Stripe.createSubtleCryptoProvider()` (stripe-node docs: the Workers/Web build uses the fetch client and SubtleCrypto; async verification is required there). All Stripe calls sit in one adapter `payments.ts` (`createCheckout`, `retrieveCheckout`, `refund`, `verifyWebhook`) that tests replace | Docs-backed fit for Workers; tests never call Stripe |
| P2 | **Test mode guard:** the API refuses to make payments unless the secret key starts with `sk_test_` (error `PAYMENTS_UNAVAILABLE`) | A demo must never take real money, even by a mistaken key |
| P3 | **Prices on the server:** the browser sends only `[{ itemId, quantity }]`; the server takes names and prices from `packages/cafe-data`, applies 20% and builds the Checkout line items (`price_data`, per dish, unit price = price × 80 kopecks — exact for whole-hryvnia prices). Limits: 1–10 of each dish, at least one dish | Never trust prices from the client; one source of truth (ADR-025) |
| P4 | **Currency: UAH** (menu prices are in UAH). Checked in step 1.4 on the test account; if Stripe refuses UAH → stop, plan revision (e.g. EUR at a fixed demo rate) | Docs did not confirm UAH for every account country |
| P5 | **Data:** migration `0007`, table `orders`: `id`, `reservation_id`, `items` (JSON: id, name, quantity, unit price), `total_uah` (full price), `amount` (charged, in kopecks), `currency`, `status` (`checkout` → `paid` → `refunded` / `refund_failed`; `checkout` → `expired`), `checkout_session_id`, `payment_intent_id`, `refund_id`, timestamps. At most one `paid` order per reservation (partial unique index). A new "Pay" press replaces an unfinished `checkout` order | Explicit payment lifecycle; the database guards double payment (like ADR-007 for slots) |
| P6 | **Guest endpoints:** `POST /reservations/:token/order` `{ items }` → creates the order and a Checkout Session (`mode: payment`, `metadata.order_id`, `client_reference_id`, `expires_at` in 30 minutes, `success_url` / `cancel_url` back to the reservation page) → `{ url }`; allowed only for a confirmed booking that has not started and has no paid order. `GET /reservations/:token` adds `order` (items, totals, status) | Small surface; the page already loads the reservation |
| P7 | **Two ways to learn about a payment, both idempotent:** (a) webhook `POST /payments/stripe/webhook` (raw body, signature checked) for `checkout.session.completed` and `checkout.session.expired`; (b) when the reservation page loads with an order still in `checkout`, the API asks Stripe for the session (`retrieveCheckout`) and records the result. Status changes are conditional updates (`… WHERE status = 'checkout'`), so a repeated or late event changes nothing | Webhooks can be late, repeated or (locally) absent; the return check makes local development work without a tunnel and shows the guest the result at once |
| P8 | **Paid after the booking was cancelled** (the café cancelled while the guest was on Stripe's page, or the booking started): the payment is recorded and **refunded at once** | The classic race of hosted payments; no money kept without a booking |
| P9 | **Guest cancellation with a paid order** — from the reservation page, the scripted chat or the AI chat (all go through the guest cancel service): the booking is cancelled first, then the refund is requested (`refunds.create` by payment intent). Refund failure → order `refund_failed`, a Telegram alert to the owner, the guest sees "the refund is being processed"; the admin shows the state | One refund path for every interface; a failed refund is visible, never silent |
| P10 | **Admin:** a paid booking hides "Cancel" (API refuses it: `409 PAID_BOOKING`) and keeps "No-show"; the day list shows a "Paid" tag and the order (dishes, amount, status) in the details | D4, D6 |
| P11 | **Telegram to the owner:** 💳 order paid (dishes, amount), ↩️ refunded, ⚠️ refund failed | Same channel as new / cancelled bookings |
| P12 | **Reservation page UI:** a "Pre-order" block on a confirmed booking (menu by category with − / + counters, full total, total after 20%, "Pay N ₴", demo note with the test card `4242 4242 4242 4242`); "Checking the payment…" after the return while the order is in `checkout`; "Paid" with the dish list after payment; refunded / refund-failed states. **New mockup** before code (Phase 2), like v4 / v5 | New UI; the look is the user's to approve |
| P13 | **Reminder texts (D3):** the form's success screen, the reservation page while `pending`, the scripted chat's and the AI chat's "booked" message (server texts) | D3 |
| P14 | **Secrets:** `STRIPE_SECRET_KEY` (`sk_test_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`) as Worker secrets, set by the user with `wrangler secret put`; locally in git-ignored `.dev.vars`. Never pasted in the chat, never printed | Project security rules |
| P15 | **Local webhook:** optional, with the Stripe CLI (`stripe listen --forward-to localhost:8787/payments/stripe/webhook`) if the user installs it; without it, local checks rely on P7(b), and the webhook is checked on the live site | No mandatory extra tool |
| P16 | **Docs:** `docs/api.md` (order endpoints, `order` in the reservation, webhook, new errors), ADR-028 (payments: Stripe Checkout hosted page, webhook + return check, server-side prices, test mode only), ADR-029 (prepayment rules D1–D7), `docs/architecture.md`, `docs/setup-integrations.md` §8 (Stripe test account, keys, webhook endpoint, secrets) | Docs before code (ADR-005) |

## Known risks

- **R1 — Stripe account from Ukraine.** Stripe does not list Ukraine; the user may have to pick
  another country at sign-up. Test mode needs no activation (Stripe docs). If sign-up is impossible
  → stop, plan revision (monobank test token or LiqPay sandbox, same mechanism).
- **R2 — UAH not accepted** for the chosen account country → P4 (revision to EUR).
- **R3 — Worker bundle size.** The `stripe` package adds to the Worker (now ~460 KB gzip of the 3 MB
  free limit). Checked in 1.5; if too big → revision (direct REST calls with `fetch`).
- **R4 — public demo.** Anyone can pay with test cards and trigger refunds; test mode moves no real
  money and real cards are declined. Accepted, like ADR-021.
- **R5 — webhook delivery.** Late or repeated events are handled by P7; a missed event is covered by
  the return check.

## Phase 0 — Documentation (on `main`, before code; ADR-005)

### 0.1 This plan approved.
### 0.2 `docs/api.md`: order endpoints, `order` in the reservation, webhook, errors.
### 0.3 `docs/decisions.md`: ADR-028, ADR-029.
### 0.4 `docs/architecture.md`: "v7 — planned"; `docs/setup-integrations.md` §8 Stripe.
- **Done when:** docs committed on `main` (ask first).

## Phase 1 — Setup

### 1.1 Branch `feature/v7-prepayment` from up-to-date `main` (warn first if a dev server runs).
### 1.2 The user creates a Stripe account (test mode, no activation) following §8.
### 1.3 The user puts the test keys into `apps/api/.dev.vars` (not in the chat).
### 1.4 Check: a test Checkout Session in UAH can be created (P4). **Done when:** the session URL opens
  Stripe's page with the amount in UAH.
### 1.5 Add `stripe` to `apps/api`; check the Worker bundle size (R3).

## Phase 2 — Mockup

### 2.1 HTML mockup of the reservation page states (pre-order, checking, paid, refunded) and the admin
  paid tag + order, EN, 375 / 1280 px.
- **Done when:** the user approves the mockup.

## Phase 3 — API

### 3.1 Migration 0007 `orders` (P5).
### 3.2 Payments adapter `payments.ts` with the test-mode guard (P1, P2) and its test replacement.
### 3.3 Pricing from `cafe-data` with the discount and limits (P3).
### 3.4 `POST /reservations/:token/order` → Checkout Session (P6).
### 3.5 `order` in `GET /reservations/:token` + the return check (P6, P7b).
### 3.6 Webhook endpoint with raw body and signature check; completed / expired (P7a).
### 3.7 Paid-after-cancel refund (P8).
### 3.8 Refund on guest cancellation in the shared guest cancel path (P9).
### 3.9 Admin: refuse "Cancel" for a paid booking; order in the admin DTO (P10).
### 3.10 Telegram messages 💳 / ↩️ / ⚠️ (P11).
### 3.11 Reminder in the scripted and AI chat "booked" texts (P13).
### 3.12 Tests: pricing, order rules (not confirmed / started / already paid), session creation,
  webhook signature (valid, invalid), completed and expired, repeated event, return check, paid
  after cancel → refund, guest cancel → refund, refund failure, admin cancel refused for paid,
  no-show allowed, test-mode guard.
- **Done when:** full suite + typecheck green.

## Phase 4 — Web

### 4.1 Reservation page: pre-order block, pay redirect, checking / paid / refunded states (P12).
### 4.2 Reminder on the form's success screen and the pending reservation page (P13).
### 4.3 Admin: paid tag, order details, no "Cancel" for paid (P10).
### 4.4 i18n EN / RU / UK.
- **Done when:** works locally against the local API with real test-mode payments.

## Phase 5 — Manual verification (built site, `generate:local` + local API, Stripe test mode)

### 5.1 Responsive and languages for the new blocks.
### 5.2 Pay with `4242 4242 4242 4242` → paid; a declined card (`4000 0000 0000 0002`) → stays
  unpaid; leave Stripe's page with "back" → can pay again.
### 5.3 Guest cancels a paid booking → refund visible in Stripe's dashboard and on the page.
### 5.4 Admin: paid tag and order; "Cancel" absent; "No-show" after the start works.
### 5.5 Telegram messages arrive (local, with the real bot as in v3).
- **Done when:** all pass; issues fixed within scope or raised.

## Phase 6 — Deploy (ask before each)

### 6.1 Remote migration 0007 (backup first).
### 6.2 The user sets the two Stripe secrets; the user adds the webhook endpoint in Stripe's dashboard
  (events `checkout.session.completed`, `checkout.session.expired`) following §8.
### 6.3 Deploy API.
### 6.4 Deploy web.
### 6.5 Live check: book → confirm in the admin → pre-order → pay → webhook marks it paid → guest
  cancels → refund; test bookings cleaned up.

## Phase 7 — Review and wrap-up

### 7.1 Code review of `main...feature/v7-prepayment`; fixes via plan revision.
### 7.2 README (pre-order and test payments, demo limitations: test mode, test cards), `docs/architecture.md`
  (v7 implemented, learned), this plan → Done.
### 7.3 Merge into `main`, push (ask first, separate commands); delete the branch.

## Revision R1 (2026-11-22) — pay in euros at a fixed demo rate (approved)

**Trigger:** step 1.2. Stripe does not offer Ukraine at sign-up; the user created the test account
as Germany (`country: DE`, default currency EUR). The user decided not to try UAH (P4) and to
charge in **euros at a fixed rate**, since it is a demo. Step 1.4 check: a test Checkout Session in
EUR is created and opens. Stripe's **Adaptive Pricing** then offered the guest a UAH price at its
own rate (+4%); with `adaptive_pricing[enabled]=false` only the euro amount is shown (checked).

**Decisions (user):**
- Menu prices stay in hryvnias on the site; the charge is in **EUR** at a fixed demo rate of
  **1 € = 50 ₴** (one constant in the code, labelled as a demo rate).
- **Euros only** on Stripe's page: every Checkout Session sets `adaptive_pricing[enabled]=false`.

**Changes to the plan:**
- P3: each line item's unit price in euro cents = `round(price_uah × 0.8 / 50 × 100)`; the charged
  amount is the sum of the lines (so Stripe's total and ours always match).
- P4: replaced by the above (UAH is not used for payments).
- P5: `orders.amount` is in euro cents, `currency = 'eur'`; `total_uah` (full) and the discounted
  hryvnia total are kept for display.
- P12: the pre-order block shows the totals in hryvnias and the charge in euros, e.g. "215 ₴ →
  172 ₴ with 20% off · you pay 3,44 € (demo rate 1 € = 50 ₴)".
- Risk R2 closed. Docs: `docs/api.md` (order object), ADR-028 (currency) updated.

**Business name on Stripe's page:** the sandbox's name ("Nick Burdo sandbox", the owner's name)
cannot be changed without verifying a business (the dashboard locks "Manage sandboxes"). Every
Checkout Session therefore sets `branding_settings[display_name]=Linden Coffee`, so the page shows
the café's name (checked). Only the browser tab title keeps the sandbox name; accepted by the user.

## Revision R2 (2026-11-22) — card payments only (approved)

**Trigger:** the Phase 4 check on Stripe's page. Besides cards, Stripe offered MB WAY, Bancontact,
Satispay and EPS (the account's dynamic payment methods). Some methods confirm the payment later,
with a separate event (`checkout.session.async_payment_succeeded`), which the API does not handle:
such an order would stay unpaid.

**Decision (user):** every Checkout Session accepts cards only. Implemented with
`allowed_payment_method_types: ["card"]`: from Stripe API version `2026-09-30` the older
`payment_method_types` cannot be passed (Stripe docs, "Restrict payment methods in code"). The demo stays
on the clear path card → paid → refund. Docs: `docs/api.md` (pre-order), ADR-028.
