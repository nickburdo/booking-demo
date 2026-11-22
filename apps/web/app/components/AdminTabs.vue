<script setup lang="ts">
// "Reservations | Chats" tabs under the admin header (v5, docs/design.md §6, Admin "Chats").
const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

const tabs = computed(() => [
  { to: localePath('/admin'), label: t('admin.tabs.reservations'), active: !route.path.includes('/admin/chats') },
  { to: localePath('/admin/chats'), label: t('admin.tabs.chats'), active: route.path.includes('/admin/chats') },
])
</script>

<template>
  <nav class="border-b border-line" :aria-label="t('admin.tabs.label')">
    <div class="page-container flex gap-1.5 pt-4">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="border-b-[3px] px-3.5 py-2 font-semibold"
        :class="tab.active ? 'border-linden text-espresso' : 'border-transparent text-steam hover:text-espresso'"
        :aria-current="tab.active ? 'page' : undefined"
      >
        {{ tab.label }}
      </NuxtLink>
    </div>
  </nav>
</template>
