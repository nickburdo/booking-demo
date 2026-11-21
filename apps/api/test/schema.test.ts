import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function insertReservation(id: string, tokenHash: string) {
  return env.DB.prepare(
    `INSERT INTO reservations (id, table_id, date, start_time, guests, name, phone, status, token_hash, created_at)
     VALUES (?, 5, '2026-12-05', '19:00', 4, 'Test', '+380671234567', 'pending', ?, '2026-11-21T00:00:00Z')`,
  ).bind(id, tokenHash);
}

function insertSlot(slot: string, reservationId: string) {
  return env.DB.prepare(
    "INSERT INTO reservation_slots (table_id, slot, reservation_id) VALUES (5, ?, ?)",
  ).bind(slot, reservationId);
}

describe("schema", () => {
  it("seeds 8 tables: four with 2 seats, four with 4 seats", async () => {
    const { results } = await env.DB.prepare(
      "SELECT seats, COUNT(*) AS n FROM tables GROUP BY seats ORDER BY seats",
    ).all();
    expect(results).toEqual([
      { seats: 2, n: 4 },
      { seats: 4, n: 4 },
    ]);
  });

  it("rejects a second row for the same table and slot", async () => {
    await env.DB.batch([insertReservation("r1", "h1"), insertSlot("2026-12-05T19:00", "r1")]);
    await expect(insertSlot("2026-12-05T19:00", "r1").run()).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rolls back the whole batch when one slot is already taken", async () => {
    await env.DB.batch([insertReservation("r2", "h2"), insertSlot("2026-12-06T10:00", "r2")]);

    // r3 wants 09:30 (free) and 10:00 (taken by r2): the batch must fail as a whole.
    await expect(
      env.DB.batch([
        insertReservation("r3", "h3"),
        insertSlot("2026-12-06T09:30", "r3"),
        insertSlot("2026-12-06T10:00", "r3"),
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    const r3 = await env.DB.prepare("SELECT id FROM reservations WHERE id = 'r3'").first();
    const free = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reservation_slots WHERE slot = '2026-12-06T09:30'",
    ).first<{ n: number }>();
    expect(r3).toBeNull();
    expect(free?.n).toBe(0);
  });
});
