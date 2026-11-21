<script setup lang="ts">
// Cloudflare Turnstile widget, rendered explicitly in the browser only (v3 plan, P8, ADR-019).
// Emits the token (or null when it expires or fails). Tokens are single-use, so the parent
// calls reset() after every submit attempt.

interface TurnstileApi {
  ready(cb: () => void): void
  render(el: HTMLElement, options: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// One script tag per page, shared by every widget instance.
let scriptPromise: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    // The API is usable once the script has loaded. turnstile.ready() must not be used with
    // an async/injected script: Turnstile throws in that case.
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile API missing')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

const props = defineProps<{ theme?: 'light' | 'dark' | 'auto' }>()
const emit = defineEmits<{ token: [string | null], error: [] }>()

const { locale } = useI18n()
const siteKey = useRuntimeConfig().public.turnstileSiteKey as string
const container = ref<HTMLElement>()
let api: TurnstileApi | null = null
let widgetId: string | null = null

function render() {
  if (!api || !container.value) return
  if (widgetId) api.remove(widgetId)
  widgetId = api.render(container.value, {
    sitekey: siteKey,
    theme: props.theme ?? 'auto',
    language: locale.value,
    callback: (token: string) => emit('token', token),
    'expired-callback': () => emit('token', null),
    'error-callback': () => {
      emit('token', null)
      emit('error')
    },
  })
}

onMounted(async () => {
  try {
    api = await loadTurnstile()
    render()
  } catch {
    emit('error')
  }
})

// The widget's own texts follow the page language.
watch(locale, () => {
  emit('token', null)
  render()
})

onBeforeUnmount(() => {
  if (api && widgetId) api.remove(widgetId)
})

defineExpose({
  reset() {
    emit('token', null)
    if (api && widgetId) api.reset(widgetId)
  },
})
</script>

<template>
  <div ref="container" class="min-h-[65px]" />
</template>
