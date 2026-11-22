// v7: pre-orders paid on Stripe Checkout in test mode (ADR-028/029). Stripe is replaced by a fake
// (test/outbound.ts); webhook signatures are real, made with Stripe's own test-header helper.
import { env } from "cloudflare:workers";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceOrder, unitCents } from "../src/orders";
import { booking, call, clearReservations, NOW, pinClock, postJson, THURSDAY, waitFor } from "./helpers";
import { outbound, realPayments } from "./outbound";

beforeEach(async () => {
  pinClock();
  await clearReservations();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ---------------------------------------------------------------------------------

const ORDER = [
  { itemId: "cappuccino", quantity: 2 },
  { itemId: "croissant", quantity: 1 },
];

async function adminToken(): Promise<string> {
  const res = await postJson("/admin/login", { username: "demo", password: "test-admin-password" });
  return ((await res.json()) as any).token;
}

async function admin(path: string, token: string, method = "POST") {
  const res = await call(path, { method, headers: { authorization: `Bearer ${token}` } });
  return { res, body: (await res.json()) as any };
}

/** A booking on Thursday that the café has confirmed. */
async function confirmedBooking(time = "15:00") {
  const made = (await (await postJson("/reservations", booking({ time, guests: 2 }))).json()) as any;
  await admin(`/admin/reservations/${made.reservation.id}/confirm`, await adminToken());
  return made as { token: string; reservation: { id: string } };
}

function order(token: string, body: unknown = { items: ORDER, locale: "en" }, origin = "http://localhost:3000") {
  return call(`/reservations/${token}/order`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const orderRow = () => env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC").first<any>();
const reservationOf = async (token: string) => (await (await call(`/reservations/${token}`)).json()) as any;
const telegramTexts = () => outbound.telegramCalls.map((c) => String(c.body.text));

function sessionEvent(type: "checkout.session.completed" | "checkout.session.expired", s: { id: string; orderId: string; paymentIntent?: string }) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type,
    data: {
      object: {
        id: s.id,
        object: "checkout.session",
        status: type === "checkout.session.completed" ? "complete" : "expired",
        payment_status: type === "checkout.session.completed" ? "paid" : "unpaid",
        payment_intent: s.paymentIntent ?? null,
        metadata: { order_id: s.orderId },
      },
    },
  };
}

async function webhook(event: unknown, secret = "whsec_test_secret") {
  const payload = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, cryptoProvider: Stripe.createSubtleCryptoProvider() });
  return call("/payments/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
}

/** Confirmed booking + order + a completed payment (by webhook). */
async function paidBooking() {
  const made = await confirmedBooking();
  await order(made.token);
  const row = await orderRow();
  await webhook(sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_test_1" }));
  return made;
}

// --- tests -----------------------------------------------------------------------------------

describe("pricing (P3, R1)", () => {
  it("takes prices from the menu, applies 20% and charges euro cents at 1 € = 50 ₴", () => {
    expect(unitCents(75)).toBe(120);
    expect(unitCents(65)).toBe(104);
    expect(priceOrder(ORDER)).toEqual({
      items: [
        { id: "cappuccino", name: "Cappuccino", quantity: 2, price: 75 },
        { id: "croissant", name: "Croissant", quantity: 1, price: 65 },
      ],
      total: 215,
      discounted: 172,
      amount: 344,
    });
  });
});

describe("creating a pre-order", () => {
  it("opens a Stripe Checkout Session in euros with the menu names and no token in the return URLs", async () => {
    const made = await confirmedBooking();
    const res = await order(made.token, { items: ORDER, locale: "ru" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/cs_test_1" });

    const req = outbound.stripe.checkouts[0]!;
    expect(req.currency).toBe("eur");
    expect(req.lines).toEqual([
      { name: "Капучино (−20%)", unitAmount: 120, quantity: 2 },
      { name: "Круассан (−20%)", unitAmount: 104, quantity: 1 },
    ]);
    expect(req.successUrl).toBe("http://localhost:3000/ru/reservation?paid=1");
    expect(req.cancelUrl).toBe("http://localhost:3000/ru/reservation?paid=0");
    expect(req.locale).toBe("ru");
    expect(req.expiresAt.getTime() - NOW.getTime()).toBe(31 * 60_000);
    expect(JSON.stringify(req)).not.toContain(made.token);

    const row = await orderRow();
    expect(row).toMatchObject({ status: "checkout", amount: 344, currency: "eur", total_uah: 215, discounted_uah: 172, checkout_session_id: "cs_test_1" });
    expect((await reservationOf(made.token)).order).toMatchObject({ status: "checkout", amount: 344, discounted: 172, rate: 50, discountPercent: 20 });
  });

  it("shows Stripe's page in the browser's language for Ukrainian (Stripe has no Ukrainian)", async () => {
    const made = await confirmedBooking();
    await order(made.token, { items: ORDER, locale: "uk" });
    expect(outbound.stripe.checkouts[0]!.locale).toBe("auto");
    expect(outbound.stripe.checkouts[0]!.successUrl).toBe("http://localhost:3000/uk/reservation?paid=1");
  });

  it("refuses a booking that is not confirmed, has started or is already paid", async () => {
    const pending = (await (await postJson("/reservations", booking({ time: "16:00", guests: 2 }))).json()) as any;
    const r1 = await order(pending.token);
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as any).error.code).toBe("ORDER_NOT_ALLOWED");

    const paid = await paidBooking();
    expect((await order(paid.token)).status).toBe(409);

    const later = await confirmedBooking("12:00");
    pinClock(new Date(`${THURSDAY}T10:05:00Z`)); // 12:05 in Kyiv
    expect((await order(later.token)).status).toBe(409);
  });

  it("validates the dishes: known ids, 1–10 each, no repeats, at least one", async () => {
    const made = await confirmedBooking();
    for (const items of [[{ itemId: "pizza", quantity: 1 }], [{ itemId: "latte", quantity: 11 }], [{ itemId: "latte", quantity: 1 }, { itemId: "latte", quantity: 2 }], []]) {
      const res = await order(made.token, { items });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("VALIDATION");
    }
    expect(outbound.stripe.checkouts).toHaveLength(0);
  });

  it("replaces an unfinished checkout and closes its Stripe page", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    await order(made.token, { items: [{ itemId: "latte", quantity: 1 }] });
    const { results } = await env.DB.prepare("SELECT status, checkout_session_id FROM orders ORDER BY created_at, rowid").all<any>();
    expect(results.map((r) => r.status)).toEqual(["expired", "checkout"]);
    expect(outbound.stripe.expired).toEqual(["cs_test_1"]);
  });

  it("answers 503 when Stripe fails and leaves no open order", async () => {
    const made = await confirmedBooking();
    outbound.stripe.failCheckout = true;
    const res = await order(made.token);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe("PAYMENTS_UNAVAILABLE");
    expect((await orderRow()).status).toBe("expired");
  });

  it("refuses to work with a key that is not a test key (P2)", async () => {
    const original = env.STRIPE_SECRET_KEY;
    (env as any).STRIPE_SECRET_KEY = "sk_live_123";
    try {
      await expect(
        realPayments.createCheckout({ orderId: "o", reservationId: "r", currency: "eur", lines: [], successUrl: "x", cancelUrl: "x", locale: "en", expiresAt: NOW }),
      ).rejects.toMatchObject({ code: "PAYMENTS_UNAVAILABLE" });
    } finally {
      (env as any).STRIPE_SECRET_KEY = original;
    }
  });
});

describe("learning about the payment", () => {
  it("rejects a webhook without a valid signature", async () => {
    const bad = await webhook(sessionEvent("checkout.session.completed", { id: "cs_x", orderId: "o" }), "whsec_wrong");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe("WEBHOOK_SIGNATURE");
    const none = await call("/payments/stripe/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(none.status).toBe(400);
  });

  it("marks the order paid from the webhook, tells the owner once, ignores a repeat", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const row = await orderRow();
    const event = sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_test_1" });
    expect((await webhook(event)).status).toBe(200);
    expect(await webhook(event)).toHaveProperty("status", 200);

    expect(await orderRow()).toMatchObject({ status: "paid", payment_intent_id: "pi_test_1", paid_at: NOW.toISOString() });
    await waitFor(async () => telegramTexts().some((t) => t.startsWith("💳")));
    const paidNotice = telegramTexts().filter((t) => t.startsWith("💳"));
    expect(paidNotice).toHaveLength(1);
    expect(paidNotice[0]).toContain("Капучино × 2, Круасан × 1");
    expect(paidNotice[0]).toContain("172 ₴ · 3,44 €");
  });

  it("marks the order expired from the webhook", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const row = await orderRow();
    await webhook(sessionEvent("checkout.session.expired", { id: row.checkout_session_id, orderId: row.id }));
    expect((await orderRow()).status).toBe("expired");
    expect((await reservationOf(made.token)).order).toBeNull();
  });

  it("acknowledges other events without changes", async () => {
    const res = await webhook({ id: "evt_1", object: "event", type: "charge.updated", data: { object: {} } });
    expect(res.status).toBe(200);
  });

  it("checks Stripe when the guest returns while the order is still in checkout (return check)", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    expect((await reservationOf(made.token)).order.status).toBe("checkout");
    outbound.stripe.sessions.set("cs_test_1", { id: "cs_test_1", status: "complete", paid: true, paymentIntentId: "pi_test_9", orderId: (await orderRow()).id });
    expect((await reservationOf(made.token)).order).toMatchObject({ status: "paid", amount: 344 });
  });
});

describe("refunds", () => {
  it("refunds a paid pre-order when the guest cancels", async () => {
    const made = await paidBooking();
    const res = await call(`/reservations/${made.token}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reservation.status).toBe("cancelled");
    expect(body.order).toMatchObject({ status: "refunded" });
    expect(outbound.stripe.refunds).toEqual([{ paymentIntentId: "pi_test_1", orderId: (await orderRow()).id }]);
    await waitFor(async () => telegramTexts().some((t) => t.startsWith("↩️")));
  });

  it("records a failed refund and alerts the owner", async () => {
    const made = await paidBooking();
    outbound.stripe.failRefund = true;
    const body = (await (await call(`/reservations/${made.token}/cancel`, { method: "POST" })).json()) as any;
    expect(body.reservation.status).toBe("cancelled");
    expect(body.order.status).toBe("refund_failed");
    await waitFor(async () => telegramTexts().some((t) => t.startsWith("⚠️")));
  });

  it("refunds at once a payment that arrives after the booking was cancelled (P8)", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const row = await orderRow();
    await call(`/reservations/${made.token}/cancel`, { method: "POST" });
    await webhook(sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_late" }));
    expect(await orderRow()).toMatchObject({ status: "refunded", payment_intent_id: "pi_late" });
    expect(outbound.stripe.refunds.map((r) => r.paymentIntentId)).toEqual(["pi_late"]);
  });

  it("refunds a second payment of the same booking (e.g. an old browser tab)", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const first = await orderRow();
    await order(made.token);
    const second = await orderRow();
    await webhook(sessionEvent("checkout.session.completed", { id: second.checkout_session_id, orderId: second.id, paymentIntent: "pi_a" }));
    await webhook(sessionEvent("checkout.session.completed", { id: first.checkout_session_id, orderId: first.id, paymentIntent: "pi_b" }));
    const { results } = await env.DB.prepare("SELECT id, status FROM orders").all<any>();
    expect(Object.fromEntries(results.map((r) => [r.id, r.status]))).toEqual({ [second.id]: "paid", [first.id]: "refunded" });
    expect((await reservationOf(made.token)).order.status).toBe("paid");
  });

  it("refunds when the guest cancels a paid booking from the scripted chat too", async () => {
    // The chat cancel path ends in the same afterGuestCancel as the page (index.ts).
    const made = await paidBooking();
    const chat = (await (await postJson("/chat/sessions", { turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", locale: "en" })).json()) as any;
    const say = (body: unknown) =>
      call("/chat/sessions/current/messages", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}` }, body: JSON.stringify(body) });
    await say({ choice: "find" });
    await say({ text: made.token });
    await say({ choice: "cancel" });
    const r = (await (await say({ choice: "yes" })).json()) as any;
    expect(JSON.stringify(r)).toContain("cancel");
    expect((await orderRow()).status).toBe("refunded");
  });
});

describe("admin and paid bookings (P10)", () => {
  it("refuses Cancel for a paid booking, shows the order, allows No-show after the start", async () => {
    const made = await paidBooking();
    const token = await adminToken();
    const cancel = await admin(`/admin/reservations/${made.reservation.id}/cancel`, token);
    expect(cancel.res.status).toBe(409);
    expect(cancel.body.error.code).toBe("PAID_BOOKING");

    const day = await admin(`/admin/reservations?date=${THURSDAY}`, token, "GET");
    expect(day.body.reservations[0].order).toMatchObject({ status: "paid", discounted: 172, amount: 344, items: [{ id: "cappuccino", quantity: 2 }, { id: "croissant", quantity: 1 }] });

    pinClock(new Date(`${THURSDAY}T13:10:00Z`)); // 15:10 in Kyiv
    // The admin session from before is too old by then; log in again.
    const noShow = await admin(`/admin/reservations/${made.reservation.id}/no-show`, await adminToken());
    expect(noShow.res.status).toBe(200);
    expect(noShow.body.reservation).toMatchObject({ status: "no_show", order: { status: "paid" } });
  });

  it("still lets the café cancel an unpaid booking (an unfinished checkout does not block it)", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const cancel = await admin(`/admin/reservations/${made.reservation.id}/cancel`, await adminToken());
    expect(cancel.res.status).toBe(200);
  });
});

describe("reminder at booking (D3)", () => {
  it("mentions the pre-order in the chat's booked message", async () => {
    const { TEXTS } = await import("../src/chat/texts");
    expect(TEXTS.en.preorderHint).toContain("20%");
    expect(TEXTS.ru.preorderHint).toContain("20%");
    expect(TEXTS.uk.preorderHint).toContain("20%");
  });
});

describe("code review fixes (v7 R3)", () => {
  /** A temporary SQLite trigger that makes one kind of write fail, to simulate a D1 error. */
  async function failWrites(name: string, when: string) {
    await env.DB.prepare(`CREATE TRIGGER ${name} BEFORE UPDATE ON orders WHEN ${when} BEGIN SELECT RAISE(ABORT, 'simulated D1 failure'); END`).run();
    return () => env.DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }

  it("R3.1: accepts a payment started before the booking and finished after its start", async () => {
    const made = await confirmedBooking("12:00");
    pinClock(new Date(`${THURSDAY}T09:50:00Z`)); // 11:50 in Kyiv: Pay is pressed
    await order(made.token);
    const row = await orderRow();
    pinClock(new Date(`${THURSDAY}T10:02:00Z`)); // 12:02: the card is entered, the webhook arrives
    await webhook(sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_late_ok" }));
    expect((await orderRow()).status).toBe("paid");
    expect(outbound.stripe.refunds).toHaveLength(0);
  });

  it("R3.2: refunds a payment whose booking is no longer live when the payment is written", async () => {
    // The booking's state is checked in the same UPDATE that marks the order paid.
    const made = await confirmedBooking();
    await order(made.token);
    const row = await orderRow();
    await env.DB.prepare("UPDATE reservations SET status = 'no_show'").run();
    await webhook(sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_race" }));
    expect((await orderRow()).status).toBe("refunded");
    expect(outbound.stripe.refunds.map((r) => r.paymentIntentId)).toEqual(["pi_race"]);
  });

  it("R3.2: a repeated payment notice after the first one changes nothing and refunds nothing", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const row = await orderRow();
    const event = sessionEvent("checkout.session.completed", { id: row.checkout_session_id, orderId: row.id, paymentIntent: "pi_once" });
    await webhook(event);
    outbound.stripe.sessions.set(row.checkout_session_id, { id: row.checkout_session_id, status: "complete", paid: true, paymentIntentId: "pi_once", orderId: row.id });
    await reservationOf(made.token); // the return check sees the same payment
    expect((await orderRow()).status).toBe("paid");
    expect(outbound.stripe.refunds).toHaveLength(0);
  });

  it("R3.3: the guest's cancel succeeds even if recording the refund fails", async () => {
    const made = await paidBooking();
    const restore = await failWrites("fail_refund", "NEW.status IN ('refunded', 'refund_failed')");
    try {
      const res = await call(`/reservations/${made.token}/cancel`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).reservation.status).toBe("cancelled");
    } finally {
      await restore();
    }
  });

  it("R3.4: a cancel closes the booking's open checkout and its Stripe page (guest and café)", async () => {
    const guest = await confirmedBooking("15:00");
    await order(guest.token);
    await call(`/reservations/${guest.token}/cancel`, { method: "POST" });
    expect((await orderRow()).status).toBe("expired");
    expect(outbound.stripe.expired).toEqual(["cs_test_1"]);

    const cafe = await confirmedBooking("18:00");
    await order(cafe.token);
    await admin(`/admin/reservations/${cafe.reservation.id}/cancel`, await adminToken());
    expect((await orderRow()).status).toBe("expired");
    expect(outbound.stripe.expired).toEqual(["cs_test_1", "cs_test_2"]);
  });

  it("R3.5: closes Stripe's page when its id cannot be stored", async () => {
    const made = await confirmedBooking();
    const restore = await failWrites("fail_session_id", "NEW.checkout_session_id IS NOT NULL");
    try {
      const res = await order(made.token);
      expect(res.status).toBe(500);
      expect((await orderRow()).status).toBe("expired");
      expect(outbound.stripe.expired).toEqual(["cs_test_1"]);
    } finally {
      await restore();
    }
  });

  it("R3.8: the admin shows a failed refund before the paid order", async () => {
    const made = await confirmedBooking();
    await order(made.token);
    const first = await orderRow();
    await order(made.token);
    const second = await orderRow();
    await webhook(sessionEvent("checkout.session.completed", { id: second.checkout_session_id, orderId: second.id, paymentIntent: "pi_a" }));
    outbound.stripe.failRefund = true;
    await webhook(sessionEvent("checkout.session.completed", { id: first.checkout_session_id, orderId: first.id, paymentIntent: "pi_b" }));
    const day = await admin(`/admin/reservations?date=${THURSDAY}`, await adminToken(), "GET");
    expect(day.body.reservations[0].order.status).toBe("refund_failed");
    expect((await reservationOf(made.token)).order.status).toBe("paid");
  });
});
