// Booking services: availability, create, view, cancel. HTTP-agnostic; throw HttpError.

import { HttpError } from "./errors";
import {
  cancelReservation,
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
): Promise<{ reservation: ReservationDto; token: string }> {
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
  };

  // Try free tables smallest-first. A conflict means another request took that table
  // between our read and our write; the batch was rolled back, so try the next one.
  for (const table of await findFreeTables(db, input.guests, slots)) {
    const row: ReservationRow = { ...base, table_id: table.id };
    try {
      await insertReservation(db, row, slots);
      return { reservation: toDto(row), token };
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
): Promise<ReservationDto> {
  const row = await findOrThrow(db, token);
  const notCancellable = new HttpError(
    409,
    "NOT_CANCELLABLE",
    "This reservation is already cancelled or has already started.",
  );
  if (row.status !== "pending" || minutesUntil(row.date, row.start_time, now) <= 0) {
    throw notCancellable;
  }
  const cancelledAt = now.toISOString();
  if (!(await cancelReservation(db, row.id, cancelledAt))) throw notCancellable;
  return toDto({ ...row, status: "cancelled", cancelled_at: cancelledAt });
}

async function findOrThrow(db: D1Database, token: string): Promise<ReservationRow> {
  const row = await findByTokenHash(db, await hashToken(token));
  if (!row) throw new HttpError(404, "NOT_FOUND", "Reservation not found.");
  return row;
}
