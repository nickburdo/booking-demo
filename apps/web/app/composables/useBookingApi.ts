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
  status: ReservationStatus
  /** v4: who cancelled, and the café's optional reason (docs/api.md). */
  cancelledBy: 'guest' | 'owner' | null
  cancelReason: string | null
}

export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show'

/** v7: a pre-order (docs/api.md → Order object). Prices in hryvnias, `amount` in euro cents. */
export interface Order {
  status: 'checkout' | 'paid' | 'refunded' | 'refund_failed'
  items: { id: string, name: string, quantity: number, price: number }[]
  total: number
  discountPercent: number
  discounted: number
  amount: number
  currency: string
  rate: number
  paidAt: string | null
  refundedAt: string | null
}

export interface ReservationView {
  reservation: Reservation
  order: Order | null
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
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'NOT_ALLOWED'
  | 'DEMO_LIMIT'
  | 'CHAT_EXPIRED'
  | 'CHAT_CONFLICT'
  | 'CHAT_LIMIT'
  | 'ORDER_NOT_ALLOWED'
  | 'PAID_BOOKING'
  | 'PAYMENTS_UNAVAILABLE'
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

/** JSON request to the API; any failure becomes an ApiError (shared with useAdminApi). */
export async function apiRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
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

export function useBookingApi() {
  const base = useRuntimeConfig().public.apiBase as string
  const request = <T>(path: string, init?: RequestInit) => apiRequest<T>(base, path, init)

  return {
    availability: (date: string, guests: number) =>
      request<{ times: string[] }>(`/availability?date=${date}&guests=${guests}`).then((r) => r.times),
    create: (input: NewReservation) =>
      request<{ reservation: Reservation, token: string }>('/reservations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // v7: the reservation comes with its pre-order.
    get: (token: string) => request<ReservationView>(`/reservations/${encodeURIComponent(token)}`),
    cancel: (token: string) =>
      request<ReservationView>(`/reservations/${encodeURIComponent(token)}/cancel`, { method: 'POST' }),
    /** v7: starts a pre-order; the answer is the URL of Stripe's payment page. */
    order: (token: string, items: { itemId: string, quantity: number }[], locale: string) =>
      request<{ url: string }>(`/reservations/${encodeURIComponent(token)}/order`, {
        method: 'POST',
        body: JSON.stringify({ items, locale }),
      }),
  }
}
