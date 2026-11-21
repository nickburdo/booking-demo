// Kyiv wall-clock helpers. Dates are "YYYY-MM-DD", times "HH:MM", both Kyiv local.
// Every rule that depends on the current moment takes `now` as a parameter.

import {
  DURATION_MINUTES,
  HORIZON_DAYS,
  LEAD_MINUTES,
  OPENING_HOURS,
  SLOT_MINUTES,
  SLOTS_PER_RESERVATION,
  TIME_ZONE,
} from "./config";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const kyivFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Current Kyiv local date and minutes since midnight. */
export function kyivNow(now: Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    kyivFormatter.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isValidTime(time: string): boolean {
  return TIME_RE.test(time);
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** All start times on the grid for a date: opening … closing − duration. */
export function startTimesFor(date: string): string[] {
  const hours = OPENING_HOURS[weekday(date)];
  const first = toMinutes(hours.open);
  const last = toMinutes(hours.close) - DURATION_MINUTES;
  const times: string[] = [];
  for (let m = first; m <= last; m += SLOT_MINUTES) times.push(fromMinutes(m));
  return times;
}

export function endTime(time: string): string {
  return fromMinutes(toMinutes(time) + DURATION_MINUTES);
}

/** Slot keys ("YYYY-MM-DDTHH:MM") occupied by a reservation starting at date/time. */
export function slotKeys(date: string, time: string): string[] {
  const start = toMinutes(time);
  return Array.from(
    { length: SLOTS_PER_RESERVATION },
    (_, i) => `${date}T${fromMinutes(start + i * SLOT_MINUTES)}`,
  );
}

/** True if the date is today … today + HORIZON_DAYS (Kyiv). */
export function isDateInRange(date: string, now: Date): boolean {
  const diff = daysBetween(kyivNow(now).date, date);
  return diff >= 0 && diff <= HORIZON_DAYS;
}

/**
 * Wall-clock minutes from now until date/time (Kyiv). DST shifts happen at night,
 * outside opening hours, so wall-clock arithmetic is accurate for bookable times.
 */
export function minutesUntil(date: string, time: string, now: Date): number {
  const current = kyivNow(now);
  return daysBetween(current.date, date) * 24 * 60 + toMinutes(time) - current.minutes;
}

/** All rules for a start time: grid and opening hours, date range, lead time. */
export function isStartBookable(date: string, time: string, now: Date): boolean {
  if (!isValidDate(date) || !isValidTime(time)) return false;
  if (!isDateInRange(date, now)) return false;
  if (!startTimesFor(date).includes(time)) return false;
  return minutesUntil(date, time, now) >= LEAD_MINUTES;
}

/** Start times on a date that are bookable right now (ignoring table occupancy). */
export function bookableTimes(date: string, now: Date): string[] {
  return startTimesFor(date).filter((t) => isStartBookable(date, t, now));
}
