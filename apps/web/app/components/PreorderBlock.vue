<script setup lang="ts">
// Pre-order with prepayment on a confirmed booking (v7, ADR-029; mockup approved in Phase 2).
// The guest picks dishes; "Pay" asks the API for a Stripe Checkout page and goes there. Prices
// here are only shown: the API prices the order itself from the same menu (plan P3).
import { cafe } from '~/data/cafe'
import { ApiError } from '~/composables/useBookingApi'

const props = defineProps<{
  token: string
  /** Dishes of an unfinished checkout, to start from after "back" on Stripe's page. */
  initial?: { id: string, quantity: number }[]
}>()

const { t, locale } = useI18n()
const localized = useLocalized()
const api = useBookingApi()

// Same numbers as the API (docs/api.md → Order object, v7 R1).
const DISCOUNT_PERCENT = 20
const RATE = 50
const MAX_PER_DISH = 10
/** Where the token waits while the guest is on Stripe's page: the return URL carries none. */
const RETURN_TOKEN_KEY = 'linden-preorder-token'

const quantities = reactive<Record<string, number>>(
  Object.fromEntries((props.initial ?? []).map((i) => [i.id, i.quantity])),
)
const items = computed(() => cafe.menu.flatMap((c) => c.items))
const chosen = computed(() => items.value.filter((i) => (quantities[i.id] ?? 0) > 0))
const total = computed(() => chosen.value.reduce((sum, i) => sum + i.price * quantities[i.id]!, 0))
const discounted = computed(() => Math.round((total.value * (100 - DISCOUNT_PERCENT)) / 100))
const cents = computed(() =>
  chosen.value.reduce((sum, i) => sum + Math.round((i.price * (100 - DISCOUNT_PERCENT)) / RATE) * quantities[i.id]!, 0),
)
const euros = computed(() =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR' }).format(cents.value / 100),
)

function change(id: string, delta: number) {
  quantities[id] = Math.min(MAX_PER_DISH, Math.max(0, (quantities[id] ?? 0) + delta))
}

const paying = ref(false)
const error = ref<string | null>(null)

async function pay() {
  if (chosen.value.length === 0 || paying.value) return
  paying.value = true
  error.value = null
  try {
    const { url } = await api.order(
      props.token,
      chosen.value.map((i) => ({ itemId: i.id, quantity: quantities[i.id]! })),
      locale.value,
    )
    try {
      sessionStorage.setItem(RETURN_TOKEN_KEY, props.token)
    } catch {
      // Storage blocked: the guest returns to a page without the token and opens the link again.
    }
    window.location.assign(url)
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL'
    error.value = ['ORDER_NOT_ALLOWED', 'PAYMENTS_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK'].includes(code)
      ? t(`preorder.errors.${code}`)
      : t('preorder.errors.generic')
    paying.value = false
  }
}
</script>

<template>
  <section class="mt-8 max-w-[640px] border-t-4 border-linden bg-white px-3.5 pt-[18px] pb-5 sm:px-[22px]" aria-labelledby="preorder-title">
    <h2 id="preorder-title" class="font-display text-[19px] font-bold sm:text-[22px]">{{ t('preorder.title') }}</h2>
    <p class="mt-1">{{ t('preorder.lead') }}</p>

    <div v-for="category in cafe.menu" :key="category.id">
      <h3 class="mt-[18px] mb-1 text-[13px] font-semibold tracking-[0.06em] text-steam uppercase">{{ localized(category.name) }}</h3>
      <ul>
        <li
          v-for="item in category.items"
          :key="item.id"
          class="grid grid-cols-[1fr_auto] items-center gap-x-3 border-b border-line py-2 sm:grid-cols-[1fr_auto_116px]"
        >
          <span :class="(quantities[item.id] ?? 0) > 0 ? 'font-semibold' : 'font-medium'">{{ localized(item.name) }}</span>
          <span class="text-[15px] text-steam tabular-nums max-sm:col-start-1 max-sm:row-start-2 max-sm:-mt-1">{{ item.price }} ₴</span>
          <span class="flex items-center justify-end gap-1.5 max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1">
            <button
              type="button"
              class="size-9 rounded-[10px] border-2 border-line bg-white text-lg font-semibold disabled:opacity-40"
              :aria-label="t('preorder.fewer', { name: localized(item.name) })"
              :disabled="!quantities[item.id] || paying"
              @click="change(item.id, -1)"
            >−</button>
            <span class="min-w-[22px] text-center tabular-nums" :class="quantities[item.id] ? 'font-semibold' : 'text-steam'" aria-live="polite">{{ quantities[item.id] ?? 0 }}</span>
            <button
              type="button"
              class="size-9 rounded-[10px] border-2 border-cobalt bg-white text-lg font-semibold text-cobalt disabled:opacity-40"
              :aria-label="t('preorder.more', { name: localized(item.name) })"
              :disabled="(quantities[item.id] ?? 0) >= MAX_PER_DISH || paying"
              @click="change(item.id, 1)"
            >+</button>
          </span>
        </li>
      </ul>
    </div>

    <template v-if="chosen.length > 0">
      <dl class="mt-[18px] grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
        <dt>{{ t('preorder.total') }}</dt>
        <dd class="text-steam line-through">{{ total }} ₴</dd>
        <dt class="font-semibold">{{ t('preorder.withDiscount') }}</dt>
        <dd class="font-display text-[22px] font-bold">{{ discounted }} ₴</dd>
        <dt class="text-[15px] text-steam">{{ t('preorder.inEuros', { rate: RATE }) }}</dt>
        <dd class="font-semibold">{{ euros }}</dd>
      </dl>
      <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <button type="button" class="btn-primary max-sm:w-full disabled:opacity-70" :disabled="paying" @click="pay">
          {{ paying ? t('preorder.paying') : t('preorder.pay', { amount: euros }) }}
        </button>
        <span class="text-[15px] text-steam">{{ t('preorder.payHint') }}</span>
      </div>
    </template>
    <template v-else>
      <p class="mt-[14px] text-[15px] text-steam">{{ t('preorder.empty') }}</p>
      <button type="button" class="btn-primary mt-3 max-sm:w-full disabled:opacity-50" disabled>{{ t('preorder.payEmpty') }}</button>
    </template>

    <p v-if="error" class="mt-3 text-error" role="alert">{{ error }}</p>

    <p class="mt-[14px] border-l-4 border-linden bg-milk px-3.5 py-2.5 text-[15px]">
      <i18n-t keypath="preorder.demo" tag="span" scope="global">
        <template #card>
          <code class="rounded bg-white px-1.5 font-mono font-semibold whitespace-nowrap">4242 4242 4242 4242</code>
        </template>
      </i18n-t>
    </p>
  </section>
</template>
