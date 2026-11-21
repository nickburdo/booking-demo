<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <!-- Target of every "Book a table" button (plan step 5.7, docs/design.md §6) -->
  <section id="booking" class="anchor-offset bg-espresso text-milk">
    <div class="page-container section-pad">
      <h2 class="font-display text-[30px] font-bold text-linden md:text-[40px]">{{ t('booking.title') }}</h2>
      <p class="mt-4 max-w-xl text-lg">{{ t('booking.text') }}</p>
    </div>
  </section>
</template>
