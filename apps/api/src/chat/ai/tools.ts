// Tools of the AI chat (v6 P2, ADR-026). `check_availability` reads; the `propose_*` tools only
// validate and return a proposal that the server shows with "Confirm / Change" — the guest's press
// does the real work. Arguments come from an open model, so every one is checked by a schema and a
// mistake goes back to the model as a short explanation it can act on.

import { z } from "zod";
import { MAX_GUESTS, MIN_GUESTS } from "../../config";
import { HttpError } from "../../errors";
import { isStartBookable, isValidDate, isValidTime } from "../../time";
import { normalisePhone } from "../../validation";
import type { ChatServices } from "../types";
import type { AiTool } from "./model";

export type Proposal =
  | { kind: "booking"; date: string; time: string; guests: number; name: string; phone: string; comment: string | null }
  | { kind: "cancellation"; ref: string; reservationId: string; date: string; time: string; guests: number }
  | { kind: "message"; question: string; name: string; phone: string };

/** A booking the server resolved from a pasted link; the model only knows its reference. */
export interface FoundBooking {
  reservationId: string;
  date: string;
  time: string;
  guests: number;
  cancellable: boolean;
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): AiTool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const AI_TOOLS: AiTool[] = [
  fn("check_availability", "Free start times on a date for a party size.", {
    date: { type: "string", description: "YYYY-MM-DD" },
    guests: { type: "integer", description: `${MIN_GUESTS}-${MAX_GUESTS}` },
  }, ["date", "guests"]),
  fn("propose_booking", "Show the guest a booking to confirm with a button. Nothing is booked until they confirm.", {
    date: { type: "string", description: "YYYY-MM-DD" },
    time: { type: "string", description: "HH:MM" },
    guests: { type: "integer", description: `${MIN_GUESTS}-${MAX_GUESTS}` },
    name: { type: "string" },
    phone: { type: "string" },
    comment: { type: "string", description: "optional wishes" },
  }, ["date", "time", "guests", "name", "phone"]),
  fn("propose_cancellation", "Show the guest a cancellation of a booking found from their link (reference like B1) to confirm.", {
    booking_ref: { type: "string" },
  }, ["booking_ref"]),
  fn("propose_message_to_cafe", "Show the guest their question for the café staff to confirm sending.", {
    question: { type: "string" },
    name: { type: "string" },
    phone: { type: "string" },
  }, ["question", "name", "phone"]),
];

const date = z.string().refine(isValidDate, "date must be YYYY-MM-DD");
const time = z.string().refine(isValidTime, "time must be HH:MM");
const guests = z.coerce.number().int().min(MIN_GUESTS).max(MAX_GUESTS);
const name = z.string().trim().min(1).max(80);
const phone = z.string().refine((v) => normalisePhone(v) !== null, "phone must be international with + or Ukrainian starting with 0");

const schemas = {
  check_availability: z.object({ date, guests }),
  propose_booking: z.object({ date, time, guests, name, phone, comment: z.string().trim().max(500).nullish() }),
  propose_cancellation: z.object({ booking_ref: z.string().trim().min(1).max(20) }),
  propose_message_to_cafe: z.object({ question: z.string().trim().min(1).max(500), name, phone }),
};

export type ToolOutcome = { result: string; proposal?: Proposal };

const fail = (message: string): ToolOutcome => ({ result: JSON.stringify({ error: message }) });

export async function runTool(
  call: { name: string; arguments: string },
  ctx: { now: Date; services: ChatServices; found: Record<string, FoundBooking> },
): Promise<ToolOutcome> {
  const schema = schemas[call.name as keyof typeof schemas];
  if (!schema) return fail(`unknown tool ${call.name}`);
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return fail("arguments are not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const args = parsed.data as Record<string, any>;

  switch (call.name) {
    case "check_availability": {
      try {
        const times = await ctx.services.availability(args.date, args.guests);
        return { result: JSON.stringify({ date: args.date, guests: args.guests, times }) };
      } catch (error) {
        if (error instanceof HttpError && error.code === "DATE_OUT_OF_RANGE") return fail("date is in the past or more than 30 days ahead");
        throw error;
      }
    }
    case "propose_booking": {
      if (!isStartBookable(args.date, args.time, ctx.now)) return fail("this start time cannot be booked (opening hours, 30-minute grid, at least 1 hour from now, 30 days ahead)");
      const free = await ctx.services.availability(args.date, args.guests).catch(() => [] as string[]);
      if (!free.includes(args.time)) return fail(`no table for ${args.guests} at ${args.time}; free times: ${free.join(", ") || "none"}`);
      const proposal: Proposal = {
        kind: "booking", date: args.date, time: args.time, guests: args.guests,
        name: args.name, phone: normalisePhone(args.phone)!, comment: args.comment || null,
      };
      return { result: JSON.stringify({ status: "shown to the guest; waiting for Confirm" }), proposal };
    }
    case "propose_cancellation": {
      const found = ctx.found[args.booking_ref.toUpperCase()];
      if (!found) return fail("unknown booking reference; the guest must paste their booking link first");
      if (!found.cancellable) return fail("this booking can no longer be cancelled");
      const proposal: Proposal = { kind: "cancellation", ref: args.booking_ref.toUpperCase(), reservationId: found.reservationId, date: found.date, time: found.time, guests: found.guests };
      return { result: JSON.stringify({ status: "shown to the guest; waiting for Confirm" }), proposal };
    }
    case "propose_message_to_cafe": {
      const proposal: Proposal = { kind: "message", question: args.question, name: args.name, phone: normalisePhone(args.phone)! };
      return { result: JSON.stringify({ status: "shown to the guest; waiting for Confirm" }), proposal };
    }
  }
  return fail(`unknown tool ${call.name}`);
}
