<script setup lang="ts">
// Chat widget on the landing page (v5, docs/design.md §6, ADR-023). The server runs the dialogue
// and writes the texts; this component renders bot turns and sends the guest's answers.
import type { ChatInput, ChatMessage, ChatOption, ChatTurn } from '~/composables/useChatApi'
import { ApiError } from '~/composables/useBookingApi'

const { t, locale } = useI18n()
const chat = useChatApi()

type Phase = 'closed-start' | 'check' | 'loading' | 'active' | 'ended'
const open = ref(false)
const phase = ref<Phase>('closed-start')
const messages = ref<ChatMessage[]>([])
const input = ref<ChatInput>({ kind: 'none' })
const busy = ref(false)
const error = ref<string | null>(null)
const endedReason = ref<'expired' | 'limit' | null>(null)
const draft = ref('')

// v5 R1: both chats side by side — the scripted one works, the AI one is "coming soon" (v6).
type Tab = 'scripted' | 'ai'
const tab = ref<Tab>('scripted')
const TABS: Tab[] = ['scripted', 'ai']
const tabButtons = ref<HTMLButtonElement[]>([])
function selectTab(next: Tab, focus = false) {
  tab.value = next
  if (focus) nextTick(() => tabButtons.value[TABS.indexOf(next)]?.focus())
  if (next === 'scripted') scrollAndFocus()
}
// Tablist keyboard pattern: arrows move between tabs.
function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const i = TABS.indexOf(tab.value)
  selectTab(TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!, true)
}

const panel = ref<HTMLElement>()
const scroller = ref<HTMLElement>()
const launcher = ref<HTMLButtonElement>()
const turnstile = ref<{ reset: () => void } | null>(null)

// Secondary chips: navigation and "skip", not answers to the question.
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
  if (tab.value !== 'scripted') return
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  // Focus moves to the new question: the text field, or the first choice.
  const target = panel.value?.querySelector<HTMLElement>('[data-chat-focus]')
  target?.focus({ preventScroll: true })
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

/** Opening: continue the conversation of this tab, or show the bot check. */
async function openChat() {
  open.value = true
  error.value = null
  if (phase.value === 'active' || phase.value === 'ended' || phase.value === 'check') return scrollAndFocus()
  if (chat.hasConversation()) {
    phase.value = 'loading'
    try {
      const history = await chat.history()
      messages.value = history.messages
      input.value = history.input
      phase.value = 'active'
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHAT_EXPIRED') {
        chat.forget()
        phase.value = 'check'
      } else {
        phase.value = 'check'
        showError(e)
      }
    }
  } else {
    phase.value = 'check'
  }
  await scrollAndFocus()
}

function closeChat() {
  open.value = false
  nextTick(() => launcher.value?.focus())
}

async function onBotCheck(token: string | null) {
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeChat()
}

const options = computed(() => (input.value.kind === 'none' ? [] : input.value.options))

// Full screen below md: the page underneath must not scroll while the chat is open.
watch(open, (isOpen) => {
  document.documentElement.style.overflow = isOpen && window.matchMedia('(max-width: 767px)').matches ? 'hidden' : ''
})
onBeforeUnmount(() => (document.documentElement.style.overflow = ''))
</script>

<template>
  <div>
    <button
      v-show="!open"
      ref="launcher"
      type="button"
      class="fixed right-4 bottom-4 z-[1100] flex h-14 items-center gap-2.5 rounded-full bg-cobalt pr-5 pl-4 font-semibold text-white shadow-[0_6px_20px_rgba(42,26,18,0.25)] hover:bg-[color-mix(in_oklab,var(--color-cobalt)_85%,black)] md:right-6 md:bottom-6"
      :aria-expanded="open"
      aria-controls="chat-panel"
      @click="openChat"
    >
      <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
      {{ t('chat.launcher') }}
    </button>

    <section
      v-if="open"
      id="chat-panel"
      ref="panel"
      role="dialog"
      :aria-label="t('chat.title')"
      class="fixed inset-0 z-[1100] flex flex-col bg-milk md:inset-auto md:right-6 md:bottom-6 md:h-[600px] md:max-h-[calc(100vh-3rem)] md:w-[380px] md:overflow-hidden md:rounded-2xl md:border md:border-line md:shadow-[0_12px_40px_rgba(42,26,18,0.25)]"
      @keydown="onKeydown"
    >
      <header class="flex items-center justify-between bg-espresso px-4 py-3.5 text-milk">
        <div>
          <p class="font-display text-base font-bold">Linden Coffee</p>
          <p class="text-[13px] text-milk/70">{{ t('chat.subtitle') }}</p>
        </div>
        <button type="button" class="flex size-9 items-center justify-center rounded-lg border-[1.5px] border-milk/40 text-lg" :aria-label="t('chat.close')" @click="closeChat">✕</button>
      </header>

      <!-- v5 R1: Scripted | AI tabs; the scripted conversation stays as it is while the AI tab is shown -->
      <div role="tablist" :aria-label="t('chat.tabs.label')" class="flex gap-1 border-b border-line bg-white px-3 pt-1.5" @keydown="onTabKeydown">
        <button
          v-for="name in TABS"
          :id="`chat-tab-${name}`"
          :key="name"
          ref="tabButtons"
          type="button"
          role="tab"
          :aria-selected="tab === name"
          :aria-controls="`chat-tabpanel-${name}`"
          :tabindex="tab === name ? 0 : -1"
          class="border-b-[3px] px-3 py-1.5 text-sm font-semibold"
          :class="tab === name ? 'border-linden text-espresso' : 'border-transparent text-steam hover:text-espresso'"
          @click="selectTab(name)"
        >
          {{ t(`chat.tabs.${name}`) }}
        </button>
      </div>

      <div v-show="tab === 'ai'" id="chat-tabpanel-ai" role="tabpanel" aria-labelledby="chat-tab-ai" class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6">
        <p class="font-display text-lg font-bold">{{ t('chat.ai.title') }}</p>
        <p class="text-[15.5px]">{{ t('chat.ai.text') }}</p>
        <p class="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-steam">{{ t('chat.ai.note') }}</p>
        <button type="button" class="self-start rounded-full border-2 border-cobalt bg-white px-3 py-1 text-sm font-semibold text-cobalt" @click="selectTab('scripted', true)">
          {{ t('chat.ai.toScripted') }}
        </button>
      </div>

      <div v-show="tab === 'scripted'" id="chat-tabpanel-scripted" role="tabpanel" aria-labelledby="chat-tab-scripted" class="flex min-h-0 flex-1 flex-col">

      <!-- Start: demo note + bot check (ADR-024: the guest learns that the admin shows chats) -->
      <div v-if="phase === 'check'" class="flex flex-col gap-3 overflow-y-auto px-4 py-5">
        <p class="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-steam">{{ t('chat.demoNote') }}</p>
        <p class="text-[15px]">{{ t('chat.botCheck') }}</p>
        <TurnstileWidget ref="turnstile" theme="light" @token="onBotCheck" @error="error = t('chat.errors.botCheck')" />
        <p v-if="busy" class="text-[15px] text-steam">{{ t('chat.starting') }}</p>
        <p v-else class="text-[15px] text-steam">{{ t('chat.startsAfter') }}</p>
        <p v-if="error" role="alert" class="border-l-4 border-error bg-[#fbeceb] px-3 py-2 text-[14.5px]">{{ error }}</p>
      </div>

      <p v-else-if="phase === 'loading'" class="px-4 py-5 text-steam">{{ t('chat.loading') }}</p>

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
            <label for="chat-text" class="sr-only">{{ input.placeholder }}</label>
            <input
              id="chat-text"
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
    </section>
  </div>
</template>
