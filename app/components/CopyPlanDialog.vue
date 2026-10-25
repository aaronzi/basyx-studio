<template>
  <!-- The plan and the report of a paste or an import (package editing
       plan, K4 to K8): what would be written, the policy for identifiers
       that exist, then what was written. The clipboard store opens it. -->
  <v-dialog max-width="640" :model-value="open" scrollable @update:model-value="value => !value && close()">
    <DialogCard flush :title="pending?.title ?? ''">
      <div class="pa-4">
        <p class="text-body-medium text-medium-emphasis mt-0 mb-0">
          {{ t('copies.into', { name: destination.data.value?.name ?? '' }) }}
          <template v-if="plan?.sourceLabel"> · {{ plan.sourceLabel }}</template>
        </p>

        <ProblemAlert v-if="error" class="mt-4" :error="error" />
      </div>

      <div v-if="planning" class="d-flex align-center ga-3 px-4 pb-4">
        <v-progress-circular indeterminate size="20" width="2" />
        <span class="text-body-medium">{{ t('copies.planning') }}</span>
      </div>

      <!-- The plan: the resources to choose, then the policy. -->
      <template v-else-if="plan && !report">
        <v-alert
          v-for="note in plan.notes"
          :key="note"
          class="mx-4 mb-3"
          density="compact"
          :text="note"
          type="info"
        />

        <v-divider />

        <v-list lines="two">
          <v-list-item
            v-for="resource in plan.resources"
            :key="resource.key"
            :disabled="resource.blocked !== null"
            :subtitle="resource.identifier"
            :title="resource.label"
            @click="toggle(resource.key)"
          >
            <template #prepend>
              <v-checkbox-btn :model-value="resource.blocked === null && !excluded.has(resource.key)" readonly />
            </template>

            <template #append>
              <div class="d-flex flex-wrap justify-end ga-1">
                <v-chip :prepend-icon="typeIcons[resource.resourceType]" :text="t(`copies.types.${resource.resourceType}`)" />

                <v-chip v-if="resource.files > 0" prepend-icon="mdi-paperclip" :text="t('copies.files', resource.files)" />

                <v-chip
                  v-if="resource.blocked"
                  v-tooltip="[resource.blocked, ...resource.findings].join(' ')"
                  color="error"
                  :text="t('copies.states.blocked')"
                />

                <v-chip v-else-if="resource.exists" color="warning" :text="t('copies.states.exists')" />

                <v-chip v-else color="success" :text="t('copies.states.new')" />
              </div>
            </template>
          </v-list-item>
        </v-list>

        <v-divider />

        <div class="pa-4">
          <v-radio-group v-model="policy" hide-details :label="t('copies.policy')">
            <v-radio v-for="item in plan.allowedCollisionPolicies" :key="item" :value="item">
              <template #label>
                <div>
                  <div>{{ t(`copies.policies.${item}.title`) }}</div>
                  <div class="text-body-small text-medium-emphasis">{{ t(`copies.policies.${item}.text`) }}</div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>

          <p class="text-body-small text-medium-emphasis mt-3 mb-0">{{ t('copies.notAtomic') }}</p>
        </div>
      </template>

      <!-- The report: what each resource came to (DATA-014). -->
      <template v-else-if="report">
        <v-alert class="mx-4 mb-3" :text="t('copies.report.counts', report.counts)" :title="t(`copies.report.${report.status}`)" :type="reportType" />

        <v-divider />

        <v-list lines="two">
          <v-list-item
            v-for="outcome in report.outcomes"
            :key="`${outcome.resourceType}:${outcome.identifier}`"
            :subtitle="outcome.message ?? outcome.destinationIdentifier"
            :title="labelOf(outcome.resourceType, outcome.identifier)"
          >
            <template #prepend>
              <v-icon :color="statusColors[outcome.status]" :icon="statusIcons[outcome.status]" />
            </template>

            <template #append>
              <v-chip :text="t(`copies.statuses.${outcome.status}`)" />
            </template>
          </v-list-item>
        </v-list>

        <SyncReport class="ma-4" :steps="report.sync" />
      </template>

      <template v-if="report && report.status !== 'succeeded'" #actions-start>
        <v-btn-secondary :loading="running" :text="t('copies.retry')" @click="execute" />
      </template>

      <template #actions>
        <v-btn :text="report ? t('common.close') : t('common.cancel')" @click="close" />

        <v-btn-primary
          v-if="!report"
          :disabled="!plan || selectedCount === 0"
          :loading="running"
          :text="t('copies.copy')"
          @click="execute"
        />

        <v-btn-primary v-else-if="report.shellKey" :text="t('copies.openShell')" @click="openResult(`/targets/${destinationId}/shells/${report.shellKey}`)" />

        <v-btn-primary
          v-else-if="report.submodelKey && destination.data.value?.capabilities.submodelListSource"
          :text="t('copies.openSubmodel')"
          @click="openResult(`/targets/${destinationId}/submodels?submodel=${report.submodelKey}`)"
        />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { CollisionPolicy, CopyPlan, CopyReport, CopyResourceOutcome, CopyResourceType } from '#shared/contract'
  import { useQueryCache } from '@pinia/colada'

  const { t } = useI18n()
  const api = useStudioApi()
  const router = useRouter()
  const store = useClipboardStore()
  const invalidate = useInvalidate()
  const queryCache = useQueryCache()

  const plan = shallowRef<CopyPlan | null>(null)
  const report = shallowRef<CopyReport | null>(null)
  const pending = computed(() => store.pending)
  const open = computed(() => pending.value !== null)
  const destinationId = computed(() => plan.value?.destinationTargetId ?? pending.value?.request?.destinationTargetId ?? '')
  const destination = useTarget(destinationId)

  const planning = ref(false)
  const running = ref(false)
  const error = ref<unknown>(null)
  const policy = ref<CollisionPolicy>('fail_without_changes')
  const excluded = ref(new Set<string>())
  // One key per attempt: a repeated request answers with the attempt's report (DATA-015).
  let idempotencyKey = ''

  const typeIcons: Record<CopyResourceType, string> = { shell: '$aas', submodel: 'mdi-file-tree-outline', conceptDescription: 'mdi-book-open-page-variant-outline' }
  const statusIcons: Record<CopyResourceOutcome['status'], string> = { created: 'mdi-plus-circle-outline', replaced: 'mdi-swap-horizontal', skipped: 'mdi-minus-circle-outline', failed: 'mdi-alert-circle-outline' }
  const statusColors: Record<CopyResourceOutcome['status'], string> = { created: 'success', replaced: 'info', skipped: 'secondary', failed: 'error' }
  const reportType = computed(() => {
    const status = report.value?.status
    if (status === 'succeeded') {
      return 'success'
    }
    return status === 'failed' ? 'error' : 'warning'
  })
  const selectedCount = computed(() => plan.value?.resources.filter(resource => resource.blocked === null && !excluded.value.has(resource.key)).length ?? 0)

  watch(pending, async value => {
    plan.value = null
    report.value = null
    error.value = null
    excluded.value = new Set()
    idempotencyKey = globalThis.crypto.randomUUID()
    if (!value) {
      return
    }
    if (value.plan) {
      show(value.plan)
      return
    }
    planning.value = true
    try {
      show(await api<CopyPlan>('/copy-plans', { method: 'POST', body: value.request }))
    } catch (error_) {
      error.value = error_
    } finally {
      planning.value = false
    }
  })

  function show (value: CopyPlan) {
    plan.value = value
    policy.value = value.defaultCollisionPolicy
  }

  function toggle (key: string) {
    const next = new Set(excluded.value)
    if (!next.delete(key)) {
      next.add(key)
    }
    excluded.value = next
  }

  function labelOf (type: CopyResourceType, identifier: string): string {
    return plan.value?.resources.find(resource => resource.resourceType === type && resource.identifier === identifier)?.label ?? identifier
  }

  async function execute () {
    if (!plan.value) {
      return
    }
    running.value = true
    error.value = null
    try {
      report.value = await api<CopyReport>(`/copy-plans/${plan.value.id}/executions`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { collisionPolicy: policy.value, confirmed: true, exclude: [...excluded.value] },
      })
      // A retry of the plan is a new attempt.
      idempotencyKey = globalThis.crypto.randomUUID()
      await invalidate(['targets', plan.value.destinationTargetId])
      // A package's unsaved changes, in the target list.
      await queryCache.invalidateQueries({ key: ['targets'], exact: true })
    } catch (error_) {
      error.value = error_
    } finally {
      running.value = false
    }
  }

  function close () {
    store.pending = null
  }

  async function openResult (path: string) {
    close()
    await router.push(path)
  }
</script>
