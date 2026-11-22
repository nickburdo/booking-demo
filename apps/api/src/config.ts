// Booking rules and opening hours. Mirrors docs/cafe.md ("Opening hours", "Tables",
// "Booking rules"); docs/cafe.md is the source of truth.

import { openingHoursByWeekday } from "@booking-demo/cafe-data";

export const TIME_ZONE = "Europe/Kyiv";

/** Browser origins allowed to call the API (docs/api.md, ADR-015); the first is the live site. */
export const ALLOWED_ORIGINS = ["https://booking-demo-web.nick-burdo.workers.dev", "http://localhost:3000"];

export const SLOT_MINUTES = 30;
export const DURATION_MINUTES = 90;
export const SLOTS_PER_RESERVATION = DURATION_MINUTES / SLOT_MINUTES;

/** A reservation must start at least this many minutes from now. */
export const LEAD_MINUTES = 60;
/** Bookable dates: today .. today + HORIZON_DAYS. */
export const HORIZON_DAYS = 30;

export const MIN_GUESTS = 1;
export const MAX_GUESTS = 4;

/** Opening hours by weekday, 0 = Sunday … 6 = Saturday (Kyiv local time), from the shared café data (ADR-025). */
export const OPENING_HOURS: Record<number, { open: string; close: string }> = openingHoursByWeekday();
