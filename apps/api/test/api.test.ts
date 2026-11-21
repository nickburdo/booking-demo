import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { booking, call, clearReservations, pinClock, postJson, tableOf, THURSDAY } from "./helpers";

beforeEach(async () => {
  pinClock();
  await clearReservations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function availableTimes(date: string, guests: number): Promise<string[]> {
  const res = await call(`/availability?date=${date}&guests=${guests}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { times: string[] }).times;
}

async function create(overrides: Record<string, unknown> = {}) {
  const res = await postJson("/reservations", booking(overrides));
  return { res, body: (await res.json()) as any };
}

describe("GET /availability", () => {
  it("lists every weekday start time on an empty day", async () => {
    const times = await availableTimes(THURSDAY, 4);
    expect(times[0]).toBe("08:00");
    expect(times.at(-1)).toBe("19:30");
    expect(times).toHaveLength(24);
  });

  it("drops times already less than 1 hour away today", async () => {
    expect((await availableTimes("2026-12-02", 2))[0]).toBe("11:30");
  });

  it("rejects bad parameters and dates out of range", async () => {
    const bad = await call("/availability?date=tomorrow&guests=0");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "VALIDATION", fields: { date: expect.any(String), guests: expect.any(String) } },
    });

    const past = await call("/availability?date=2026-12-01&guests=2");
    expect(past.status).toBe(400);
    expect(await past.json()).toMatchObject({ error: { code: "DATE_OUT_OF_RANGE" } });

    const far = await call("/availability?date=2027-01-02&guests=2");
    expect(far.status).toBe(400);
  });

  it("hides a time once every fitting table overlaps it", async () => {
    for (let i = 0; i < 4; i++) expect((await create()).res.status).toBe(201);

    const times = await availableTimes(THURSDAY, 4);
    // 19:00 is taken on all 4-seat tables; 18:00, 18:30 and 19:30 overlap it.
    for (const t of ["18:00", "18:30", "19:00", "19:30"]) expect(times).not.toContain(t);
    expect(times).toContain("17:30");

    // Parties of 2 still have the 2-seat tables.
    expect(await availableTimes(THURSDAY, 2)).toContain("19:00");
  });
});

describe("POST /reservations", () => {
  it("creates a pending reservation and returns a token once", async () => {
    const { res, body } = await create({ comment: "Window seat" });
    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.reservation).toEqual({
      id: expect.any(String),
      date: THURSDAY,
      time: "19:00",
      endTime: "20:30",
      guests: 4,
      name: "Olena",
      phone: "+380671234567",
      comment: "Window seat",
      status: "pending",
    });
    expect(body.reservation).not.toHaveProperty("table_id");

    const stored = await env.DB.prepare("SELECT token_hash FROM reservations").first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(body.token);
  });

  it("answers 409 SLOT_TAKEN when no fitting table is left", async () => {
    for (let i = 0; i < 4; i++) expect((await create()).res.status).toBe(201);
    const { res, body } = await create();
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("SLOT_TAKEN");
  });

  it("blocks overlapping starts on the same table but allows back-to-back", async () => {
    for (let i = 0; i < 4; i++) await create({ time: "12:00" });
    expect((await create({ time: "13:00" })).res.status).toBe(409); // overlaps 12:00–13:30
    expect((await create({ time: "13:30" })).res.status).toBe(201); // starts when it ends
  });

  it("gives the smallest fitting table, then a 4-seat one when 2-seat tables are full", async () => {
    const seats: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { body } = await create({ guests: 2 });
      seats.push((await tableOf(body.reservation.id)).seats);
    }
    expect(seats).toEqual([2, 2, 2, 2, 4]);
  });

  it("rejects times that cannot be booked", async () => {
    const cases = [
      { time: "19:15" }, // off grid
      { time: "07:30" }, // before opening
      { time: "20:00" }, // would end after closing
      { date: "2026-12-02", time: "11:00" }, // less than 1 hour away
      { date: "2027-01-02", time: "12:00" }, // beyond 30 days
      { date: "2026-12-01", time: "12:00" }, // in the past
    ];
    for (const c of cases) {
      const { res, body } = await create(c);
      expect(res.status, JSON.stringify(c)).toBe(400);
      expect(body.error.code, JSON.stringify(c)).toBe("TIME_NOT_BOOKABLE");
    }
  });

  it("rejects an invalid body with field errors", async () => {
    const res = await postJson("/reservations", { date: THURSDAY, guests: 7, phone: "12" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("VALIDATION");
    expect(Object.keys(body.error.fields).sort()).toEqual(["guests", "name", "phone", "time"]);
  });

  it("rejects malformed JSON", async () => {
    const res = await call("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION" } });
  });

  it("answers 413 PAYLOAD_TOO_LARGE for a body over 10 KB", async () => {
    const res = await postJson("/reservations", booking({ comment: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("answers 400 VALIDATION for an unreadable body", async () => {
    const res = await call("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json; charset=koi8-r" },
      body: JSON.stringify(booking()),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "VALIDATION", message: "Request body could not be read." },
    });
  });
});

describe("GET /reservations/:token", () => {
  it("returns the reservation for its token", async () => {
    const { body } = await create();
    const res = await call(`/reservations/${body.token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reservation: body.reservation });
  });

  it("answers 404 for an unknown token", async () => {
    const res = await call("/reservations/not-a-real-token");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("POST /reservations/:token/cancel", () => {
  it("cancels, frees the time, and refuses a second cancel", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) tokens.push((await create()).body.token);
    expect(await availableTimes(THURSDAY, 4)).not.toContain("19:00");

    const res = await call(`/reservations/${tokens[0]}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reservation: { status: "cancelled" } });

    expect(await availableTimes(THURSDAY, 4)).toContain("19:00");
    expect((await create()).res.status).toBe(201);

    const again = await call(`/reservations/${tokens[0]}/cancel`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "NOT_CANCELLABLE" } });
  });

  it("refuses to cancel a reservation that has started", async () => {
    const { body } = await create({ time: "12:00" });
    pinClock(new Date("2026-12-03T10:00:00Z")); // Thursday 12:00 Kyiv
    const res = await call(`/reservations/${body.token}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("answers 404 for an unknown token", async () => {
    const res = await call("/reservations/nope/cancel", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("unknown routes", () => {
  it("answer 404 NOT_FOUND as JSON", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });
});
