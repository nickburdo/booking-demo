<script setup lang="ts">
import { cafe } from '~/data/cafe'

const { t } = useI18n()
const localized = useLocalized()
</script>

<template>
  <section id="menu" class="page-container section-pad anchor-offset">
    <h2 class="font-display text-[30px] font-bold md:text-[40px]">{{ t('menu.title') }}</h2>
    <div class="mt-9 grid gap-7 md:grid-cols-3 md:gap-10">
      <div v-for="category in cafe.menu" :key="category.id">
        <h3 class="border-b-4 border-linden pb-2.5 font-display text-xl">{{ localized(category.name) }}</h3>
        <ul class="mt-3.5">
          <li
            v-for="item in category.items"
            :key="item.id"
            class="flex justify-between gap-4 border-t border-line py-2.5 first:border-t-0"
          >
            <span>{{ localized(item.name) }}</span>
            <span class="whitespace-nowrap font-semibold tabular-nums">{{ item.price }} {{ t('menu.currency') }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
