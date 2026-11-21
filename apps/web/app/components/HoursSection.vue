<script setup lang="ts">
import { cafe } from '~/data/cafe'

const { t } = useI18n()
</script>

<template>
  <section id="hours" class="page-container section-pad anchor-offset">
    <h2 class="font-display text-[30px] font-bold md:text-[40px]">{{ t('hours.title') }}</h2>
    <ul class="mt-9 max-w-xl">
      <li
        v-for="row in cafe.openingHours"
        :key="row.fromDay"
        class="flex justify-between gap-4 border-t border-line py-2.5 first:border-t-0"
      >
        <span>{{ t(`days.${row.fromDay}`) }} – {{ t(`days.${row.toDay}`) }}</span>
        <span class="font-semibold tabular-nums">{{ row.opens }}–{{ row.closes }}</span>
      </li>
    </ul>
  </section>
</template>
