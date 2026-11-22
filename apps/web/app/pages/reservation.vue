<script setup lang="ts">
// Guest reservation page (ADR-017): /reservation#<token>. The token stays in the URL hash,
// so it never reaches the static host; everything here runs in the browser.
import { cafe } from '~/data/cafe'
import { ApiError, type Order, type Reservation } from '~/composables/useBookingApi'

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
const order = ref<Order | null>(null)
const token = ref('')

// Language links carry the hash (the token) only after hydration, like the site header.
const hydrated = ref(false)
function localeLink(code: string): string {
  const path = switchLocalePath(code as 'en' | 'ru' | 'uk')
  return hydrated.value ? path : path.split('#')[0]!
}

async function load() {
  state.value = 'loading'
  try {
    const view = await api.get(token.value)
    reservation.value = view.reservation
    order.value = view.order
    state.value = 'ready'
  } catch (error) {
    state.value = error instanceof ApiError && error.code === 'NOT_FOUND' ? 'notFound' : 'error'
  }
}

// v7: back from Stripe's page. The return URL is /reservation?paid=1 (or 0) without the token
// (Stripe never sees it); PreorderBlock kept the token in sessionStorage before leaving.
const RETURN_TOKEN_KEY = 'linden-preorder-token'
const returned = ref<'paid' | 'left' | null>(null)
const checking = ref(false)
const checkingSlow = ref(false)

function tokenFromReturn(): string {
  try {
    const saved = sessionStorage.getItem(RETURN_TOKEN_KEY) ?? ''
    sessionStorage.removeItem(RETURN_TOKEN_KEY)
    return saved
  } catch {
    return ''
  }
}

/** After a payment Stripe's webhook can take a few seconds; the API also asks Stripe on each load. */
async function waitForPayment() {
  checking.value = true
  for (let i = 0; i < 15 && order.value?.status === 'checkout'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      const view = await api.get(token.value)
      reservation.value = view.reservation
      order.value = view.order
    } catch {
      // A failed poll is retried on the next round.
    }
  }
  checkingSlow.value = order.value?.status === 'checkout'
  checking.value = false
}

// The page is prerendered for /reservation. While hydrating a URL that differs from it (here: the
// #token), Nuxt 4 shows the prerendered route first and restores the real one on
// app:suspense:resolve ("deferred route", plan revision R3). onNuxtReady runs after that, so the
// route hash holds the token by then; window.location.hash in onMounted can still be empty.
const route = useRoute()
const router = useRouter()
onNuxtReady(async () => {
  hydrated.value = true
  try {
    token.value = decodeURIComponent(route.hash.slice(1))
  } catch {
    token.value = '' // malformed hash, e.g. a truncated link (R4.5)
  }
  const paidParam = route.query.paid
  if (paidParam === '1' || paidParam === '0') {
    returned.value = paidParam === '1' ? 'paid' : 'left'
    if (!token.value) token.value = tokenFromReturn()
    // Put the token back into the address (language links carry it) and drop ?paid.
    if (token.value) await router.replace({ query: {}, hash: `#${encodeURIComponent(token.value)}` })
  }
  if (!token.value) {
    state.value = 'notFound'
    return
  }
  await load()
  if (returned.value === 'paid' && order.value?.status === 'checkout') await waitForPayment()
})

// A booking that has started cannot be cancelled (docs/api.md); compare in Kyiv time.
// The clock ticks, so the cancel button disappears when the booking starts (v4 R2.2).
const kyivNow = useKyivClock()
const started = computed(() => {
  const r = reservation.value
  if (!r) return false
  return `${r.date} ${r.time}` <= kyivNow.value
})
// v4: confirmed bookings can be cancelled by the guest too (ADR-022).
const live = computed(() => reservation.value?.status === 'pending' || reservation.value?.status === 'confirmed')
const canCancel = computed(() => live.value && !started.value)

// v7: the pre-order block appears on a confirmed booking before it starts, while nothing is paid.
const paid = computed(() => order.value?.status === 'paid')
const canPreorder = computed(() =>
  reservation.value?.status === 'confirmed' && !started.value && !checking.value
  && (!order.value || order.value.status === 'checkout'),
)
const orderInitial = computed(() =>
  order.value?.status === 'checkout' ? order.value.items.map((i) => ({ id: i.id, quantity: i.quantity })) : undefined,
)
const localized = useLocalized()
const menuNames = new Map(cafe.menu.flatMap((c) => c.items).map((i) => [i.id, i.name]))
const dishName = (id: string, fallback: string) => {
  const name = menuNames.get(id)
  return name ? localized(name) : fallback
}
const orderEuros = computed(() =>
  order.value ? new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR' }).format(order.value.amount / 100) : '',
)
const orderAmount = computed(() => (order.value ? `${order.value.discounted} ₴ · ${orderEuros.value}` : ''))
const statusKey = computed(() => {
  const r = reservation.value
  if (!r) return 'pending'
  if (r.status === 'cancelled') return r.cancelledBy === 'owner' ? 'cancelledByOwner' : 'cancelled'
  if (r.status === 'no_show') return 'no_show'
  if (started.value) return 'started'
  return r.status
})
const pillClass = computed(() => ({
  pending: 'bg-linden',
  confirmed: 'bg-linden',
  no_show: 'bg-[#F3D5D2] text-[#7A1C16]',
})[statusKey.value as string] ?? 'bg-line')

const confirming = ref(false)
const cancelling = ref(false)
const actionError = ref<string | null>(null)
const statusLine = ref<HTMLElement>()

async function cancel() {
  cancelling.value = true
  actionError.value = null
  try {
    const view = await api.cancel(token.value)
    reservation.value = view.reservation
    order.value = view.order
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
            :class="pillClass"
          >
            {{ t(`reservation.status.${statusKey}`) }}
          </span>
        </p>
        <!-- Demo limitation: no messages to guests, the status is only shown here (v4 plan, R1.2) -->
        <p v-if="reservation.status === 'pending' && !started" class="mt-2 max-w-xl text-[15px] text-steam">{{ t('reservation.demoNote') }}</p>
        <!-- v7 (D3): the pre-order becomes possible once the café confirms -->
        <p v-if="reservation.status === 'pending' && !started" class="mt-3 max-w-xl border-l-4 border-linden bg-white px-3.5 py-2.5 text-[15.5px]">{{ t('preorder.reminder') }}</p>

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

        <!-- v4: what the café did with the booking -->
        <p v-if="reservation.status === 'confirmed' && !started" class="mt-5">{{ t('reservation.confirmedNote') }}</p>
        <template v-if="statusKey === 'cancelledByOwner'">
          <p class="mt-5">{{ t('reservation.cancelledByOwnerNote') }}</p>
          <p v-if="reservation.cancelReason" class="mt-1">{{ t('reservation.reason', { reason: reservation.cancelReason }) }}</p>
        </template>
        <p v-if="reservation.status === 'no_show'" class="mt-5">{{ t('reservation.noShowNote') }}</p>

        <!-- v7: pre-order with prepayment (ADR-029) -->
        <section v-if="checking" class="mt-7 max-w-[640px] border-t-4 border-line bg-white px-5 py-[18px]" aria-live="polite">
          <h2 class="font-display text-xl font-bold">
            <span class="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-line border-t-cobalt align-[-2px]" aria-hidden="true" />{{ t('preorder.checking') }}
          </h2>
          <p class="mt-1 text-[15px] text-steam">{{ t('preorder.checkingHint') }}</p>
        </section>
        <p v-else-if="checkingSlow" class="mt-7 max-w-xl border-l-4 border-linden bg-white px-3.5 py-2.5 text-[15.5px]" role="status">{{ t('preorder.checkingSlow') }}</p>
        <p v-if="returned === 'left' && canPreorder" class="mt-7 max-w-xl border-l-4 border-linden bg-white px-3.5 py-2.5 text-[15.5px]" role="status">{{ t('preorder.notCompleted') }}</p>

        <PreorderBlock v-if="canPreorder" :token="token" :initial="orderInitial" />

        <section
          v-if="order && order.status !== 'checkout'"
          class="mt-7 max-w-[640px] border-t-4 bg-white px-5 py-[18px]"
          :class="order.status === 'paid' ? 'border-linden' : order.status === 'refund_failed' ? 'border-[#e2b04a]' : 'border-line'"
        >
          <template v-if="order.status === 'paid'">
            <h2 class="font-display text-xl font-bold">{{ t('preorder.paidTitle') }}</h2>
            <ul class="mt-2">
              <li v-for="item in order.items" :key="item.id" class="flex justify-between gap-3 border-b border-line py-1 tabular-nums">
                <span>{{ dishName(item.id, item.name) }} × {{ item.quantity }}</span>
                <span>{{ item.price * item.quantity }} ₴</span>
              </li>
            </ul>
            <p class="mt-2.5 flex justify-between gap-3 tabular-nums">
              <span>{{ t('preorder.paidWith') }}</span><span class="font-semibold">{{ orderAmount }}</span>
            </p>
            <p v-if="live && !started" class="mt-2.5 text-[15px] text-steam">{{ t('preorder.paidNote') }}</p>
          </template>
          <template v-else-if="order.status === 'refunded'">
            <h2 class="font-display text-xl font-bold">{{ t('preorder.refundedTitle') }}</h2>
            <p class="mt-1">{{ t('preorder.refundedText', { amount: orderAmount }) }}</p>
          </template>
          <template v-else>
            <h2 class="font-display text-xl font-bold">{{ t('preorder.refundFailedTitle') }}</h2>
            <p class="mt-1">{{ t('preorder.refundFailedText') }}</p>
          </template>
        </section>

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
              {{ paid ? t('preorder.cancelRefund') : t('reservation.cancel') }}
            </button>
            <p class="mt-2 text-[15px] text-steam">{{ paid ? t('preorder.cancelRefundHint') : t('reservation.cancelHint') }}</p>
          </template>
        </div>
        <p v-else-if="statusKey === 'cancelled'" class="mt-6">{{ t('reservation.cancelledNote') }}</p>
        <p v-else-if="started && live" class="mt-6">{{ t('reservation.startedNote') }}</p>
      </template>

      <p class="mt-10">
        <NuxtLink :to="localePath('/')" class="text-cobalt underline underline-offset-2">← {{ t('reservation.back') }}</NuxtLink>
      </p>
    </main>

    <SiteFooter />
  </div>
</template>
