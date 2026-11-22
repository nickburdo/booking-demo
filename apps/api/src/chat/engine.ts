// Scripted chat engine (v5, ADR-023): state + guest input → new state + bot turn + effects.
// No HTTP and no storage here; booking goes through ChatServices — the same services as the form.

import { cafe } from "@booking-demo/cafe-data";
import { HORIZON_DAYS, MAX_GUESTS, MIN_GUESTS } from "../config";
import { HttpError } from "../errors";
import { addDays, endTime, kyivNow, minutesUntil } from "../time";
import { normalisePhone } from "../validation";
import { dayName, formatDate, TEXTS, type ChatTexts } from "./texts";
import type { ChatContext, ChatState, Effects, GuestInput, Input, Option, Step, TextField, Turn } from "./types";

export const MAX_TEXT = 500;
const MAX_NAME = 80;
const DAYS_PER_PAGE = 7;

interface Result {
  state: ChatState;
  turn: Turn;
  effects: Effects;
}

// --- Turn builders ---------------------------------------------------------------------------

function t(ctx: ChatContext): ChatTexts {
  return TEXTS[ctx.locale];
}

function opt(id: string, label: string): Option {
  return { id, label };
}

function choices(options: Option[]): Input {
  return { kind: "choices", options };
}

function text(ctx: ChatContext, field: Exclude<TextField, "message">, options: Option[], optional = false): Input {
  const maxLength = field === "name" ? MAX_NAME : field === "phone" ? 40 : MAX_TEXT;
  return { kind: "text", field, placeholder: t(ctx).placeholder[field], maxLength, optional, options };
}

function menuOption(ctx: ChatContext): Option {
  return opt("menu", t(ctx).opt.menu);
}

function result(step: Step, input: Input, messages: string[], prev: ChatState, effects: Effects = {}, personSent = prev.personSent): Result {
  return {
    state: { step, awaiting: input, personSent },
    turn: { messages: messages.map((m) => ({ text: m })), input },
    effects,
  };
}

// --- Steps: what each step asks --------------------------------------------------------------

function menuInput(ctx: ChatContext, personSent: boolean): Input {
  const o = t(ctx).opt;
  return choices([
    opt("book", o.book),
    opt("find", o.find),
    opt("faq", o.faq),
    ...(personSent ? [] : [opt("person", o.person)]),
  ]);
}

function toMenu(ctx: ChatContext, prev: ChatState, messages: string[], effects: Effects = {}, personSent = prev.personSent): Result {
  return result({ at: "menu" }, menuInput(ctx, personSent), [...messages, t(ctx).anythingElse], prev, effects, personSent);
}

function dateInput(ctx: ChatContext, page: number): Input {
  const today = kyivNow(ctx.now).date;
  const first = page * DAYS_PER_PAGE;
  const options: Option[] = [];
  for (let i = first; i < first + DAYS_PER_PAGE && i <= HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    const label = i === 0 ? t(ctx).opt.today : i === 1 ? t(ctx).opt.tomorrow : formatDate(ctx.locale, date);
    options.push(opt(`d:${date}`, label));
  }
  if (first + DAYS_PER_PAGE <= HORIZON_DAYS) options.push(opt("more", t(ctx).opt.more));
  options.push(menuOption(ctx));
  return choices(options);
}

function toDate(ctx: ChatContext, prev: ChatState, page = 0, before: string[] = []): Result {
  return result({ at: "book.date", page }, dateInput(ctx, page), [...before, t(ctx).askDate], prev);
}

function guestsInput(ctx: ChatContext): Input {
  const options: Option[] = [];
  for (let n = MIN_GUESTS; n <= MAX_GUESTS; n++) options.push(opt(`g:${n}`, String(n)));
  return choices([...options, opt("otherDay", t(ctx).opt.otherDay), menuOption(ctx)]);
}

/** Free times for the party, or back to the date question if there are none. */
async function toTimes(ctx: ChatContext, prev: ChatState, date: string, guests: number, before: string[] = []): Promise<Result> {
  const tx = t(ctx);
  let times: string[] = [];
  try {
    times = await ctx.services.availability(date, guests);
  } catch (error) {
    // The day left the bookable range (e.g. past midnight): ask for another day.
    if (!(error instanceof HttpError && error.code === "DATE_OUT_OF_RANGE")) throw error;
  }
  const dateLabel = formatDate(ctx.locale, date);
  if (times.length === 0) return toDate(ctx, prev, 0, [...before, tx.noTimes(tx.guests(guests), dateLabel)]);
  const input = choices([...times.map((time) => opt(`t:${time}`, time)), opt("otherDay", tx.opt.otherDay), menuOption(ctx)]);
  return result({ at: "book.time", date, guests }, input, [...before, tx.askTime(dateLabel, tx.guests(guests))], prev);
}

function when(ctx: ChatContext, date: string, time: string): string {
  return `${formatDate(ctx.locale, date)} · ${time}–${endTime(time)}`;
}

function hoursLines(ctx: ChatContext): string[] {
  return cafe.openingHours.map((h) => `• ${dayName(ctx.locale, h.fromDay)}–${dayName(ctx.locale, h.toDay)}: ${h.opens}–${h.closes}`);
}

function menuLines(ctx: ChatContext): string[] {
  return cafe.menu.flatMap((category) => [
    `${category.name[ctx.locale]}:`,
    ...category.items.map((item) => `• ${item.name[ctx.locale]} — ${item.price}`),
  ]);
}

/** The guest token from a pasted link (…/reservation#TOKEN) or a bare token. */
export function tokenFromLink(input: string): string | null {
  const raw = input.trim();
  const candidate = raw.includes("#") ? raw.slice(raw.lastIndexOf("#") + 1) : raw;
  const token = candidate.trim();
  return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

function reservationLink(ctx: ChatContext, token: string): string {
  const prefix = ctx.locale === "en" ? "" : `/${ctx.locale}`;
  return `${ctx.siteUrl}${prefix}/reservation#${token}`;
}

// --- Public API ------------------------------------------------------------------------------

/** First turn of a conversation: greeting, demo notice and the main menu. */
export function start(ctx: ChatContext): Result {
  const tx = t(ctx);
  const input = menuInput(ctx, false);
  const state: ChatState = { step: { at: "menu" }, awaiting: input, personSent: false };
  return { state, turn: { messages: [tx.greeting, tx.demoNotice, tx.menuQuestion].map((m) => ({ text: m })), input }, effects: {} };
}

/**
 * Applies the guest's input. The caller has already checked that a choice was offered and that
 * text was expected (see checkInput); "menu" is offered everywhere and handled here.
 */
export async function handle(ctx: ChatContext, state: ChatState, input: GuestInput): Promise<Result> {
  const tx = t(ctx);
  const step = state.step;
  const choice = "choice" in input ? input.choice : null;
  const value = "text" in input ? input.text.trim() : "";

  if (choice === "menu") return result({ at: "menu" }, menuInput(ctx, state.personSent), [tx.menuQuestion], state);

  switch (step.at) {
    case "menu": {
      if (choice === "book") return toDate(ctx, state);
      if (choice === "find") return result({ at: "find.link" }, text(ctx, "link", [menuOption(ctx)]), [tx.askLink], state);
      if (choice === "faq") return result({ at: "faq" }, faqInput(ctx), [tx.faqQuestion], state);
      if (choice === "person") {
        if (state.personSent) return toMenu(ctx, state, [tx.personAlready]);
        return result({ at: "person.question" }, text(ctx, "question", [menuOption(ctx)]), [tx.askQuestion], state);
      }
      break;
    }

    case "book.date": {
      if (choice === "more") return toDate(ctx, state, step.page + 1);
      if (choice?.startsWith("d:")) {
        const date = choice.slice(2);
        return result({ at: "book.guests", date }, guestsInput(ctx), [tx.askGuests(formatDate(ctx.locale, date))], state);
      }
      break;
    }

    case "book.guests": {
      if (choice === "otherDay") return toDate(ctx, state);
      if (choice?.startsWith("g:")) return toTimes(ctx, state, step.date, Number(choice.slice(2)));
      break;
    }

    case "book.time": {
      if (choice === "otherDay") return toDate(ctx, state);
      if (choice?.startsWith("t:")) {
        const next: Step = { at: "book.name", date: step.date, guests: step.guests, time: choice.slice(2) };
        return result(next, text(ctx, "name", [menuOption(ctx)]), [tx.askName], state);
      }
      break;
    }

    case "book.name": {
      if (!value || value.length > MAX_NAME) return result(step, state.awaiting, [tx.badName], state);
      const next: Step = { at: "book.phone", date: step.date, guests: step.guests, time: step.time, name: value };
      return result(next, text(ctx, "phone", [menuOption(ctx)]), [tx.askPhone], state);
    }

    case "book.phone": {
      const phone = normalisePhone(value);
      if (!phone) return result(step, state.awaiting, [tx.badPhone], state);
      const booking = { date: step.date, guests: step.guests, time: step.time, name: step.name, phone };
      const input = text(ctx, "comment", [opt("skip", tx.opt.skip), menuOption(ctx)], true);
      return result({ at: "book.comment", booking }, input, [tx.askComment], state);
    }

    case "book.comment": {
      if (choice !== "skip" && value.length > MAX_TEXT) return result(step, state.awaiting, [tx.tooLong(MAX_TEXT)], state);
      const comment = choice === "skip" || !value ? null : value;
      const b = step.booking;
      const summary = tx.summary({ when: when(ctx, b.date, b.time), guests: tx.guests(b.guests), name: b.name, phone: b.phone, comment });
      const input = choices([opt("confirm", tx.opt.confirm), opt("change", tx.opt.change), menuOption(ctx)]);
      return result({ at: "book.confirm", booking: b, comment }, input, [summary], state);
    }

    case "book.confirm": {
      if (choice === "change") return toDate(ctx, state);
      if (choice === "confirm") {
        const b = step.booking;
        try {
          const { token, row } = await ctx.services.book({ ...b, comment: step.comment });
          return toMenu(ctx, state, [tx.booked, tx.bookedLink(reservationLink(ctx, token)), tx.bookedDemo], { booked: row, outcome: "booked" });
        } catch (error) {
          if (error instanceof HttpError && (error.code === "SLOT_TAKEN" || error.code === "TIME_NOT_BOOKABLE")) {
            // Someone took the time meanwhile (or it is too close now): offer what is still free.
            return toTimes(ctx, state, b.date, b.guests, [tx.slotTaken]);
          }
          throw error;
        }
      }
      break;
    }

    case "find.link": {
      const token = tokenFromLink(value);
      if (!token) return result(step, state.awaiting, [tx.badLink], state);
      try {
        const r = await ctx.services.find(token);
        const started = minutesUntil(r.date, r.time, ctx.now) <= 0;
        const live = r.status === "pending" || r.status === "confirmed";
        const status = live && started ? tx.status.started : tx.status[r.status];
        const canCancel = live && !started;
        const message = tx.found({ when: when(ctx, r.date, r.time), guests: tx.guests(r.guests), status });
        const input = choices([...(canCancel ? [opt("cancel", tx.opt.cancelBooking)] : []), menuOption(ctx)]);
        return result({ at: "find.found", token, canCancel }, input, [message], state, { outcome: "found" });
      } catch (error) {
        if (error instanceof HttpError && error.code === "NOT_FOUND") return result(step, state.awaiting, [tx.notFound], state);
        throw error;
      }
    }

    case "find.found": {
      if (choice === "cancel" && step.canCancel) {
        const input = choices([opt("yes", tx.opt.yes), opt("no", tx.opt.no)]);
        return result({ at: "find.cancel", token: step.token }, input, [tx.cancelQuestion], state);
      }
      break;
    }

    case "find.cancel": {
      if (choice === "no") return toMenu(ctx, state, []);
      if (choice === "yes") {
        try {
          const { row } = await ctx.services.cancel(step.token);
          return toMenu(ctx, state, [tx.cancelled], { cancelled: row });
        } catch (error) {
          if (error instanceof HttpError && (error.code === "NOT_CANCELLABLE" || error.code === "NOT_FOUND")) {
            return toMenu(ctx, state, [tx.notCancellable]);
          }
          throw error;
        }
      }
      break;
    }

    case "faq": {
      const answers: Record<string, string> = {
        hours: tx.hours(hoursLines(ctx)),
        address: tx.address(cafe.address[ctx.locale]),
        menuItems: tx.menu(menuLines(ctx)),
      };
      if (choice && answers[choice]) return result(step, faqInput(ctx), [answers[choice]], state, { outcome: "questions" });
      break;
    }

    case "person.question": {
      if (!value) return result(step, state.awaiting, [tx.emptyText], state);
      if (value.length > MAX_TEXT) return result(step, state.awaiting, [tx.tooLong(MAX_TEXT)], state);
      return result({ at: "person.name", question: value }, text(ctx, "name", [menuOption(ctx)]), [tx.askPersonName], state);
    }

    case "person.name": {
      if (!value || value.length > MAX_NAME) return result(step, state.awaiting, [tx.badName], state);
      const next: Step = { at: "person.phone", question: step.question, name: value };
      return result(next, text(ctx, "phone", [menuOption(ctx)]), [tx.askPersonPhone], state);
    }

    case "person.phone": {
      const phone = normalisePhone(value);
      if (!phone) return result(step, state.awaiting, [tx.badPhone], state);
      const person = { question: step.question, name: step.name, phone };
      return toMenu(ctx, state, [tx.personSent], { person, outcome: "person" }, true);
    }
  }

  // Unreachable when the caller checked the input against `awaiting`; repeat the question.
  return result(step, state.awaiting, [tx.error], state);
}

function faqInput(ctx: ChatContext): Input {
  const o = t(ctx).opt;
  return choices([opt("hours", o.hours), opt("address", o.address), opt("menuItems", o.menuItems), menuOption(ctx)]);
}

/**
 * Checks the guest's input against what the last turn asked for. Returns the label to store as
 * the guest's message (the option label, or the text), or null if the input does not fit.
 */
export function checkInput(awaiting: Input, input: GuestInput): { label: string; field: TextField | null } | null {
  if (awaiting.kind === "none") return null;
  if ("choice" in input) {
    const option = awaiting.options.find((o) => o.id === input.choice);
    return option ? { label: option.label, field: null } : null;
  }
  if (awaiting.kind !== "text") return null;
  // Empty or too long text is answered by the engine with a hint, so it is accepted here.
  return { label: input.text.trim(), field: awaiting.field };
}
