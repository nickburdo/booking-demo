// Chat types (v5, ADR-023, docs/api.md → Chat). The engine turns a state plus the guest's input
// into a new state and a "bot turn"; the widget only renders turns.

import type { ReservationDto } from "../booking";
import type { ReservationRow } from "../repo";

export type Locale = "en" | "ru" | "uk";
export const LOCALES: readonly Locale[] = ["en", "ru", "uk"];

export interface Option {
  id: string;
  label: string;
}

export type TextField = "name" | "phone" | "comment" | "link" | "question" | "message";

/** What the bot expects next. Text inputs may offer quick options too (e.g. "Skip", "Main menu"). */
export type Input =
  | { kind: "choices"; options: Option[] }
  | { kind: "text"; field: TextField; placeholder: string; maxLength: number; optional: boolean; options: Option[] }
  | { kind: "none" };

export interface Turn {
  messages: { text: string }[];
  input: Input;
}

interface Booking {
  date: string;
  guests: number;
  time: string;
  name: string;
  phone: string;
}

/** Where the conversation is. Collected answers travel with the step. */
export type Step =
  | { at: "menu" }
  | { at: "book.date"; page: number }
  | { at: "book.guests"; date: string }
  | { at: "book.time"; date: string; guests: number }
  | { at: "book.name"; date: string; guests: number; time: string }
  | { at: "book.phone"; date: string; guests: number; time: string; name: string }
  | { at: "book.comment"; booking: Booking }
  | { at: "book.confirm"; booking: Booking; comment: string | null }
  | { at: "find.link" }
  | { at: "find.found"; token: string; canCancel: boolean }
  | { at: "find.cancel"; token: string }
  | { at: "faq" }
  | { at: "person.question" }
  | { at: "person.name"; question: string }
  | { at: "person.phone"; question: string; name: string };

export interface ChatState {
  step: Step;
  /** The input of the last bot turn: the guest's next message is checked against it. */
  awaiting: Input;
  /** "Pass to a person" works once per conversation (ADR-024). */
  personSent: boolean;
  /** Set while a request handles this step (v5 R2.2): ISO time of the claim. */
  busySince?: string;
}

export type Outcome = "left" | "questions" | "found" | "person" | "booked";
/** Higher wins when a conversation does several things. */
export const OUTCOME_RANK: Record<Outcome, number> = { left: 0, questions: 1, found: 2, person: 3, booked: 4 };

/** What the guest sent: a choice id from the offered options, or text. */
export type GuestInput = { choice: string } | { text: string };

/** Booking services the engine uses — the same ones as the form (ADR-023). */
export interface ChatServices {
  availability(date: string, guests: number): Promise<string[]>;
  book(input: { date: string; time: string; guests: number; name: string; phone: string; comment: string | null }): Promise<{
    token: string;
    reservation: ReservationDto;
    row: ReservationRow;
  }>;
  find(token: string): Promise<ReservationDto>;
  cancel(token: string): Promise<{ reservation: ReservationDto; row: ReservationRow }>;
}

export interface ChatContext {
  locale: Locale;
  now: Date;
  /** Site origin for the reservation link (the request's allowed Origin, or the live site). */
  siteUrl: string;
  services: ChatServices;
}

/** Side effects for the HTTP layer to carry out after the turn is saved. */
export interface Effects {
  booked?: ReservationRow;
  cancelled?: ReservationRow;
  person?: { question: string; name: string; phone: string };
  outcome?: Outcome;
}
