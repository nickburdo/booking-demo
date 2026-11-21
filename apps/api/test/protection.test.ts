import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { booking, call, clearReservations, pinClock, postJson } from "./helpers";

beforeEach(async () => {
  pinClock();
  await clearReservations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CORS", () => {
  it("allows the live site and localhost", async () => {
    for (const origin of ["https://booking-demo-web.nick-burdo.workers.dev", "http://localhost:3000"]) {
      const res = await call("/reservations", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("sends no CORS headers to other origins", async () => {
    const res = await call("/health", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("rate limit on POST /reservations", () => {
  it("answers 429 RATE_LIMITED after 10 requests a minute from one IP", async () => {
    const ip = "203.0.113.7";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // Invalid bodies are still counted: the limit is checked before validation.
      statuses.push((await postJson("/reservations", {}, ip)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);

    const res = await postJson("/reservations", booking(), ip);
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    // Another IP is not affected.
    expect((await postJson("/reservations", booking(), "203.0.113.8")).status).toBe(201);
  });
});
