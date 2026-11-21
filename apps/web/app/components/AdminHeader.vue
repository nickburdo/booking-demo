<script setup lang="ts">
// Header of the admin pages (docs/design.md §6, Admin): brand + "Admin demo" badge,
// language switcher, link to the site and (when logged in) "Log out".
import { cafe } from '~/data/cafe'

defineProps<{ loggedIn?: boolean }>()
const emit = defineEmits<{ logout: [] }>()

const { t, locale, locales } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
</script>

<template>
  <header class="border-b border-line bg-milk">
    <div class="page-container flex h-(--header-height) items-center justify-between gap-2 sm:gap-3">
      <div class="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
        <NuxtLink :to="localePath('/')" class="font-display text-sm font-bold whitespace-nowrap sm:text-base md:text-lg">{{ cafe.name }}</NuxtLink>
        <span class="rounded-md bg-espresso px-1.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-milk uppercase sm:px-2 sm:text-xs">
          <span class="hidden sm:inline">{{ t('admin.badge') }}</span><span class="sm:hidden">{{ t('admin.badgeShort') }}</span>
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2 sm:gap-3 md:gap-4">
        <nav :aria-label="t('language.label')" class="flex gap-0.5">
          <NuxtLink
            v-for="l in locales"
            :key="l.code"
            :to="switchLocalePath(l.code)"
            :lang="l.language"
            :aria-label="l.name"
            :aria-current="l.code === locale ? 'true' : undefined"
            class="rounded-md px-1 py-1 text-[14px] font-medium uppercase sm:px-1.5 sm:text-[15px] md:px-2"
            :class="l.code === locale ? 'bg-linden' : 'hover:text-cobalt'"
          >
            {{ l.code }}
          </NuxtLink>
        </nav>
        <NuxtLink :to="localePath('/')" class="hidden text-[15px] text-cobalt underline underline-offset-2 sm:inline">{{ t('admin.site') }}</NuxtLink>
        <button v-if="loggedIn" type="button" class="text-[15px] text-cobalt underline underline-offset-2" @click="emit('logout')">
          {{ t('admin.logout') }}
        </button>
      </div>
    </div>
  </header>
</template>
