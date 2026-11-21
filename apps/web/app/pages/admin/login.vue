<script setup lang="ts">
// Admin login (v4, ADR-020/021). Public demo: the credentials are shown and can be filled in.
import { ApiError } from '~/composables/useBookingApi'

const { t } = useI18n()
const localePath = useLocalePath()
const admin = useAdminApi()
const config = useRuntimeConfig().public
const demoUser = config.adminDemoUsername as string
const demoPassword = config.adminDemoPassword as string

useHead({
  title: () => t('admin.login.metaTitle'),
  meta: [{ name: 'robots', content: 'noindex' }],
})

const username = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const errorBox = ref<HTMLElement>()

// Already logged in (session in this tab): go straight to the day view. Read after hydration.
onNuxtReady(() => {
  if (admin.hasSession()) navigateTo(localePath('/admin'))
})

function fillDemo() {
  username.value = demoUser
  password.value = demoPassword
}

async function submit() {
  error.value = null
  if (!username.value.trim() || !password.value) {
    error.value = t('admin.login.errors.required')
    return
  }
  submitting.value = true
  try {
    await admin.login(username.value.trim(), password.value)
    await navigateTo(localePath('/admin'))
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL'
    error.value = ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'NETWORK'].includes(code)
      ? t(`admin.login.errors.${code}`)
      : t('admin.errors.generic')
    await nextTick()
    errorBox.value?.focus()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <AdminHeader />
    <main class="page-container section-pad min-h-[60vh]">
      <div class="max-w-[420px]">
        <h1 class="font-display text-[26px] font-bold md:text-[34px]">{{ t('admin.login.title') }}</h1>
        <p class="mt-2 text-[15px] text-steam">{{ t('admin.login.lead') }}</p>

        <div v-if="demoPassword" class="mt-5 border-l-4 border-linden bg-white px-4 py-3.5">
          <i18n-t keypath="admin.login.demo" tag="p" scope="global">
            <template #intro><strong class="font-semibold">{{ t('admin.login.demoIntro') }}</strong></template>
            <template #username><code class="rounded bg-milk px-1.5 font-mono font-semibold">{{ demoUser }}</code></template>
            <template #password><code class="rounded bg-milk px-1.5 font-mono font-semibold">{{ demoPassword }}</code></template>
          </i18n-t>
          <p class="mt-1 text-[15px] text-steam">{{ t('admin.login.masked') }}</p>
          <button type="button" class="mt-3 rounded-[10px] border-2 border-espresso px-3.5 py-1.5 text-[15px] font-semibold" @click="fillDemo">
            {{ t('admin.login.fill') }}
          </button>
        </div>

        <form class="mt-6" novalidate @submit.prevent="submit">
          <p
            v-if="error"
            ref="errorBox"
            tabindex="-1"
            role="alert"
            class="mb-4 border-l-4 border-error bg-[#fbeceb] px-3.5 py-2.5 outline-none"
          >
            {{ error }}
          </p>
          <label for="admin-username" class="field-label">{{ t('admin.login.username') }}</label>
          <input id="admin-username" v-model="username" autocomplete="username" class="admin-input" required>
          <label for="admin-password" class="field-label mt-4">{{ t('admin.login.password') }}</label>
          <input id="admin-password" v-model="password" type="password" autocomplete="current-password" class="admin-input" required>
          <button type="submit" class="btn-primary mt-5 w-full sm:w-auto disabled:opacity-70" :disabled="submitting">
            {{ submitting ? t('admin.login.submitting') : t('admin.login.submit') }}
          </button>
        </form>

        <p class="mt-8">
          <NuxtLink :to="localePath('/')" class="text-cobalt underline underline-offset-2">← {{ t('admin.back') }}</NuxtLink>
        </p>
      </div>
    </main>
  </div>
</template>
