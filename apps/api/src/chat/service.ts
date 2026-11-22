// Chat use cases for the HTTP layer (v5): start, reply, history, and the admin views.
// Ties together the engine, storage and the booking services. HTTP-agnostic; throws HttpError.

import { cancelByIdAsGuest, cancelByToken, createReservation, getAvailability, getReservation } from "../booking";
import { HttpError } from "../errors";
import { maskName, maskPhone } from "../mask";
import { generateToken, hashToken } from "../token";
import { normalisePhone } from "../validation";
import { AI_BUSY_MS, AI_MAX_GUEST_MESSAGES, TOKEN_CANDIDATES, handleAi, startAi, type AiState } from "./ai/engine";
import { checkInput, handle, start, tokenFromLink } from "./engine";
import {
  CHAT_RETENTION_DAYS,
  claimStep,
  createSession,
  findChat,
  findLiveSession,
  listChats,
  listMessages,
  releaseStep,
  saveTurn,
  type ChatEngine,
  type ChatListRow,
  type ChatSessionRow,
  type NewMessage,
} from "./store";
import { OUTCOME_RANK, type ChatContext, type ChatServices, type ChatState, type Effects, type GuestInput, type Input, type Locale, type Turn } from "./types";

export const MAX_GUEST_MESSAGES = 60;

/** The real booking services, the same as the form uses (ADR-023). */
export function bookingServices(db: D1Database, now: Date): ChatServices {
  return {
    availability: (date, guests) => getAvailability(db, date, guests, now),
    book: async (input) => {
      const { reservation, token, row } = await createReservation(db, input, now);
      return { reservation, token, row };
    },
    find: (token) => getReservation(db, token),
    cancel: (token) => cancelByToken(db, token, now),
  };
}

function botMessages(turn: Turn): NewMessage[] {
  return turn.messages.map((m) => ({ sender: "bot", field: null, text: m.text }));
}

export async function startChat(
  db: D1Database,
  locale: Locale,
  siteUrl: string,
  now: Date,
  engine: ChatEngine = "scripted",
): Promise<{ token: string; turn: Turn }> {
  const ctx: ChatContext = { locale, now, siteUrl, services: bookingServices(db, now) };
  // The AI greeting is fixed text: starting a conversation costs no neurons (ADR-027).
  const { state, turn } = engine === "ai" ? startAi(locale) : start(ctx);
  const token = generateToken();
  await createSession(db, {
    id: crypto.randomUUID(),
    tokenHash: await hashToken(token),
    locale,
    engine,
    state,
    messages: botMessages(turn),
    now,
  });
  return { token, turn };
}

async function liveSession(db: D1Database, token: string | null, now: Date): Promise<ChatSessionRow> {
  const row = token ? await findLiveSession(db, await hashToken(token), now) : null;
  if (!row) throw new HttpError(401, "CHAT_EXPIRED", "This conversation has ended. Start a new one.");
  return row;
}

/** Applies one guest message; returns the bot's turn and the side effects to carry out. */
export async function replyToChat(
  db: D1Database,
  token: string | null,
  input: GuestInput,
  siteUrl: string,
  now: Date,
  services: ChatServices = bookingServices(db, now),
): Promise<{ turn: Turn; effects: Effects }> {
  const row = await liveSession(db, token, now);
  if (row.guest_messages >= (row.engine === "ai" ? AI_MAX_GUEST_MESSAGES : MAX_GUEST_MESSAGES)) {
    throw new HttpError(409, "CHAT_LIMIT", "This conversation is too long. Start a new one.");
  }
  const { busySince, ...state } = JSON.parse(row.state) as ChatState | AiState;
  const conflict = () =>
    new HttpError(409, "CHAT_CONFLICT", "Another message for this step is being handled. Reload the conversation.");
  // Another request is working on this step (v5 R2.2). A mark older than BUSY_MS (AI: AI_BUSY_MS,
  // v6 R3.3) is from a request that died half-way and no longer blocks the conversation.
  const busyMs = row.engine === "ai" ? AI_BUSY_MS : BUSY_MS;
  if (busySince && now.getTime() - Date.parse(busySince) < busyMs) throw conflict();

  const guest = checkInput(state.awaiting, input);
  if (!guest) throw new HttpError(400, "VALIDATION", "This answer does not fit the current question.");

  // Claim the step and mark it busy in one write, so a later request sees the mark (v5 R2.2).
  if (!(await claimStep(db, row.id, row.version, { ...state, busySince: now.toISOString() }))) throw conflict();

  const ctx: ChatContext = { locale: row.locale, now, siteUrl, services };
  let result: { state: object; turn: Turn; effects: Effects };
  try {
    result =
      row.engine === "ai"
        ? await handleAi(
            { db, locale: row.locale, now, siteUrl, services: { ...services, cancelById: (id: string) => cancelByIdAsGuest(db, id, now) } },
            state as AiState,
            input,
          )
        : await handle(ctx, state as ChatState, input);
  } catch (error) {
    await releaseStep(db, row.id, state).catch(() => {}); // best effort; the mark expires anyway
    throw error;
  }
  const outcome =
    result.effects.outcome && OUTCOME_RANK[result.effects.outcome] > OUTCOME_RANK[row.outcome] ? result.effects.outcome : row.outcome;
  try {
    await saveTurn(db, row, {
      state: result.state,
      outcome,
      reservationId: result.effects.booked?.id ?? row.reservation_id,
      // Stored without reservation tokens (v5 R2.1, ADR-013): the guest sees the link in this
      // response only; the transcript and the history keep "…#••••".
      messages: [
        { sender: "guest", field: guest.field, text: redactTokens(guest.label, guest.field) },
        ...botMessages(result.turn).map((m) => ({ ...m, text: redactTokens(m.text, null) })),
      ],
      now,
    });
  } catch (error) {
    // The action already happened (a booking, a cancellation, a message to the owner): answer
    // with its result anyway, so the guest does not repeat it and the owner is notified (v5 R2.3).
    const done = result.effects.booked || result.effects.cancelled || result.effects.person;
    if (!done) throw error;
    console.error("Chat turn saved partly; the action itself succeeded:", error);
  }
  return { turn: result.turn, effects: result.effects };
}

/** A request that died half-way leaves its "busy" mark for at most this long (v5 R2.2). */
export const BUSY_MS = 30_000;

/** Replaces reservation tokens with "••••" in text that is stored (v5 R2.1). */
export function redactTokens(text: string, field: string | null): string {
  const masked = text.replace(/#[A-Za-z0-9_-]{20,100}/g, "#••••");
  // A bare token pasted as the "link" answer (scripted).
  if (field === "link") return tokenFromLink(masked) ? "••••" : masked;
  // AI chat: every bare token the engine would resolve, anywhere in the message (v6 R3.1).
  if (field === "message") return masked.replace(TOKEN_CANDIDATES, (m) => (tokenFromLink(m) ? "••••" : m));
  return masked;
}

export async function chatHistory(
  db: D1Database,
  token: string | null,
  now: Date,
): Promise<{ messages: { sender: "guest" | "bot"; text: string }[]; input: Input }> {
  const row = await liveSession(db, token, now);
  const messages = (await listMessages(db, row.id)).map((m) => ({ sender: m.sender, text: m.text }));
  return { messages, input: (JSON.parse(row.state) as ChatState | AiState).awaiting };
}

// --- Admin (ADR-024): masked transcripts of the last 7 days ----------------------------------

function toAdminChat(row: ChatListRow) {
  return {
    id: row.id,
    startedAt: row.created_at,
    locale: row.locale,
    engine: row.engine,
    outcome: row.outcome,
    messages: row.message_count,
    reservationDate: row.reservation_date,
  };
}

export async function adminChatList(db: D1Database, now: Date, engine?: ChatEngine) {
  const since = new Date(now.getTime() - CHAT_RETENTION_DAYS * 86_400_000).toISOString();
  return (await listChats(db, since, engine)).map(toAdminChat);
}

/**
 * A transcript with the guest's name and phone answers masked — also where the bot repeats them
 * (the booking summary), in the typed and in the normalised (E.164) form.
 */
export async function adminChatTranscript(db: D1Database, id: string) {
  const chat = await findChat(db, id);
  if (!chat) throw new HttpError(404, "NOT_FOUND", "Conversation not found.");
  const rows = await listMessages(db, id);

  const names: [string, string][] = [];
  const phones: [string, string][] = [];
  for (const m of rows) {
    if (m.sender !== "guest" || !m.text) continue;
    if (m.field === "name") names.push([m.text, maskName(m.text)]);
    if (m.field === "phone") {
      const e164 = normalisePhone(m.text);
      if (e164) phones.push([e164, maskPhone(e164)]);
    }
  }
  const replaceAll = (text: string, pairs: [string, string][]) =>
    // Longer values first, so a value is not partly replaced by a shorter one.
    [...pairs].sort((a, b) => b[0].length - a[0].length).reduce((acc, [raw, masked]) => acc.split(raw).join(masked), text);

  const shown = (m: (typeof rows)[number]): string => {
    if (m.sender === "guest" && m.field === "name") return maskName(m.text);
    if (m.sender === "guest" && m.field === "phone") return maskPhone(normalisePhone(m.text) ?? m.text);
    // The bot repeats name and phone only in the booking summary, which always holds the phone;
    // only such messages get the name replaced, so short names do not hit other words.
    if (m.sender === "bot" && phones.some(([e164]) => m.text.includes(e164))) return replaceAll(replaceAll(m.text, phones), names);
    return m.text;
  };

  if (chat.engine === "ai") {
    // v6 P10: in free text the guest can write a name or a phone anywhere. Names come from the
    // AI's proposals; anything that looks like a phone number is masked in every message.
    const aiNames = proposalNames(JSON.parse(chat.state) as AiState);
    return {
      chat: toAdminChat(chat),
      messages: rows.map((m) => ({ sender: m.sender, text: maskPhoneLike(maskWholeWords(m.text, aiNames)), at: m.created_at })),
    };
  }

  return {
    chat: toAdminChat(chat),
    messages: rows.map((m) => ({ sender: m.sender, text: shown(m), at: m.created_at })),
  };
}

/** Names the AI put into proposals (from the tool calls kept in the conversation state). */
function proposalNames(state: AiState): string[] {
  const names = new Set<string>();
  for (const message of state.history ?? []) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    for (const call of message.tool_calls) {
      try {
        const name = (JSON.parse(call.function.arguments) as { name?: unknown }).name;
        if (typeof name === "string" && name.trim().length >= 2) names.add(name.trim());
      } catch {
        // malformed arguments: nothing to mask
      }
    }
  }
  return [...names];
}

/** Replaces each name only as a whole word, so "Al" does not change "Already" (v6 R3.7). */
export function maskWholeWords(text: string, names: string[]): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...names]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, name) => acc.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "gu"), maskName(name)), text);
}

/** Masks phone-like sequences (8+ digits with spaces, dashes or brackets) in free text. */
export function maskPhoneLike(text: string): string {
  return text.replace(/\+?\d[\d\s\-()]{6,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 8) return match;
    // Dates like 2026-11-27 have eight digits too; they are not phones. What follows a date (a time,
    // or a phone glued to it) is checked on its own (v6 R3.7).
    const date = /^\d{4}-\d{2}-\d{2}(?!\d)/.exec(match)?.[0];
    if (date) return date + maskPhoneLike(match.slice(date.length));
    const e164 = normalisePhone(match) ?? `+${digits}`;
    return maskPhone(e164);
  });
}
