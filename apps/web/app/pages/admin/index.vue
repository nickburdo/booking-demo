<script setup lang="ts">
// Admin day view (v4, docs/design.md §6, Admin): one day of reservations, status filter,
// owner actions and demo data. Prerendered shell; session and data are read in the browser
// after hydration (onNuxtReady, the v3 R3 lesson).
import type { AdminAction, AdminReservation } from '~/composables/useAdminApi'
import { ApiError, type ReservationStatus } from '~/composables/useBookingApi'

const { t, locale, locales } = useI18n()
const admin = useAdminApi()
const localePath = useLocalePath()
const route = useRoute()
const router = useRouter()

useHead({
  title: () => t('admin.day.metaTitle'),
  meta: [{ name: 'robots', content: 'noindex' }],
})

const ready = ref(false)
const date = ref('')
const reservations = ref<AdminReservation[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const filter = ref<ReservationStatus | 'all'>('all')
const busyId = ref<string | null>(null)
const rowErrors = ref<Record<string, string>>({})
const notice = ref<string | null>(null)
const demoBusy = ref(false)
// Ticks every 30 s, so the rows switch actions when a reservation starts (v4 R2.2).
const kyivNow = useKyivClock()

let requestSeq = 0
async function load() {
  const seq = ++requestSeq
  state.value = 'loading'
  try {
    const list = await admin.day(date.value)
    if (seq !== requestSeq) return
    reservations.value = list
    state.value = 'ready'
  } catch (error) {
    if (seq !== requestSeq) return
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return // redirected to login
    state.value = 'error'
  }
}

onNuxtReady(() => {
  if (!admin.hasSession()) {
    navigateTo(localePath('/admin/login'))
    return
  }
  const fromUrl = typeof route.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) ? route.query.date : ''
  date.value = fromUrl || kyivToday()
  ready.value = true
})

// The chosen day is kept in the URL (?date=), so a reload or a language switch keeps it.
watch(date, (value) => {
  if (!value) return
  rowErrors.value = {}
  notice.value = null
  filter.value = 'all'
  if (route.query.date !== value) router.replace({ query: { ...route.query, date: value } })
  load()
})

function shift(days: number) {
  if (date.value) date.value = addDays(date.value, days)
}

const dayTitle = computed(() => {
  if (!date.value) return ''
  const tag = (locales.value as Array<{ code: string, language?: string }>).find((l) => l.code === locale.value)?.language
  return new Intl.DateTimeFormat(tag ?? 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${date.value}T00:00:00Z`))
})

const STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'cancelled', 'no_show']
const counts = computed(() => {
  const c: Record<string, number> = { all: reservations.value.length }
  for (const s of STATUSES) c[s] = reservations.value.filter((r) => r.status === s).length
  return c
})
const guestsTotal = computed(() =>
  reservations.value.filter((r) => r.status === 'pending' || r.status === 'confirmed').reduce((n, r) => n + r.guests, 0),
)
const shown = computed(() => (filter.value === 'all' ? reservations.value : reservations.value.filter((r) => r.status === filter.value)))

async function act(r: AdminReservation, action: AdminAction, reason?: string) {
  busyId.value = r.id
  const { [r.id]: _old, ...rest } = rowErrors.value
  rowErrors.value = rest
  try {
    const updated = await admin.act(r.id, action, reason)
    reservations.value = reservations.value.map((x) => (x.id === updated.id ? updated : x))
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'INTERNAL'
    if (code === 'UNAUTHORIZED') return
    rowErrors.value = {
      ...rowErrors.value,
      [r.id]: code === 'NOT_ALLOWED' || code === 'NETWORK' ? t(`admin.errors.${code}`) : t('admin.errors.generic'),
    }
    // Someone else may have changed it: show the current state.
    if (code === 'NOT_ALLOWED' || code === 'NOT_FOUND') {
      const keep = rowErrors.value
      await load()
      rowErrors.value = keep
    }
  } finally {
    busyId.value = null
  }
}

async function addDemo() {
  demoBusy.value = true
  notice.value = null
  try {
    const created = await admin.addDemo()
    notice.value = t('admin.demo.added', created)
    await load()
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'INTERNAL'
    if (code === 'UNAUTHORIZED') return
    notice.value = ['DEMO_LIMIT', 'RATE_LIMITED', 'NETWORK'].includes(code) ? t(`admin.demo.errors.${code}`) : t('admin.errors.generic')
  } finally {
    demoBusy.value = false
  }
}
</script>

<template>
  <div>
    <AdminHeader :logged-in="ready" @logout="admin.logout()" />
    <AdminTabs />
    <main class="page-container section-pad min-h-[70vh]">
      <h1 class="font-display text-[26px] font-bold md:text-[34px]">{{ t('admin.day.title') }}</h1>

      <template v-if="ready">
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <div class="flex w-full items-center gap-2 sm:w-auto">
            <button type="button" class="admin-icon-btn" :aria-label="t('admin.day.prev')" @click="shift(-1)">←</button>
            <label for="admin-date" class="sr-only">{{ t('admin.day.date') }}</label>
            <input id="admin-date" v-model="date" type="date" class="admin-input !h-11 min-w-0 flex-1 sm:w-44 sm:flex-none">
            <button type="button" class="admin-icon-btn" :aria-label="t('admin.day.next')" @click="shift(1)">→</button>
            <button type="button" class="admin-outline-btn hidden h-11 sm:inline-block" @click="date = kyivToday()">{{ t('admin.day.today') }}</button>
          </div>
          <div class="hidden flex-1 sm:block" />
          <button type="button" class="admin-outline-btn hidden sm:inline-block disabled:opacity-70" :disabled="demoBusy" @click="addDemo">
            + {{ t('admin.demo.add') }}
          </button>
        </div>

        <h2 class="mt-6 font-display text-lg md:text-xl">
          <span class="first-letter:uppercase inline-block">{{ dayTitle }}</span>
          <span v-if="state === 'ready' && reservations.length" class="font-sans text-[15px] text-steam">
            · {{ t('admin.day.summary', { count: t('admin.day.reservations', counts.all!), guests: t('admin.guests', guestsTotal) }) }}
          </span>
        </h2>

        <p v-if="notice" class="mt-3 border-l-4 border-linden bg-white px-3.5 py-2" role="status">{{ notice }}</p>

        <div aria-live="polite">
          <p v-if="state === 'loading'" class="mt-6 text-steam">{{ t('admin.day.loading') }}</p>
          <div v-else-if="state === 'error'" class="mt-6" role="alert">
            {{ t('admin.errors.load') }}
            <button type="button" class="ml-2 text-cobalt underline underline-offset-2" @click="load">{{ t('booking.retry') }}</button>
          </div>
          <div v-else-if="reservations.length === 0" class="mt-6 rounded-[10px] border-2 border-dashed border-line p-5 text-steam">
            {{ t('admin.day.empty') }}
            <span class="block text-[15px]">
              {{ t('admin.demo.hint') }}
              <button type="button" class="text-cobalt underline underline-offset-2 disabled:opacity-70" :disabled="demoBusy" @click="addDemo">{{ t('admin.demo.add') }}</button>
            </span>
          </div>
          <template v-else>
            <div class="mt-4 flex flex-wrap gap-2" role="group" :aria-label="t('admin.day.filter')">
              <button
                v-for="key in (['all', ...STATUSES] as const)"
                :key="key"
                type="button"
                class="inline-flex h-9 items-center gap-1.5 rounded-[10px] border-2 px-3 text-sm font-semibold"
                :class="filter === key ? 'border-espresso bg-espresso text-milk' : 'border-line bg-white'"
                :aria-pressed="filter === key"
                @click="filter = key"
              >
                {{ t(`admin.filter.${key}`) }} <span class="font-medium opacity-70">{{ counts[key] }}</span>
              </button>
            </div>
            <ul class="mt-5 border-t border-line">
              <AdminReservationRow
                v-for="r in shown"
                :key="r.id"
                :reservation="r"
                :busy="busyId === r.id"
                :error="rowErrors[r.id] ?? null"
                :now="kyivNow"
                @act="(action, reason) => act(r, action, reason)"
              />
            </ul>
            <p v-if="shown.length === 0" class="mt-4 text-steam">{{ t('admin.day.noneWithFilter') }}</p>
          </template>
        </div>

        <button type="button" class="admin-outline-btn mt-6 w-full sm:hidden disabled:opacity-70" :disabled="demoBusy" @click="addDemo">
          + {{ t('admin.demo.add') }}
        </button>
      </template>
      <p v-else class="mt-6 text-steam">{{ t('admin.day.loading') }}</p>
    </main>
  </div>
</template>
