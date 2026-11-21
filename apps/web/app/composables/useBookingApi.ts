// Thin client for the booking API (docs/api.md). Every failure becomes an ApiError with
// the API's stable error code, so components translate by code (v3 plan, P9).

export interface Reservation {
  id: string
  date: string
  time: string
  endTime: string
  guests: number
  name: string
  phone: string
  comment: string | null
  status: 'pending' | 'cancelled'
}

export interface NewReservation {
  date: string
  time: string
  guests: number
  name: string
  phone: string
  comment?: string
  turnstileToken: string
}

/** API error codes (docs/api.md) plus NETWORK for "no answer at all". */
export type ApiErrorCode =
  | 'VALIDATION'
  | 'DATE_OUT_OF_RANGE'
  | 'TIME_NOT_BOOKABLE'
  | 'VERIFICATION_FAILED'
  | 'NOT_FOUND'
  | 'SLOT_TAKEN'
  | 'NOT_CANCELLABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'VERIFICATION_UNAVAILABLE'
  | 'NETWORK'

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function useBookingApi() {
  const base = useRuntimeConfig().public.apiBase as string

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      })
    } catch {
      throw new ApiError('NETWORK', 'The booking service cannot be reached.')
    }
    const body = await res.json().catch(() => null)
    if (res.ok) return body as T
    const error = body?.error
    throw new ApiError(error?.code ?? 'INTERNAL', error?.message ?? `HTTP ${res.status}`, error?.fields ?? {})
  }

  return {
    availability: (date: string, guests: number) =>
      request<{ times: string[] }>(`/availability?date=${date}&guests=${guests}`).then((r) => r.times),
    create: (input: NewReservation) =>
      request<{ reservation: Reservation, token: string }>('/reservations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    get: (token: string) =>
      request<{ reservation: Reservation }>(`/reservations/${encodeURIComponent(token)}`).then((r) => r.reservation),
    cancel: (token: string) =>
      request<{ reservation: Reservation }>(`/reservations/${encodeURIComponent(token)}/cancel`, {
        method: 'POST',
      }).then((r) => r.reservation),
  }
}
