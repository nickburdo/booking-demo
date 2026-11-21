<script setup lang="ts">
// Guest reservation page (ADR-017): /reservation#<token>. The token stays in the URL hash,
// so it never reaches the static host; everything here runs in the browser.
import { cafe } from '~/data/cafe'
import { ApiError, type Reservation } from '~/composables/useBookingApi'

const { t, locale, locales } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
const api = useBookingApi()
const formatDate = useFormatDate()

useHead({
  title: () => t('reservation.metaTitle'),
  meta: [{ name: 'robots', content: 'noindex' }],
})

type State = 'loading' | 'notFound' | 'error' | 'ready'
const state = ref<State>('loading')
const reservation = ref<Reservation | null>(null)
let token = ''

// Language links carry the hash (the token) only after hydration, like the site header.
const hydrated = ref(false)
function localeLink(code: string): string {
  const path = switchLocalePath(code as 'en' | 'ru' | 'uk')
  return hydrated.value ? path : path.split('#')[0]!
}

async function load() {
  state.value = 'loading'
  try {
    reservation.value = await api.get(token)
    state.value = 'ready'
  } catch (error) {
    state.value = error instanceof ApiError && error.code === 'NOT_FOUND' ? 'notFound' : 'error'
  }
}

// The page is prerendered for /reservation. While hydrating a URL that differs from it (here: the
// #token), Nuxt 4 shows the prerendered route first and restores the real one on
// app:suspense:resolve ("deferred route", plan revision R3). onNuxtReady runs after that, so the
// route hash holds the token by then; window.location.hash in onMounted can still be empty.
const route = useRoute()
onNuxtReady(() => {
  hydrated.value = true
  try {
    token = decodeURIComponent(route.hash.slice(1))
  } catch {
    token = '' // malformed hash, e.g. a truncated link (R4.5)
  }
  if (token) load()
  else state.value = 'notFound'
})

// A booking that has started cannot be cancelled (docs/api.md); compare in Kyiv time.
const started = computed(() => {
  const r = reservation.value
  if (!r) return false
  return `${r.date} ${r.time}` <= `${kyivToday()} ${kyivTimeNow()}`
})
const canCancel = computed(() => reservation.value?.status === 'pending' && !started.value)
const statusKey = computed(() =>
  reservation.value?.status === 'cancelled' ? 'cancelled' : started.value ? 'started' : 'pending',
)

const confirming = ref(false)
const cancelling = ref(false)
const actionError = ref<string | null>(null)
const statusLine = ref<HTMLElement>()

async function cancel() {
  cancelling.value = true
  actionError.value = null
  try {
    reservation.value = await api.cancel(token)
    confirming.value = false
    await nextTick()
    statusLine.value?.focus()
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'INTERNAL'
    actionError.value = code === 'NOT_CANCELLABLE' || code === 'NETWORK'
      ? t(`reservation.errors.${code}`)
      : t('reservation.errors.generic')
    if (code === 'NOT_CANCELLABLE') await load()
    confirming.value = false
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div>
    <header class="border-b border-line bg-milk">
      <div class="page-container flex h-(--header-height) items-center justify-between gap-6">
        <NuxtLink :to="localePath('/')" class="font-display text-lg font-bold">{{ cafe.name }}</NuxtLink>
        <nav :aria-label="t('language.label')" class="flex gap-1">
          <NuxtLink
            v-for="l in locales"
            :key="l.code"
            :to="localeLink(l.code)"
            :lang="l.language"
            :aria-label="l.name"
            :aria-current="l.code === locale ? 'true' : undefined"
            class="rounded-md px-2 py-1 text-[15px] font-medium uppercase"
            :class="l.code === locale ? 'bg-linden' : 'hover:text-cobalt'"
          >
            {{ l.code }}
          </NuxtLink>
        </nav>
      </div>
    </header>

    <main class="page-container section-pad min-h-[60vh]">
      <h1 class="font-display text-[30px] font-bold md:text-[40px]">
        {{ state === 'notFound' ? t('reservation.notFound') : t('reservation.title') }}
      </h1>

      <p v-if="state === 'loading'" class="mt-6 text-steam" aria-live="polite">{{ t('reservation.loading') }}</p>

      <p v-else-if="state === 'notFound'" class="mt-4 max-w-xl">{{ t('reservation.notFoundText') }}</p>

      <div v-else-if="state === 'error'" class="mt-6" role="alert">
        <p>{{ t('reservation.errors.generic') }}</p>
        <button type="button" class="btn-primary mt-4" @click="load">{{ t('booking.retry') }}</button>
      </div>

      <template v-else-if="reservation">
        <p ref="statusLine" tabindex="-1" class="mt-3 outline-none" aria-live="polite">
          <span
            class="inline-block rounded-md px-2.5 py-1 text-sm font-semibold"
            :class="statusKey === 'pending' ? 'bg-linden' : 'bg-line'"
          >
            {{ t(`reservation.status.${statusKey}`) }}
          </span>
        </p>

        <dl class="mt-5 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          <dt class="text-steam">{{ t('reservation.when') }}</dt>
          <dd>{{ formatDate(reservation.date) }} · {{ reservation.time }}–{{ reservation.endTime }}</dd>
          <dt class="text-steam">{{ t('reservation.guests') }}</dt>
          <dd>{{ reservation.guests }}</dd>
          <dt class="text-steam">{{ t('reservation.name') }}</dt>
          <dd>{{ reservation.name }} · {{ reservation.phone }}</dd>
          <template v-if="reservation.comment">
            <dt class="text-steam">{{ t('reservation.comment') }}</dt>
            <dd>{{ reservation.comment }}</dd>
          </template>
        </dl>

        <p v-if="actionError" class="mt-5 text-error" role="alert">{{ actionError }}</p>

        <div v-if="canCancel" class="mt-6">
          <div v-if="confirming" class="flex flex-wrap items-center gap-3">
            <span class="font-semibold">{{ t('reservation.confirmQuestion') }}</span>
            <button
              type="button"
              class="rounded-[10px] bg-error px-5 py-3 font-semibold text-white disabled:opacity-70"
              :disabled="cancelling"
              @click="cancel"
            >
              {{ cancelling ? t('reservation.cancelling') : t('reservation.confirmYes') }}
            </button>
            <button type="button" class="rounded-[10px] border-2 border-espresso px-5 py-2.5 font-semibold" :disabled="cancelling" @click="confirming = false">
              {{ t('reservation.confirmNo') }}
            </button>
          </div>
          <template v-else>
            <button type="button" class="rounded-[10px] border-2 border-error px-5 py-2.5 font-semibold text-error hover:bg-error/5" @click="confirming = true">
              {{ t('reservation.cancel') }}
            </button>
            <p class="mt-2 text-[15px] text-steam">{{ t('reservation.cancelHint') }}</p>
          </template>
        </div>
        <p v-else-if="reservation.status === 'cancelled'" class="mt-6">{{ t('reservation.cancelledNote') }}</p>
        <p v-else-if="started" class="mt-6">{{ t('reservation.startedNote') }}</p>
      </template>

      <p class="mt-10">
        <NuxtLink :to="localePath('/')" class="text-cobalt underline underline-offset-2">← {{ t('reservation.back') }}</NuxtLink>
      </p>
    </main>

    <SiteFooter />
  </div>
</template>
