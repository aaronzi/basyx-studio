<template>
  <v-container>
    <v-empty-state
      v-if="session.needsLogin"
      :image="basyxLogo"
      size="96"
      :text="t('home.signInText')"
      :title="t('home.signInTitle')"
    >
      <template #actions>
        <v-btn-primary :loading="signingIn" prepend-icon="mdi-login" :text="t('app.signIn')" @click="signIn" />
      </template>
    </v-empty-state>

    <template v-else>
      <PageHeader :subtitle="t('home.subtitle')" :title="t('home.title')">
        <template #actions>
          <v-btn
            v-if="session.isAdmin"
            prepend-icon="mdi-plus"
            :text="t('home.addInfrastructure')"
            to="/admin/infrastructures"
            variant="tonal"
          />

          <v-btn-primary
            v-if="bridge"
            :loading="opening"
            prepend-icon="mdi-folder-open-outline"
            :text="t('workspace.open')"
            @click="openPackage"
          />
        </template>
      </PageHeader>

      <ProblemAlert v-if="authError" class="mb-4" :error="authErrorProblem" />
      <ProblemAlert v-if="openError" class="mb-4" :error="openError" />

      <ProblemAlert
        v-if="targets.error.value"
        class="mb-4"
        :error="targets.error.value"
        retry
        @retry="targets.refetch()"
      />

      <v-card v-if="targets.isPending.value">
        <v-skeleton-loader type="list-item-avatar-two-line@3" />
      </v-card>

      <v-card v-else-if="items.length > 0">
        <ListFilterBar
          v-model:search="search"
          v-model:selected="selected"
          :options="filterOptions"
          :placeholder="t('home.search')"
        />

        <v-divider />

        <v-list-records v-if="filtered.length > 0">
          <template v-for="(target, index) in filtered" :key="target.id">
            <v-divider v-if="index > 0" />

            <RecordListItem :subtitle="target.description ?? undefined" :title="target.name" :to="`/targets/${target.id}`">
              <template #prepend>
                <v-avatar class="me-3" :color="target.authenticationState === 'required' ? 'warning' : 'primary'" size="36" variant="tonal">
                  <v-icon :icon="targetIcon(target)" size="20" />
                </v-avatar>
              </template>

              <template #meta>
                <TargetChips :target="target" />
              </template>

              <template #actions>
                <v-btn
                  v-tooltip="t('landing.openViewer')"
                  :aria-label="t('landing.openViewer')"
                  icon="$aas"
                  @click.stop.prevent="navigateTo(`/targets/${target.id}/shells`)"
                />
              </template>
            </RecordListItem>
          </template>
        </v-list-records>

        <v-card-text v-else class="text-medium-emphasis">{{ t('lists.noMatches') }}</v-card-text>
      </v-card>

      <v-empty-state
        v-else-if="targets.data.value"
        icon="mdi-server-network-off"
        :text="session.isAdmin ? t('home.noTargetsAdmin') : t('home.noTargetsUser')"
        :title="t('home.noTargets')"
      >
        <template v-if="session.isAdmin" #actions>
          <v-btn-primary :text="t('home.addInfrastructure')" to="/admin/infrastructures" />
        </template>
      </v-empty-state>
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import type { DesktopBridge } from '~/composables/useDesktopBridge'
  import type { FilterOption } from '~/utils/records'
  import { useQuery } from '@pinia/colada'
  import basyxLogo from '~/assets/basyx-logo.svg'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { securityModeIcons, targetIcon } from '~/utils/aas'
  import { filterRecords } from '~/utils/records'

  const { t } = useI18n()
  const route = useRoute()
  const session = useSessionStore()
  const api = useStudioApi()

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
    enabled: () => !session.needsLogin,
  })

  const items = computed(() => targets.data.value?.items ?? [])
  const search = ref<string | null>(null)
  const selected = ref<string[]>([])

  /** Security mode, or `workspace` for a local package. */
  function kindOf (target: Target): string {
    return target.securityMode ?? 'workspace'
  }

  // Filters for the security modes and sign-in states that occur.
  const filterOptions = computed<FilterOption[]>(() => [
    ...[...new Set(items.value.map(target => kindOf(target)))].map(kind => ({
      value: `security:${kind}`,
      title: kind === 'workspace' ? t('workspace.localFile') : t(`security.${kind}`),
      icon: kind === 'workspace' ? 'mdi-package-variant-closed' : securityModeIcons[kind],
    })),
    ...[...new Set(items.value.filter(target => target.securityMode).map(target => target.authenticationState))]
      .map(state => ({ value: `state:${state}`, title: t(`authState.${state}`) })),
  ])

  const filtered = computed(() => filterRecords(items.value, search.value, selected.value, target => ({
    text: [target.name, target.description],
    facets: [`security:${kindOf(target)}`, `state:${target.authenticationState}`],
  })))

  const authError = computed(() => typeof route.query.authError === 'string' ? route.query.authError : null)
  const authErrorProblem = computed(() => new StudioApiError({
    type: 'about:blank',
    title: 'Authorization failed',
    status: 400,
    code: authError.value === 'access_denied' ? 'forbidden' : 'target_auth_required',
    requestId: '-',
    retryable: false,
  }))

  // Desktop only: open a local AASX package as a workspace target.
  const bridge = ref<DesktopBridge | null>(null)
  onMounted(() => (bridge.value = useDesktopBridge()))
  const opening = ref(false)
  const openError = ref<unknown>(null)

  async function openPackage () {
    opening.value = true
    openError.value = null
    try {
      const grant = await bridge.value?.chooseAasxFile()
      if (grant) {
        const target = await api<Target>('/workspaces', { method: 'POST', body: { fileHandle: grant.handle } })
        await navigateTo(`/targets/${target.id}/shells`)
      }
    } catch (error) {
      openError.value = error
    } finally {
      opening.value = false
    }
  }

  const signingIn = ref(false)
  async function signIn () {
    signingIn.value = true
    const returnTo = typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/'
    try {
      await session.login(returnTo)
    } finally {
      signingIn.value = false
    }
  }
</script>
