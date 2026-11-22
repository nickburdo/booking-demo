// Raw SQL access to D1. Multi-statement writes go through batch(), which D1 runs
// as one SQL transaction (all or nothing).

/** Statuses and transitions: ADR-022. pending and confirmed hold their slots. */
export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "no_show";
export const ACTIVE_STATUSES: readonly ReservationStatus[] = ["pending", "confirmed"];

export interface ReservationRow {
  id: string;
  table_id: number;
  date: string;
  start_time: string;
  guests: number;
  name: string;
  phone: string;
  comment: string | null;
  status: ReservationStatus;
  token_hash: string;
  created_at: string;
  cancelled_at: string | null;
  notified_at: string | null;
  cancel_notified_at: string | null;
  confirmed_at: string | null;
  no_show_at: string | null;
  cancelled_by: "guest" | "owner" | null;
  cancel_reason: string | null;
  is_demo: 0 | 1;
}

export interface TableRow {
  id: number;
  seats: number;
}

/** Tables that fit the party, smallest first. */
export async function tablesFor(db: D1Database, guests: number): Promise<TableRow[]> {
  const { results } = await db
    .prepare("SELECT id, seats FROM tables WHERE seats >= ? ORDER BY seats, id")
    .bind(guests)
    .all<TableRow>();
  return results;
}

/** Tables that fit the party and have none of the given slots taken, smallest first. */
export async function findFreeTables(
  db: D1Database,
  guests: number,
  slots: string[],
): Promise<TableRow[]> {
  const placeholders = slots.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT t.id, t.seats FROM tables t
       WHERE t.seats >= ?
         AND NOT EXISTS (
           SELECT 1 FROM reservation_slots s
           WHERE s.table_id = t.id AND s.slot IN (${placeholders})
         )
       ORDER BY t.seats, t.id`,
    )
    .bind(guests, ...slots)
    .all<TableRow>();
  return results;
}

/** Occupied slot keys on a date, grouped by table id. */
export async function occupiedSlots(
  db: D1Database,
  date: string,
): Promise<Map<number, Set<string>>> {
  const { results } = await db
    .prepare(
      "SELECT table_id, slot FROM reservation_slots WHERE slot >= ? AND slot <= ?",
    )
    .bind(`${date}T00:00`, `${date}T23:59`)
    .all<{ table_id: number; slot: string }>();
  const byTable = new Map<number, Set<string>>();
  for (const { table_id, slot } of results) {
    if (!byTable.has(table_id)) byTable.set(table_id, new Set());
    byTable.get(table_id)!.add(slot);
  }
  return byTable;
}

/**
 * Inserts the reservation and its slot rows in one transaction. Throws the D1 error
 * if any slot is already taken; nothing is written in that case.
 */
export async function insertReservation(
  db: D1Database,
  row: ReservationRow,
  slots: string[],
): Promise<void> {
  const insertReservationStmt = db
    .prepare(
      `INSERT INTO reservations
         (id, table_id, date, start_time, guests, name, phone, comment, status,
          token_hash, created_at, cancelled_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.table_id,
      row.date,
      row.start_time,
      row.guests,
      row.name,
      row.phone,
      row.comment,
      row.status,
      row.token_hash,
      row.created_at,
      row.cancelled_at,
      row.is_demo,
    );
  const insertSlotStmts = slots.map((slot) =>
    db
      .prepare("INSERT INTO reservation_slots (table_id, slot, reservation_id) VALUES (?, ?, ?)")
      .bind(row.table_id, slot, row.id),
  );
  await db.batch([insertReservationStmt, ...insertSlotStmts]);
}

/** True if the error is a primary-key conflict on reservation_slots (slot already taken). */
export function isSlotConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed: reservation_slots.");
}

export async function findByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<ReservationRow | null> {
  return db
    .prepare("SELECT * FROM reservations WHERE token_hash = ?")
    .bind(tokenHash)
    .first<ReservationRow>();
}

export async function findById(db: D1Database, id: string): Promise<ReservationRow | null> {
  return db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first<ReservationRow>();
}

const FINAL_STATUSES = "('cancelled', 'no_show')";

/**
 * Moves a reservation to `to` if its status is one of `from`, setting extra columns, in one
 * transaction (ADR-022). Cancel and no-show also free the slots; the delete only runs if the
 * reservation is (now) in a final status, never for a live one. Returns false if the status
 * did not match (nothing changed), so two concurrent actions cannot both win.
 */
async function transition(
  db: D1Database,
  id: string,
  from: readonly ReservationStatus[],
  to: ReservationStatus,
  set: Record<string, string | null>,
): Promise<boolean> {
  const columns = Object.keys(set);
  const assignments = ["status = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
  const fromList = from.map(() => "?").join(", ");
  const update = db
    .prepare(`UPDATE reservations SET ${assignments} WHERE id = ? AND status IN (${fromList})`)
    .bind(to, ...columns.map((c) => set[c]), id, ...from);
  const statements = [update];
  if (to === "cancelled" || to === "no_show") {
    statements.push(
      db
        .prepare(
          `DELETE FROM reservation_slots WHERE reservation_id = ?
             AND EXISTS (SELECT 1 FROM reservations WHERE id = ? AND status IN ${FINAL_STATUSES})`,
        )
        .bind(id, id),
    );
  }
  const [result] = await db.batch(statements);
  return result.meta.changes === 1;
}

/** Cancels a pending or confirmed reservation and frees its slots. */
export function cancelReservation(
  db: D1Database,
  id: string,
  at: string,
  by: "guest" | "owner",
  reason: string | null = null,
): Promise<boolean> {
  return transition(db, id, ACTIVE_STATUSES, "cancelled", {
    cancelled_at: at,
    cancelled_by: by,
    cancel_reason: reason,
  });
}

export function confirmReservation(db: D1Database, id: string, at: string): Promise<boolean> {
  return transition(db, id, ["pending"], "confirmed", { confirmed_at: at });
}

export function markNoShow(db: D1Database, id: string, at: string): Promise<boolean> {
  return transition(db, id, ACTIVE_STATUSES, "no_show", { no_show_at: at });
}

/** A reservation as the admin day view needs it: row plus its table label. */
export type AdminRow = ReservationRow & { table_label: string };

export async function listByDate(db: D1Database, date: string): Promise<AdminRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, t.label AS table_label FROM reservations r JOIN tables t ON t.id = r.table_id
       WHERE r.date = ? ORDER BY r.start_time, t.id`,
    )
    .bind(date)
    .all<AdminRow>();
  return results;
}

export async function findAdminRow(db: D1Database, id: string): Promise<AdminRow | null> {
  return db
    .prepare(
      `SELECT r.*, t.label AS table_label FROM reservations r JOIN tables t ON t.id = r.table_id
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<AdminRow>();
}

/**
 * Demo reservations that are live and have not started yet (limit in ADR-021). Past ones do not
 * count: nothing moves them to a final status, so they would block the button for good (v4 R2.1).
 * `today` / `time` are Kyiv wall-clock values (YYYY-MM-DD, HH:MM).
 */
export async function countUpcomingDemo(db: D1Database, today: string, time: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reservations
       WHERE is_demo = 1 AND status IN ('pending', 'confirmed')
         AND (date > ? OR (date = ? AND start_time > ?))`,
    )
    .bind(today, today, time)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// --- Admin sessions (ADR-020): only the token hash is stored ---------------------------------

export async function insertSession(
  db: D1Database,
  tokenHash: string,
  createdAt: string,
  expiresAt: string,
): Promise<void> {
  await db.batch([
    // Housekeeping: drop expired sessions whenever someone logs in.
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(createdAt),
    db
      .prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(tokenHash, createdAt, expiresAt),
  ]);
}

/** True if a session with this hash exists and has not expired at `now`. */
export async function isSessionValid(db: D1Database, tokenHash: string, now: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, now)
    .first<{ ok: number }>();
  return row !== null;
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function tableLabel(db: D1Database, tableId: number): Promise<string> {
  const row = await db
    .prepare("SELECT label FROM tables WHERE id = ?")
    .bind(tableId)
    .first<{ label: string }>();
  return row?.label ?? `#${tableId}`;
}

/** When Telegram accepted the "new booking" notification, or null (ADR-018). */
export async function notifiedAt(db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT notified_at FROM reservations WHERE id = ?")
    .bind(id)
    .first<{ notified_at: string | null }>();
  return row?.notified_at ?? null;
}

/** Records that Telegram accepted the owner notification (ADR-018). */
export async function markNotified(
  db: D1Database,
  id: string,
  kind: "created" | "cancelled",
  at: string,
): Promise<void> {
  const column = kind === "created" ? "notified_at" : "cancel_notified_at";
  await db.prepare(`UPDATE reservations SET ${column} = ? WHERE id = ?`).bind(at, id).run();
}
