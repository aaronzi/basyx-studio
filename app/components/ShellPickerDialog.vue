<template>
  <v-dialog v-model="open" max-width="520">
    <DialogCard :title="title">
      <v-autocomplete
        v-model="picked"
        v-model:search="text"
        autofocus
        :custom-filter="serverSearch ? () => true : undefined"
        item-props
        :items="items"
        :label="t('submodels.pickShell')"
        :loading="loading"
        :no-data-text="t('submodels.noShells')"
        prepend-inner-icon="$aas"
        return-object
      />

      <ProblemAlert v-if="error" class="mt-2" :error="error" />

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="open = false" />
        <v-btn-primary :disabled="!picked" :text="t('submodels.addToShell')" @click="pick" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Page, ShellSearchPage, ShellSummary } from '#shared/contract'
  import { langText } from '~/utils/aas'

  // Picks a shell of the target, e.g. to give it a reference to a submodel.
  // Where the target can search, the typed text searches it; otherwise the
  // first shells are filtered as typed.
  const props = defineProps<{
    targetId: string
    title: string
    /** Shells not to offer (by ID), e.g. those that reference the submodel already. */
    exclude?: string[]
  }>()
  const emit = defineEmits<{ pick: [shell: ShellSummary] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const target = useTarget(() => props.targetId)
  const serverSearch = computed(() => target.data.value !== undefined && target.data.value.capabilities.search !== 'filter')

  const text = ref('')
  const picked = ref<{ title: string, subtitle: string, value: string, shell: ShellSummary } | null>(null)
  const shells = ref<ShellSummary[]>([])
  const loading = ref(false)
  const error = ref<unknown>(null)

  const items = computed(() => shells.value
    .filter(shell => !props.exclude?.includes(shell.id))
    .map(shell => ({ title: langText(shell.displayName) ?? shell.idShort ?? shell.id, subtitle: shell.id, value: shell.key, shell })))

  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  async function load (expression: string) {
    const current = ++sequence
    loading.value = true
    error.value = null
    try {
      const page = serverSearch.value
        ? await api<ShellSearchPage>(`/targets/${props.targetId}/searches`, { method: 'POST', body: { scope: 'shells', expression, limit: 50 } })
        : await api<Page<ShellSummary>>(`/targets/${props.targetId}/shells`, { query: { limit: 200 } })
      if (current === sequence) {
        shells.value = page.items
      }
    } catch (error_) {
      error.value = error_
    } finally {
      if (current === sequence) {
        loading.value = false
      }
    }
  }

  // The selected title becomes the text: that is no new search.
  watch(text, value => {
    if (!serverSearch.value || !open.value || value === picked.value?.title) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => load(value ?? ''), 300)
  })

  watch(open, value => {
    if (value) {
      picked.value = null
      text.value = ''
      void load('')
    }
  })
  onScopeDispose(() => clearTimeout(timer))

  function pick () {
    if (picked.value) {
      emit('pick', picked.value.shell)
      open.value = false
    }
  }
</script>
