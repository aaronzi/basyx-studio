<template>
  <v-app>
    <v-main>
      <!-- The module's own bar of its pages. Studio's app bar and rail stay
           Studio's: no second app bar or rail in the frame (ADR 0045). -->
      <v-toolbar>
        <v-toolbar-title class="flex-0-0 me-4" :text="t('app.title')" />

        <v-tabs data-test="pages">
          <v-tab exact :text="t('app.pages.overview')" :to="{ name: 'overview' }" />
          <v-tab :text="t('app.pages.shells')" :to="{ name: 'shells' }" />
        </v-tabs>

        <v-spacer />

        <!-- The page is full-width, without Studio's breadcrumbs: the app names the target. -->
        <v-chip
          v-if="context.target"
          class="me-3"
          data-test="target"
          prepend-icon="mdi-server-network-outline"
          :text="context.target.name"
        />
      </v-toolbar>

      <v-divider />

      <v-container>
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { StudioClient } from '@basyx/studio-sdk'
  import { provideClient } from './client'
  import { provideI18n } from './i18n'

  const props = defineProps<{ client: StudioClient }>()
  const { context } = provideClient(props.client)
  const { t } = provideI18n(props.client)
</script>
