// v3 API behaviour: Turnstile on create (ADR-019) and Telegram notifications (ADR-018).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  booking,
  call,
  clearReservations,
  notificationColumns,
  pinClock,
  postJson,
  TEST_TURNSTILE_TOKEN,
  waitFor,
} from "./helpers";
import { outbound } from "./outbound";
import { cancelOrder } from "../src/notify";

beforeEach(async () => {
  pinClock();
  await clearReservations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function create(overrides: Record<string, unknown> = {}, ip?: string) {
  const res = await postJson("/reservations", booking(overrides), ip);
  return { res, body: (await res.json()) as any };
}

describe("Turnstile on POST /reservations", () => {
  it("sends the token, secret and client IP to siteverify", async () => {
    const { res } = await create({}, "198.51.100.20");
    expect(res.status).toBe(201);
    expect(outbound.turnstileCalls).toEqual([
      { secret: "test-turnstile-secret", response: TEST_TURNSTILE_TOKEN, remoteip: "198.51.100.20" },
    ]);
  });

  it("answers 400 VERIFICATION_FAILED without a token, without calling siteverify", async () => {
    const { res, body } = await create({ turnstileToken: undefined });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VERIFICATION_FAILED");
    expect(outbound.turnstileCalls).toHaveLength(0);
  });

  it("answers 400 VERIFICATION_FAILED when Turnstile rejects the token", async () => {
    outbound.turnstile = "failed";
    const { res, body } = await create();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VERIFICATION_FAILED");
  });

  it("fails closed with 503 VERIFICATION_UNAVAILABLE when Turnstile is down", async () => {
    for (const mode of ["network-error", "http-error"] as const) {
      outbound.turnstile = mode;
      const { res, body } = await create();
      expect(res.status, mode).toBe(503);
      expect(body.error.code, mode).toBe("VERIFICATION_UNAVAILABLE");
    }
  });

  it("validates the body before spending the token", async () => {
    const { res, body } = await create({ phone: "nope" });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(outbound.turnstileCalls).toHaveLength(0);
  });

  it("rejects an over-long token as VALIDATION", async () => {
    const { res, body } = await create({ turnstileToken: "x".repeat(2049) });
    expect(res.status).toBe(400);
    expect(body.error.fields).toHaveProperty("turnstileToken");
  });

  it("creates nothing when verification fails", async () => {
    outbound.turnstile = "failed";
    await create();
    const res = await call("/availability?date=2026-12-03&guests=4");
    expect(((await res.json()) as { times: string[] }).times).toContain("19:00");
  });
});

describe("Telegram notifications", () => {
  it("notifies the owner about a new reservation and stamps notified_at", async () => {
    const { res, body } = await create({ comment: "Window <please>" });
    expect(res.status).toBe(201);

    const cols = await waitFor(async () => {
      const c = await notificationColumns(body.reservation.id);
      return c.notified_at ? c : null;
    });
    expect(cols?.notified_at).toBe("2026-12-02T08:10:00.000Z");
    expect(cols?.cancel_notified_at).toBeNull();

    expect(outbound.telegramCalls).toHaveLength(1);
    const [{ url, body: sent }] = outbound.telegramCalls;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    expect(sent).toEqual({
      chat_id: "42",
      parse_mode: "HTML",
      text: [
        "🆕 Нове бронювання",
        "чт, 3 грудня · 19:00–20:30",
        "4 гості · стіл T5",
        "Olena · +380671234567",
        "«Window &lt;please&gt;»",
      ].join("\n"),
    });
  });

  it("still books when Telegram fails, leaving notified_at empty", async () => {
    for (const mode of ["failed", "network-error"] as const) {
      await clearReservations();
      outbound.telegram = mode;
      outbound.telegramCalls = [];
      const { res, body } = await create();
      expect(res.status, mode).toBe(201);
      await waitFor(async () => outbound.telegramCalls.length > 0);
      await new Promise((r) => setTimeout(r, 50));
      expect((await notificationColumns(body.reservation.id)).notified_at, mode).toBeNull();
    }
  });

  it("notifies about a guest cancellation and stamps cancel_notified_at", async () => {
    const { body } = await create({ guests: 2, time: "12:00" });
    await waitFor(async () => (await notificationColumns(body.reservation.id)).notified_at);

    const res = await call(`/reservations/${body.token}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    const cols = await waitFor(async () => {
      const c = await notificationColumns(body.reservation.id);
      return c.cancel_notified_at ? c : null;
    });
    expect(cols?.cancel_notified_at).not.toBeNull();
    expect(outbound.telegramCalls).toHaveLength(2);
    expect(String(outbound.telegramCalls[1].body.text)).toBe(
      ["❌ Скасовано бронювання", "чт, 3 грудня · 12:00–13:30", "2 гості · стіл T1", "Olena · +380671234567"].join(
        "\n",
      ),
    );
  });

  it("sends the cancellation only after the new-booking message", async () => {
    // The "new booking" request to Telegram is slow; the guest cancels at once (R4.4).
    outbound.telegramDelayMs = (text) => (text.startsWith("🆕") ? 300 : 0);
    const { body } = await create({ guests: 2, time: "12:00" });
    const res = await call(`/reservations/${body.token}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    await waitFor(async () => (await notificationColumns(body.reservation.id)).cancel_notified_at, 5000);
    expect(outbound.telegramDone.map((text) => text.split("\n")[0])).toEqual([
      "🆕 Нове бронювання",
      "❌ Скасовано бронювання",
    ]);
  });

  it("still sends the cancellation when the new-booking message failed", async () => {
    const saved = { ...cancelOrder };
    Object.assign(cancelOrder, { intervalMs: 20, maxWaitMs: 200 });
    try {
      outbound.telegram = "failed";
      const { body } = await create({ guests: 2, time: "12:00" });
      await waitFor(async () => outbound.telegramCalls.length > 0);
      outbound.telegram = "ok";

      await call(`/reservations/${body.token}/cancel`, { method: "POST" });
      const cols = await waitFor(async () => {
        const c = await notificationColumns(body.reservation.id);
        return c.cancel_notified_at ? c : null;
      });
      expect(cols?.notified_at).toBeNull();
      expect(cols?.cancel_notified_at).not.toBeNull();
    } finally {
      Object.assign(cancelOrder, saved);
    }
  });

  it("sends nothing when booking fails", async () => {
    outbound.turnstile = "failed";
    await create();
    await new Promise((r) => setTimeout(r, 50));
    expect(outbound.telegramCalls).toHaveLength(0);
  });
});
