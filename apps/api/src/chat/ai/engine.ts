// AI chat engine (v6, ADR-026): the guest's message → model with tools → bot turn, in the same turn
// shape as the scripted engine. The model only proposes; "confirm" runs the real service here,
// without the model. Reservation tokens never reach the model or the stored state (P4).

import { HttpError } from "../../errors";
import { endTime, minutesUntil } from "../../time";
import { TEXTS, formatDate } from "../texts";
import type { ChatServices, Effects, GuestInput, Input, Locale, Option, Turn } from "../types";
import { tokenFromLink } from "../engine";
import { addNeurons, budgetLeft } from "./budget";
import { aiModel, AiUnavailableError, MODEL_TIMEOUT_MS, neuronsFor, type AiMessage } from "./model";
import { systemPrompt } from "./prompt";
import { AI_TEXTS } from "./texts";
import { AI_TOOLS, runTool, type FoundBooking, type Proposal } from "./tools";

export const AI_MAX_GUEST_MESSAGES = 20;
export const AI_MAX_TEXT = 500;
const MAX_MODEL_CALLS = 4;
const HISTORY_LIMIT = 12;
/** An AI turn can take up to MAX_MODEL_CALLS timed-out calls; its busy mark lives longer (v6 R3.3). */
export const AI_BUSY_MS = MAX_MODEL_CALLS * MODEL_TIMEOUT_MS + 20_000;
/** What a timed-out call is charged: Cloudflare still bills it, the reply never tells us (v6 R3.8). */
export const TIMEOUT_NEURONS = neuronsFor({ input: 2000, output: 600 });
/**
 * Pasted links and bare tokens in a guest message (v6 R3.5: lookarounds, since "\b" fails next to "-").
 * Shared with redactTokens so whatever the model never sees is not stored either (v6 R3.1).
 */
export const TOKEN_CANDIDATES = /\S*#[A-Za-z0-9_-]{20,100}|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,50}(?![A-Za-z0-9_-])/g;

export interface AiState {
  engine: "ai";
  history: AiMessage[];
  pending: Proposal | null;
  /** Bookings resolved from pasted links, by the reference the model knows (B1, B2…). */
  found: Record<string, FoundBooking>;
  awaiting: Input;
  personSent: boolean;
  busySince?: string;
}

export interface AiContext {
  db: D1Database;
  locale: Locale;
  now: Date;
  siteUrl: string;
  services: ChatServices & { cancelById(id: string): ReturnType<ChatServices["cancel"]> };
}

interface Result {
  state: AiState;
  turn: Turn;
  effects: Effects;
}

function textInput(locale: Locale, options: Option[] = []): Input {
  return { kind: "text", field: "message", placeholder: AI_TEXTS[locale].placeholder, maxLength: AI_MAX_TEXT, optional: false, options };
}

function when(locale: Locale, date: string, time: string): string {
  return `${formatDate(locale, date)} · ${time}–${endTime(time)}`;
}

function done(locale: Locale, state: AiState, messages: string[], effects: Effects = {}, input?: Input): Result {
  const awaiting = input ?? textInput(locale);
  return { state: { ...state, awaiting }, turn: { messages: messages.filter(Boolean).map((text) => ({ text })), input: awaiting }, effects };
}

export function startAi(locale: Locale): { state: AiState; turn: Turn } {
  const tx = AI_TEXTS[locale];
  const awaiting = textInput(locale);
  const state: AiState = { engine: "ai", history: [], pending: null, found: {}, awaiting, personSent: false };
  return { state, turn: { messages: [{ text: tx.greeting }, { text: tx.demoNotice }], input: awaiting } };
}

/** The last messages, starting at a guest message so no tool result is left without its call. */
function trimmed(history: AiMessage[]): AiMessage[] {
  let start = Math.max(0, history.length - HISTORY_LIMIT);
  while (start < history.length && history[start]!.role !== "user") start++;
  if (start < history.length) return history.slice(start);
  // A long turn (many tool calls) pushed the guest's message out: keep it anyway (v6 R3.4).
  const lastUser = history.findLastIndex((m) => m.role === "user");
  return lastUser >= 0 ? history.slice(lastUser) : history;
}

function proposalTurn(locale: Locale, proposal: Proposal): { message: string; input: Input } {
  const tx = AI_TEXTS[locale];
  const st = TEXTS[locale];
  let message: string;
  if (proposal.kind === "booking") {
    message = st.summary({ when: when(locale, proposal.date, proposal.time), guests: st.guests(proposal.guests), name: proposal.name, phone: proposal.phone, comment: proposal.comment });
  } else if (proposal.kind === "cancellation") {
    message = tx.cancellationSummary({ when: when(locale, proposal.date, proposal.time), guests: st.guests(proposal.guests) });
  } else {
    message = tx.messageSummary({ question: proposal.question, name: proposal.name, phone: proposal.phone });
  }
  const options = [{ id: "confirm", label: tx.confirm[proposal.kind] }, { id: "change", label: tx.change }];
  return { message, input: textInput(locale, options) };
}

function reservationLink(ctx: AiContext, token: string): string {
  const prefix = ctx.locale === "en" ? "" : `/${ctx.locale}`;
  return `${ctx.siteUrl}${prefix}/reservation#${token}`;
}

/** The guest pressed "Confirm": the server acts, the model is not involved (D6). */
async function confirm(ctx: AiContext, state: AiState, proposal: Proposal): Promise<Result> {
  const tx = AI_TEXTS[ctx.locale];
  const st = TEXTS[ctx.locale];
  const next: AiState = { ...state, pending: null };
  const note = (text: string): AiMessage => ({ role: "assistant", content: text });

  if (proposal.kind === "booking") {
    try {
      const { token, row } = await ctx.services.book(proposal);
      next.history = [...state.history, note(tx.bookingNote(when("en", proposal.date, proposal.time), proposal.guests))];
      return done(ctx.locale, next, [st.booked, st.bookedLink(reservationLink(ctx, token)), st.preorderHint, st.bookedDemo], { booked: row, outcome: "booked" });
    } catch (error) {
      if (error instanceof HttpError && (error.code === "SLOT_TAKEN" || error.code === "TIME_NOT_BOOKABLE")) {
        next.history = [...state.history, note("(Confirm failed: that time was just taken. Offer other times.)")];
        return done(ctx.locale, next, [st.slotTaken.replace(/:$/, ".")]);
      }
      throw error;
    }
  }
  if (proposal.kind === "cancellation") {
    try {
      const { row } = await ctx.services.cancelById(proposal.reservationId);
      next.history = [...state.history, note(tx.cancelledNote)];
      const found = { ...state.found };
      if (found[proposal.ref]) found[proposal.ref] = { ...found[proposal.ref]!, cancellable: false };
      next.found = found;
      return done(ctx.locale, next, [st.cancelled], { cancelled: row });
    } catch (error) {
      if (error instanceof HttpError && (error.code === "NOT_CANCELLABLE" || error.code === "NOT_FOUND")) {
        // So the model does not offer the same cancellation again (v6 R3.10).
        const found = { ...state.found };
        if (found[proposal.ref]) found[proposal.ref] = { ...found[proposal.ref]!, cancellable: false };
        next.found = found;
        next.history = [...state.history, note(`(Cancelling ${proposal.ref} failed: it can no longer be cancelled.)`)];
        return done(ctx.locale, next, [st.notCancellable]);
      }
      throw error;
    }
  }
  if (state.personSent) return done(ctx.locale, next, [st.personAlready]);
  next.personSent = true;
  next.history = [...state.history, note(tx.messageNote)];
  return done(ctx.locale, next, [st.personSent], { person: { question: proposal.question, name: proposal.name, phone: proposal.phone }, outcome: "person" });
}

/**
 * Finds bookings from links the guest pasted. The model gets the text with each link replaced by
 * "[link]" and a server note with a reference; the token is never kept.
 */
async function resolveLinks(ctx: AiContext, state: AiState, text: string): Promise<{ content: string; found: Record<string, FoundBooking>; any: boolean }> {
  const found = { ...state.found };
  const notes: string[] = [];
  const candidates = [...text.matchAll(TOKEN_CANDIDATES)].map((m) => m[0]);
  let resolved = false;
  let content = text;
  for (const candidate of candidates) {
    const token = tokenFromLink(candidate);
    if (!token) continue;
    content = content.split(candidate).join("[link]");
    try {
      const r = await ctx.services.find(token);
      const live = r.status === "pending" || r.status === "confirmed";
      const started = minutesUntil(r.date, r.time, ctx.now) <= 0;
      const ref = `B${Object.keys(found).length + 1}`;
      found[ref] = { reservationId: r.id, date: r.date, time: r.time, guests: r.guests, cancellable: live && !started };
      resolved = true;
      const status = !live ? r.status : started ? "already started" : r.status === "confirmed" ? "confirmed by the café" : "waiting for the café to confirm";
      notes.push(`[Server: booking ${ref} from the pasted link: ${r.date} ${r.time}-${endTime(r.time)}, ${r.guests} guests, ${status}, ${live && !started ? "can be cancelled" : "cannot be cancelled"}.]`);
    } catch (error) {
      if (!(error instanceof HttpError && error.code === "NOT_FOUND")) throw error;
      notes.push("[Server: the pasted link matches no booking.]");
    }
  }
  // Outcome "found" only when a booking was actually resolved (v6 R3.9).
  return { content: [content, ...notes].join("\n"), found, any: resolved };
}

export async function handleAi(ctx: AiContext, state: AiState, input: GuestInput): Promise<Result> {
  const tx = AI_TEXTS[ctx.locale];

  if ("choice" in input) {
    if (state.pending && input.choice === "confirm") return confirm(ctx, state, state.pending);
    if (state.pending && input.choice === "change") {
      const next = { ...state, pending: null, history: [...state.history, { role: "assistant" as const, content: "(The guest wants to change the proposal.)" }] };
      return done(ctx.locale, next, [tx.changeAsk]);
    }
    return done(ctx.locale, state, [tx.tooManySteps]);
  }

  const text = input.text.trim();
  if (!text) return done(ctx.locale, state, [tx.emptyText], {}, state.awaiting);
  // The browser limits the field too; the server enforces it so nobody burns the budget (v6 R3.2).
  if (text.length > AI_MAX_TEXT) return done(ctx.locale, state, [tx.tooLong], {}, state.awaiting);

  const links = await resolveLinks(ctx, state, text);
  let next: AiState = { ...state, pending: null, found: links.found, history: [...state.history, { role: "user", content: links.content }] };
  const effects: Effects = { outcome: links.any ? "found" : "questions" };

  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    if (!(await budgetLeft(ctx.db, ctx.now))) return done(ctx.locale, next, [tx.budgetUsed], effects, { kind: "none" });
    let reply;
    try {
      reply = await aiModel.run([{ role: "system", content: systemPrompt(ctx.locale, ctx.now) }, ...trimmed(next.history)], AI_TOOLS);
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        console.error("AI model call failed:", error.message);
        if (error.timedOut) await addNeurons(ctx.db, ctx.now, TIMEOUT_NEURONS);
        return error.quota ? done(ctx.locale, next, [tx.budgetUsed], effects, { kind: "none" }) : done(ctx.locale, next, [tx.unavailable], effects);
      }
      throw error;
    }
    await addNeurons(ctx.db, ctx.now, neuronsFor(reply.usage));

    if (reply.toolCalls.length === 0) {
      next.history = [...next.history, { role: "assistant", content: reply.text }];
      return done(ctx.locale, next, [reply.text || tx.tooManySteps], effects);
    }

    next.history = [
      ...next.history,
      { role: "assistant", content: reply.text, tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) },
    ];
    let proposal: Proposal | undefined;
    for (const c of reply.toolCalls) {
      const outcome = proposal
        ? { result: JSON.stringify({ error: "only one proposal at a time" }) }
        : await runTool(c, { now: ctx.now, services: ctx.services, found: next.found });
      if (outcome.proposal) proposal = outcome.proposal;
      next.history = [...next.history, { role: "tool", tool_call_id: c.id, content: outcome.result }];
    }
    if (proposal) {
      // The server's summary is the answer: the model's own wording could claim it is done (1.3).
      next = { ...next, pending: proposal };
      const p = proposalTurn(ctx.locale, proposal);
      return done(ctx.locale, next, [p.message], effects, p.input);
    }
  }
  return done(ctx.locale, next, [tx.tooManySteps], effects);
}
