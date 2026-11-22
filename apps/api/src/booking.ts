// Booking services: availability, create, view, cancel. HTTP-agnostic; throw HttpError.

import { HttpError } from "./errors";
import {
  ACTIVE_STATUSES,
  cancelReservation,
  findById,
  findByTokenHash,
  findFreeTables,
  insertReservation,
  isSlotConflict,
  occupiedSlots,
  tablesFor,
  type ReservationRow,
} from "./repo";
import { bookableTimes, endTime, isDateInRange, isStartBookable, minutesUntil, slotKeys } from "./time";
import { generateToken, hashToken } from "./token";
import type { ReservationInput } from "./validation";

/** Guest-facing reservation (no table id, no token hash). */
export interface ReservationDto {
  id: string;
  date: string;
  time: string;
  endTime: string;
  guests: number;
  name: string;
  phone: string;
  comment: string | null;
  status: ReservationRow["status"];
  /** v4: who cancelled, and the café's optional reason (docs/api.md). */
  cancelledBy: ReservationRow["cancelled_by"];
  cancelReason: string | null;
}

export function toDto(row: ReservationRow): ReservationDto {
  return {
    id: row.id,
    date: row.date,
    time: row.start_time,
    endTime: endTime(row.start_time),
    guests: row.guests,
    name: row.name,
    phone: row.phone,
    comment: row.comment,
    status: row.status,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
  };
}

/** Start times on `date` at which some fitting table is free for the whole duration. */
export async function getAvailability(
  db: D1Database,
  date: string,
  guests: number,
  now: Date,
): Promise<string[]> {
  if (!isDateInRange(date, now)) {
    throw new HttpError(400, "DATE_OUT_OF_RANGE", "Date is in the past or beyond the booking horizon.");
  }
  const [tables, occupied] = await Promise.all([tablesFor(db, guests), occupiedSlots(db, date)]);
  return bookableTimes(date, now).filter((time) => {
    const slots = slotKeys(date, time);
    return tables.some((t) => slots.every((s) => !occupied.get(t.id)?.has(s)));
  });
}

export async function createReservation(
  db: D1Database,
  input: ReservationInput,
  now: Date,
  options: { demo?: boolean } = {},
): Promise<{ reservation: ReservationDto; token: string; row: ReservationRow }> {
  if (!isStartBookable(input.date, input.time, now)) {
    throw new HttpError(
      400,
      "TIME_NOT_BOOKABLE",
      "This start time cannot be booked (grid, opening hours, lead time or horizon).",
    );
  }

  const slots = slotKeys(input.date, input.time);
  const token = generateToken();
  const base: Omit<ReservationRow, "table_id"> = {
    id: crypto.randomUUID(),
    date: input.date,
    start_time: input.time,
    guests: input.guests,
    name: input.name,
    phone: input.phone,
    comment: input.comment,
    status: "pending",
    token_hash: await hashToken(token),
    created_at: now.toISOString(),
    cancelled_at: null,
    notified_at: null,
    cancel_notified_at: null,
    confirmed_at: null,
    no_show_at: null,
    cancelled_by: null,
    cancel_reason: null,
    is_demo: options.demo ? 1 : 0,
  };

  // Try free tables smallest-first. A conflict means another request took that table
  // between our read and our write; the batch was rolled back, so try the next one.
  for (const table of await findFreeTables(db, input.guests, slots)) {
    const row: ReservationRow = { ...base, table_id: table.id };
    try {
      await insertReservation(db, row, slots);
      return { reservation: toDto(row), token, row };
    } catch (error) {
      if (!isSlotConflict(error)) throw error;
    }
  }

  throw new HttpError(
    409,
    "SLOT_TAKEN",
    `No table is free for ${input.guests} guests at ${input.time}.`,
  );
}

export async function getReservation(db: D1Database, token: string): Promise<ReservationDto> {
  return toDto(await findOrThrow(db, token));
}

export async function cancelByToken(
  db: D1Database,
  token: string,
  now: Date,
): Promise<{ reservation: ReservationDto; row: ReservationRow }> {
  return cancelAsGuest(db, await findOrThrow(db, token), now);
}

/**
 * Guest cancellation by reservation id, for the AI chat (v6 P4): the guest proved access by pasting
 * the private link, which the server resolved; the token itself is never kept. Same rules as above.
 */
export async function cancelByIdAsGuest(
  db: D1Database,
  id: string,
  now: Date,
): Promise<{ reservation: ReservationDto; row: ReservationRow }> {
  const row = await findById(db, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Reservation not found.");
  return cancelAsGuest(db, row, now);
}

async function cancelAsGuest(
  db: D1Database,
  row: ReservationRow,
  now: Date,
): Promise<{ reservation: ReservationDto; row: ReservationRow }> {
  const notCancellable = new HttpError(
    409,
    "NOT_CANCELLABLE",
    "This reservation is already cancelled or has already started.",
  );
  // pending and (from v4) confirmed, before the start (ADR-022).
  if (!ACTIVE_STATUSES.includes(row.status) || minutesUntil(row.date, row.start_time, now) <= 0) {
    throw notCancellable;
  }
  const cancelledAt = now.toISOString();
  if (!(await cancelReservation(db, row.id, cancelledAt, "guest"))) throw notCancellable;
  const cancelled: ReservationRow = {
    ...row,
    status: "cancelled",
    cancelled_at: cancelledAt,
    cancelled_by: "guest",
  };
  return { reservation: toDto(cancelled), row: cancelled };
}

async function findOrThrow(db: D1Database, token: string): Promise<ReservationRow> {
  const row = await findByTokenHash(db, await hashToken(token));
  if (!row) throw new HttpError(404, "NOT_FOUND", "Reservation not found.");
  return row;
}
