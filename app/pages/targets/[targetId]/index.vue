<template>
  <v-container>
    <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

    <TargetAuthorization
      v-else-if="target.data.value && target.needsAuthorization.value"
      :target="target.data.value"
      @authorized="invalidate(['targets', targetId])"
    />

    <v-skeleton-loader v-else-if="!target.data.value" type="heading, card" />

    <template v-else>
      <!-- The landing page of a target; a later MVP turns it into a dashboard (MVP-4 plan, R1). -->
      <div class="d-flex flex-wrap align-center ga-4 mb-6">
        <div class="flex-grow-1">
          <h1 class="text-headline-small">{{ target.data.value.name }}</h1>
          <p class="text-body-large text-medium-emphasis">{{ target.data.value.description ?? t('landing.subtitle') }}</p>
        </div>

        <div class="d-flex flex-wrap ga-2">
          <v-btn
            v-if="capabilities.upload"
            prepend-icon="mdi-upload"
            :text="t('landing.upload')"
            variant="tonal"
            @click="uploadOpen = true"
          />

          <v-btn-primary prepend-icon="$aas" :text="t('landing.openViewer')" :to="`/targets/${targetId}/shells`" />
        </div>
      </div>

      <v-card class="mb-6">
        <v-card-item>
          <template #prepend>
            <v-avatar :color="target.data.value.authenticationState === 'required' ? 'warning' : 'success'" variant="tonal">
              <v-icon :icon="targetIcon(target.data.value)" />
            </v-avatar>
          </template>

          <v-card-title>{{ t('landing.status') }}</v-card-title>

          <template v-if="mdAndUp" #append>
            <TargetStatus :target="target.data.value" />
          </template>
        </v-card-item>

        <v-card-text class="pt-0">
          <TargetStatus v-if="!mdAndUp" class="mb-4" :target="target.data.value" />
          <CapabilityChips :capabilities="capabilities" />
        </v-card-text>
      </v-card>

      <v-empty-state
        icon="mdi-view-dashboard-outline"
        :text="t('landing.dashboardText')"
        :title="t('landing.dashboardTitle')"
      />

      <UploadDialog v-if="capabilities.upload" v-model="uploadOpen" :target="target.data.value" />
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { TargetCapabilities } from '#shared/contract'
  import { useDisplay } from 'vuetify'
  import { noCapabilities } from '#shared/contract'
  import { targetIcon } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const invalidate = useInvalidate()
  const { mdAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)
  const capabilities = computed<TargetCapabilities>(() => target.data.value?.capabilities ?? noCapabilities)
  const uploadOpen = ref(false)
</script>
