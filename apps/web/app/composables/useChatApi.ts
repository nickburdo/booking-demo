// Chat API client (v5, docs/api.md → Chat). The conversation token lives in sessionStorage, so a
// reload in the same tab continues the conversation.
import { apiRequest } from '~/composables/useBookingApi'

export interface ChatOption {
  id: string
  label: string
}

export type ChatInput =
  | { kind: 'choices', options: ChatOption[] }
  | { kind: 'text', field: string, placeholder: string, maxLength: number, optional: boolean, options: ChatOption[] }
  | { kind: 'none' }

export interface ChatTurn {
  messages: { text: string }[]
  input: ChatInput
}

export interface ChatMessage {
  sender: 'guest' | 'bot'
  text: string
}

const STORAGE_KEY = 'linden-chat-token'

function readToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the conversation just will not survive a reload.
  }
}

export function useChatApi() {
  const base = useRuntimeConfig().public.apiBase as string
  let token = readToken()

  const authed = () => ({ authorization: `Bearer ${token}` })

  return {
    hasConversation: () => token !== null,

    forget() {
      token = null
      writeToken(null)
    },

    async start(turnstileToken: string, locale: string): Promise<ChatTurn> {
      const body = await apiRequest<{ token: string, turn: ChatTurn }>(base, '/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ turnstileToken, locale }),
      })
      token = body.token
      writeToken(token)
      return body.turn
    },

    send: (input: { choice: string } | { text: string }) =>
      apiRequest<{ turn: ChatTurn }>(base, '/chat/sessions/current/messages', {
        method: 'POST',
        headers: authed(),
        body: JSON.stringify(input),
      }).then((r) => r.turn),

    history: () =>
      apiRequest<{ messages: ChatMessage[], input: ChatInput }>(base, '/chat/sessions/current', { headers: authed() }),
  }
}
