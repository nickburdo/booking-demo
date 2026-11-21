<script setup lang="ts">
// Per-locale document head (plan step 5.9): html lang, hreflang alternates,
// title and description in the current language.
const { t } = useI18n()
const i18nHead = useLocaleHead({ seo: true })

useHead(() => ({
  htmlAttrs: { lang: i18nHead.value.htmlAttrs?.lang },
  title: t('meta.title'),
  // The favicon is set in nuxt.config.ts (app.head) so the error page gets it too.
  link: [...(i18nHead.value.link || [])],
  meta: [
    { name: 'description', content: t('meta.description') },
    ...(i18nHead.value.meta || []),
  ],
}))
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </div>
</template>
