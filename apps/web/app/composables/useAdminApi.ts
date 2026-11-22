// Admin API client (v4, docs/api.md → Admin, ADR-020). The session token lives in
// sessionStorage and goes out as a bearer header; a 401 ends the session and opens the login.
import { ApiError, apiRequest, type ReservationStatus } from '~/composables/useBookingApi'

export interface AdminReservation {
  id: string
  date: string
  time: string
  endTime: string
  guests: number
  table: string
  name: string
  phone: string
  comment: string | null
  status: ReservationStatus
  cancelledBy: 'guest' | 'owner' | null
  cancelReason: string | null
  notified: boolean
  demo: boolean
}

export type AdminAction = 'confirm' | 'cancel' | 'no-show'

/** A chat conversation in the admin list (v5, docs/api.md → Chat → Admin). */
export interface AdminChat {
  id: string
  startedAt: string
  locale: 'en' | 'ru' | 'uk'
  /** v6: which chat engine ran the conversation. */
  engine: 'scripted' | 'ai'
  outcome: 'booked' | 'found' | 'questions' | 'person' | 'left'
  messages: number
  reservationDate: string | null
}

export interface AdminChatMessage {
  sender: 'guest' | 'bot'
  text: string
  at: string
}

const STORAGE_KEY = 'linden-admin-session'

interface Session {
  token: string
  expiresAt: string
}

function readSession(): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null
    return session && new Date(session.expiresAt) > new Date() ? session : null
  } catch {
    return null
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: nothing to clear.
  }
}

export function useAdminApi() {
  const base = useRuntimeConfig().public.apiBase as string
  const localePath = useLocalePath()

  /** Authorised request; on 401 the session is dropped and the login page opens. */
  async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = readSession()
    if (!session) {
      await navigateTo(localePath('/admin/login'))
      throw new ApiError('UNAUTHORIZED', 'Not logged in.')
    }
    try {
      return await apiRequest<T>(base, path, {
        ...init,
        headers: { authorization: `Bearer ${session.token}`, ...init.headers },
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        clearSession()
        await navigateTo(localePath('/admin/login'))
      }
      throw error
    }
  }

  return {
    hasSession: () => readSession() !== null,

    async login(username: string, password: string): Promise<void> {
      const session = await apiRequest<Session>(base, '/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      } catch {
        throw new ApiError('INTERNAL', 'Session storage is not available.')
      }
    },

    async logout(): Promise<void> {
      try {
        await authed('/admin/logout', { method: 'POST' })
      } catch {
        // The session is dropped locally either way.
      }
      clearSession()
      await navigateTo(localePath('/admin/login'))
    },

    day: (date: string) =>
      authed<{ reservations: AdminReservation[] }>(`/admin/reservations?date=${date}`).then((r) => r.reservations),

    act: (id: string, action: AdminAction, reason?: string) =>
      authed<{ reservation: AdminReservation }>(`/admin/reservations/${id}/${action}`, {
        method: 'POST',
        body: action === 'cancel' ? JSON.stringify({ reason: reason || null }) : undefined,
      }).then((r) => r.reservation),

    addDemo: () => authed<{ created: number }>('/admin/demo-reservations', { method: 'POST' }).then((r) => r.created),

    chats: (engine?: AdminChat['engine']) =>
      authed<{ chats: AdminChat[] }>(engine ? `/admin/chats?engine=${engine}` : '/admin/chats').then((r) => r.chats),

    chat: (id: string) => authed<{ chat: AdminChat, messages: AdminChatMessage[] }>(`/admin/chats/${id}`),
  }
}
