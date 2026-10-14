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
      <v-row align="center" class="mb-2">
        <v-col cols="12" md>
          <div class="text-label-large text-primary">{{ today }}</div>
          <h1 class="text-headline-medium font-weight-semibold">{{ greeting }}</h1>

          <p class="text-body-large text-medium-emphasis">
            {{ target.data.value.name }}<template v-if="capabilities.changeFeed && changes.data.value"> · {{ todayCount >= changeLimit ? t('dashboard.manyChangesToday', { count: changeLimit }) : t('dashboard.changesToday', todayCount) }}</template>
          </p>
        </v-col>

        <v-col class="d-flex ga-2 flex-wrap" cols="12" md="auto">
          <v-btn
            v-if="capabilities.upload"
            prepend-icon="mdi-upload"
            :text="t('dashboard.upload')"
            variant="tonal"
            @click="uploadOpen = true"
          />

          <v-btn-primary prepend-icon="mdi-cube-outline" :text="t('dashboard.openViewer')" :to="`/targets/${targetId}/shells`" />
        </v-col>
      </v-row>

      <v-row>
        <!-- Recent changes (event feed) -->
        <v-col cols="12" lg="7">
          <v-card height="100%">
            <v-card-item prepend-icon="mdi-timeline-clock-outline">
              <v-card-title>{{ t('dashboard.changes') }}</v-card-title>
              <v-card-subtitle>{{ t('dashboard.changesSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <template v-if="capabilities.changeFeed">
              <v-card-text class="py-0">
                <v-chip-group v-model="entity" mandatory selected-class="text-primary">
                  <v-chip filter :text="t('dashboard.entities.all')" value="all" />
                  <v-chip filter :text="t('dashboard.entities.aas')" value="aas" />
                  <v-chip filter :text="t('dashboard.entities.submodel')" value="submodel" />
                  <v-chip filter :text="t('dashboard.entities.asset')" value="asset" />
                </v-chip-group>
              </v-card-text>

              <ProblemAlert
                v-if="changes.error.value"
                class="ma-4"
                :error="changes.error.value"
                retry
                @retry="changes.refetch()"
              />

              <v-skeleton-loader v-else-if="changes.isLoading.value" type="list-item-avatar-two-line@4" />

              <v-list v-else-if="feed.length > 0" class="px-2" lines="two">
                <v-list-item
                  v-for="event in feed"
                  :key="event.id"
                  :subtitle="`${timeAgo(event.time)} · ${event.subject}`"
                  :title="t(`changes.${event.entity}.${event.action}`, { name: '' })"
                  :to="event.entity === 'submodel' || event.action === 'deleted' ? undefined : `/targets/${targetId}/shells/${event.subjectKey}`"
                >
                  <template #prepend>
                    <v-avatar :color="changeMeta[event.action].color" rounded="lg" variant="tonal">
                      <v-icon :icon="changeMeta[event.action].icon" />
                    </v-avatar>
                  </template>

                  <template v-if="mdAndUp" #append>
                    <v-chip size="x-small" :text="t(`dashboard.entities.${event.entity}`)" />
                  </template>
                </v-list-item>
              </v-list>

              <v-empty-state
                v-else
                icon="mdi-timeline-remove-outline"
                size="56"
                :text="t('changes.noneText')"
                :title="t('changes.none')"
              />
            </template>

            <v-empty-state
              v-else
              icon="mdi-timeline-remove-outline"
              size="56"
              :text="t('dashboard.noFeed')"
              :title="t('dashboard.noFeedTitle')"
            />
          </v-card>
        </v-col>

        <v-col class="d-flex flex-column ga-4" cols="12" lg="5">
          <!-- Discovery -->
          <v-card v-if="capabilities.discovery">
            <v-card-item prepend-icon="mdi-barcode-scan">
              <v-card-title>{{ t('dashboard.lookup') }}</v-card-title>
              <v-card-subtitle>{{ t('dashboard.lookupSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-card-text>
              <v-text-field
                v-model="assetId"
                clearable
                :placeholder="t('dashboard.lookupPlaceholder')"
                prepend-inner-icon="mdi-magnify"
                @keyup.enter="lookup"
              >
                <template #append-inner>
                  <v-btn-primary
                    :disabled="!assetId"
                    :loading="lookingUp"
                    size="small"
                    :text="t('dashboard.lookupAction')"
                    @click="lookup"
                  />
                </template>
              </v-text-field>

              <ProblemAlert v-if="lookupError" class="mt-2" :error="lookupError" />
            </v-card-text>

            <v-expand-transition>
              <v-list v-if="lookupResult" class="px-2 pt-0">
                <v-list-item
                  v-for="shell in lookupResult"
                  :key="shell.key"
                  append-icon="mdi-chevron-right"
                  prepend-icon="mdi-cube-outline"
                  :subtitle="shell.id"
                  :title="langText(shell.displayName) ?? shell.idShort ?? shell.id"
                  :to="`/targets/${targetId}/shells/${shell.key}`"
                />

                <v-list-item v-if="lookupResult.length === 0" prepend-icon="mdi-help-circle-outline" :title="t('dashboard.lookupNone')" />
              </v-list>
            </v-expand-transition>
          </v-card>

          <!-- Recently opened -->
          <v-card class="flex-grow-1">
            <v-card-item prepend-icon="mdi-history">
              <v-card-title>{{ t('dashboard.recent') }}</v-card-title>
              <v-card-subtitle>{{ t('dashboard.recentSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-list v-if="recent.length > 0" class="px-2 pt-0">
              <v-list-item
                v-for="key in recent"
                :key="key"
                prepend-icon="mdi-cube-outline"
                :title="decodeResourceKey(key) ?? key"
                :to="`/targets/${targetId}/shells/${key}`"
              />
            </v-list>

            <v-card-text v-else class="text-medium-emphasis">{{ t('dashboard.recentNone') }}</v-card-text>
          </v-card>
        </v-col>

        <!-- The target itself -->
        <v-col cols="12">
          <v-card>
            <v-card-item>
              <template #prepend>
                <v-avatar :color="target.data.value.authenticationState === 'required' ? 'warning' : 'success'" rounded="lg" variant="tonal">
                  <v-icon :icon="targetIcon(target.data.value)" />
                </v-avatar>
              </template>

              <v-card-title>{{ target.data.value.name }}</v-card-title>
              <v-card-subtitle>{{ target.data.value.description ?? t('dashboard.targetSubtitle') }}</v-card-subtitle>

              <template #append>
                <TargetStatus :target="target.data.value" />
              </template>
            </v-card-item>

            <v-card-text class="pt-0">
              <CapabilityChips :capabilities="capabilities" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <UploadDialog v-if="capabilities.upload" v-model="uploadOpen" :target="target.data.value" />
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ChangePage, ShellSummary, TargetCapabilities } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { changeMeta, decodeResourceKey, langText, targetIcon } from '~/utils/aas'

  const { t, locale } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const invalidate = useInvalidate()
  const session = useSessionStore()
  const preferences = usePreferences()
  const timeAgo = useTimeAgo()
  const { mdAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)
  const capabilities = computed<TargetCapabilities>(() => target.data.value!.capabilities)

  const today = computed(() => new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }))
  const greeting = computed(() => {
    const hour = new Date().getHours()
    const part = hour < 12 ? 'morning' : (hour < 18 ? 'afternoon' : 'evening')
    const name = session.isDesktop ? '' : (session.session?.user.name.split(/\s+/, 1)[0] ?? '')
    return t(`dashboard.greeting.${part}`, { name })
  })

  // Changes of the last 24 hours, re-read every 30 s while the page is visible.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const changeLimit = 200
  const changes = useQuery({
    key: () => ['targets', targetId.value, 'changes', 'dashboard'],
    query: ({ signal }) => api<ChangePage>(`/targets/${targetId.value}/changes`, { query: { since, limit: changeLimit }, signal }),
    enabled: () => Boolean(target.data.value?.capabilities.changeFeed) && !target.needsAuthorization.value,
    refetchOnWindowFocus: true,
  })
  if (import.meta.client) {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && target.data.value?.capabilities.changeFeed) {
        void changes.refetch()
      }
    }, 30_000)
    onScopeDispose(() => clearInterval(timer))
  }

  const entity = ref('all')
  const feed = computed(() => (changes.data.value?.items ?? []).filter(event => entity.value === 'all' || event.entity === entity.value).slice(0, 8))
  const todayCount = computed(() => {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    return (changes.data.value?.items ?? []).filter(event => new Date(event.time) >= midnight).length
  })

  const assetId = ref('')
  const lookingUp = ref(false)
  const lookupError = ref<unknown>(null)
  const lookupResult = ref<ShellSummary[] | null>(null)
  async function lookup () {
    if (!assetId.value) {
      return
    }
    lookingUp.value = true
    lookupError.value = null
    try {
      lookupResult.value = (await api<{ items: ShellSummary[] }>(`/targets/${targetId.value}/lookup`, { query: { assetId: assetId.value.trim() } })).items
    } catch (error) {
      lookupError.value = error
    } finally {
      lookingUp.value = false
    }
  }

  const recent = computed(() => preferences.recent(targetId.value))
  const uploadOpen = ref(false)
</script>
