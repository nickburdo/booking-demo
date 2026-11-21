import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import { clock } from "../src/clock";

/** Wednesday 2026-12-02, 10:10 Kyiv time. Tests book on the following days. */
export const NOW = new Date("2026-12-02T08:10:00Z");
export const THURSDAY = "2026-12-03";

export function pinClock(now: Date = NOW): void {
  vi.spyOn(clock, "now").mockReturnValue(now);
}

export async function clearReservations(): Promise<void> {
  await env.DB.batch([
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
