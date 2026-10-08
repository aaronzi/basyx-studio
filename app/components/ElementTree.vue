<template>
  <div>
    <ProblemAlert
      v-if="error"
      class="ma-2"
      :error="error"
      retry
      @retry="reload"
    />

    <v-progress-linear v-if="loadingRoot" />

    <div v-else-if="rootLoaded && items.length === 0" class="pa-4 text-medium-emphasis">
      {{ t('shell.noElements') }}
    </div>

    <v-treeview
      v-else
      v-model:activated="activated"
      item-title="label"
      item-value="key"
      :items="items"
      :load-children="loadChildren"
    >
      <template #prepend="{ item }">
        <v-icon :icon="modelTypeIcon(item.modelType)" size="small" />
      </template>

      <template #title="{ item }">
        <span>{{ item.variableGroup ? t(`variables.${item.variableGroup}`) : item.label }}</span>
        <span v-if="item.preview" class="text-medium-emphasis ml-2">{{ item.preview }}</span>
      </template>
    </v-treeview>
  </div>
</template>

<script lang="ts" setup>
  import type { ElementNode } from '#shared/contract'
  import { modelTypeIcon } from '~/utils/aas'

  interface TreeItem extends ElementNode {
    children?: TreeItem[]
  }

  const props = defineProps<{ targetId: string, submodelKey: string }>()
  const selected = defineModel<string | null>('selected', { default: null })

  const { t } = useI18n()
  const api = useStudioApi()

  // Loaded children per parent key; the tree is derived from it, so lazily
  // loaded levels never require mutating Vuetify's internal item objects.
  const rootNodes = ref<ElementNode[]>([])
  const children = ref<Record<string, ElementNode[]>>({})
  const rootLoaded = ref(false)
  const loadingRoot = ref(false)
  const error = ref<unknown>(null)
  let generation = 0

  function build (nodes: ElementNode[]): TreeItem[] {
    return nodes.map(node => {
      const loaded = children.value[node.key]
      if (!node.hasChildren) {
        return { ...node }
      }
      return { ...node, children: loaded ? build(loaded) : [] }
    })
  }
  const items = computed(() => build(rootNodes.value))

  const activated = computed({
    get: () => (selected.value ? [selected.value] : []),
    set: (keys: unknown[]) => {
      selected.value = (keys[0] as string | undefined) ?? null
    },
  })

  function elementsUrl () {
    return `/targets/${props.targetId}/submodels/${props.submodelKey}/elements`
  }

  async function reload () {
    const current = ++generation
    loadingRoot.value = true
    error.value = null
    rootLoaded.value = false
    children.value = {}
    try {
      const result = await api<{ items: ElementNode[] }>(elementsUrl())
      if (current === generation) {
        rootNodes.value = result.items
        rootLoaded.value = true
      }
    } catch (error_) {
      if (current === generation) {
        rootNodes.value = []
        error.value = error_
      }
    } finally {
      if (current === generation) {
        loadingRoot.value = false
      }
    }
  }

  async function loadChildren (item: unknown) {
    const { key } = item as TreeItem
    const current = generation
    try {
      const result = await api<{ items: ElementNode[] }>(elementsUrl(), { query: { parentElementKey: key } })
      // Ignore answers that arrive after the user switched submodels.
      if (current === generation) {
        children.value = { ...children.value, [key]: result.items }
      }
    } catch (error_) {
      if (current === generation) {
        error.value = error_
      }
    }
  }

  watch(() => [props.targetId, props.submodelKey], reload, { immediate: true })
</script>
