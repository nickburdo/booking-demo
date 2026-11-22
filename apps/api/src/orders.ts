// Pre-orders with prepayment (v7, ADR-028/029): pricing, the order lifecycle, refunds.
// HTTP-agnostic; throws HttpError. Stripe calls go through `payments`.

import { cafe, type MenuItem } from "@booking-demo/cafe-data";
import { waitUntil } from "cloudflare:workers";
import { HttpError } from "./errors";
import { payments } from "./payments";
import { ACTIVE_STATUSES, findById, findByTokenHash, type ReservationRow } from "./repo";
import { buildOrderMessage, sendTelegram, type OrderNoticeKind, type TelegramConfig } from "./telegram";
import { minutesUntil } from "./time";
import { hashToken } from "./token";
import type { OrderInput } from "./validation";

export const DISCOUNT_PERCENT = 20;
/** Demo rate: menu prices are in hryvnias, the Stripe test account charges euros (v7 R1). */
export const DEMO_EUR_RATE = 50;
export const CURRENCY = "eur";
/** Stripe allows 30 minutes at least; a minute more absorbs clock differences. */
export const CHECKOUT_MINUTES = 31;

export type OrderStatus = "checkout" | "paid" | "expired" | "refunded" | "refund_failed";

export interface OrderItem {
  id: string;
  /** English name, kept for the record; pages show the menu name in their language. */
  name: string;
  quantity: number;
  /** Full price of one, in hryvnias. */
  price: number;
}

export interface OrderRow {
  id: string;
  reservation_id: string;
  items: string;
  total_uah: number;
  discounted_uah: number;
  amount: number;
  currency: string;
  status: OrderStatus;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  refund_id: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
}

/** The order as the guest page and the admin see it (docs/api.md → Order object). */
export interface OrderDto {
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  discountPercent: number;
  discounted: number;
  /** Charged, in euro cents. */
  amount: number;
  currency: string;
  rate: number;
  paidAt: string | null;
  refundedAt: string | null;
}

const MENU = new Map<string, MenuItem>(cafe.menu.flatMap((c) => c.items).map((i) => [i.id, i]));

/** Euro cents for one dish after the discount: price × 0.8 / rate × 100, rounded. */
export function unitCents(priceUah: number): number {
  return Math.round((priceUah * (100 - DISCOUNT_PERCENT)) / DEMO_EUR_RATE);
}

/** "3,44 €" — Telegram is in Ukrainian, which writes a decimal comma. */
export function formatEuro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/** Prices a pre-order from the menu (never from the client, P3). */
export function priceOrder(input: OrderInput["items"]): { items: OrderItem[]; total: number; discounted: number; amount: number } {
  const fields: Record<string, string> = {};
  const items = input.map((line, i) => {
    const dish = MENU.get(line.itemId);
    if (!dish) fields[`items.${i}.itemId`] = "Unknown dish";
    return { id: line.itemId, name: dish?.name.en ?? "", quantity: line.quantity, price: dish?.price ?? 0 };
  });
  if (Object.keys(fields).length > 0) throw new HttpError(400, "VALIDATION", "Unknown dish in the order.", fields);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return {
    items,
    total,
    discounted: Math.round((total * (100 - DISCOUNT_PERCENT)) / 100),
    amount: items.reduce((sum, i) => sum + unitCents(i.price) * i.quantity, 0),
  };
}

export function toOrderDto(row: OrderRow): OrderDto {
  return {
    status: row.status,
    items: JSON.parse(row.items) as OrderItem[],
    total: row.total_uah,
    discountPercent: DISCOUNT_PERCENT,
    discounted: row.discounted_uah,
    amount: row.amount,
    currency: row.currency,
    rate: DEMO_EUR_RATE,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
  };
}

// --- Storage -------------------------------------------------------------------------------

// The order shown for a reservation: a paid one first, then a refund in trouble, a refund, an
// unfinished checkout. Expired ones are never shown.
const SHOWN_ORDER = `ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'refund_failed' THEN 1 WHEN 'refunded' THEN 2 ELSE 3 END, created_at DESC`;

export function findOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<OrderRow>();
}

export function shownOrder(db: D1Database, reservationId: string): Promise<OrderRow | null> {
  return db
    .prepare(`SELECT * FROM orders WHERE reservation_id = ? AND status != 'expired' ${SHOWN_ORDER} LIMIT 1`)
    .bind(reservationId)
    .first<OrderRow>();
}

/** Orders of past payments for the admin list: paid, refunded or refund failed (P10). */
export async function adminOrders(db: D1Database, reservationIds: string[]): Promise<Map<string, OrderDto>> {
  const map = new Map<string, OrderDto>();
  if (reservationIds.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT * FROM orders WHERE reservation_id IN (${reservationIds.map(() => "?").join(", ")})
         AND status IN ('paid', 'refund_failed', 'refunded') ${SHOWN_ORDER}`,
    )
    .bind(...reservationIds)
    .all<OrderRow>();
  for (const row of results) if (!map.has(row.reservation_id)) map.set(row.reservation_id, toOrderDto(row));
  return map;
}

/** Moves an order to `to` if its status is one of `from`; false when another request was first. */
async function moveOrder(db: D1Database, id: string, from: OrderStatus[], to: OrderStatus, set: Record<string, string | null> = {}): Promise<boolean> {
  const columns = Object.keys(set);
  const assignments = ["status = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
  const result = await db
    .prepare(`UPDATE orders SET ${assignments} WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`)
    .bind(to, ...columns.map((c) => set[c]!), id, ...from)
    .run();
  return result.meta.changes === 1;
}

// --- Notifications -------------------------------------------------------------------------

function noticeInBackground(telegram: TelegramConfig, kind: OrderNoticeKind, reservation: ReservationRow, order: OrderRow): void {
  const items = (JSON.parse(order.items) as OrderItem[]).map((i) => ({ name: MENU.get(i.id)?.name.uk ?? i.name, quantity: i.quantity }));
  const text = buildOrderMessage(kind, {
    date: reservation.date,
    time: reservation.start_time,
    name: reservation.name,
    phone: reservation.phone,
    items,
    discountedUah: order.discounted_uah,
    charged: formatEuro(order.amount),
  });
  waitUntil(
    sendTelegram(telegram, text).then(
      (ok) => {
        if (!ok) console.warn(`Order notice (${kind}) was not delivered`);
      },
      (error) => console.error(`Order notice (${kind}) failed:`, error),
    ),
  );
}

// --- Use cases -----------------------------------------------------------------------------

const notAllowed = (message: string) => new HttpError(409, "ORDER_NOT_ALLOWED", message);

function started(r: ReservationRow, now: Date): boolean {
  return minutesUntil(r.date, r.start_time, now) <= 0;
}

/**
 * Creates a pre-order and its Stripe Checkout Session; returns the URL of Stripe's page (P6).
 * The return URLs carry no reservation token: the page keeps it in the browser (Stripe never sees it).
 */
export async function createOrder(db: D1Database, token: string, input: OrderInput, siteUrl: string, now: Date): Promise<{ url: string }> {
  const reservation = await findByTokenHash(db, await hashToken(token));
  if (!reservation) throw new HttpError(404, "NOT_FOUND", "Reservation not found.");
  if (reservation.status !== "confirmed") throw notAllowed("Pre-orders are possible after the café confirms the booking.");
  if (started(reservation, now)) throw notAllowed("The booking has already started.");
  const paid = await db.prepare("SELECT 1 FROM orders WHERE reservation_id = ? AND status = 'paid'").bind(reservation.id).first();
  if (paid) throw notAllowed("This booking already has a paid pre-order.");

  const priced = priceOrder(input.items);

  // A new "Pay" replaces an unfinished checkout; its Stripe page is closed too (best effort).
  const { results: open } = await db
    .prepare("SELECT * FROM orders WHERE reservation_id = ? AND status = 'checkout'")
    .bind(reservation.id)
    .all<OrderRow>();
  for (const old of open) {
    await moveOrder(db, old.id, ["checkout"], "expired");
    if (old.checkout_session_id) await payments.expireCheckout(old.checkout_session_id).catch(() => {});
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO orders (id, reservation_id, items, total_uah, discounted_uah, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'checkout', ?)`,
    )
    .bind(id, reservation.id, JSON.stringify(priced.items), priced.total, priced.discounted, priced.amount, CURRENCY, now.toISOString())
    .run();

  const prefix = input.locale === "en" ? "" : `/${input.locale}`;
  try {
    const session = await payments.createCheckout({
      orderId: id,
      reservationId: reservation.id,
      currency: CURRENCY,
      lines: priced.items.map((item) => ({
        name: `${MENU.get(item.id)!.name[input.locale]} (−${DISCOUNT_PERCENT}%)`,
        unitAmount: unitCents(item.price),
        quantity: item.quantity,
      })),
      successUrl: `${siteUrl}${prefix}/reservation?paid=1`,
      cancelUrl: `${siteUrl}${prefix}/reservation?paid=0`,
      locale: input.locale === "uk" ? "auto" : input.locale,
      expiresAt: new Date(now.getTime() + CHECKOUT_MINUTES * 60_000),
    });
    await db.prepare("UPDATE orders SET checkout_session_id = ? WHERE id = ?").bind(session.id, id).run();
    return { url: session.url };
  } catch (error) {
    await moveOrder(db, id, ["checkout"], "expired");
    throw error;
  }
}

/** Refunds a payment and records the outcome; the idempotency key makes a repeated call harmless. */
async function refundPayment(
  db: D1Database,
  order: OrderRow,
  paymentIntentId: string,
  from: OrderStatus[],
  now: Date,
  telegram: TelegramConfig,
  reservation: ReservationRow,
): Promise<void> {
  const at = now.toISOString();
  let kind: OrderNoticeKind;
  let changed: boolean;
  try {
    const refund = await payments.refund(paymentIntentId, order.id);
    changed = await moveOrder(db, order.id, from, "refunded", { refund_id: refund.id, payment_intent_id: paymentIntentId, paid_at: order.paid_at ?? at, refunded_at: at });
    kind = "refunded";
  } catch (error) {
    console.error(`Refund for order ${order.id} failed:`, error instanceof Error ? error.message : error);
    changed = await moveOrder(db, order.id, from, "refund_failed", { payment_intent_id: paymentIntentId, paid_at: order.paid_at ?? at });
    kind = "refund_failed";
  }
  if (changed) noticeInBackground(telegram, kind, reservation, order);
}

/**
 * Stripe says the order is paid (webhook or return check). Repeated news changes nothing. A payment
 * for a booking that is no longer active, or a second payment of one booking, is refunded at once (P8).
 */
export async function recordPayment(db: D1Database, orderId: string, paymentIntentId: string | null, now: Date, telegram: TelegramConfig): Promise<void> {
  const order = await findOrder(db, orderId);
  if (!order || !paymentIntentId) return;
  if (order.status !== "checkout" && order.status !== "expired") return;
  const reservation = await findById(db, order.reservation_id);
  if (!reservation) return;

  if (ACTIVE_STATUSES.includes(reservation.status) && !started(reservation, now)) {
    try {
      if (await moveOrder(db, order.id, ["checkout", "expired"], "paid", { payment_intent_id: paymentIntentId, paid_at: now.toISOString() })) {
        noticeInBackground(telegram, "paid", reservation, order);
      }
      return;
    } catch (error) {
      // The unique index: this booking already has a paid order, so this payment is a second one.
      if (!String(error).includes("UNIQUE")) throw error;
    }
  }
  await refundPayment(db, order, paymentIntentId, ["checkout", "expired"], now, telegram, reservation);
}

/** Stripe closed the session unpaid. */
export async function recordExpired(db: D1Database, orderId: string): Promise<void> {
  await moveOrder(db, orderId, ["checkout"], "expired");
}

/** The return check (P7b): an order still in checkout asks Stripe for the session's state. */
export async function reconcile(db: D1Database, order: OrderRow, now: Date, telegram: TelegramConfig): Promise<void> {
  if (order.status !== "checkout" || !order.checkout_session_id) return;
  const session = await payments.retrieveCheckout(order.checkout_session_id);
  if (session.status === "complete" && session.paid) await recordPayment(db, order.id, session.paymentIntentId, now, telegram);
  else if (session.status === "expired") await recordExpired(db, order.id);
}

/** The order of a reservation for the guest page, after the return check (errors are logged). */
export async function orderForGuest(db: D1Database, reservationId: string, now: Date, telegram: TelegramConfig): Promise<OrderDto | null> {
  const order = await shownOrder(db, reservationId);
  if (!order) return null;
  if (order.status === "checkout") {
    try {
      await reconcile(db, order, now, telegram);
    } catch (error) {
      console.error(`Return check for order ${order.id} failed:`, error instanceof Error ? error.message : error);
    }
    const fresh = await shownOrder(db, reservationId);
    return fresh ? toOrderDto(fresh) : null;
  }
  return toOrderDto(order);
}

/** After a guest's cancellation (page, scripted or AI chat): refund a paid pre-order (P9). */
export async function refundAfterGuestCancel(db: D1Database, reservation: ReservationRow, now: Date, telegram: TelegramConfig): Promise<void> {
  const order = await db.prepare("SELECT * FROM orders WHERE reservation_id = ? AND status = 'paid'").bind(reservation.id).first<OrderRow>();
  if (!order?.payment_intent_id) return;
  await refundPayment(db, order, order.payment_intent_id, ["paid"], now, telegram, reservation);
}
