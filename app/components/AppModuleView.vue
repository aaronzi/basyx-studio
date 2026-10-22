<template>
  <!-- A full-page module (ADR 0045): only the frame, from the rail to the
       window's edges. Anything Studio shows instead keeps the standard page. -->
  <v-sheet-full-page v-if="fullPage && module">
    <AppFrame
      :key="`${targetId ?? ''}:${shellKey ?? ''}:${module.installationId}:${module.id}`"
      :contribution="module"
      :shell-id="shellId"
      :sub-path="subPath"
      :target="target?.data.value ?? null"
      @navigate="navigate"
    />
  </v-sheet-full-page>

  <v-container v-else max-width="none">
    <TargetHeader v-if="targetId" :target="target?.data.value" :trail="trail" />

    <PageHeader v-else :title="title" />

    <ProblemAlert v-if="contributions.error.value" :error="contributions.error.value" retry @retry="contributions.refetch()" />

    <v-progress-linear v-else-if="contributions.isPending.value" />

    <v-alert v-else-if="!module" :text="t('apps.notInstalled')" type="info" />

    <template v-else-if="targetId && target">
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && target.needsAuthorization.value"
        :target="target.data.value"
        @authorized="target.refetch()"
      />

      <v-alert v-else-if="module.context === 'shell' && !shellId" :text="t('apps.needsShell')" type="info" />

      <v-card-pane v-else-if="target.data.value">
        <AppFrame
          :key="`${targetId}:${shellKey ?? ''}:${module.installationId}:${module.id}`"
          :contribution="module"
          :shell-id="shellId"
          :sub-path="subPath"
          :target="target.data.value"
          @navigate="navigate"
        />
      </v-card-pane>
    </template>

    <v-card-pane v-else>
      <AppFrame
        :key="`${module.installationId}:${module.id}`"
        :contribution="module"
        :sub-path="subPath"
        :target="null"
        @navigate="navigate"
      />
    </v-card-pane>
  </v-container>
</template>

<script lang="ts" setup>
  import { decodeResourceKey } from '~/utils/aas'

  // An app module page (MVP-3). Global modules live under /apps, target and
  // shell modules under /targets/{targetId}/apps; the rest of the path is the
  // module's own sub-path (nested routes).
  const props = defineProps<{
    installationId: string
    route: string
    targetId: string | null
    shellKey: string | null
    subPath: string
  }>()

  const { t } = useI18n()
  const router = useRouter()
  const currentRoute = useRoute()
  const label = useLocalizedLabel()

  const contributions = useAppContributions()
  const module = computed(() => contributions.data.value?.modules
    .find(item => item.installationId === props.installationId && item.route === props.route) ?? null)
  const target = props.targetId ? useTarget(() => props.targetId!) : null
  const shellId = computed(() => props.shellKey ? decodeResourceKey(props.shellKey) : null)

  /** The frame can be shown: the module is installed, and its target is open, authorized and has the shell it needs. */
  const frameReady = computed(() => {
    if (!module.value) {
      return false
    }
    if (!target) {
      return true
    }
    return Boolean(target.data.value && !target.error.value && !target.needsAuthorization.value && (module.value.context !== 'shell' || shellId.value))
  })
  const fullPage = computed(() => module.value?.layout === 'fullPage' && frameReady.value)

  const title = computed(() => module.value ? label(module.value.title) : t('app.apps'))
  const trail = computed(() => [{ title: title.value }])

  /**
   * The module's sub-path in Studio's URL. A pushed entry lets back and
   * forward move between the module's pages; the new sub-path reaches the
   * frame with the context, which stays connected (its key has no sub-path).
   */
  function navigate (subPath: string, history: 'push' | 'replace') {
    const base = props.targetId
      ? `/targets/${props.targetId}/apps/${props.installationId}/${props.route}`
      : `/apps/${props.installationId}/${props.route}`
    const location = { path: subPath ? `${base}/${subPath}` : base, query: currentRoute.query }
    void (history === 'push' ? router.push(location) : router.replace(location))
  }
</script>
