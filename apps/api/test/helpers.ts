import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import { clock } from "../src/clock";

/** Wednesday 2026-12-02, 10:10 Kyiv time. Tests book on the following days. */
export const NOW = new Date("2026-12-02T08:10:00Z");
export const THURSDAY = "2026-12-03";
export const TEST_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export function pinClock(now: Date = NOW): void {
  vi.spyOn(clock, "now").mockReturnValue(now);
}

export async function clearReservations(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM orders"),
    env.DB.prepare("DELETE FROM reservation_slots"),
    env.DB.prepare("DELETE FROM reservations"),
  ]);
}

let ipCounter = 0;

/** A fresh client IP per request, so the rate limiter does not interfere. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function call(
  path: string,
  init: RequestInit & { ip?: string } = {},
): Promise<Response> {
  const { ip = freshIp(), headers, ...rest } = init;
  return exports.default.fetch(`https://api.test${path}`, {
    ...rest,
    headers: { "cf-connecting-ip": ip, ...headers },
  });
}

export function postJson(path: string, body: unknown, ip?: string): Promise<Response> {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ip,
  });
}

export function booking(overrides: Record<string, unknown> = {}) {
  return {
    date: THURSDAY,
    time: "19:00",
    guests: 4,
    name: "Olena",
    phone: "067 123 45 67",
    // Turnstile test token; siteverify is mocked in test/outbound.ts.
    turnstileToken: TEST_TURNSTILE_TOKEN,
    ...overrides,
  };
}

export async function tableOf(reservationId: string): Promise<{ id: number; seats: number }> {
  const row = await env.DB.prepare(
    "SELECT t.id, t.seats FROM reservations r JOIN tables t ON t.id = r.table_id WHERE r.id = ?",
  )
    .bind(reservationId)
    .first<{ id: number; seats: number }>();
  if (!row) throw new Error(`reservation ${reservationId} not found`);
  return row;
}

/** Polls until fn returns a truthy value (background work after a response). */
export async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
}

export async function notificationColumns(
  id: string,
): Promise<{ notified_at: string | null; cancel_notified_at: string | null }> {
  const row = await env.DB.prepare("SELECT notified_at, cancel_notified_at FROM reservations WHERE id = ?")
    .bind(id)
    .first<{ notified_at: string | null; cancel_notified_at: string | null }>();
  if (!row) throw new Error(`reservation ${id} not found`);
  return row;
}
