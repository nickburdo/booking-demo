// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n', '@nuxtjs/leaflet'],
  css: ['~/assets/css/main.css'],
  // Baked into the static build (v3 plan, P7). Override with NUXT_PUBLIC_API_BASE and
  // NUXT_PUBLIC_TURNSTILE_SITE_KEY (local values in apps/web/.env.local, plan R1).
  runtimeConfig: {
    public: {
      apiBase: 'https://booking-demo-api.nick-burdo.workers.dev',
      // Public Turnstile site key (not a secret; docs/setup-integrations.md).
      turnstileSiteKey: '0x4AAAAAAGL8b1GVwSQwY16N',
    },
  },
  // Global head: applies to every page, including the 404 error page (plan revision R7.6).
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    // Live site address: makes hreflang and canonical links absolute (plan revision R4)
    baseUrl: 'https://booking-demo-web.nick-burdo.workers.dev',
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'ru', language: 'ru-RU', name: 'Русский', file: 'ru.json' },
      { code: 'uk', language: 'uk-UA', name: 'Українська', file: 'uk.json' },
    ],
    // Browser detection is off: a first visit is always English;
    // the chosen language is remembered by plugins/remember-locale.client.ts (ADR-006).
    detectBrowserLanguage: false,
  },
})
