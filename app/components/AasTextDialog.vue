<template>
  <!-- *From JSON or XML* (package editing plan, K9): AAS text, filled in
       from the system clipboard when it holds some, checked with AAS Core
       while the user types. An element is inserted here; shells, submodels
       and concept descriptions go on to the copy plan. -->
  <v-dialog v-model="open" max-width="760" persistent>
    <DialogCard flush :title="title">
      <v-sheet color="transparent" height="360">
        <CodeView
          v-model="text"
          editable
          :label="format === 'xml' ? 'XML' : 'JSON'"
          :language="format"
          model-namespace="insert"
        />
      </v-sheet>

      <v-divider />

      <div class="pa-3">
        <v-alert v-if="findings.length > 0" density="compact" :title="t('editor.findings')" type="error">
          <ul class="ps-4 text-body-small">
            <li v-for="finding in findings.slice(0, 6)" :key="`${finding.path}:${finding.message}`">
              <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
            </li>
          </ul>
        </v-alert>

        <v-alert v-else-if="contents" density="compact" :text="contentsText" type="info" />

        <v-alert v-else-if="checked" density="compact" :text="t('insert.valid')" type="success" />

        <div v-else-if="text.trim() === ''" class="text-body-small text-medium-emphasis">{{ t('copies.text.hint') }}</div>

        <ProblemAlert v-if="error" class="mt-2" :error="error" />
      </div>

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="close" />

        <v-btn-primary
          :disabled="!checked || (findings.length > 0 && kind === 'element')"
          :loading="busy"
          :text="kind === 'element' ? t('insert.insert') : t('copies.text.review')"
          @click="submit"
        />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ValidationResult } from '#shared/contract'

  const props = defineProps<{
    targetId: string
    kind: 'element' | 'shell' | 'submodel' | 'conceptDescription'
    title: string
    /** Inserts an element (the JSON AAS Core checked); rejects with the problem to show. */
    insert?: (value: Record<string, unknown>) => Promise<void>
    /** A pasted submodel is also referenced from this shell. */
    destinationShellKey?: string
  }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const clipboard = useClipboardStore()

  const text = ref('')
  const format = computed(() => (text.value.trimStart().startsWith('<') ? 'xml' : 'json'))
  const findings = ref<Array<{ path: string, message: string }>>([])
  const contents = ref<ValidationResult['contents']>(null)
  const checked = ref(false)
  const busy = ref(false)
  const error = ref<unknown>(null)
  let element: Record<string, unknown> | null = null
  /** What the text holds, the kinds it has only. */
  const contentsText = computed(() => {
    const counts = contents.value
    if (!counts) {
      return ''
    }
    const parts = (['shells', 'submodels', 'conceptDescriptions'] as const)
      .filter(key => counts[key] > 0)
      .map(key => t(`copies.text.count.${key}`, counts[key]))
    return parts.length > 0 ? t('copies.text.contents', { list: parts.join(', ') }) : t('copies.text.empty')
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  watch(text, () => {
    checked.value = false
    contents.value = null
    element = null
    error.value = null
    findings.value = []
    clearTimeout(timer)
    if (text.value.trim() === '') {
      return
    }
    const current = ++sequence
    timer = setTimeout(async () => {
      try {
        const result = await api<ValidationResult>(`/targets/${props.targetId}/validations`, { method: 'POST', body: { kind: props.kind, format: format.value, text: text.value } })
        if (current === sequence) {
          findings.value = result.violations
          contents.value = result.contents ?? null
          element = result.value ?? null
          checked.value = true
        }
      } catch (error_) {
        error.value = error_
      }
    }, 350)
  })

  // AAS text on the system clipboard fills the editor; reading it may need the user's consent.
  watch(open, async value => {
    if (!value) {
      return
    }
    text.value = ''
    try {
      const pasted = await navigator.clipboard.readText()
      if (/^\s*[{<]/.test(pasted)) {
        text.value = pasted
      }
    } catch {
      // The user types or pastes the text.
    }
  })

  async function submit () {
    if (props.kind !== 'element') {
      // The plan shows what is written, with findings per resource and the policy for collisions.
      close()
      clipboard.openCopy({
        request: {
          source: { kind: 'text', format: format.value, content: text.value },
          destinationTargetId: props.targetId,
          destinationShellKey: props.destinationShellKey,
          dependencies: { submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' },
        },
        plan: null,
        title: props.title,
      })
      return
    }
    if (!element || !props.insert) {
      return
    }
    busy.value = true
    error.value = null
    try {
      await props.insert(element)
      close()
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = false
    }
  }

  function close () {
    clearTimeout(timer)
    open.value = false
  }
</script>
