<script setup lang="ts">
// One chat conversation inside the widget (v5 design; v6: used by both tabs). The server runs the
// dialogue — scripted (ADR-023) or AI (ADR-026) — and writes the texts; this component renders bot
// turns, the bot check and the guest's answers. The widget calls activate() when the conversation
// becomes visible.
import type { ChatEngine, ChatInput, ChatMessage, ChatOption, ChatTurn } from '~/composables/useChatApi'
import { ApiError } from '~/composables/useBookingApi'

const props = defineProps<{ engine: ChatEngine }>()

const { t, locale } = useI18n()
const chat = useChatApi(props.engine)

type Phase = 'idle' | 'check' | 'loading' | 'active' | 'ended'
const phase = ref<Phase>('idle')
const messages = ref<ChatMessage[]>([])
const input = ref<ChatInput>({ kind: 'none' })
const busy = ref(false)
const error = ref<string | null>(null)
const endedReason = ref<'expired' | 'limit' | null>(null)
const draft = ref('')

const root = ref<HTMLElement>()
const scroller = ref<HTMLElement>()
const turnstile = ref<{ reset: () => void } | null>(null)

// Secondary chips: navigation and "skip"/"change", not answers to the question.
const SECONDARY = new Set(['menu', 'skip', 'otherDay', 'more', 'change', 'no'])
const isTime = (o: ChatOption) => o.id.startsWith('t:')

/** Bot text with plain links turned into anchors (rendered as text nodes, never as HTML). */
function parts(text: string): { text: string, href?: string }[] {
  return text.split(/(https?:\/\/\S+)/g).filter(Boolean).map((p) => (/^https?:\/\//.test(p) ? { text: p, href: p } : { text: p }))
}
// Demo notes start with "Demo:" / "Демо:" (\b would not work with Cyrillic).
const isDemoNote = (m: ChatMessage) => m.sender === 'bot' && /^(Demo|Демо):/.test(m.text)

async function scrollAndFocus() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  // Focus moves to the new question: the text field, or the first choice.
  root.value?.querySelector<HTMLElement>('[data-chat-focus]')?.focus({ preventScroll: true })
}

function applyTurn(turn: ChatTurn) {
  messages.value.push(...turn.messages.map((m) => ({ sender: 'bot' as const, text: m.text })))
  input.value = turn.input
  if (turn.input.kind === 'none') phase.value = 'ended'
}

function end(reason: 'expired' | 'limit') {
  chat.forget()
  endedReason.value = reason
  input.value = { kind: 'none' }
  phase.value = 'ended'
}

function showError(e: unknown) {
  const code = e instanceof ApiError ? e.code : 'INTERNAL'
  if (code === 'CHAT_EXPIRED') return end('expired')
  if (code === 'CHAT_LIMIT') return end('limit')
  error.value = ['NETWORK', 'RATE_LIMITED', 'VERIFICATION_FAILED', 'VERIFICATION_UNAVAILABLE'].includes(code)
    ? t(`chat.errors.${code}`)
    : t('chat.errors.generic')
}

/** Becoming visible: continue the conversation of this tab, or show the bot check. */
async function activate() {
  error.value = null
  if (phase.value !== 'idle') return scrollAndFocus()
  if (chat.hasConversation()) {
    phase.value = 'loading'
    try {
      const history = await chat.history()
      messages.value = history.messages
      input.value = history.input
      phase.value = history.input.kind === 'none' ? 'ended' : 'active'
    } catch (e) {
      phase.value = 'check'
      if (e instanceof ApiError && e.code === 'CHAT_EXPIRED') chat.forget()
      else showError(e)
    }
  } else {
    phase.value = 'check'
  }
  await scrollAndFocus()
}

// v6 R1: the bot check only prepares a token; the conversation is created when the guest presses
// "Start chat", so opening the widget or a tab leaves nothing behind in the admin.
const checkToken = ref<string | null>(null)

function onBotCheck(token: string | null) {
  checkToken.value = token // null when the check expired; Turnstile then runs it again
  if (token) nextTick(() => root.value?.querySelector<HTMLElement>('[data-chat-start]')?.focus({ preventScroll: true }))
}

async function startConversation() {
  const token = checkToken.value
  if (!token || busy.value) return
  busy.value = true
  error.value = null
  try {
    const turn = await chat.start(token, locale.value)
    messages.value = []
    endedReason.value = null
    phase.value = 'active'
    applyTurn(turn)
  } catch (e) {
    showError(e)
    turnstile.value?.reset()
  } finally {
    checkToken.value = null // a Turnstile token works once
    busy.value = false
  }
  await scrollAndFocus()
}

/** A conflict or a refused answer means our view is stale: reload the conversation. */
async function reload() {
  try {
    const history = await chat.history()
    messages.value = history.messages
    input.value = history.input
  } catch (e) {
    showError(e)
  }
}

async function send(payload: { choice: string } | { text: string }, label: string) {
  if (busy.value) return
  busy.value = true
  error.value = null
  messages.value.push({ sender: 'guest', text: label })
  const previousInput = input.value
  input.value = { kind: 'none' }
  await scrollAndFocus()
  try {
    applyTurn(await chat.send(payload))
    draft.value = ''
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL'
    if (code === 'CHAT_CONFLICT' || code === 'VALIDATION') {
      await reload()
    } else {
      messages.value.pop() // the message did not go through; keep it in the field to retry
      input.value = previousInput
      showError(e)
    }
  } finally {
    busy.value = false
  }
  await scrollAndFocus()
}

function choose(option: ChatOption) {
  send({ choice: option.id }, option.label)
}

function submitText() {
  if (input.value.kind !== 'text') return
  const text = draft.value.trim()
  if (!text) {
    // Empty optional answer = the "Skip" option, so no empty bubble is sent (v5 R2.5).
    const skip = input.value.optional ? input.value.options.find((o) => o.id === 'skip') : undefined
    if (skip) choose(skip)
    return
  }
  send({ text }, text)
}

function startOver() {
  chat.forget()
  messages.value = []
  endedReason.value = null
  error.value = null
  phase.value = 'check'
  scrollAndFocus()
}

const options = computed(() => (input.value.kind === 'none' ? [] : input.value.options))
const textId = `chat-text-${props.engine}`

defineExpose({ activate })
</script>

<template>
  <div ref="root" class="flex min-h-0 flex-1 flex-col">
    <!-- Start: demo note + bot check (ADR-024: the guest learns that the admin shows chats) -->
    <div v-if="phase === 'check'" class="flex flex-col gap-3 overflow-y-auto px-4 py-5">
      <p class="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-steam">
        {{ engine === 'ai' ? t('chat.ai.demoNote') : t('chat.demoNote') }}
      </p>
      <p class="text-[15px]">{{ t('chat.botCheck') }}</p>
      <TurnstileWidget ref="turnstile" theme="light" @token="onBotCheck" @error="error = t('chat.errors.botCheck')" />
      <button
        type="button"
        data-chat-start
        class="self-start rounded-[10px] bg-cobalt px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        :disabled="!checkToken || busy"
        @click="startConversation"
      >
        {{ busy ? t('chat.starting') : t('chat.start') }}
      </button>
      <p v-if="!checkToken && !busy" class="text-[15px] text-steam">{{ t('chat.startsAfter') }}</p>
      <p v-if="error" role="alert" class="border-l-4 border-error bg-[#fbeceb] px-3 py-2 text-[14.5px]">{{ error }}</p>
    </div>

    <p v-else-if="phase === 'loading' || phase === 'idle'" class="px-4 py-5 text-steam">{{ t('chat.loading') }}</p>

    <template v-else>
      <div ref="scroller" class="flex flex-1 flex-col gap-2 overflow-y-auto px-3.5 pt-3.5 pb-1.5" aria-live="polite">
        <p
          v-for="(m, i) in messages"
          :key="i"
          class="max-w-[85%] rounded-[14px] px-3 py-2 text-[15.5px] leading-snug whitespace-pre-line"
          :class="m.sender === 'guest'
            ? 'self-end rounded-br-[4px] bg-espresso text-milk'
            : isDemoNote(m)
              ? 'self-start border border-dashed border-line text-sm text-steam'
              : 'self-start rounded-bl-[4px] border border-line bg-white'"
        >
          <span v-if="m.sender === 'guest'" class="sr-only">{{ t('chat.you') }}: </span>
          <template v-for="(p, j) in parts(m.text)" :key="j">
            <a v-if="p.href" :href="p.href" class="break-all text-cobalt underline underline-offset-2">{{ p.text }}</a>
            <template v-else>{{ p.text }}</template>
          </template>
        </p>
        <p v-if="busy" class="self-start text-sm text-steam" aria-hidden="true">…</p>
        <p v-if="error" role="alert" class="border-l-4 border-error bg-[#fbeceb] px-3 py-2 text-[14.5px]">{{ error }}</p>
        <p v-if="phase === 'ended' && endedReason" class="self-start rounded-xl border border-dashed border-line px-3 py-2 text-sm text-steam">
          {{ t(`chat.ended.${endedReason}`) }}
        </p>
      </div>

      <div v-if="phase === 'ended'" class="px-3.5 pt-1 pb-3">
        <button type="button" data-chat-focus class="rounded-full border-2 border-cobalt bg-white px-3 py-1 text-sm font-semibold text-cobalt" @click="startOver">
          {{ t('chat.startNew') }}
        </button>
      </div>

      <template v-else>
        <div v-if="options.length" class="flex flex-wrap gap-1.5 px-3.5 pt-1 pb-3" role="group" :aria-label="t('chat.answers')">
          <button
            v-for="(o, i) in options"
            :key="o.id"
            type="button"
            :data-chat-focus="input.kind === 'choices' && i === 0 ? '' : undefined"
            class="border-2 bg-white px-3 py-1 text-sm font-semibold disabled:opacity-60"
            :class="[
              isTime(o) ? 'min-w-[62px] rounded-[10px] tabular-nums' : 'rounded-full',
              SECONDARY.has(o.id) ? 'border-line text-espresso' : 'border-cobalt text-cobalt',
            ]"
            :disabled="busy"
            @click="choose(o)"
          >
            {{ o.label }}
          </button>
        </div>
        <form v-if="input.kind === 'text'" class="flex gap-2 border-t border-line bg-white px-3 py-2.5" @submit.prevent="submitText">
          <label :for="textId" class="sr-only">{{ input.placeholder }}</label>
          <input
            :id="textId"
            v-model="draft"
            data-chat-focus
            :placeholder="input.placeholder"
            :maxlength="input.maxLength"
            :type="input.field === 'phone' ? 'tel' : 'text'"
            :autocomplete="input.field === 'name' ? 'name' : input.field === 'phone' ? 'tel' : 'off'"
            class="h-11 min-w-0 flex-1 rounded-[10px] border-2 border-line px-3"
          >
          <button type="submit" class="flex size-11 items-center justify-center rounded-[10px] bg-cobalt text-lg text-white disabled:opacity-60" :disabled="busy" :aria-label="t('chat.send')">➤</button>
        </form>
      </template>
    </template>
  </div>
</template>
