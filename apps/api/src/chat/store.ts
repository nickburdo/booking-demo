// D1 access for chat conversations (v5, ADR-024). Multi-statement writes go through batch().

import type { ChatState, Locale, Outcome, TextField } from "./types";

export const CHAT_IDLE_MS = 2 * 3600_000; // a conversation expires after 2 h of silence
export const CHAT_RETENTION_DAYS = 7;

export interface ChatSessionRow {
  id: string;
  token_hash: string;
  locale: Locale;
  state: string; // JSON ChatState
  outcome: Outcome;
  reservation_id: string | null;
  guest_messages: number;
  message_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NewMessage {
  sender: "guest" | "bot";
  field: TextField | null;
  text: string;
}

function insertMessages(db: D1Database, sessionId: string, startSeq: number, messages: NewMessage[], at: string) {
  return messages.map((m, i) =>
    db
      .prepare("INSERT INTO chat_messages (session_id, seq, sender, field, text, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(sessionId, startSeq + i, m.sender, m.field, m.text, at),
  );
}

/** Starts a conversation; also deletes conversations older than the retention period. */
export async function createSession(
  db: D1Database,
  s: { id: string; tokenHash: string; locale: Locale; state: ChatState; messages: NewMessage[]; now: Date },
): Promise<void> {
  const at = s.now.toISOString();
  const cutoff = new Date(s.now.getTime() - CHAT_RETENTION_DAYS * 86_400_000).toISOString();
  await db.batch([
    // Messages go with their session (ON DELETE CASCADE).
    db.prepare("DELETE FROM chat_sessions WHERE created_at < ?").bind(cutoff),
    db
      .prepare(
        `INSERT INTO chat_sessions (id, token_hash, locale, state, message_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(s.id, s.tokenHash, s.locale, JSON.stringify(s.state), s.messages.length, at, at),
    ...insertMessages(db, s.id, 0, s.messages, at),
  ]);
}

/** A live conversation for this token hash, or null if unknown or silent for too long. */
export async function findLiveSession(db: D1Database, tokenHash: string, now: Date): Promise<ChatSessionRow | null> {
  const since = new Date(now.getTime() - CHAT_IDLE_MS).toISOString();
  return db
    .prepare("SELECT * FROM chat_sessions WHERE token_hash = ? AND updated_at > ?")
    .bind(tokenHash, since)
    .first<ChatSessionRow>();
}

/**
 * Claims the current step (v5 plan R3, R2.2): bumps the version only if nobody else did, and in the
 * same write stores the state with its "busy" mark. A second request either loses the version
 * race or reads the mark, so an action such as a booking cannot run twice.
 */
export async function claimStep(db: D1Database, id: string, version: number, busyState: ChatState): Promise<boolean> {
  const result = await db
    .prepare("UPDATE chat_sessions SET version = version + 1, state = ? WHERE id = ? AND version = ?")
    .bind(JSON.stringify(busyState), id, version)
    .run();
  return result.meta.changes === 1;
}

/** Puts back the state without the busy mark after a failed step (best effort). */
export async function releaseStep(db: D1Database, id: string, state: ChatState): Promise<void> {
  await db.prepare("UPDATE chat_sessions SET state = ? WHERE id = ?").bind(JSON.stringify(state), id).run();
}

/** Saves the new state and the turn's messages (guest message first, then the bot's). */
export async function saveTurn(
  db: D1Database,
  row: ChatSessionRow,
  t: { state: ChatState; outcome: Outcome; reservationId: string | null; messages: NewMessage[]; now: Date },
): Promise<void> {
  const at = t.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE chat_sessions
         SET state = ?, outcome = ?, reservation_id = ?, guest_messages = guest_messages + 1,
             message_count = message_count + ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(JSON.stringify(t.state), t.outcome, t.reservationId, t.messages.length, at, row.id),
    ...insertMessages(db, row.id, row.message_count, t.messages, at),
  ]);
}

export interface ChatMessageRow {
  seq: number;
  sender: "guest" | "bot";
  field: TextField | null;
  text: string;
  created_at: string;
}

export async function listMessages(db: D1Database, sessionId: string): Promise<ChatMessageRow[]> {
  const { results } = await db
    .prepare("SELECT seq, sender, field, text, created_at FROM chat_messages WHERE session_id = ? ORDER BY seq")
    .bind(sessionId)
    .all<ChatMessageRow>();
  return results;
}

export type ChatListRow = Pick<ChatSessionRow, "id" | "locale" | "outcome" | "message_count" | "created_at"> & {
  reservation_date: string | null;
};

/** Conversations started since `since`, newest first, with the date of the booking made in them. */
export async function listChats(db: D1Database, since: string): Promise<ChatListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.locale, c.outcome, c.message_count, c.created_at, r.date AS reservation_date
       FROM chat_sessions c LEFT JOIN reservations r ON r.id = c.reservation_id
       WHERE c.created_at >= ? ORDER BY c.created_at DESC LIMIT 200`,
    )
    .bind(since)
    .all<ChatListRow>();
  return results;
}

export async function findChat(db: D1Database, id: string): Promise<ChatListRow | null> {
  return db
    .prepare(
      `SELECT c.id, c.locale, c.outcome, c.message_count, c.created_at, r.date AS reservation_date
       FROM chat_sessions c LEFT JOIN reservations r ON r.id = c.reservation_id WHERE c.id = ?`,
    )
    .bind(id)
    .first<ChatListRow>();
}
