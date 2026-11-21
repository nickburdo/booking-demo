// Background owner notifications (ADR-018): never block or fail the guest's request.

import { waitUntil } from "cloudflare:workers";
import { markNotified, notifiedAt, tableLabel, type ReservationRow } from "./repo";
import { buildMessage, sendTelegram, type NotificationKind, type TelegramConfig } from "./telegram";
import { endTime } from "./time";

/**
 * The two messages of one booking are separate background tasks, so a quick cancel could reach
 * the owner before the "new booking" message (plan revision R4.4). The cancel task waits until
 * notified_at is set, polling; after maxWaitMs it sends anyway (the first message failed).
 * Mutable for tests.
 */
export const cancelOrder = { intervalMs: 500, maxWaitMs: 10_000 };

async function waitForCreatedNotice(db: D1Database, id: string): Promise<void> {
  // Count attempts instead of reading the clock: Date.now() does not advance during I/O in Workers.
  const attempts = Math.ceil(cancelOrder.maxWaitMs / cancelOrder.intervalMs);
  for (let i = 0; i < attempts; i++) {
    if (await notifiedAt(db, id)) return;
    await new Promise((resolve) => setTimeout(resolve, cancelOrder.intervalMs));
  }
}

async function notify(
  db: D1Database,
  telegram: TelegramConfig,
  kind: NotificationKind,
  row: ReservationRow,
  now: () => Date,
): Promise<void> {
  if (kind === "cancelled" && telegram.botToken && telegram.chatId) {
    await waitForCreatedNotice(db, row.id);
  }
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
