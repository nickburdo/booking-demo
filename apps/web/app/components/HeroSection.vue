<script setup lang="ts">
import { cafe } from '~/data/cafe'

const { t } = useI18n()
const localized = useLocalized()
</script>

<template>
  <!-- Full-bleed photo (docs/design.md §3); espresso shows while it loads -->
  <section class="relative flex min-h-[min(88vh,820px)] items-end overflow-hidden bg-espresso text-milk">
    <img
      src="/images/hero-1200.webp"
      srcset="/images/hero-1200.webp 1200w, /images/hero-2400.webp 2400w"
      sizes="100vw"
      width="2400"
      height="1600"
      alt=""
      fetchpriority="high"
      class="absolute inset-0 size-full object-cover"
    >
    <!-- Bottom gradient keeps the milk-white headline readable over any part of the photo -->
    <div
      class="absolute inset-0 bg-[linear-gradient(to_top,rgb(42_26_18/0.9)_0%,rgb(42_26_18/0.6)_45%,rgb(42_26_18/0.15)_85%)]"
      aria-hidden="true"
    />

    <div class="page-container relative z-10 w-full pt-14 pb-11">
      <h1 class="font-display text-[clamp(64px,15vw,210px)] leading-[0.85] font-black tracking-[-0.03em]">
        Linden<br>Coffee
      </h1>
      <div class="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p class="text-[clamp(17px,5.2vw,24px)] font-medium whitespace-nowrap text-linden">
            {{ localized(cafe.tagline) }}
          </p>
          <p class="mt-1.5 text-base">{{ localized(cafe.address) }}</p>
        </div>
        <NuxtLink :to="{ hash: '#booking' }" class="btn-primary">{{ t('cta.book') }}</NuxtLink>
      </div>
    </div>
  </section>
</template>
