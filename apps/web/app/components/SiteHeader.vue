<script setup lang="ts">
import { cafe } from '~/data/cafe'

const { t, locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const localePath = useLocalePath()

const sections = ['menu', 'hours', 'location', 'booking'] as const

// switchLocalePath keeps the current URL hash (#menu etc.), so after switching the page
// returns to the last section reached via a link (plan step 5.2). It is not the section
// currently in view: plain scrolling does not change the hash. The server never sees the hash,
// so links get it only after hydration; otherwise opening /#menu directly causes a
// hydration mismatch.
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })

function localeLink(code: string): string {
  const path = switchLocalePath(code as 'en' | 'ru' | 'uk')
  return hydrated.value ? path : path.split('#')[0]!
}

const menuOpen = ref(false)
const closeMenu = () => { menuOpen.value = false }

// Escape closes the mobile navigation.
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { closeMenu() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Sticky at every width (docs/design.md §9); z-index above Leaflet controls (1000) -->
  <header class="sticky top-0 z-[1100] border-b border-line bg-milk">
    <div class="page-container flex h-(--header-height) items-center justify-between gap-6">
      <NuxtLink :to="localePath('/')" class="font-display text-lg font-bold" @click="closeMenu">
        {{ cafe.name }}
      </NuxtLink>

      <!-- Desktop: full header from lg (docs/design.md §5) -->
      <nav class="hidden gap-6 font-medium lg:flex">
        <NuxtLink v-for="id in sections" :key="id" :to="{ hash: `#${id}` }" class="hover:text-cobalt">
          {{ t(`nav.${id}`) }}
        </NuxtLink>
      </nav>

      <div class="hidden items-center gap-6 lg:flex">
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
        <NuxtLink :to="{ hash: '#booking' }" class="btn-primary">{{ t('cta.book') }}</NuxtLink>
      </div>

      <!-- Mobile: toggle for the navigation panel -->
      <button
        type="button"
        class="rounded-lg bg-espresso p-2.5 text-milk lg:hidden"
        :aria-expanded="menuOpen"
        :aria-controls="menuOpen ? 'mobile-nav' : undefined"
        :aria-label="menuOpen ? t('nav.close') : t('nav.open')"
        @click="menuOpen = !menuOpen"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path v-if="!menuOpen" d="M3 5h14M3 10h14M3 15h14" />
          <path v-else d="M4 4l12 12M16 4L4 16" />
        </svg>
      </button>
    </div>

    <div
      v-if="menuOpen"
      id="mobile-nav"
      class="page-container max-h-[calc(100dvh-var(--header-height))] overflow-y-auto border-t border-line pb-6 lg:hidden"
    >
      <nav class="flex flex-col">
        <NuxtLink
          v-for="id in sections"
          :key="id"
          :to="{ hash: `#${id}` }"
          class="border-b border-line py-3 text-lg font-medium"
          @click="closeMenu"
        >
          {{ t(`nav.${id}`) }}
        </NuxtLink>
      </nav>
      <div class="mt-5 flex items-center justify-between gap-4">
        <nav :aria-label="t('language.label')" class="flex gap-1">
          <NuxtLink
            v-for="l in locales"
            :key="l.code"
            :to="localeLink(l.code)"
            :lang="l.language"
            :aria-label="l.name"
            :aria-current="l.code === locale ? 'true' : undefined"
            class="rounded-md px-2 py-1 text-[15px] font-medium uppercase"
            :class="l.code === locale ? 'bg-linden' : ''"
            @click="closeMenu"
          >
            {{ l.code }}
          </NuxtLink>
        </nav>
        <NuxtLink :to="{ hash: '#booking' }" class="btn-primary" @click="closeMenu">{{ t('cta.book') }}</NuxtLink>
      </div>
    </div>
  </header>
</template>
