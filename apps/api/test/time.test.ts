import { describe, expect, it } from "vitest";
import {
  bookableTimes,
  endTime,
  isDateInRange,
  isStartBookable,
  isValidDate,
  kyivNow,
  minutesUntil,
  slotKeys,
  startTimesFor,
} from "../src/time";

// Wednesday 2026-12-02, 10:10 in Kyiv (UTC+2 in winter).
const WED_1010 = new Date("2026-12-02T08:10:00Z");
const WEDNESDAY = "2026-12-02";
const SATURDAY = "2026-12-05";

describe("kyivNow", () => {
  it("converts winter time (UTC+2)", () => {
    expect(kyivNow(WED_1010)).toEqual({ date: WEDNESDAY, minutes: 10 * 60 + 10 });
  });

  it("converts summer time (UTC+3)", () => {
    expect(kyivNow(new Date("2026-07-01T05:00:00Z"))).toEqual({ date: "2026-07-01", minutes: 8 * 60 });
  });

  it("rolls over to the Kyiv date before UTC midnight", () => {
    expect(kyivNow(new Date("2026-12-02T22:30:00Z")).date).toBe("2026-12-03");
  });
});

describe("startTimesFor", () => {
  it("weekday: 08:00 … 19:30 every 30 minutes", () => {
    const times = startTimesFor(WEDNESDAY);
    expect(times[0]).toBe("08:00");
    expect(times.at(-1)).toBe("19:30");
    expect(times).toHaveLength(24);
    expect(times).toContain("08:30");
  });

  it("weekend: 09:00 … 20:30", () => {
    const times = startTimesFor(SATURDAY);
    expect(times[0]).toBe("09:00");
    expect(times.at(-1)).toBe("20:30");
    expect(times).toHaveLength(24);
  });
});

describe("slots and end time", () => {
  it("a reservation occupies three 30-minute slots", () => {
    expect(slotKeys(WEDNESDAY, "19:30")).toEqual([
      "2026-12-02T19:30",
      "2026-12-02T20:00",
      "2026-12-02T20:30",
    ]);
  });

  it("ends 90 minutes after the start", () => {
    expect(endTime("19:30")).toBe("21:00");
  });
});

describe("date range", () => {
  it("accepts today and today + 30 days", () => {
    expect(isDateInRange(WEDNESDAY, WED_1010)).toBe(true);
    expect(isDateInRange("2027-01-01", WED_1010)).toBe(true);
  });

  it("rejects yesterday and today + 31 days", () => {
    expect(isDateInRange("2026-12-01", WED_1010)).toBe(false);
    expect(isDateInRange("2027-01-02", WED_1010)).toBe(false);
  });

  it("rejects impossible dates", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
  });
});

describe("isStartBookable", () => {
  it("rejects times less than 1 hour away", () => {
    expect(isStartBookable(WEDNESDAY, "11:00", WED_1010)).toBe(false); // 50 min
    expect(isStartBookable(WEDNESDAY, "11:30", WED_1010)).toBe(true); // 80 min
  });

  it("accepts a start exactly 1 hour away", () => {
    const wed1000 = new Date("2026-12-02T08:00:00Z");
    expect(minutesUntil(WEDNESDAY, "11:00", wed1000)).toBe(60);
    expect(isStartBookable(WEDNESDAY, "11:00", wed1000)).toBe(true);
  });

  it("rejects off-grid and out-of-hours starts", () => {
    expect(isStartBookable("2026-12-03", "10:15", WED_1010)).toBe(false);
    expect(isStartBookable("2026-12-03", "07:30", WED_1010)).toBe(false);
    expect(isStartBookable("2026-12-03", "19:30", WED_1010)).toBe(true);
    expect(isStartBookable("2026-12-03", "20:00", WED_1010)).toBe(false);
    expect(isStartBookable(SATURDAY, "20:30", WED_1010)).toBe(true);
  });

  it("rejects dates outside the horizon", () => {
    expect(isStartBookable("2027-01-01", "12:00", WED_1010)).toBe(true);
    expect(isStartBookable("2027-01-02", "12:00", WED_1010)).toBe(false);
  });
});

describe("bookableTimes", () => {
  it("today starts at the first time at least 1 hour away", () => {
    const times = bookableTimes(WEDNESDAY, WED_1010);
    expect(times[0]).toBe("11:30");
    expect(times.at(-1)).toBe("19:30");
  });

  it("is empty after the last start of the day", () => {
    expect(bookableTimes(WEDNESDAY, new Date("2026-12-02T18:00:00Z"))).toEqual([]); // 20:00
  });
});
