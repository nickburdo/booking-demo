<script setup lang="ts">
import { cafe } from '~/data/cafe'

const { t } = useI18n()
const localized = useLocalized()

const center: [number, number] = [cafe.coordinates.lat, cafe.coordinates.lng]

// Keep the page scrollable over the map (plan step 5.6): no wheel zoom, and on touch
// screens no one-finger panning, so a swipe over the map still scrolls the page.
// The map renders only in the browser (<ClientOnly>), so the server value is never used.
const mapOptions = {
  scrollWheelZoom: false,
  dragging: import.meta.client ? !window.matchMedia('(pointer: coarse)').matches : true,
}
</script>

<template>
  <section id="location" class="page-container section-pad anchor-offset">
    <h2 class="font-display text-[30px] font-bold md:text-[40px]">{{ t('location.title') }}</h2>
    <div class="mt-9 grid gap-8 md:grid-cols-2 md:gap-10">
      <address class="not-italic">
        <p class="text-xl font-medium">{{ cafe.name }}</p>
        <p class="mt-1">{{ localized(cafe.address) }}</p>
      </address>
      <div role="region" :aria-label="t('location.mapLabel')" class="h-[280px] bg-line md:h-[360px]">
        <ClientOnly>
          <LMap :zoom="16" :center="center" :options="mapOptions" :use-global-leaflet="false">
            <LTileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&amp;copy; <a href=&quot;https://www.openstreetmap.org/copyright&quot;>OpenStreetMap</a> contributors"
              layer-type="base"
              name="OpenStreetMap"
            />
            <LMarker :lat-lng="center" />
          </LMap>
        </ClientOnly>
      </div>
    </div>
  </section>
</template>
