<script setup lang="ts">
// Chat widget on the landing page (v5, docs/design.md §6). Two tabs, two conversations side by
// side (v5 R1, v6): the scripted chat (ADR-023) and the AI chat on Workers AI (ADR-026). Each tab
// keeps its own conversation; ChatConversation renders and runs it.
import type { ChatEngine } from '~/composables/useChatApi'

const { t } = useI18n()

const open = ref(false)
const tab = ref<ChatEngine>('scripted')
const TABS: ChatEngine[] = ['scripted', 'ai']
const tabButtons = ref<HTMLButtonElement[]>([])
const launcher = ref<HTMLButtonElement>()
const conversations = reactive<Partial<Record<ChatEngine, { activate: () => Promise<void> }>>>({})

function setConversation(engine: ChatEngine, el: unknown) {
  if (el) conversations[engine] = el as { activate: () => Promise<void> }
}

async function activateCurrent() {
  await nextTick()
  await conversations[tab.value]?.activate()
}

function selectTab(next: ChatEngine, focus = false) {
  tab.value = next
  if (focus) nextTick(() => tabButtons.value[TABS.indexOf(next)]?.focus())
  activateCurrent()
}

// Tablist keyboard pattern: arrows move between tabs.
function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const i = TABS.indexOf(tab.value)
  selectTab(TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!, true)
}

function openChat() {
  open.value = true
  activateCurrent()
}

function closeChat() {
  open.value = false
  nextTick(() => launcher.value?.focus())
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeChat()
}

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

    <!-- v-show keeps both conversations (and their bot checks) alive while the panel is closed -->
    <section
      v-show="open"
      id="chat-panel"
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

      <div
        v-for="name in TABS"
        v-show="tab === name"
        :id="`chat-tabpanel-${name}`"
        :key="name"
        role="tabpanel"
        :aria-labelledby="`chat-tab-${name}`"
        class="flex min-h-0 flex-1 flex-col"
      >
        <ChatConversation :ref="(el) => setConversation(name, el)" :engine="name" />
      </div>
    </section>
  </div>
</template>
