<script setup lang="ts">
// Admin "Chats" (v5, docs/design.md §6, ADR-024): conversations of the last 7 days and a
// transcript with the guest's name and phone masked by the API. Prerendered shell; data is read
// in the browser after hydration.
import type { AdminChat, AdminChatMessage } from '~/composables/useAdminApi'
import { ApiError } from '~/composables/useBookingApi'

const { t, locale, locales } = useI18n()
const admin = useAdminApi()
const localePath = useLocalePath()

useHead({
  title: () => t('admin.chats.metaTitle'),
  meta: [{ name: 'robots', content: 'noindex' }],
})

const ready = ref(false)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const chats = ref<AdminChat[]>([])
const selected = ref<AdminChat | null>(null)
const transcript = ref<AdminChatMessage[]>([])
const transcriptState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const transcriptBox = ref<HTMLElement>()

async function load() {
  state.value = 'loading'
  try {
    chats.value = await admin.chats()
    state.value = 'ready'
    const first = chats.value[0]
    if (first && !selected.value) await open(first, false)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
    state.value = 'error'
  }
}

async function open(chat: AdminChat, focus = true) {
  selected.value = chat
  transcriptState.value = 'loading'
  try {
    transcript.value = (await admin.chat(chat.id)).messages
    transcriptState.value = 'ready'
    if (focus) {
      await nextTick()
      transcriptBox.value?.focus()
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
    transcriptState.value = 'error'
  }
}

onNuxtReady(() => {
  if (!admin.hasSession()) {
    navigateTo(localePath('/admin/login'))
    return
  }
  ready.value = true
  load()
})

const tag = computed(() => (locales.value as Array<{ code: string, language?: string }>).find((l) => l.code === locale.value)?.language ?? 'en-US')

/** "Today 10:42", "Yesterday 21:03", or "Nov 20 12:01" — in Kyiv time. */
function startedLabel(iso: string): string {
  const d = new Date(iso)
  const day = kyivToday(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  if (day === kyivToday()) return `${t('admin.chats.today')} ${time}`
  if (day === addDays(kyivToday(), -1)) return `${t('admin.chats.yesterday')} ${time}`
  const date = new Intl.DateTimeFormat(tag.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
  return `${date} ${time}`
}

function reservationDayLabel(date: string): string {
  return new Intl.DateTimeFormat(tag.value, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

const outcomeClass: Record<AdminChat['outcome'], string> = {
  booked: 'bg-linden',
  person: 'bg-[#DFE6FB] text-[#1F3A8F]',
  found: 'border-[1.5px] border-espresso bg-white',
  questions: 'bg-line',
  left: 'border-[1.5px] border-dashed border-line text-steam',
}

// Demo notes start with "Demo:" / "Демо:" (\b would not work with Cyrillic).
const isDemoNote = (m: AdminChatMessage) => m.sender === 'bot' && /^(Demo|Демо):/.test(m.text)
</script>

<template>
  <div>
    <AdminHeader :logged-in="ready" @logout="admin.logout()" />
    <AdminTabs />
    <main class="page-container section-pad min-h-[70vh]">
      <template v-if="ready">
        <div class="grid gap-7 lg:grid-cols-[440px_1fr]">
          <div>
            <h1 class="font-display text-[26px] font-bold md:text-[30px]">{{ t('admin.chats.title') }}</h1>
            <p class="mt-1 text-[15px] text-steam">{{ t('admin.chats.lead') }}</p>

            <p v-if="state === 'loading'" class="mt-6 text-steam">{{ t('admin.day.loading') }}</p>
            <div v-else-if="state === 'error'" class="mt-6" role="alert">
              {{ t('admin.chats.loadError') }}
              <button type="button" class="ml-2 text-cobalt underline underline-offset-2" @click="load">{{ t('booking.retry') }}</button>
            </div>
            <p v-else-if="chats.length === 0" class="mt-6 rounded-[10px] border-2 border-dashed border-line p-5 text-steam">{{ t('admin.chats.empty') }}</p>
            <ul v-else class="mt-4 border-t border-line">
              <li v-for="c in chats" :key="c.id" class="border-b border-line">
                <button
                  type="button"
                  class="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 px-2 py-3 text-left sm:grid sm:grid-cols-[minmax(96px,auto)_40px_1fr_auto]"
                  :class="selected?.id === c.id ? 'bg-white' : 'hover:bg-white/60'"
                  :aria-current="selected?.id === c.id ? 'true' : undefined"
                  @click="open(c)"
                >
                  <span class="text-[15px] tabular-nums">{{ startedLabel(c.startedAt) }}</span>
                  <span class="rounded border border-line px-1 text-center text-xs font-semibold uppercase">{{ c.locale }}</span>
                  <!-- On phones the message count goes to a second line, so long outcome labels fit -->
                  <span class="order-last w-full text-[15px] text-steam sm:order-none sm:w-auto">{{ t('admin.chats.messages', c.messages) }}</span>
                  <span class="ml-auto rounded-md px-2 py-0.5 text-[13px] font-semibold sm:ml-0" :class="outcomeClass[c.outcome]">{{ t(`admin.chats.outcome.${c.outcome}`) }}</span>
                </button>
              </li>
            </ul>
          </div>

          <section v-if="selected" :aria-label="t('admin.chats.transcript')">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p>
                <strong>{{ startedLabel(selected.startedAt) }}</strong>
                <span class="text-[15px] text-steam"> · {{ selected.locale.toUpperCase() }} · {{ t('admin.chats.messages', selected.messages) }}</span>
              </p>
              <NuxtLink
                v-if="selected.reservationDate"
                :to="{ path: localePath('/admin'), query: { date: selected.reservationDate } }"
                class="text-[15px] text-cobalt underline underline-offset-2"
              >
                {{ t('admin.chats.bookingLink', { date: reservationDayLabel(selected.reservationDate) }) }} →
              </NuxtLink>
            </div>
            <div ref="transcriptBox" tabindex="-1" class="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 outline-none">
              <p v-if="transcriptState === 'loading'" class="text-steam">{{ t('admin.day.loading') }}</p>
              <p v-else-if="transcriptState === 'error'" role="alert">{{ t('admin.chats.loadError') }}</p>
              <template v-else>
                <p
                  v-for="(m, i) in transcript"
                  :key="i"
                  class="max-w-[85%] rounded-[14px] px-3 py-2 text-[15px] leading-snug whitespace-pre-line break-words"
                  :class="m.sender === 'guest'
                    ? 'self-end rounded-br-[4px] bg-espresso text-milk'
                    : isDemoNote(m)
                      ? 'self-start border border-dashed border-line text-sm text-steam'
                      : 'self-start rounded-bl-[4px] border border-line bg-milk'"
                >
                  <span class="sr-only">{{ m.sender === 'guest' ? t('admin.chats.guest') : t('admin.chats.bot') }}: </span>{{ m.text }}
                </p>
              </template>
            </div>
          </section>
        </div>
      </template>
      <p v-else class="text-steam">{{ t('admin.day.loading') }}</p>
    </main>
  </div>
</template>
