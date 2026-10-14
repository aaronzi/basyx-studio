<template>
  <div>
    <!-- The drawers register with the app layout from inside the page. -->
    <ShellListDrawer :active-key="null" :target-id="targetId" />

    <v-container class="fill-height" max-width="720">
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && target.needsAuthorization.value"
        :target="target.data.value"
        @authorized="invalidate(['targets', targetId])"
      />

      <template v-else>
        <v-empty-state
          :headline="t('viewer.headline')"
          :text="t('viewer.text')"
          :title="t('viewer.title')"
        >
          <template #media>
            <v-avatar class="mb-4" color="primary" size="96" variant="tonal">
              <v-icon icon="mdi-cube-scan" size="48" />
            </v-avatar>
          </template>

          <template #actions>
            <v-btn-primary
              v-if="!lgAndUp"
              prepend-icon="mdi-format-list-bulleted"
              :text="t('viewer.browse')"
              @click="ui.listDrawer = true"
            />

            <v-btn prepend-icon="mdi-magnify" :text="t('viewer.search')" variant="tonal" @click="ui.commandOpen = true" />
          </template>
        </v-empty-state>

        <div v-if="recent.length > 0" class="w-100 text-center">
          <div class="text-label-large text-medium-emphasis mb-2">{{ t('dashboard.recent') }}</div>

          <v-chip-group class="justify-center">
            <v-chip
              v-for="key in recent"
              :key="key"
              prepend-icon="mdi-history"
              :text="decodeResourceKey(key) ?? key"
              :to="`/targets/${targetId}/shells/${key}`"
              variant="outlined"
            />
          </v-chip-group>
        </div>
      </template>
    </v-container>
  </div>
</template>

<script lang="ts" setup>
  import { useDisplay } from 'vuetify'
  import { decodeResourceKey } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const ui = useUiStore()
  const invalidate = useInvalidate()
  const preferences = usePreferences()
  const { lgAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)
  const recent = computed(() => preferences.recent(targetId.value).slice(0, 5))
</script>
