<template>
  <v-app>
    <!-- Studio's card shows the view's title; where the frame fills its space (Visualization tab, full screen), the card fills the frame. -->
    <v-view-card :class="fills ? 'd-flex flex-column' : undefined" :height="fills ? '100vh' : undefined">
      <v-progress-linear v-if="loading" />

      <v-alert
        v-else-if="loadError"
        class="ma-4"
        data-test="load-error"
        :text="loadError"
        type="error"
      />

      <!-- The overlays are contained in this area; it does not scroll itself, so they stay in view. -->
      <v-sheet
        v-else
        class="position-relative d-flex flex-column"
        :class="fills ? 'flex-grow-1 overflow-hidden' : undefined"
        color="transparent"
        :height="fills ? undefined : 560"
        @dragleave="onAreaDragLeave"
        @dragover="onAreaDragOver"
        @drop="onAreaDrop"
      >
        <div class="px-4 pt-4">
          <!-- Breadcrumbs with "up", as in the Web UI; on the right the selection, the view toggle and New. -->
          <v-list-item border class="pa-0" data-test="breadcrumbs">
            <template #prepend>
              <v-btn
                :aria-label="t('fs.up')"
                class="ma-2"
                data-test="up"
                density="compact"
                :disabled="!folder"
                icon="mdi-chevron-up"
                @click="openFolder(parentOf(folder))"
              />

              <v-divider vertical />
            </template>

            <v-breadcrumbs class="pa-0 ms-2" divider="/" :items="breadcrumbs">
              <template #item="{ item, index }">
                <v-breadcrumbs-item :data-test="`crumb-${index}`" :disabled="item.disabled" @click="openFolder(breadcrumbs[index]!.value)">{{ item.title }}</v-breadcrumbs-item>
              </template>
            </v-breadcrumbs>

            <template #append>
              <div class="d-flex align-center flex-wrap justify-end ga-2 me-2 my-1">
                <v-sheet
                  v-if="selected.size > 0"
                  border
                  class="d-flex align-center"
                  data-test="selection"
                  rounded="xl"
                >
                  <v-btn
                    :aria-label="t('fs.clearSelection')"
                    data-test="clear-selection"
                    icon="mdi-close"
                    size="small"
                    @click="selected = new Set()"
                  />

                  <span class="text-title-small mx-2">{{ t('fs.selected', { count: selected.size }) }}</span>

                  <v-btn
                    :aria-label="t('fs.move')"
                    data-test="move-selected"
                    icon="mdi-folder-move"
                    size="small"
                    @click="startDialog('move', selectedEntries)"
                  />

                  <v-btn
                    :aria-label="t('fs.delete')"
                    data-test="delete-selected"
                    icon="mdi-delete"
                    size="small"
                    @click="startDialog('delete', selectedEntries)"
                  />
                </v-sheet>

                <v-btn-toggle v-model="view" :aria-label="t('fs.view')" mandatory>
                  <v-btn-toggle-icon
                    v-tooltip="t('fs.gallery')"
                    :aria-label="t('fs.gallery')"
                    data-test="view-grid"
                    icon="mdi-view-grid-outline"
                    value="grid"
                  />

                  <v-btn-toggle-icon
                    v-tooltip="t('fs.explorer')"
                    :aria-label="t('fs.explorer')"
                    data-test="view-list"
                    icon="mdi-view-list-outline"
                    value="list"
                  />
                </v-btn-toggle>

                <new-menu v-if="canEdit" @create-folder="startDialog('newFolder')" @upload="startDialog('upload')" />
              </div>
            </template>
          </v-list-item>
        </div>

        <div class="flex-grow-1 overflow-y-auto pa-4">
          <v-alert
            v-if="notice"
            class="mb-3"
            closable
            data-test="notice"
            :text="notice.text"
            :type="notice.type"
            @click:close="notice = null"
          />

          <gallery-view
            v-if="view === 'grid'"
            :drop-target="dropTarget"
            :editable="canEdit"
            :entries="entries"
            :folder="folder"
            :selected="selected"
            :sources="sources"
            @action="onAction"
            @create-folder="startDialog('newFolder')"
            @drag-leave="onDragLeave"
            @drag-over="onDragOver"
            @drag-start="onDragStart"
            @drop="onDrop"
            @open="openFolder"
            @preview="preview"
            @toggle="toggle"
            @upload="startDialog('upload')"
          />

          <list-view
            v-else
            :drop-target="dropTarget"
            :editable="canEdit"
            :entries="entries"
            :folder="folder"
            :selected="selected"
            @action="onAction"
            @drag-leave="onDragLeave"
            @drag-over="onDragOver"
            @drag-start="onDragStart"
            @drop="onDrop"
            @open="openFolder"
            @preview="preview"
            @toggle="toggle"
            @toggle-all="toggleAll"
          />
        </div>

        <!-- Files dragged in from the computer -->
        <v-overlay
          class="align-center justify-center"
          contained
          data-test="drop-zone"
          :model-value="externalDrag"
          :opacity="0.1"
          persistent
          scrim="primary"
        >
          <v-sheet class="pa-5" color="primary" rounded="lg">
            <v-empty-state icon="mdi-upload" :title="t('fs.dropHere')" />
          </v-sheet>
        </v-overlay>

        <!-- Progress of uploads, moves and deletes -->
        <v-overlay class="align-center justify-center" contained :model-value="progress !== null" persistent>
          <v-card v-if="progress" class="pa-6" data-test="progress" min-width="350">
            <v-card-title class="text-center">{{ progress.title }}</v-card-title>

            <v-card-text>
              <div class="text-center mb-2">
                <span class="text-title-large">{{ progress.current }}</span>
                <span class="text-body-large"> / {{ progress.total }}</span>
              </div>

              <v-progress-linear height="20" :indeterminate="false" :model-value="(progress.current / Math.max(progress.total, 1)) * 100" rounded>
                <strong>{{ Math.round((progress.current / Math.max(progress.total, 1)) * 100) }}%</strong>
              </v-progress-linear>
            </v-card-text>
          </v-card>
        </v-overlay>

        <!-- The Web UI's dialogs, inside the view: Studio sizes the view's frame to its content. -->
        <v-overlay class="align-center justify-center" contained :model-value="dialog !== null" @update:model-value="dialog = null">
          <v-card v-if="dialog" data-test="dialog" max-width="600" min-width="360">
            <v-card-title data-test="dialog-title">{{ dialogTitle }}</v-card-title>
            <v-divider />

            <v-card-text>
              <v-text-field
                v-if="dialog.kind === 'newFolder' || dialog.kind === 'rename'"
                v-model="dialog.name"
                autofocus
                data-test="name-field"
                :label="t('fs.name')"
                :rules="[(value: string) => Boolean(value?.trim()) || t('fs.nameRequired')]"
                @keydown.enter="submitDialog"
              />

              <v-file-input
                v-else-if="dialog.kind === 'upload'"
                v-model="dialog.files"
                data-test="file-input"
                :label="t('fs.selectFiles')"
                multiple
                prepend-icon=""
                prepend-inner-icon="mdi-paperclip"
              />

              <v-select
                v-else-if="dialog.kind === 'move'"
                v-model="dialog.target"
                data-test="move-target"
                :items="moveTargets"
                :label="t('fs.moveTo')"
              />

              <template v-else>
                <p class="text-body-medium mb-2" data-test="delete-text">{{ deleteText }}</p>

                <v-list v-if="dialog.entries.length > 1" class="pa-0" max-height="200">
                  <v-list-item v-for="entry in dialog.entries" :key="entry.path" class="px-0" :title="entry.name">
                    <template #prepend>
                      <v-icon :color="iconColorOf(entry)" :icon="iconOf(entry)" size="small" />
                    </template>
                  </v-list-item>
                </v-list>
              </template>
            </v-card-text>

            <v-divider />

            <v-card-actions>
              <v-spacer />
              <v-btn data-test="dialog-cancel" :text="t('fs.cancel')" @click="dialog = null" />

              <v-btn-primary
                :color="dialog.kind === 'delete' ? 'error' : undefined"
                data-test="dialog-submit"
                :disabled="!dialogValid"
                :text="submitText"
                @click="submitDialog"
              />
            </v-card-actions>
          </v-card>
        </v-overlay>
      </v-sheet>
    </v-view-card>

  </v-app>
</template>

<script lang="ts" setup>
  import type { Entry, EntryAction, FileEntry } from './fileSystem'
  import type { FileSource } from '@basyx/file-viewer/vue'
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { provideFileViewer, withCachedContent } from '@basyx/file-viewer/vue'
  import { putAttachmentMaxBytes, StudioError } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { childrenAt, findEntry, flatten, folders, iconColorOf, iconOf, isWithin, parentOf, readFileSystem, trail } from './fileSystem'
  import GalleryView from './GalleryView.vue'
  import { provideI18n } from './i18n'
  import ListView from './ListView.vue'
  import NewMenu from './NewMenu.vue'
  import { FileSystemWriter, TooLargeError } from './operations'

  // The FileSystem submodel (https://basyx.org/FileSystem/FileSystem/0/1) as
  // the BaSyx AAS Web UI's FileSystem plugin shows it: a gallery or a list of
  // the current folder with breadcrumbs, and a full-screen preview. In
  // Studio's edit mode, files are uploaded (also by dropping them on the
  // view), folders created, and files and folders selected, renamed, moved
  // (also by dragging them onto a folder) and deleted (Studio app API 0.1.5,
  // ADR 0049).

  const props = defineProps<{ client: StudioClient }>()
  const { t, locale } = provideI18n(props.client)
  provideFileViewer({ locale: () => locale.value })

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const fullscreen = computed(() => context.value.fullscreen ?? false)
  /** The frame fills its space (Visualization tab, full screen): the view fills the window; on the Overview it keeps its size. */
  const fills = computed(() => context.value.fills ?? fullscreen.value)
  const canEdit = computed(() => (context.value.target?.write ?? false) && context.value.mode === 'edit')
  const submodelId = computed(() => context.value.submodel!.id)
  const writer = computed(() => new FileSystemWriter(props.client, submodelId.value))

  /** What the full-screen dialog opens with: the folder. */
  interface ViewState { folder?: string }
  function initialState (): ViewState {
    try {
      const state = JSON.parse(context.value.viewState || '{}') as ViewState
      return typeof state === 'object' && state ? state : {}
    } catch {
      return {}
    }
  }
  const state = initialState()

  const loading = ref(true)
  const loadError = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)
  const notice = ref<{ type: 'success' | 'error' | 'warning', text: string } | null>(null)
  const progress = ref<{ title: string, current: number, total: number } | null>(null)

  const view = ref<'grid' | 'list'>(storedView())
  const folder = ref(state.folder ?? '')
  const selected = ref<Set<string>>(new Set())

  const tree = computed(() => submodel.value ? readFileSystem(submodel.value, locale.value) : [])
  const entries = computed(() => childrenAt(tree.value, folder.value))
  /** The selected entries, also in folders expanded in the list; inside a selected folder, only the folder. */
  const selectedEntries = computed(() => flatten(tree.value).filter(entry => selected.value.has(entry.path)
    && ![...selected.value].some(path => path !== entry.path && isWithin(entry.path, path))))
  const breadcrumbs = computed(() => [
    { title: t('fs.root'), value: '', disabled: !folder.value },
    ...trail(tree.value, folder.value).map(entry => ({ title: entry.name, value: entry.path, disabled: entry.path === folder.value })),
  ])

  /** The view the user chose last; the frame may have no storage. */
  function storedView (): 'grid' | 'list' {
    try {
      return localStorage.getItem('fileSystemViewMode') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  }
  watch(view, value => {
    try {
      localStorage.setItem('fileSystemViewMode', value)
    } catch {
      // Without storage, the choice lasts as long as the view.
    }
  })

  async function load () {
    try {
      submodel.value = await props.client.aas.getSubmodel(submodelId.value)
      loadError.value = null
      // A folder that went away: show the nearest one that is left.
      while (folder.value && findEntry(tree.value, folder.value)?.kind !== 'folder') {
        folder.value = parentOf(folder.value)
      }
      selected.value = new Set([...selected.value].filter(path => findEntry(tree.value, path)))
    } catch (error_) {
      loadError.value = error_ instanceof StudioError ? error_.message : t('fs.loadFailed')
    } finally {
      loading.value = false
    }
  }

  function openFolder (path: string) {
    folder.value = path
    selected.value = new Set()
  }

  /**
   * Previews a file as the Web UI does, filling the window: in Studio's
   * file viewer, which shows every kind of file the same way (ADR 0052).
   */
  function preview (entry: FileEntry) {
    void props.client.ui.previewFile(submodelId.value, entry.path).catch((error_: unknown) => {
      notice.value = { type: 'error', text: describe(error_) }
    })
  }

  function openFile (entry: FileEntry, download: boolean) {
    void props.client.ui.openFile(submodelId.value, entry.path, download).catch((error_: unknown) => {
      notice.value = { type: 'error', text: describe(error_) }
    })
  }

  function toggle (entry: Entry) {
    const next = new Set(selected.value)
    if (next.has(entry.path)) {
      next.delete(entry.path)
    } else {
      next.add(entry.path)
    }
    selected.value = next
  }

  function toggleAll () {
    selected.value = entries.value.every(entry => selected.value.has(entry.path)) ? new Set() : new Set(entries.value.map(entry => entry.path))
  }

  // A full-screen dialog of this view is a frame of its own, which may have
  // changed the files: show what is there now once it closes.
  watch(() => context.value.fullscreenOpen, (open, wasOpen) => {
    if (wasOpen && !open) {
      void load()
    }
  })

  // Leaving edit mode ends a selection and closes what changes files.
  watch(canEdit, editable => {
    if (!editable) {
      selected.value = new Set()
      dialog.value = null
    }
  })

  // The files as the file viewer's thumbnails read them, through Studio as
  // the Web UI reads them; each is read once, when its card is in view.
  const sourceCache = new Map<string, FileSource>()
  const sources = computed(() => Object.fromEntries(entries.value.filter(entry => entry.kind === 'file').map(entry => {
    const key = `${entry.path}:${JSON.stringify(entry.element.value ?? null)}`
    let source = sourceCache.get(key)
    if (!source) {
      source = withCachedContent({
        key,
        name: entry.fileName,
        contentType: entry.contentType,
        external: entry.external,
        load: () => props.client.ui.readFile(submodelId.value, entry.path),
      })
      sourceCache.set(key, source)
    }
    return [entry.path, source]
  })))

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

  /**
   * Runs a change on several entries one after the other with a progress
   * card, then reloads. A failure stops the rest; the view shows what is
   * there now.
   */
  async function change<T> (title: string, items: T[], work: (item: T) => Promise<void>, done: (count: number) => string) {
    notice.value = null
    progress.value = { title, current: 0, total: items.length }
    let count = 0
    try {
      for (const item of items) {
        progress.value = { title, current: count + 1, total: items.length }
        await work(item)
        count++
      }
      notice.value = { type: 'success', text: done(count) }
    } catch (error_) {
      notice.value = { type: count > 0 ? 'warning' : 'error', text: count > 0 ? `${done(count)} ${describe(error_)}` : describe(error_) }
    } finally {
      progress.value = null
      selected.value = new Set()
      await load()
    }
  }

  async function upload (files: File[], into = folder.value) {
    const tooLarge = files.find(file => file.size > putAttachmentMaxBytes)
    if (tooLarge) {
      notice.value = { type: 'error', text: t('fs.tooLarge', { name: tooLarge.name }) }
      return
    }
    await change(t('fs.uploading'), files, async file => {
      await writer.value.upload(into, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    }, count => t('fs.uploaded', { count }))
  }

  async function move (items: Entry[], target: string) {
    const movable = items.filter(entry => entry.parent !== target && !(entry.kind === 'folder' && isWithin(target, entry.path)))
    if (movable.length === 0) {
      return
    }
    await change(t('fs.moving'), movable, async entry => {
      await writer.value.move(entry, target)
    }, count => t('fs.moved', { count }))
  }

  // Dialogs: new folder, upload, rename, move and delete.
  type DialogKind = 'newFolder' | 'upload' | 'rename' | 'move' | 'delete'
  const dialog = ref<{ kind: DialogKind, entries: Entry[], name: string, files: File[], target: string } | null>(null)

  function startDialog (kind: DialogKind, items: Entry[] = []) {
    const first = items[0]
    dialog.value = {
      kind,
      entries: items,
      name: kind === 'newFolder' ? t('fs.defaultFolderName') : (first?.name ?? ''),
      files: [],
      target: first ? first.parent : folder.value,
    }
  }

  function onAction (entry: Entry, action: EntryAction | 'moveUp') {
    switch (action) {
      case 'open':
      case 'download': {
        if (entry.kind === 'file') {
          openFile(entry, action === 'download')
        }
        break
      }
      case 'moveUp': {
        void move([entry], parentOf(entry.parent))
        break
      }
      default: {
        startDialog(action, [entry])
      }
    }
  }

  const dialogTitle = computed(() => {
    const current = dialog.value
    const name = current?.entries[0]?.name ?? ''
    switch (current?.kind) {
      case 'newFolder': {
        return t('fs.createFolder')
      }
      case 'upload': {
        return t('fs.uploadFiles')
      }
      case 'rename': {
        return t('fs.renameTitle', { name })
      }
      case 'move': {
        return current.entries.length > 1 ? t('fs.moveManyTitle', { count: current.entries.length }) : t('fs.moveTitle', { name })
      }
      case 'delete': {
        if (current.entries.length > 1) {
          return t('fs.deleteManyTitle', { count: current.entries.length })
        }
        return current.entries[0]?.kind === 'folder' ? t('fs.deleteFolderTitle', { name }) : t('fs.deleteFileTitle', { name })
      }
      default: {
        return ''
      }
    }
  })

  const deleteText = computed(() => {
    const items = dialog.value?.entries ?? []
    if (items.length > 1) {
      return t('fs.deleteManyText')
    }
    return items[0]?.kind === 'folder' ? t('fs.deleteFolderText') : t('fs.deleteFileText')
  })

  /** Folders the dialog's entries can move to: not into themselves. */
  const moveTargets = computed(() => {
    const moving = dialog.value?.entries ?? []
    const targets = [{ title: t('fs.root'), value: '' }, ...folders(tree.value).map(entry => ({ title: `${'— '.repeat(entry.path.split('.').length - 1)}${entry.name}`, value: entry.path }))]
    return targets.filter(target => moving.every(entry => entry.kind !== 'folder' || !isWithin(target.value, entry.path)))
  })

  const dialogValid = computed(() => {
    const current = dialog.value
    switch (current?.kind) {
      case 'newFolder':
      case 'rename': {
        return current.name.trim().length > 0
      }
      case 'upload': {
        return current.files.length > 0
      }
      case 'move': {
        return current.entries.some(entry => entry.parent !== current.target)
      }
      default: {
        return current !== null
      }
    }
  })

  const submitText = computed(() => {
    switch (dialog.value?.kind) {
      case 'newFolder': {
        return t('fs.create')
      }
      case 'upload': {
        return t('fs.upload')
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

  async function submitDialog () {
    const current = dialog.value
    if (!current || !dialogValid.value) {
      return
    }
    dialog.value = null
    const name = current.name.trim()
    switch (current.kind) {
      case 'newFolder': {
        const into = folder.value
        await change(t('fs.createFolder'), [name], async folderName => {
          await writer.value.createFolder(into, folderName)
        }, () => t('fs.created', { name }))
        break
      }
      case 'upload': {
        await upload(current.files)
        break
      }
      case 'rename': {
        await change(t('fs.rename'), current.entries, async entry => {
          await writer.value.rename(entry, name, locale.value)
        }, () => t('fs.renamed', { name }))
        break
      }
      case 'move': {
        await move(current.entries, current.target)
        break
      }
      case 'delete': {
        await change(t('fs.deleting'), current.entries, async entry => {
          await writer.value.delete(entry)
        }, count => t('fs.deleted', { count }))
        break
      }
    }
  }

  // Drag and drop, as in the Web UI: entries onto a folder (or `...`) move
  // there; files from the computer onto the view upload into the folder.
  const dragType = 'application/x-basyx-file-system'
  const dragging = ref<Entry[]>([])
  const dropTarget = ref<string | null>(null)
  const externalDrag = ref(false)

  function onDragStart (entry: Entry, event: DragEvent) {
    if (!canEdit.value || !event.dataTransfer) {
      return
    }
    dragging.value = selected.value.has(entry.path) ? selectedEntries.value : [entry]
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(dragType, JSON.stringify(dragging.value.map(item => item.path)))
  }

  function canDropOn (target: string): boolean {
    return dragging.value.some(entry => entry.parent !== target) && dragging.value.every(entry => entry.kind !== 'folder' || !isWithin(target, entry.path))
  }

  function onDragOver (target: string, event: DragEvent) {
    if (canDropOn(target)) {
      event.preventDefault()
      event.stopPropagation()
      dropTarget.value = target
    }
  }

  function onDragLeave (target: string) {
    if (dropTarget.value === target) {
      dropTarget.value = null
    }
  }

  function onDrop (target: string, event: DragEvent) {
    if (!canDropOn(target)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const items = dragging.value
    endDrag()
    void move(items, target)
  }

  function endDrag () {
    dragging.value = []
    dropTarget.value = null
    externalDrag.value = false
  }

  function onAreaDragOver (event: DragEvent) {
    if (canEdit.value && dragging.value.length === 0 && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
      externalDrag.value = true
    }
  }

  function onAreaDragLeave (event: DragEvent) {
    const area = event.currentTarget as HTMLElement
    if (!(event.relatedTarget instanceof Node) || !area.contains(event.relatedTarget)) {
      externalDrag.value = false
    }
  }

  function onAreaDrop (event: DragEvent) {
    const files = [...event.dataTransfer?.files ?? []]
    const external = externalDrag.value
    endDrag()
    if (canEdit.value && external && files.length > 0) {
      event.preventDefault()
      void upload(files)
    }
  }

  onMounted(() => {
    window.addEventListener('dragend', endDrag)
    void load()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('dragend', endDrag)
  })
</script>
