<template>
  <v-app>
    <!-- Studio's card shows the view's title. In Studio's full-screen dialog, the card fills the frame. -->
    <v-view-card :class="fullscreen ? 'd-flex flex-column' : undefined" :height="fullscreen ? '100vh' : undefined">
      <v-progress-linear v-if="loading" />

      <v-alert
        v-else-if="loadError"
        class="ma-4"
        data-test="load-error"
        :text="loadError"
        type="error"
      />

      <template v-else>
        <div class="d-flex align-center flex-wrap ga-2 px-4 pb-2">
          <span class="text-body-2 text-medium-emphasis" data-test="counts">{{ t('fs.counts', counts) }}</span>

          <v-spacer />

          <template v-if="canEdit">
            <v-btn-primary
              data-test="upload"
              :disabled="busy !== null"
              prepend-icon="mdi-upload"
              :text="t('fs.upload')"
              @click="fileInput?.click()"
            />

            <v-btn-secondary
              data-test="new-folder"
              :disabled="busy !== null"
              prepend-icon="mdi-folder-plus-outline"
              :text="t('fs.newFolder')"
              @click="startForm('newFolder')"
            />

            <input
              ref="fileInput"
              class="d-none"
              data-test="file-input"
              multiple
              type="file"
              @change="onFilesChosen"
            >
          </template>
        </div>

        <v-alert
          v-if="notice"
          class="mx-4 mb-2"
          closable
          data-test="notice"
          :text="notice.text"
          :type="notice.type"
          @click:close="notice = null"
        />

        <div v-if="busy" class="mx-4 mb-2" data-test="busy">
          <p class="text-body-2 mb-1">{{ busy }}</p>
          <v-progress-linear />
        </div>

        <!-- Changes are made in place: the view is sized to its content, so a dialog would not fit. -->
        <v-sheet
          v-if="form"
          border
          class="mx-4 mb-2 pa-3"
          data-test="form"
          rounded="lg"
        >
          <template v-if="form.kind === 'newFolder' || form.kind === 'rename'">
            <v-text-field
              v-model="form.name"
              autofocus
              data-test="name-field"
              :label="t('fs.name')"
              :rules="[value => Boolean(value?.trim()) || t('fs.nameRequired')]"
              @keydown.enter="submitForm"
            />
          </template>

          <v-select
            v-else-if="form.kind === 'move'"
            v-model="form.target"
            data-test="move-target"
            :items="moveTargets"
            :label="t('fs.moveTo')"
          />

          <p v-else class="text-body-2" data-test="delete-question">
            {{ form.entry?.kind === 'folder' ? t('fs.deleteFolder', { name: form.entry.name }) : t('fs.deleteFile', { name: form.entry?.name ?? '' }) }}
          </p>

          <div class="d-flex justify-end ga-2 mt-2">
            <v-btn data-test="form-cancel" :text="t('fs.cancel')" @click="form = null" />

            <v-btn-primary
              :color="form.kind === 'delete' ? 'error' : undefined"
              data-test="form-submit"
              :disabled="!formValid"
              :text="submitText"
              @click="submitForm"
            />
          </div>
        </v-sheet>

        <v-row :class="fullscreen ? 'flex-grow-1 overflow-hidden' : undefined" no-gutters>
          <v-col :class="fullscreen ? 'h-100 overflow-y-auto' : undefined" cols="12" md="5">
            <v-treeview
              v-if="items.length > 0"
              v-model:activated="activated"
              v-model:opened="opened"
              activatable
              :class="fullscreen ? undefined : 'overflow-y-auto'"
              color="primary"
              data-test="tree"
              density="compact"
              item-value="id"
              :items="items"
              :max-height="fullscreen ? undefined : 480"
            >
              <template #prepend="{ item, isOpen }">
                <v-icon :icon="iconOf(item.entry, isOpen)" />
              </template>
            </v-treeview>

            <v-card-text v-else class="text-medium-emphasis" data-test="empty">
              {{ t('fs.empty') }} <template v-if="canEdit">{{ t('fs.emptyEdit') }}</template>
            </v-card-text>
          </v-col>

          <v-col :class="fullscreen ? 'h-100 overflow-y-auto' : undefined" cols="12" md="7">
            <template v-if="selected">
              <v-card-item :prepend-icon="iconOf(selected)">
                <v-card-title class="text-body-1" data-test="selected-name">{{ selected.name }}</v-card-title>
                <v-card-subtitle data-test="selected-details">{{ details }}</v-card-subtitle>

                <template #append>
                  <div class="d-flex flex-wrap ga-1">
                    <template v-if="selected.kind === 'file' && !selected.external">
                      <v-btn
                        :aria-label="t('fs.open')"
                        data-test="open-file"
                        icon="mdi-open-in-new"
                        @click="openFile(selected, false)"
                      />

                      <v-btn
                        :aria-label="t('fs.download')"
                        data-test="download-file"
                        icon="mdi-download"
                        @click="openFile(selected, true)"
                      />
                    </template>

                    <template v-if="canEdit">
                      <v-btn
                        :aria-label="t('fs.rename')"
                        data-test="rename"
                        :disabled="busy !== null"
                        icon="mdi-pencil-outline"
                        @click="startForm('rename', selected)"
                      />

                      <v-btn
                        :aria-label="t('fs.move')"
                        data-test="move"
                        :disabled="busy !== null"
                        icon="mdi-folder-move-outline"
                        @click="startForm('move', selected)"
                      />

                      <v-btn
                        :aria-label="t('fs.delete')"
                        color="error"
                        data-test="delete"
                        :disabled="busy !== null"
                        icon="mdi-delete-outline"
                        @click="startForm('delete', selected)"
                      />
                    </template>
                  </div>
                </template>
              </v-card-item>

              <v-card-text>
                <file-preview
                  v-if="selected.kind === 'file'"
                  :client="client"
                  :file="selected"
                  :fullscreen="fullscreen"
                  :locale="locale"
                  :submodel-id="submodelId"
                  @loaded="size = $event"
                />

                <v-list v-else-if="selected.children.length > 0" data-test="folder-content">
                  <v-list-item
                    v-for="child in selected.children"
                    :key="child.path"
                    :prepend-icon="iconOf(child)"
                    :title="child.name"
                    @click="select(child.path)"
                  />
                </v-list>

                <p v-else class="text-medium-emphasis">{{ t('fs.folderEmpty') }}</p>
              </v-card-text>
            </template>

            <v-card-text v-else class="text-medium-emphasis" data-test="select-hint">{{ t('fs.select') }}</v-card-text>
          </v-col>
        </v-row>
      </template>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { Entry } from './fileSystem'
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'
  import FilePreview from './FilePreview.vue'
  import { findEntry, flatten, folders, formatSize, iconOf, isWithin, readFileSystem } from './fileSystem'
  import { provideI18n } from './i18n'
  import { FileSystemWriter, TooLargeError } from './operations'

  // The FileSystem submodel (https://basyx.org/FileSystem/FileSystem/0/1) as
  // folders and files, with a preview of the selected file, as the BaSyx AAS
  // Web UI's FileSystem plugin shows it. In Studio's edit mode, files are
  // uploaded, and files and folders created, renamed, moved and deleted
  // (Studio app API 0.1.5, ADR 0049).

  const props = defineProps<{ client: StudioClient }>()
  const { t, locale } = provideI18n(props.client)

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const fullscreen = computed(() => context.value.fullscreen ?? false)
  const canEdit = computed(() => (context.value.target?.write ?? false) && context.value.mode === 'edit')
  const submodelId = computed(() => context.value.submodel!.id)
  const writer = computed(() => new FileSystemWriter(props.client, submodelId.value))

  const loading = ref(true)
  const loadError = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)
  const notice = ref<{ type: 'success' | 'error' | 'warning', text: string } | null>(null)
  /** What is being changed, shown above a progress bar; `null` when idle. */
  const busy = ref<string | null>(null)
  const size = ref<number | null>(null)
  const fileInput = ref<HTMLInputElement | null>(null)

  const entries = computed(() => submodel.value ? readFileSystem(submodel.value, locale.value) : [])
  interface TreeItem { id: string, title: string, entry: Entry, children?: TreeItem[] }
  function toItem (entry: Entry): TreeItem {
    return entry.kind === 'folder' && entry.children.length > 0
      ? { id: entry.path, title: entry.name, entry, children: entry.children.map(child => toItem(child)) }
      : { id: entry.path, title: entry.name, entry }
  }
  const items = computed(() => entries.value.map(entry => toItem(entry)))
  const counts = computed(() => {
    const all = flatten(entries.value)
    return { folders: all.filter(entry => entry.kind === 'folder').length, files: all.filter(entry => entry.kind === 'file').length }
  })

  const activated = ref<string[]>([])
  const opened = ref<string[]>([])
  const selectedPath = computed(() => activated.value[0] ?? null)
  const selected = computed(() => selectedPath.value ? findEntry(entries.value, selectedPath.value) : null)
  /** Where uploads and new folders go: the selected folder, or the selected file's folder. */
  const currentFolder = computed(() => selected.value ? (selected.value.kind === 'folder' ? selected.value.path : selected.value.parent) : '')

  const details = computed(() => {
    const entry = selected.value
    if (!entry) {
      return ''
    }
    if (entry.kind === 'folder') {
      const inside = flatten(entry.children)
      return t('fs.counts', { folders: inside.filter(child => child.kind === 'folder').length, files: inside.filter(child => child.kind === 'file').length })
    }
    return [entry.contentType, size.value === null ? null : formatSize(size.value, locale.value)].filter(Boolean).join(' · ')
  })

  function select (path: string) {
    size.value = null
    activated.value = [path]
    // Its folders open, so it shows in the tree.
    const parents = path.split('.').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('.'))
    opened.value = [...new Set([...opened.value, ...parents])]
  }

  async function load () {
    try {
      submodel.value = await props.client.aas.getSubmodel(submodelId.value)
      loadError.value = null
      if (selectedPath.value && !findEntry(entries.value, selectedPath.value)) {
        activated.value = []
      } else if (selectedPath.value) {
        select(selectedPath.value)
      }
    } catch (error_) {
      loadError.value = error_ instanceof StudioError ? error_.message : t('fs.loadFailed')
    } finally {
      loading.value = false
    }
  }

  function describe (cause: unknown): string {
    if (cause instanceof TooLargeError) {
      return t('fs.tooLarge', { name: cause.fileName })
    }
    if (!(cause instanceof StudioError)) {
      return String(cause)
    }
    switch (cause.code) {
      case 'revision_conflict':
      case 'structure_conflict':
      case 'idshort_conflict': {
        return t('fs.conflict')
      }
      case 'app_edit_mode_required': {
        return t('fs.editMode')
      }
      case 'forbidden':
      case 'target_forbidden': {
        return t('fs.forbidden')
      }
      default: {
        return cause.message
      }
    }
  }

  /** Runs a change and reloads; a failure is shown, and the view shows the current state. */
  async function change (label: string, work: () => Promise<string | null>, done: () => string) {
    notice.value = null
    busy.value = label
    try {
      const path = await work()
      notice.value = { type: 'success', text: done() }
      if (path !== null) {
        select(path)
      }
    } catch (error_) {
      notice.value = { type: 'error', text: describe(error_) }
    } finally {
      busy.value = null
      await load()
    }
  }

  async function onFilesChosen (event: Event) {
    const input = event.target as HTMLInputElement
    const files = [...input.files ?? []]
    input.value = ''
    const folder = currentFolder.value
    let uploaded = 0
    let last: string | null = null
    await change(t('fs.upload'), async () => {
      for (const [index, file] of files.entries()) {
        busy.value = t('fs.uploading', { current: index + 1, total: files.length, name: file.name })
        last = await writer.value.upload(folder, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
        uploaded++
      }
      return last
    }, () => t('fs.uploaded', { count: uploaded }))
    if (notice.value?.type === 'error' && uploaded > 0) {
      notice.value = { type: 'warning', text: `${t('fs.uploaded', { count: uploaded })} ${notice.value.text}` }
    }
  }

  type FormKind = 'newFolder' | 'rename' | 'move' | 'delete'
  const form = ref<{ kind: FormKind, entry: Entry | null, name: string, target: string } | null>(null)

  function startForm (kind: FormKind, entry: Entry | null = null) {
    form.value = { kind, entry, name: kind === 'newFolder' ? t('fs.defaultFolderName') : (entry?.name ?? ''), target: entry?.parent ?? '' }
  }

  /** Folders an entry can move to: not where it is, not into itself. */
  const moveTargets = computed(() => {
    const entry = form.value?.entry
    const targets = [{ title: t('fs.topLevel'), value: '' }, ...folders(entries.value).map(folder => ({ title: `${'— '.repeat(folder.path.split('.').length - 1)}${folder.name}`, value: folder.path }))]
    return targets.filter(target => !entry || (entry.kind !== 'folder' || !isWithin(target.value, entry.path)))
  })

  const formValid = computed(() => {
    const current = form.value
    if (!current) {
      return false
    }
    if (current.kind === 'newFolder' || current.kind === 'rename') {
      return current.name.trim().length > 0
    }
    if (current.kind === 'move') {
      return current.target !== current.entry?.parent
    }
    return true
  })

  const submitText = computed(() => {
    switch (form.value?.kind) {
      case 'newFolder': {
        return t('fs.create')
      }
      case 'move': {
        return t('fs.move')
      }
      case 'delete': {
        return t('fs.delete')
      }
      default: {
        return t('fs.save')
      }
    }
  })

  async function submitForm () {
    const current = form.value
    if (!current || !formValid.value) {
      return
    }
    form.value = null
    const name = current.name.trim()
    const entry = current.entry
    switch (current.kind) {
      case 'newFolder': {
        const folder = currentFolder.value
        await change(t('fs.newFolder'), () => writer.value.createFolder(folder, name), () => t('fs.created', { name }))
        break
      }
      case 'rename': {
        await change(t('fs.rename'), async () => {
          await writer.value.rename(entry!, name, locale.value)
          return entry!.path
        }, () => t('fs.renamed', { name }))
        break
      }
      case 'move': {
        await change(t('fs.moving', { name: entry!.name }), () => writer.value.move(entry!, current.target), () => t('fs.moved', { name: entry!.name }))
        break
      }
      case 'delete': {
        await change(t('fs.delete'), async () => {
          await writer.value.delete(entry!)
          activated.value = []
          return null
        }, () => t('fs.deleted', { name: entry!.name }))
        break
      }
    }
  }

  function openFile (entry: Entry, download: boolean) {
    void props.client.ui.openFile(submodelId.value, entry.path, download).catch((error_: unknown) => {
      notice.value = { type: 'error', text: describe(error_) }
    })
  }

  onMounted(load)
</script>
