import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { booking, clearReservations, pinClock, postJson, THURSDAY } from "./helpers";

// Locally D1 is one SQLite file, so this proves the unique key + retry logic,
// not behaviour under real distributed load (v2 plan, R-T3; see scripts/race.mjs).
describe("concurrent bookings of one slot", () => {
  beforeEach(async () => {
    pinClock();
    await clearReservations();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    "run %i: 8 parallel requests for 4 guests → exactly 4 succeed",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          postJson("/reservations", booking({ name: `Guest ${i + 1}` })),
        ),
      );
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 201, 409, 409, 409, 409]);

      const slots = await env.DB.prepare(
        "SELECT table_id, slot, COUNT(*) AS n FROM reservation_slots WHERE slot LIKE ? GROUP BY table_id, slot",
      )
        .bind(`${THURSDAY}T%`)
        .all<{ table_id: number; n: number }>();
      expect(slots.results).toHaveLength(12); // 4 tables × 3 slots
      expect(slots.results.every((r) => r.n === 1)).toBe(true);
      expect(new Set(slots.results.map((r) => r.table_id))).toEqual(new Set([5, 6, 7, 8]));
    },
  );
});
