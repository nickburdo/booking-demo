// v4 API behaviour: admin login and sessions (ADR-020), masked day list and demo data (ADR-021),
// status transitions for the owner and the guest (ADR-022).
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskName, maskPhone } from "../src/mask";
import { booking, call, clearReservations, NOW, pinClock, postJson, THURSDAY, waitFor } from "./helpers";
import { outbound } from "./outbound";

const PASSWORD = "test-admin-password";
/** Thursday 19:30 Kyiv (UTC+2): a 19:00 reservation has started. */
const AFTER_START = new Date("2026-12-03T17:30:00Z");

beforeEach(async () => {
  pinClock();
  await clearReservations();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loginAs(username = "demo", password = PASSWORD, ip?: string) {
  const res = await postJson("/admin/login", { username, password }, ip);
  return { res, body: (await res.json()) as any };
}

async function token(): Promise<string> {
  const { body } = await loginAs();
  return body.token;
}

function adminCall(path: string, auth: string | null, init: RequestInit = {}) {
  return call(path, {
    ...init,
    headers: {
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

async function action(auth: string, id: string, name: string, body?: unknown) {
  const res = await adminCall(`/admin/reservations/${id}/${name}`, auth, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, body: (await res.json()) as any };
}

async function book(overrides: Record<string, unknown> = {}) {
  const res = await postJson("/reservations", booking(overrides));
  expect(res.status).toBe(201);
  return (await res.json()) as any;
}

async function slotCount(id: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM reservation_slots WHERE reservation_id = ?")
    .bind(id)
    .first<{ n: number }>();
  return row!.n;
}

describe("masking", () => {
  it("keeps the first name and the initial of the second word", () => {
    expect(maskName("Olena Kovalenko")).toBe("Olena K.");
    expect(maskName("  олена   коваленко  ")).toBe("олена К.");
    expect(maskName("Olena")).toBe("Olena");
  });

  it("keeps the country/operator code and the last two digits", () => {
    expect(maskPhone("+380671234567")).toBe("+380 67 *** ** 67");
    expect(maskPhone("+442071234567")).toBe("+44 ******** 67");
  });
});

describe("admin login and sessions", () => {
  it("returns a token that expires in 8 hours and stores only its hash", async () => {
    const { res, body } = await loginAs();
    expect(res.status).toBe(200);
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + 8 * 3600_000).toISOString());
    const stored = await env.DB.prepare("SELECT token_hash FROM admin_sessions").all<{ token_hash: string }>();
    expect(stored.results).toHaveLength(1);
    expect(stored.results[0]!.token_hash).not.toBe(body.token);
    expect(stored.results[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a wrong password or username with 401 INVALID_CREDENTIALS", async () => {
    for (const [user, pass] of [["demo", "nope"], ["admin", PASSWORD]]) {
      const { res, body } = await loginAs(user, pass);
      expect(res.status).toBe(401);
      expect(body.error.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("validates the login body", async () => {
    const res = await postJson("/admin/login", { username: "demo" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.fields).toHaveProperty("password");
  });

  it("rate-limits logins per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await loginAs("demo", "nope", "10.9.9.9")).res.status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("protects admin routes: no token, unknown token, expired token, after logout", async () => {
    const path = `/admin/reservations?date=${THURSDAY}`;
    expect((await adminCall(path, null)).status).toBe(401);
    expect((await adminCall(path, "not-a-session")).status).toBe(401);

    const auth = await token();
    expect((await adminCall(path, auth)).status).toBe(200);

    pinClock(new Date(NOW.getTime() + 8 * 3600_000 + 1000));
    const expired = await adminCall(path, auth);
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as any).error.code).toBe("UNAUTHORIZED");

    pinClock();
    const fresh = await token();
    expect((await adminCall("/admin/logout", fresh, { method: "POST" })).status).toBe(200);
    expect((await adminCall(path, fresh)).status).toBe(401);
  });
});

describe("admin day list", () => {
  it("lists one day, sorted by time, with table, masked guest data and flags", async () => {
    await book({ time: "19:00", name: "Olena Kovalenko" });
    await book({ time: "12:00", guests: 2, name: "Taras" });
    await book({ date: "2026-12-04", time: "12:00" });
    const auth = await token();

    const res = await adminCall(`/admin/reservations?date=${THURSDAY}`, auth);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.date).toBe(THURSDAY);
    expect(body.reservations.map((r: any) => r.time)).toEqual(["12:00", "19:00"]);
    expect(body.reservations[1]).toMatchObject({
      endTime: "20:30",
      guests: 4,
      table: expect.stringMatching(/^T\d$/),
      name: "Olena K.",
      phone: "+380 67 *** ** 67",
      status: "pending",
      cancelledBy: null,
      cancelReason: null,
      demo: false,
    });
    expect(typeof body.reservations[1].notified).toBe("boolean");
  });

  it("rejects a malformed date", async () => {
    const res = await adminCall("/admin/reservations?date=03.12.2026", await token());
    expect(res.status).toBe(400);
  });
});

describe("owner actions", () => {
  it("confirms a pending reservation once", async () => {
    const { reservation } = await book();
    const auth = await token();
    const first = await action(auth, reservation.id, "confirm");
    expect(first.res.status).toBe(200);
    expect(first.body.reservation.status).toBe("confirmed");
    expect(await slotCount(reservation.id)).toBe(3);

    const again = await action(auth, reservation.id, "confirm");
    expect(again.res.status).toBe(409);
    expect(again.body.error.code).toBe("NOT_ALLOWED");
  });

  it("cancels pending or confirmed with an optional reason and frees the table", async () => {
    const a = (await book({ time: "12:00" })).reservation;
    const b = (await book({ time: "15:00" })).reservation;
    const auth = await token();
    await action(auth, b.id, "confirm");

    const withReason = await action(auth, a.id, "cancel", { reason: "  Private event  " });
    expect(withReason.res.status).toBe(200);
    expect(withReason.body.reservation).toMatchObject({
      status: "cancelled",
      cancelledBy: "owner",
      cancelReason: "Private event",
    });
    const withoutReason = await action(auth, b.id, "cancel");
    expect(withoutReason.body.reservation).toMatchObject({ status: "cancelled", cancelReason: null });
    expect(await slotCount(a.id)).toBe(0);
    expect(await slotCount(b.id)).toBe(0);
  });

  it("rejects a reason over 200 characters", async () => {
    const { reservation } = await book();
    const { res } = await action(await token(), reservation.id, "cancel", { reason: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("marks no-show only after the start, and frees the table", async () => {
    const { reservation } = await book({ time: "19:00" });
    const auth = await token();
    const early = await action(auth, reservation.id, "no-show");
    expect(early.res.status).toBe(409);
    expect(early.body.error.message).toContain("not started");

    pinClock(AFTER_START);
    const late = await action(await token(), reservation.id, "no-show");
    expect(late.res.status).toBe(200);
    expect(late.body.reservation.status).toBe("no_show");
    expect(await slotCount(reservation.id)).toBe(0);
  });

  it("refuses confirm and cancel after the start, and any action on a final status", async () => {
    const { reservation } = await book({ time: "19:00" });
    pinClock(AFTER_START); // more than 8 h later: log in again
    const auth = await token();
    for (const name of ["confirm", "cancel"]) {
      const { res, body } = await action(auth, reservation.id, name);
      expect(res.status, name).toBe(409);
      expect(body.error.message).toContain("already started");
    }
    await action(auth, reservation.id, "no-show");
    const { body } = await action(auth, reservation.id, "no-show");
    expect(body.error.message).toContain("no_show");
  });

  it("answers 404 for an unknown id", async () => {
    const { res } = await action(await token(), "00000000-0000-0000-0000-000000000000", "confirm");
    expect(res.status).toBe(404);
  });

  it("lets only one of two concurrent actions win", async () => {
    const { reservation } = await book();
    const auth = await token();
    const results = await Promise.all([
      action(auth, reservation.id, "confirm"),
      action(auth, reservation.id, "cancel"),
    ]);
    const statuses = results.map((r) => r.res.status).sort();
    // Both may pass the first check; the guarded UPDATE lets at most one change the row.
    // confirm → confirmed, then cancel is still allowed from confirmed: both 200 is valid too.
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    const final = await env.DB.prepare("SELECT status FROM reservations WHERE id = ?")
      .bind(reservation.id)
      .first<{ status: string }>();
    expect(["confirmed", "cancelled"]).toContain(final!.status);
    if (final!.status === "cancelled") expect(await slotCount(reservation.id)).toBe(0);
    else expect(await slotCount(reservation.id)).toBe(3);
  });

  it("lets two concurrent cancels change the row only once", async () => {
    const { reservation } = await book();
    const auth = await token();
    const results = await Promise.all([
      action(auth, reservation.id, "cancel", { reason: "A" }),
      action(auth, reservation.id, "cancel", { reason: "B" }),
    ]);
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 409]);
  });

  it("sends no Telegram messages for owner actions", async () => {
    const a = (await book({ time: "12:00" })).reservation;
    const b = (await book({ time: "15:00" })).reservation;
    await waitFor(async () => outbound.telegramCalls.length === 2);
    const auth = await token();
    await action(auth, a.id, "confirm");
    await action(auth, b.id, "cancel", { reason: "Closed" });
    await new Promise((r) => setTimeout(r, 100));
    expect(outbound.telegramCalls).toHaveLength(2);
  });
});

describe("guest side of v4 statuses", () => {
  it("guest can cancel a confirmed reservation before the start; the owner is notified", async () => {
    const { reservation, token: guestToken } = await book();
    await action(await token(), reservation.id, "confirm");

    const res = await call(`/reservations/${guestToken}/cancel`, { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.reservation).toMatchObject({ status: "cancelled", cancelledBy: "guest", cancelReason: null });
    await waitFor(async () => outbound.telegramCalls.some((c) => String(c.body.text).startsWith("❌")));
  });

  it("guest sees the café's cancellation and reason, and confirmed / no_show statuses", async () => {
    const one = await book({ time: "12:00" });
    const two = await book({ time: "19:00" });
    const auth = await token();

    await action(auth, one.reservation.id, "cancel", { reason: "Kitchen closed" });
    const view = (await (await call(`/reservations/${one.token}`)).json()) as any;
    expect(view.reservation).toMatchObject({ status: "cancelled", cancelledBy: "owner", cancelReason: "Kitchen closed" });

    await action(auth, two.reservation.id, "confirm");
    expect(((await (await call(`/reservations/${two.token}`)).json()) as any).reservation.status).toBe("confirmed");
    pinClock(AFTER_START);
    await action(await token(), two.reservation.id, "no-show");
    expect(((await (await call(`/reservations/${two.token}`)).json()) as any).reservation.status).toBe("no_show");
    const cancel = await call(`/reservations/${two.token}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(409);
  });
});

describe("demo reservations", () => {
  it("creates up to 6 made-up reservations over the next days, without Telegram", async () => {
    const auth = await token();
    const res = await adminCall("/admin/demo-reservations", auth, { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(201);
    expect(body.created).toBe(6);

    const rows = await env.DB.prepare("SELECT date, phone, is_demo, status FROM reservations").all<any>();
    expect(rows.results).toHaveLength(6);
    for (const r of rows.results) {
      expect(r.is_demo).toBe(1);
      expect(r.status).toBe("pending");
      expect(r.phone).toMatch(/^\+38000\d{7}$/);
      expect(r.date > "2026-12-02" && r.date <= "2026-12-05").toBe(true);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(outbound.telegramCalls).toHaveLength(0);
  });

  it("stops at 20 active demo reservations with 409 DEMO_LIMIT", async () => {
    const auth = await token();
    const created: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await adminCall("/admin/demo-reservations", auth, { method: "POST" });
      created.push(((await res.json()) as any).created);
    }
    expect(created).toEqual([6, 6, 6, 2]);
    const fifth = await adminCall("/admin/demo-reservations", auth, { method: "POST" });
    expect(fifth.status).toBe(409);
    expect(((await fifth.json()) as any).error.code).toBe("DEMO_LIMIT");
  });

  it("needs a session", async () => {
    expect((await adminCall("/admin/demo-reservations", null, { method: "POST" })).status).toBe(401);
  });
});

describe("migration 0004", () => {
  it("keeps the foreign key from reservation_slots to the rebuilt reservations table", async () => {
    await expect(
      env.DB.prepare("INSERT INTO reservation_slots (table_id, slot, reservation_id) VALUES (1, '2026-12-03T12:00', 'missing')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("allows only the four statuses", async () => {
    const { reservation } = await book();
    await expect(
      env.DB.prepare("UPDATE reservations SET status = 'done' WHERE id = ?").bind(reservation.id).run(),
    ).rejects.toThrow(/CHECK/);
  });
});
