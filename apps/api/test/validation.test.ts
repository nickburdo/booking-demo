import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors";
import { availabilityQuery, normalisePhone, parse, reservationBody } from "../src/validation";

const valid = {
  date: "2026-12-05",
  time: "19:00",
  guests: 4,
  name: "Olena",
  phone: "+380671234567",
};

function fieldErrors(input: unknown): Record<string, string> {
  try {
    parse(reservationBody, input);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const e = error as HttpError;
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION");
    return e.fields ?? {};
  }
  throw new Error("expected validation to fail");
}

describe("normalisePhone", () => {
  it("keeps international numbers, stripping spaces, dashes and brackets", () => {
    expect(normalisePhone("+380 67 123 45 67")).toBe("+380671234567");
    expect(normalisePhone("+380 (67) 123-45-67")).toBe("+380671234567");
    expect(normalisePhone("+48 600 700 800")).toBe("+48600700800");
  });

  it("turns a Ukrainian local number into +380", () => {
    expect(normalisePhone("0671234567")).toBe("+380671234567");
    expect(normalisePhone("067 123 45 67")).toBe("+380671234567");
  });

  it("rejects everything else", () => {
    expect(normalisePhone("380671234567")).toBeNull(); // no + and not local
    expect(normalisePhone("067123456")).toBeNull(); // 9 digits
    expect(normalisePhone("+1234567")).toBeNull(); // too short
    expect(normalisePhone("+3806712345678901")).toBeNull(); // too long
    expect(normalisePhone("call me")).toBeNull();
  });
});

describe("reservationBody", () => {
  it("accepts a valid body and normalises it", () => {
    expect(parse(reservationBody, { ...valid, name: "  Olena ", phone: "067 123 45 67" })).toEqual({
      ...valid,
      name: "Olena",
      phone: "+380671234567",
      comment: null,
    });
  });

  it("keeps a comment and treats a blank one as none", () => {
    expect(parse(reservationBody, { ...valid, comment: " Window " }).comment).toBe("Window");
    expect(parse(reservationBody, { ...valid, comment: "  " }).comment).toBeNull();
    expect(parse(reservationBody, { ...valid, comment: null }).comment).toBeNull();
  });

  it("reports each invalid field", () => {
    expect(Object.keys(fieldErrors({ ...valid, name: "   " }))).toEqual(["name"]);
    expect(Object.keys(fieldErrors({ ...valid, name: "x".repeat(81) }))).toEqual(["name"]);
    expect(Object.keys(fieldErrors({ ...valid, guests: 0 }))).toEqual(["guests"]);
    expect(Object.keys(fieldErrors({ ...valid, guests: 5 }))).toEqual(["guests"]);
    expect(Object.keys(fieldErrors({ ...valid, guests: 2.5 }))).toEqual(["guests"]);
    expect(Object.keys(fieldErrors({ ...valid, date: "05.12.2026" }))).toEqual(["date"]);
    expect(Object.keys(fieldErrors({ ...valid, time: "7pm" }))).toEqual(["time"]);
    expect(Object.keys(fieldErrors({ ...valid, phone: "12345" }))).toEqual(["phone"]);
    expect(Object.keys(fieldErrors({ ...valid, comment: "x".repeat(501) }))).toEqual(["comment"]);
  });

  it("reports all missing fields", () => {
    expect(Object.keys(fieldErrors({})).sort()).toEqual(["date", "guests", "name", "phone", "time"]);
  });
});

describe("availabilityQuery", () => {
  it("coerces guests from the query string", () => {
    expect(parse(availabilityQuery, { date: "2026-12-05", guests: "2" })).toEqual({
      date: "2026-12-05",
      guests: 2,
    });
  });

  it("rejects out-of-range guests", () => {
    expect(() => parse(availabilityQuery, { date: "2026-12-05", guests: "9" })).toThrow(HttpError);
  });
});
