import { z } from "zod";
import { MAX_GUESTS, MIN_GUESTS } from "./config";
import { HttpError } from "./errors";
import { isValidDate, isValidTime } from "./time";

/**
 * Normalises a phone number to E.164, or returns null if it is not acceptable.
 * Spaces, dashes and brackets are ignored. A Ukrainian local number "0XXXXXXXXX"
 * becomes "+380XXXXXXXXX"; anything else must start with "+" (v2 plan, O1).
 */
export function normalisePhone(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, "");
  if (/^0\d{9}$/.test(compact)) return `+380${compact.slice(1)}`;
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  return null;
}

const date = z.string().refine(isValidDate, "Expected a date as YYYY-MM-DD");
const time = z.string().refine(isValidTime, "Expected a time as HH:MM");
const guests = z.int().min(MIN_GUESTS).max(MAX_GUESTS);

const phone = z.string().transform((value, ctx) => {
  const normalised = normalisePhone(value);
  if (normalised === null) {
    ctx.issues.push({
      code: "custom",
      message: "Expected an international number with + or a Ukrainian number starting with 0",
      input: value,
    });
    return z.NEVER;
  }
  return normalised;
});

export const availabilityQuery = z.object({
  date,
  guests: z.coerce.number().pipe(guests),
});

export const reservationBody = z.object({
  date,
  time,
  guests,
  name: z.string().trim().min(1).max(80),
  phone,
  comment: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
  // Checked with Turnstile after validation; a missing token is VERIFICATION_FAILED (ADR-019).
  turnstileToken: z.string().max(2048).optional(),
});

export type ReservationInput = z.output<typeof reservationBody>;

// --- Admin (v4, docs/api.md → Admin) ---

export const loginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const adminDayQuery = z.object({ date });

export const adminCancelBody = z.object({
  reason: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null)),
});

/** Parses input or throws a 400 VALIDATION HttpError with one message per field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const { formErrors, fieldErrors } = z.flattenError(result.error);
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) fields[key] = messages[0];
  }
  throw new HttpError(400, "VALIDATION", formErrors[0] ?? "Invalid request", fields);
}
