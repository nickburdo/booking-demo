// Raw SQL access to D1. Multi-statement writes go through batch(), which D1 runs
// as one SQL transaction (all or nothing).

export type ReservationStatus = "pending" | "cancelled";

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
          token_hash, created_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

/**
 * Cancels a pending reservation and frees its slots in one transaction.
 * Returns false if the reservation was no longer pending (nothing changed).
 */
export async function cancelReservation(
  db: D1Database,
  id: string,
  cancelledAt: string,
): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare(
        "UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(cancelledAt, id),
    // Only frees slots when the reservation is (now) cancelled, never a live one.
    db
      .prepare(
        `DELETE FROM reservation_slots WHERE reservation_id = ?
           AND EXISTS (SELECT 1 FROM reservations WHERE id = ? AND status = 'cancelled')`,
      )
      .bind(id, id),
  ]);
  return update.meta.changes === 1;
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
