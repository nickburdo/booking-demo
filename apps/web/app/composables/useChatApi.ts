// Chat API client (v5, docs/api.md → Chat). The conversation token lives in sessionStorage, so a
// reload in the same tab continues the conversation.
import { apiRequest } from '~/composables/useBookingApi'

/** "scripted" (v5) or "ai" (v6, ADR-026): which engine runs a conversation. */
export type ChatEngine = "scripted" | "ai"

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

// One token per engine; the scripted key stays as in v5, so its conversations survive the update.
const STORAGE_KEYS: Record<ChatEngine, string> = { scripted: 'linden-chat-token', ai: 'linden-chat-token-ai' }

function readToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeToken(key: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(key, token)
    else sessionStorage.removeItem(key)
  } catch {
    // Storage blocked: the conversation just will not survive a reload.
  }
}

export function useChatApi(engine: ChatEngine = 'scripted') {
  const base = useRuntimeConfig().public.apiBase as string
  const key = STORAGE_KEYS[engine]
  let token = readToken(key)

  const authed = () => ({ authorization: `Bearer ${token}` })

  return {
    hasConversation: () => token !== null,

    forget() {
      token = null
      writeToken(key, null)
    },

    async start(turnstileToken: string, locale: string): Promise<ChatTurn> {
      const body = await apiRequest<{ token: string, turn: ChatTurn }>(base, '/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ turnstileToken, locale, engine }),
      })
      token = body.token
      writeToken(key, token)
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
