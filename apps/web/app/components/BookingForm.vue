<script setup lang="ts">
// Booking form (ADR-017, docs/design.md §6): date + guests → free times → contacts →
// Turnstile → POST /reservations → confirmation with the private link.
import { ApiError, type Reservation } from '~/composables/useBookingApi'

const { t } = useI18n()
const localePath = useLocalePath()
const api = useBookingApi()
const formatDate = useFormatDate()

// --- Step 1: date and guests -------------------------------------------------
// Dates depend on "today" in Kyiv, so they are set in the browser after hydration.
const range = ref<{ min: string, max: string } | null>(null)
const date = ref('')
const guests = ref(2)
const GUEST_OPTIONS = [1, 2, 3, 4]

// --- Step 2: free times --------------------------------------------------------
const times = ref<string[]>([])
const timesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const time = ref<string | null>(null)
let requestSeq = 0

async function loadTimes() {
  if (!date.value) {
    // Cleared or half-typed date: drop the times of the previous date (R4.2).
    ++requestSeq
    times.value = []
    time.value = null
    timesState.value = 'idle'
    return
  }
  const seq = ++requestSeq
  timesState.value = 'loading'
  try {
    const result = await api.availability(date.value, guests.value)
    if (seq !== requestSeq) return // a newer request has started
    times.value = result
    timesState.value = 'ready'
    if (time.value && !result.includes(time.value)) time.value = null
  } catch (error) {
    if (seq !== requestSeq) return
    if (error instanceof ApiError && error.code === 'DATE_OUT_OF_RANGE') {
      times.value = []
      time.value = null
      timesState.value = 'ready'
      await onDateOutOfRange(false) // no reload here: it could loop
      return
    }
    timesState.value = 'error'
  }
}

// "Today" moved on since the page was opened (e.g. past midnight), so the chosen date is no
// longer bookable (R4.7). Recompute the range, move the date into it if needed, explain.
async function onDateOutOfRange(reloadTimes: boolean) {
  range.value = bookableRange()
  if (date.value < range.value.min || date.value > range.value.max) date.value = range.value.min
  else if (reloadTimes) loadTimes()
  await nextTick() // let the date watcher clear the old error and reload the times first
  fieldErrors.value = { ...fieldErrors.value, date: t('booking.errors.DATE_OUT_OF_RANGE') }
}

watch([date, guests], loadTimes)

onMounted(() => {
  range.value = bookableRange()
  date.value = range.value.min
})

function endOf(start: string): string {
  const [h, m] = start.split(':').map(Number)
  const total = h! * 60 + m! + 90
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// --- Step 3: details, bot check, submit ---------------------------------------
const name = ref('')
const phone = ref('')
const comment = ref('')
const turnstileToken = ref<string | null>(null)
const turnstileFailed = ref(false)
const turnstile = ref<{ reset: () => void } | null>(null)

const submitting = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const errorBox = ref<HTMLElement>()

// Mirrors the API rule (docs/api.md): international with "+", or Ukrainian 0XXXXXXXXX.
function phoneLooksValid(value: string): boolean {
  const compact = value.replace(/[\s\-()]/g, '')
  return /^0\d{9}$/.test(compact) || /^\+\d{8,15}$/.test(compact)
}

function checkLocally(): boolean {
  const errors: Record<string, string> = {}
  if (!date.value) errors.date = t('booking.fieldErrors.date')
  if (!time.value) errors.time = t('booking.fieldErrors.time')
  if (!name.value.trim()) errors.name = t('booking.fieldErrors.name')
  if (!phoneLooksValid(phone.value)) errors.phone = t('booking.fieldErrors.phone')
  if (comment.value.trim().length > 500) errors.comment = t('booking.fieldErrors.comment')
  if (!turnstileToken.value) errors.turnstile = t('booking.fieldErrors.turnstile')
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

// An error under a field disappears as soon as the visitor changes that field.
function clearError(field: string) {
  if (fieldErrors.value[field]) {
    const { [field]: _removed, ...rest } = fieldErrors.value
    fieldErrors.value = rest
  }
}
watch(date, () => clearError('date'))
watch(guests, () => clearError('guests'))
watch(time, () => clearError('time'))
watch(name, () => clearError('name'))
watch(phone, () => clearError('phone'))
watch(comment, () => clearError('comment'))
watch(turnstileToken, (token) => {
  if (!token) return
  clearError('turnstile')
  turnstileFailed.value = false // the widget recovered (R4.6)
})

const KNOWN_FIELDS = ['date', 'time', 'guests', 'name', 'phone', 'comment']

function showApiError(error: unknown, attemptedTime: string) {
  const code = error instanceof ApiError ? error.code : 'INTERNAL'
  if (code === 'VALIDATION' && error instanceof ApiError) {
    // Show our own translated text under each field the API rejected.
    const errors: Record<string, string> = {}
    for (const field of Object.keys(error.fields)) {
      if (KNOWN_FIELDS.includes(field)) errors[field] = t(`booking.fieldErrors.${field}`)
    }
    fieldErrors.value = errors
    if (Object.keys(errors).length === 0) formError.value = t('booking.errors.generic')
    return
  }
  if (code === 'DATE_OUT_OF_RANGE') {
    void onDateOutOfRange(true)
    return
  }
  const known = ['SLOT_TAKEN', 'TIME_NOT_BOOKABLE', 'VERIFICATION_FAILED', 'VERIFICATION_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK']
  formError.value = known.includes(code)
    ? t(`booking.errors.${code}`, { time: attemptedTime })
    : t('booking.errors.generic')
  if (code === 'SLOT_TAKEN' || code === 'TIME_NOT_BOOKABLE') {
    time.value = null
    loadTimes()
  }
}

const result = ref<{ reservation: Reservation, link: string } | null>(null)
const resultHeading = ref<HTMLElement>()

async function submit() {
  formError.value = null
  if (!checkLocally() || !time.value || !turnstileToken.value) return
  submitting.value = true
  const attemptedTime = time.value
  try {
    const { reservation, token } = await api.create({
      date: date.value,
      time: attemptedTime,
      guests: guests.value,
      name: name.value.trim(),
      phone: phone.value,
      comment: comment.value.trim() || undefined,
      turnstileToken: turnstileToken.value,
    })
    const link = `${window.location.origin}${localePath('/reservation')}#${token}`
    result.value = { reservation, link }
    await nextTick()
    resultHeading.value?.focus()
  } catch (error) {
    showApiError(error, attemptedTime)
    await nextTick()
    errorBox.value?.focus()
  } finally {
    submitting.value = false
    // Tokens are single-use: always get a fresh one for the next attempt (v3 plan, P8).
    turnstile.value?.reset()
  }
}

const copied = ref(false)
async function copyLink() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value.link)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked: the link stays visible and selectable.
  }
}

function bookAnother() {
  result.value = null
  // The token of the finished booking is spent; the remounted widget issues a new one (R4.3).
  turnstileToken.value = null
  turnstileFailed.value = false
  time.value = null
  comment.value = ''
  fieldErrors.value = {}
  formError.value = null
  loadTimes()
}

const submitLabel = computed(() =>
  time.value && date.value
    ? t('booking.submitFor', { date: formatDate(date.value, 'short'), time: time.value })
    : t('booking.submit'),
)
</script>

<template>
  <!-- Confirmation (replaces the form) -->
  <div v-if="result" class="mt-9 max-w-2xl border-l-4 border-linden py-1 pl-5">
    <h3 ref="resultHeading" tabindex="-1" class="font-display text-2xl font-bold text-linden outline-none">
      {{ t('booking.success.title') }}
    </h3>
    <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4">
      <dt class="text-milk/70">{{ t('booking.success.when') }}</dt>
      <dd>{{ formatDate(result.reservation.date) }} · {{ result.reservation.time }}–{{ result.reservation.endTime }}</dd>
      <dt class="text-milk/70">{{ t('booking.success.guests') }}</dt>
      <dd>{{ result.reservation.guests }}</dd>
      <dt class="text-milk/70">{{ t('booking.success.name') }}</dt>
      <dd>{{ result.reservation.name }} · {{ result.reservation.phone }}</dd>
    </dl>
    <p class="mt-4">{{ t('booking.success.linkIntro') }}</p>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <a :href="result.link" class="min-w-0 flex-1 rounded-[10px] bg-milk/10 px-3 py-2.5 font-mono text-sm break-all underline-offset-2 hover:underline">
        {{ result.link }}
      </a>
      <button type="button" class="btn-outline-light" @click="copyLink">
        {{ copied ? t('booking.success.copied') : t('booking.success.copy') }}
      </button>
    </div>
    <!-- Includes the demo limitation: no messages to guests (v4 plan, R1.2) -->
    <p class="mt-3 text-[15px] text-milk/70">{{ t('booking.success.note') }}</p>
    <button type="button" class="btn-outline-light mt-4" @click="bookAnother">{{ t('booking.success.another') }}</button>
  </div>

  <!-- Form -->
  <form v-else class="mt-9 grid gap-8 md:grid-cols-2 md:gap-12" novalidate @submit.prevent="submit">
    <div>
      <h3 class="step-title"><span>1</span>{{ t('booking.step1') }}</h3>
      <div class="mt-4">
        <label for="booking-date" class="field-label">{{ t('booking.date') }}</label>
        <input
          id="booking-date"
          v-model="date"
          type="date"
          :min="range?.min"
          :max="range?.max"
          required
          class="field-input max-w-64"
          :class="{ 'field-input-error': fieldErrors.date }"
          :aria-invalid="!!fieldErrors.date"
          :aria-describedby="fieldErrors.date ? 'booking-date-error' : undefined"
        >
        <p v-if="fieldErrors.date" id="booking-date-error" class="field-error">{{ fieldErrors.date }}</p>
      </div>
      <fieldset class="mt-4">
        <legend class="field-label">{{ t('booking.guests') }}</legend>
        <div class="flex gap-2">
          <label v-for="n in GUEST_OPTIONS" :key="n" class="chip">
            <input v-model="guests" type="radio" name="guests" :value="n" class="sr-only">
            <span>{{ n }}</span>
          </label>
        </div>
        <p v-if="fieldErrors.guests" class="field-error">{{ fieldErrors.guests }}</p>
      </fieldset>

      <h3 class="step-title mt-7"><span>2</span>{{ t('booking.step2') }}</h3>
      <div class="mt-4" aria-live="polite">
        <div v-if="timesState === 'loading' || timesState === 'idle'" class="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <div v-for="i in 8" :key="i" class="h-11 rounded-[10px] bg-milk/10" />
          <p v-if="date" class="col-span-full mt-1 text-[15px] text-milk/70">{{ t('booking.loadingTimes') }}</p>
        </div>
        <div v-else-if="timesState === 'error'" class="rounded-[10px] border-2 border-dashed border-milk/25 p-4">
          {{ t('booking.timesError') }}
          <button type="button" class="ml-2 underline underline-offset-2" @click="loadTimes">{{ t('booking.retry') }}</button>
        </div>
        <p v-else-if="times.length === 0" class="rounded-[10px] border-2 border-dashed border-milk/25 p-4 text-milk/80">
          {{ t('booking.noTimes', { guests }) }}
        </p>
        <fieldset v-else>
          <legend class="sr-only">{{ t('booking.step2') }}</legend>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
            <label v-for="slot in times" :key="slot" class="chip">
              <input v-model="time" type="radio" name="time" :value="slot" class="sr-only">
              <span>{{ slot }}</span>
            </label>
          </div>
          <p class="mt-3 text-[15px] text-milk/70">
            {{ t('booking.onlyFree') }}
            <template v-if="time">{{ t('booking.selected', { start: time, end: endOf(time) }) }}</template>
          </p>
        </fieldset>
        <p v-if="fieldErrors.time" class="field-error">{{ fieldErrors.time }}</p>
      </div>
    </div>

    <div>
      <h3 class="step-title"><span>3</span>{{ t('booking.step3') }}</h3>

      <div v-if="formError" ref="errorBox" tabindex="-1" role="alert" class="mt-4 border-l-4 border-error-on-dark bg-error-on-dark/10 px-4 py-2.5 outline-none">
        {{ formError }}
      </div>

      <div class="mt-4">
        <label for="booking-name" class="field-label">{{ t('booking.name') }}</label>
        <input
          id="booking-name"
          v-model="name"
          type="text"
          autocomplete="name"
          maxlength="80"
          required
          class="field-input"
          :class="{ 'field-input-error': fieldErrors.name }"
          :aria-invalid="!!fieldErrors.name"
          :aria-describedby="fieldErrors.name ? 'booking-name-error' : undefined"
        >
        <p v-if="fieldErrors.name" id="booking-name-error" class="field-error">{{ fieldErrors.name }}</p>
      </div>

      <div class="mt-4">
        <label for="booking-phone" class="field-label">{{ t('booking.phone') }}</label>
        <input
          id="booking-phone"
          v-model="phone"
          type="tel"
          autocomplete="tel"
          inputmode="tel"
          required
          class="field-input"
          :class="{ 'field-input-error': fieldErrors.phone }"
          :aria-invalid="!!fieldErrors.phone"
          aria-describedby="booking-phone-hint"
        >
        <p v-if="fieldErrors.phone" class="field-error">{{ fieldErrors.phone }}</p>
        <p id="booking-phone-hint" class="mt-1.5 text-[15px] text-milk/70">{{ t('booking.phoneHint') }}</p>
      </div>

      <div class="mt-4">
        <label for="booking-comment" class="field-label">
          {{ t('booking.comment') }} <span class="font-normal text-milk/70">{{ t('booking.optional') }}</span>
        </label>
        <textarea
          id="booking-comment"
          v-model="comment"
          rows="3"
          maxlength="500"
          class="field-input h-auto py-2.5"
          :class="{ 'field-input-error': fieldErrors.comment }"
        />
        <p v-if="fieldErrors.comment" class="field-error">{{ fieldErrors.comment }}</p>
      </div>

      <div class="mt-5" :aria-label="t('booking.check')">
        <TurnstileWidget
          ref="turnstile"
          theme="dark"
          @token="(v) => (turnstileToken = v)"
          @error="turnstileFailed = true"
        />
        <p v-if="turnstileFailed && !turnstileToken" class="field-error">{{ t('booking.errors.turnstileLoad') }}</p>
        <p v-else-if="fieldErrors.turnstile" class="field-error">{{ fieldErrors.turnstile }}</p>
      </div>

      <button type="submit" class="btn-primary mt-5 w-full sm:w-auto" :disabled="submitting" :aria-busy="submitting">
        {{ submitting ? t('booking.submitting') : submitLabel }}
      </button>
    </div>
  </form>
</template>
