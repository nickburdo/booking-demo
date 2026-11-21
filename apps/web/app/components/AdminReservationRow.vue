<script setup lang="ts">
// One reservation in the admin day view (docs/design.md §6, Admin). Shows only the actions the
// API allows now (ADR-022); the API stays the authority and answers NOT_ALLOWED otherwise.
import type { AdminAction, AdminReservation } from '~/composables/useAdminApi'

const props = defineProps<{ reservation: AdminReservation, busy: boolean, error: string | null }>()
const emit = defineEmits<{ act: [action: AdminAction, reason?: string] }>()

const { t } = useI18n()

// Kyiv wall-clock comparison, like the guest page.
const started = computed(() => `${props.reservation.date} ${props.reservation.time}` <= `${kyivToday()} ${kyivTimeNow()}`)
const live = computed(() => props.reservation.status === 'pending' || props.reservation.status === 'confirmed')
const canConfirm = computed(() => props.reservation.status === 'pending' && !started.value)
const canCancel = computed(() => live.value && !started.value)
const canNoShow = computed(() => live.value && started.value)

const statusLabel = computed(() => {
  const r = props.reservation
  if (r.status === 'cancelled') return t(r.cancelledBy === 'owner' ? 'admin.status.cancelledByOwner' : 'admin.status.cancelledByGuest')
  return t(`admin.status.${r.status}`)
})
const pillClass = computed(() => ({
  pending: 'border-[1.5px] border-espresso bg-white',
  confirmed: 'bg-linden',
  cancelled: 'bg-line',
  no_show: 'bg-[#F3D5D2] text-[#7A1C16]',
})[props.reservation.status])

// Inline panels: cancel with an optional reason, and a confirm step for the final no-show.
const panel = ref<'cancel' | 'no-show' | null>(null)
const reason = ref('')
const MAX_REASON = 200
const reasonId = computed(() => `reason-${props.reservation.id}`)

function openCancel() {
  reason.value = ''
  panel.value = 'cancel'
}

// Close the panel once the action went through (the status changed).
watch(() => props.reservation.status, () => (panel.value = null))
</script>

<template>
  <li
    class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-b border-line py-4 md:grid-cols-[112px_96px_1fr_170px_minmax(0,280px)] md:gap-4"
    :class="{ 'text-steam': !live }"
  >
    <!-- Mobile first line: time · table · guests, status on the right -->
    <p class="font-semibold tabular-nums md:hidden">
      {{ reservation.time }}–{{ reservation.endTime }} · {{ reservation.table }} · {{ t('admin.guests', reservation.guests) }}
    </p>
    <p class="font-semibold tabular-nums max-md:hidden">{{ reservation.time }}–{{ reservation.endTime }}</p>
    <p class="max-md:hidden">
      <span class="font-semibold">{{ reservation.table }}</span>
      <span class="text-[15px] text-steam"> · {{ t('admin.guests', reservation.guests) }}</span>
    </p>

    <div class="max-md:order-3 max-md:col-span-2">
      <p class="font-medium">
        {{ reservation.name }}
        <span v-if="reservation.demo" class="ml-1.5 rounded border border-line px-1.5 text-[11px] font-semibold tracking-wide text-steam uppercase">{{ t('admin.demoTag') }}</span>
      </p>
      <p class="text-[15px] text-steam">{{ reservation.phone }}</p>
      <p v-if="reservation.comment" class="mt-1 text-[15px]">“{{ reservation.comment }}”</p>
      <p v-if="reservation.cancelReason" class="mt-1 text-[15px]">{{ t('admin.reasonShown', { reason: reservation.cancelReason }) }}</p>
    </div>

    <div class="text-right md:text-left max-md:order-2">
      <span class="inline-block rounded-md px-2 py-0.5 text-[13px] font-semibold text-espresso" :class="pillClass">{{ statusLabel }}</span>
      <span v-if="live && !reservation.notified" class="mt-1 block text-[13px] text-[#8a5a00]">⚠ {{ t('admin.notNotified') }}</span>
    </div>

    <div class="flex flex-wrap items-start gap-2 max-md:order-4 max-md:col-span-2 max-md:mt-1 md:justify-end">
      <template v-if="panel === null">
        <button v-if="canConfirm" type="button" class="btn-primary !px-3.5 !py-2 text-[15px] disabled:opacity-70" :disabled="busy" @click="emit('act', 'confirm')">
          {{ t('admin.actions.confirm') }}
        </button>
        <button v-if="canCancel" type="button" class="rounded-[10px] border-2 border-error px-3.5 py-1.5 text-[15px] font-semibold text-error disabled:opacity-70" :disabled="busy" @click="openCancel">
          {{ t('admin.actions.cancel') }}
        </button>
        <button v-if="canNoShow" type="button" class="rounded-[10px] border-2 border-espresso px-3.5 py-1.5 text-[15px] font-semibold disabled:opacity-70" :disabled="busy" @click="panel = 'no-show'">
          {{ t('admin.actions.noShow') }}
        </button>
      </template>
      <div v-else-if="panel === 'no-show'" class="flex flex-wrap items-center gap-2">
        <span class="text-[15px] font-semibold">{{ t('admin.noShowQuestion') }}</span>
        <button type="button" class="rounded-[10px] bg-espresso px-3.5 py-2 text-[15px] font-semibold text-milk disabled:opacity-70" :disabled="busy" @click="emit('act', 'no-show')">
          {{ t('admin.actions.noShowYes') }}
        </button>
        <button type="button" class="rounded-[10px] border-2 border-espresso px-3.5 py-1.5 text-[15px] font-semibold" :disabled="busy" @click="panel = null">
          {{ t('admin.actions.keep') }}
        </button>
      </div>
    </div>

    <form
      v-if="panel === 'cancel'"
      class="col-span-2 rounded-[10px] border-2 border-line bg-white p-3.5 max-md:order-5 md:col-start-3 md:col-end-6"
      @submit.prevent="emit('act', 'cancel', reason.trim())"
    >
      <label :for="reasonId" class="text-[15px] font-medium">{{ t('admin.reasonLabel') }}</label>
      <textarea :id="reasonId" v-model="reason" :maxlength="MAX_REASON" rows="2" class="admin-input mt-1.5 !h-auto py-2" />
      <p class="text-[15px] text-steam">{{ t('admin.reasonHint') }} {{ reason.length }} / {{ MAX_REASON }}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="submit" class="rounded-[10px] bg-error px-3.5 py-2 text-[15px] font-semibold text-white disabled:opacity-70" :disabled="busy">
          {{ t('admin.actions.cancelYes') }}
        </button>
        <button type="button" class="rounded-[10px] border-2 border-espresso px-3.5 py-1.5 text-[15px] font-semibold" :disabled="busy" @click="panel = null">
          {{ t('admin.actions.keep') }}
        </button>
      </div>
    </form>

    <p v-if="error" role="alert" class="col-span-2 text-[15px] text-error max-md:order-6 md:col-start-3 md:col-end-6">{{ error }}</p>
  </li>
</template>
