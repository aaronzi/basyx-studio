<template>
  <div class="d-flex flex-column flex-grow-1 position-relative overflow-hidden" data-test="file-viewer-text">
    <v-progress-linear v-if="!ready && monacoLoader" class="flex-shrink-0" indeterminate />

    <!-- Without Monaco (no loader, or it failed): the text as it is. -->
    <v-code v-if="!monacoLoader || failed" class="d-block flex-grow-1 overflow-auto pa-4 text-pre-wrap text-break">{{ state.text.value }}</v-code>

    <!-- Monaco needs a sized host; it lays itself out when the host changes. -->
    <div v-else ref="host" class="flex-grow-1" />
  </div>
</template>

<script lang="ts" setup>
  import type { MonacoApi } from '../i18n.ts'
  import type { FileViewerState } from '../state.ts'
  import type { editor } from 'monaco-editor'
  import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
  import { useTheme } from 'vuetify'
  import { VCode } from 'vuetify/components/VCode'
  import { VProgressLinear } from 'vuetify/components/VProgressLinear'
  import { useFileViewerContext } from '../i18n.ts'

  // A text in Monaco, as Studio's code views show JSON and XML: highlighting
  // by language, folding and find (⌘F / Ctrl+F). Editable when the state
  // says so; ⌘S / Ctrl+S saves.
  const props = defineProps<{ state: FileViewerState }>()
  const emit = defineEmits<{ save: [] }>()

  const { monaco: monacoLoader, t } = useFileViewerContext()
  const theme = useTheme()
  const host = useTemplateRef<HTMLDivElement>('host')
  const ready = ref(false)
  const failed = ref(false)

  let instance: editor.IStandaloneCodeEditor | undefined
  let model: editor.ITextModel | undefined
  let api: MonacoApi | undefined
  let applying = false
  let disposed = false

  const language = computed(() => props.state.info.value.language)
  const options = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    folding: true,
    fontSize: 13,
    wordWrap: props.state.wrap.value ? 'on' : 'off',
    // Read-only while a save is on its way, so nothing typed then gets lost.
    readOnly: !props.state.writable.value,
    domReadOnly: !props.state.writable.value,
    renderValidationDecorations: props.state.editable.value ? 'on' : 'off',
    ariaLabel: props.state.source.value?.name ?? t('kinds.text'),
    theme: theme.current.value.dark ? 'vs-dark' : 'vs',
  }))

  watch(options, value => instance?.updateOptions(value))
  watch(() => theme.current.value.dark, dark => api?.editor.setTheme(dark ? 'vs-dark' : 'vs'))
  watch(() => props.state.text.value, value => {
    if (model && value !== model.getValue()) {
      applying = true
      model.setValue(value)
      applying = false
    }
  })
  watch(language, value => model && api?.editor.setModelLanguage(model, value))

  onMounted(async () => {
    if (!monacoLoader) {
      return
    }
    try {
      api = await monacoLoader()
      if (disposed || !host.value) {
        return
      }
      const extension = props.state.source.value?.name.split('.').pop() ?? 'txt'
      const uri = api.Uri.parse(`inmemory://file-viewer/${crypto.randomUUID()}.${extension}`)
      model = api.editor.createModel(props.state.text.value, language.value, uri)
      instance = api.editor.create(host.value, { ...options.value, model })
      model.onDidChangeContent(() => {
        if (!applying && model && props.state.writable.value) {
          props.state.setText(model.getValue())
        }
      })
      instance.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () => emit('save'))
      ready.value = true
    } catch {
      failed.value = true
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    instance?.dispose()
    model?.dispose()
  })

  function find () {
    instance?.focus()
    void instance?.getAction('actions.find')?.run()
  }

  defineExpose({ find })
</script>
