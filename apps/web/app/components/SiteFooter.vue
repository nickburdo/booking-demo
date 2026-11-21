<script setup lang="ts">
import { cafe } from '~/data/cafe'
import { heroPhotoCredit, repoUrl } from '~/data/site'

const { t } = useI18n()
const localized = useLocalized()
const localePath = useLocalePath()
</script>

<template>
  <footer class="page-container py-10 text-[15px]">
    <p class="font-display font-bold">{{ cafe.name }}</p>
    <p class="mt-1">{{ localized(cafe.address) }}</p>
    <p class="mt-4 text-steam">{{ t('footer.demo') }}</p>
    <p class="mt-1 text-steam">
      <a :href="heroPhotoCredit.url" class="underline underline-offset-2 hover:text-cobalt" target="_blank" rel="noopener">
        {{ t('footer.photoCredit', { author: heroPhotoCredit.author }) }}
      </a>
    </p>
    <p v-if="repoUrl" class="mt-1">
      <a :href="repoUrl" class="text-cobalt underline underline-offset-2" target="_blank" rel="noopener">{{ t('footer.repo') }}</a>
    </p>
    <!-- v4: the admin is a demo feature, so it is linked here, not in the main navigation -->
    <p class="mt-1">
      <NuxtLink :to="localePath('/admin/login')" class="text-cobalt underline underline-offset-2">{{ t('footer.admin') }}</NuxtLink>
    </p>
  </footer>
</template>
