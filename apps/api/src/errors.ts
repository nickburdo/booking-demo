export type ErrorCode =
  | "VALIDATION"
  | "DATE_OUT_OF_RANGE"
  | "TIME_NOT_BOOKABLE"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "NOT_FOUND"
  | "SLOT_TAKEN"
  | "NOT_CANCELLABLE"
  | "NOT_ALLOWED"
  | "DEMO_LIMIT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL";

/** An error that maps directly to a JSON error response (see docs/api.md). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
