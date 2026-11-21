// Background owner notifications (ADR-018): never block or fail the guest's request.

import { waitUntil } from "cloudflare:workers";
import { markNotified, tableLabel, type ReservationRow } from "./repo";
import { buildMessage, sendTelegram, type NotificationKind, type TelegramConfig } from "./telegram";
import { endTime } from "./time";

async function notify(
  db: D1Database,
  telegram: TelegramConfig,
  kind: NotificationKind,
  row: ReservationRow,
  now: () => Date,
): Promise<void> {
  const text = buildMessage(kind, {
    date: row.date,
    time: row.start_time,
    endTime: endTime(row.start_time),
    guests: row.guests,
    tableLabel: await tableLabel(db, row.table_id),
    name: row.name,
    phone: row.phone,
    comment: row.comment,
  });
  if (await sendTelegram(telegram, text)) {
    await markNotified(db, row.id, kind, now().toISOString());
  }
}

/** Schedules a notification after the response; errors are logged, never thrown. */
export function notifyInBackground(
  db: D1Database,
  telegram: TelegramConfig,
  kind: NotificationKind,
  row: ReservationRow,
  now: () => Date,
): void {
  waitUntil(
    notify(db, telegram, kind, row, now).catch((error) => {
      console.error(`Notification (${kind}) for ${row.id} failed:`, error);
    }),
  );
}
