// Admin services (v4): day list, owner actions, demo reservations. HTTP-agnostic; throw HttpError.
// Statuses and transitions: ADR-022. Masking and demo data: ADR-021.

import { createReservation, getAvailability } from "./booking";
import { HttpError } from "./errors";
import { maskName, maskPhone } from "./mask";
import {
  ACTIVE_STATUSES,
  cancelReservation,
  confirmReservation,
  countActiveDemo,
  findAdminRow,
  listByDate,
  markNoShow,
  type AdminRow,
  type ReservationStatus,
} from "./repo";
import { addDays, endTime, kyivNow, minutesUntil } from "./time";

/** Reservation as the admin sees it: table label, masked guest data, notification flag. */
export interface AdminReservationDto {
  id: string;
  date: string;
  time: string;
  endTime: string;
  guests: number;
  table: string;
  name: string;
  phone: string;
  comment: string | null;
  status: ReservationStatus;
  cancelledBy: AdminRow["cancelled_by"];
  cancelReason: string | null;
  notified: boolean;
  demo: boolean;
}

export function toAdminDto(row: AdminRow): AdminReservationDto {
  return {
    id: row.id,
    date: row.date,
    time: row.start_time,
    endTime: endTime(row.start_time),
    guests: row.guests,
    table: row.table_label,
    name: maskName(row.name),
    phone: maskPhone(row.phone),
    comment: row.comment,
    status: row.status,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    notified: row.notified_at !== null,
    demo: row.is_demo === 1,
  };
}

export async function listDay(db: D1Database, date: string): Promise<AdminReservationDto[]> {
  return (await listByDate(db, date)).map(toAdminDto);
}

export type AdminAction = "confirm" | "cancel" | "no-show";

const RULES: Record<AdminAction, { from: readonly ReservationStatus[]; when: "before" | "after" }> = {
  confirm: { from: ["pending"], when: "before" },
  cancel: { from: ACTIVE_STATUSES, when: "before" },
  "no-show": { from: ACTIVE_STATUSES, when: "after" },
};

function notAllowed(action: AdminAction, row: AdminRow, started: boolean): HttpError {
  const reason = RULES[action].from.includes(row.status)
    ? started
      ? "the reservation has already started"
      : "the reservation has not started yet"
    : `the reservation is ${row.status}`;
  return new HttpError(409, "NOT_ALLOWED", `Cannot ${action}: ${reason}.`);
}

/** Applies an owner action if the rules allow it; returns the updated reservation. */
export async function applyAction(
  db: D1Database,
  id: string,
  action: AdminAction,
  now: Date,
  reason: string | null = null,
): Promise<AdminReservationDto> {
  const row = await findAdminRow(db, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Reservation not found.");

  const started = minutesUntil(row.date, row.start_time, now) <= 0;
  const rule = RULES[action];
  if (!rule.from.includes(row.status) || started !== (rule.when === "after")) {
    throw notAllowed(action, row, started);
  }

  const at = now.toISOString();
  const changed =
    action === "confirm"
      ? await confirmReservation(db, id, at)
      : action === "cancel"
        ? await cancelReservation(db, id, at, "owner", reason)
        : await markNoShow(db, id, at);

  const updated = (await findAdminRow(db, id))!;
  // Someone else changed it between our read and our write (ADR-022).
  if (!changed) throw notAllowed(action, updated, started);
  return toAdminDto(updated);
}

// --- Demo reservations (ADR-021) ------------------------------------------------------------

export const DEMO_BATCH = 6;
export const DEMO_MAX_ACTIVE = 20;
const DEMO_DAYS = 3;

const DEMO_NAMES = [
  "Олена Коваленко",
  "Андрій Шевчук",
  "Марія Бондар",
  "Тарас Мельник",
  "Ірина Ткаченко",
  "Дмитро Кравець",
  "Софія Литвин",
  "Максим Гончар",
  "Anna Novak",
  "Lukas Weber",
];
const DEMO_COMMENTS = [null, null, null, "Біля вікна, будь ласка", "Будемо з дитячим візочком", "День народження"];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** "+38000" + 7 digits: the 00 operator code does not exist, so it is never a real number. */
function demoPhone(): string {
  return `+38000${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

/**
 * Creates up to DEMO_BATCH made-up reservations over the next DEMO_DAYS days at free times,
 * through the normal booking code (same slot guard), flagged as demo. No Telegram.
 */
export async function addDemoReservations(db: D1Database, now: Date): Promise<number> {
  const active = await countActiveDemo(db);
  if (active >= DEMO_MAX_ACTIVE) {
    throw new HttpError(409, "DEMO_LIMIT", `There are already ${active} demo reservations.`);
  }
  const wanted = Math.min(DEMO_BATCH, DEMO_MAX_ACTIVE - active);
  const today = kyivNow(now).date;

  let created = 0;
  for (let attempt = 0; created < wanted && attempt < wanted * 3; attempt++) {
    const date = addDays(today, 1 + (attempt % DEMO_DAYS));
    const guests = 1 + Math.floor(Math.random() * 4);
    const times = await getAvailability(db, date, guests, now);
    if (times.length === 0) continue;
    try {
      await createReservation(
        db,
        { date, time: pick(times), guests, name: pick(DEMO_NAMES), phone: demoPhone(), comment: pick(DEMO_COMMENTS) },
        now,
        { demo: true },
      );
      created++;
    } catch (error) {
      // Someone took the time between our read and our write: try another one.
      if (!(error instanceof HttpError && error.code === "SLOT_TAKEN")) throw error;
    }
  }
  return created;
}
