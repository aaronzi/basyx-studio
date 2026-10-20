<template>
  <v-app>
    <v-main>
      <!-- A full-page module (layout: fullPage): the app owns the whole page. -->
      <v-sheet class="d-flex flex-column flex-md-row" color="transparent" height="100vh">
        <div class="d-flex flex-column flex-grow-1">
          <!-- With a shared apps origin the frame is opaque, and embedded pages
               run without cookies or storage; many stay blank there. -->
          <v-alert
            v-if="opaque"
            class="ma-2 flex-grow-0"
            data-test="opaque"
            text="This Studio serves all apps from one origin, so the embedded map may stay blank."
            type="info"
          >
            <template #append>
              <v-btn text="Open the map" @click="client.ui.openExternal(mapUrl)" />
            </template>
          </v-alert>

          <!-- Declared in sandbox.frameOrigins. -->
          <iframe
            class="flex-grow-1 border-0 d-block w-100"
            data-test="map"
            referrerpolicy="no-referrer"
            :src="mapUrl"
            :title="`Map of ${place.name}`"
          />
        </div>

        <v-sheet class="pa-4 flex-shrink-0" color="transparent" :width="mdAndUp ? 320 : undefined">
          <v-btn-toggle v-model="selected" class="mb-4" mandatory>
            <v-btn v-for="item in places" :key="item.name" :text="item.name" :value="item.name" />
          </v-btn-toggle>

          <v-card :title="`Weather in ${place.name}`">
            <v-progress-linear v-if="loading" />

            <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

            <!-- Read with fetch from sandbox.connectOrigins. -->
            <v-list v-else-if="weather" data-test="weather">
              <v-list-item prepend-icon="mdi-thermometer" subtitle="Temperature" :title="`${weather.temperature} °C`" />
              <v-list-item prepend-icon="mdi-weather-windy" subtitle="Wind" :title="`${weather.wind} km/h`" />
            </v-list>

            <v-card-text class="text-medium-emphasis">Weather data by Open-Meteo.com, map by OpenStreetMap.</v-card-text>
          </v-card>
        </v-sheet>
      </v-sheet>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { StudioClient } from '@basyx/studio-sdk'
  import { computed, ref, watch } from 'vue'
  import { useDisplay } from 'vuetify'

  defineProps<{ client: StudioClient }>()

  const { mdAndUp } = useDisplay()

  const places = [
    { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
    { name: 'Paris', latitude: 48.857, longitude: 2.352 },
    { name: 'Tokyo', latitude: 35.68, longitude: 139.77 },
  ]
  const selected = ref(places[0]!.name)
  const place = computed(() => places.find(item => item.name === selected.value) ?? places[0]!)

  /** In an opaque frame (a shared apps origin), `self.origin` is the string `null`. */
  const opaque = self.origin === 'null'

  const mapUrl = computed(() => {
    const { latitude, longitude } = place.value
    const bbox = [longitude - 0.08, latitude - 0.04, longitude + 0.08, latitude + 0.04].map(value => value.toFixed(3)).join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`
  })

  const weather = ref<{ temperature: number, wind: number } | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  watch(place, async ({ latitude, longitude }) => {
    loading.value = true
    error.value = null
    try {
      // A keyless public API: no credentials, nothing secret in the request.
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m`)
      if (!response.ok) {
        throw new Error(`Open-Meteo answered ${response.status}.`)
      }
      const { current } = await response.json() as { current: { temperature_2m: number, wind_speed_10m: number } }
      weather.value = { temperature: current.temperature_2m, wind: current.wind_speed_10m }
    } catch (error_) {
      weather.value = null
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }, { immediate: true })
</script>
