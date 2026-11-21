// Booking rules and opening hours. Mirrors docs/cafe.md ("Opening hours", "Tables",
// "Booking rules"); docs/cafe.md is the source of truth.

export const TIME_ZONE = "Europe/Kyiv";

export const SLOT_MINUTES = 30;
export const DURATION_MINUTES = 90;
export const SLOTS_PER_RESERVATION = DURATION_MINUTES / SLOT_MINUTES;

/** A reservation must start at least this many minutes from now. */
export const LEAD_MINUTES = 60;
/** Bookable dates: today .. today + HORIZON_DAYS. */
export const HORIZON_DAYS = 30;

export const MIN_GUESTS = 1;
export const MAX_GUESTS = 4;

/** Opening hours by weekday, 0 = Sunday … 6 = Saturday (Kyiv local time). */
export const OPENING_HOURS: Record<number, { open: string; close: string }> = {
  0: { open: "09:00", close: "22:00" },
  1: { open: "08:00", close: "21:00" },
  2: { open: "08:00", close: "21:00" },
  3: { open: "08:00", close: "21:00" },
  4: { open: "08:00", close: "21:00" },
  5: { open: "08:00", close: "21:00" },
  6: { open: "09:00", close: "22:00" },
};
