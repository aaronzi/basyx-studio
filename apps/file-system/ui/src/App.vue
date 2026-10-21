<template>
  <v-app>
    <!-- A frame Studio opened for a preview shows only the preview, over the dimmed page. -->
    <v-card-fullscreen
      v-if="previewMode"
      class="d-flex flex-column"
      color="transparent"
      data-test="preview"
      height="100vh"
      theme="dark"
    >
      <v-toolbar class="ps-3 flex-shrink-0" color="transparent">
        <template v-if="previewed">
          <v-icon :color="iconColorOf(previewed)" :icon="iconOf(previewed)" />
          <v-toolbar-title class="text-title-medium text-white" data-test="preview-name">{{ previewed.name }}</v-toolbar-title>
        </template>

        <v-spacer />

        <template v-if="previewed && !previewed.external">
          <v-btn
            :aria-label="t('fs.open')"
            color="white"
            data-test="preview-open"
            icon="mdi-open-in-new"
            @click="openFile(previewed, false)"
          />

          <v-btn :aria-label="t('fs.download')" color="white" icon="mdi-download" @click="openFile(previewed, true)" />
        </template>

        <v-btn
          :aria-label="t('preview.close')"
          color="white"
          data-test="preview-close"
          icon="mdi-close"
          @click="closePreview"
        />
      </v-toolbar>

      <file-preview
        v-if="previewed"
        :client="client"
        :file="previewed"
        :locale="locale"
        :submodel-id="submodelId"
        @close="closePreview"
        @download="openFile(previewed, true)"
      />

      <div v-else class="d-flex flex-grow-1 align-center justify-center" @click.self="closePreview">
        <v-progress-circular v-if="loading" color="primary" indeterminate size="64" />

        <v-sheet v-else class="pa-6" max-width="500" rounded="lg">
          <v-empty-state data-test="preview-error" icon="mdi-alert-circle" :text="loadError ?? t('preview.gone')" :title="t('preview.failedTitle')" />
        </v-sheet>
      </div>
    </v-card-fullscreen>

    <!-- Studio's card shows the view's title; in Studio's full-screen dialog, the card fills the frame. -->
    <v-view-card v-else :class="fullscreen ? 'd-flex flex-column' : undefined" :height="fullscreen ? '100vh' : undefined">
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
        :class="fullscreen ? 'flex-grow-1 overflow-hidden' : undefined"
        color="transparent"
        :height="fullscreen ? undefined : 560"
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
            :thumbnails="thumbnails"
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
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { putAttachmentMaxBytes, StudioError } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import FilePreview from './FilePreview.vue'
  import { childrenAt, findEntry, flatten, folders, iconColorOf, iconOf, isWithin, parentOf, previewKind, readFileSystem, trail } from './fileSystem'
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

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const fullscreen = computed(() => context.value.fullscreen ?? false)
  const canEdit = computed(() => (context.value.target?.write ?? false) && context.value.mode === 'edit')
  const submodelId = computed(() => context.value.submodel!.id)
  const writer = computed(() => new FileSystemWriter(props.client, submodelId.value))

  /** What the full-screen dialog opens with: the folder, and the file to preview. */
  interface ViewState { folder?: string, preview?: string }
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
  /** The file this frame previews: Studio opened it for that, without its header. */
  const previewPath = fullscreen.value ? (state.preview ?? null) : null
  const previewMode = previewPath !== null
  const selected = ref<Set<string>>(new Set())

  const tree = computed(() => submodel.value ? readFileSystem(submodel.value, locale.value) : [])
  const entries = computed(() => childrenAt(tree.value, folder.value))
  /** The selected entries, also in folders expanded in the list; inside a selected folder, only the folder. */
  const selectedEntries = computed(() => flatten(tree.value).filter(entry => selected.value.has(entry.path)
    && ![...selected.value].some(path => path !== entry.path && isWithin(entry.path, path))))
  const previewed = computed(() => {
    const entry = previewPath ? findEntry(tree.value, previewPath) : null
    return entry?.kind === 'file' ? entry : null
  })
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
   * Previews a file as the Web UI does, filling the window: Studio opens the
   * view again without its header, over the dimmed page, and that frame
   * shows only the preview.
   */
  function preview (entry: FileEntry) {
    void props.client.ui.openFullscreen(JSON.stringify({ folder: folder.value, preview: entry.path } satisfies ViewState), { header: false })
  }

  function closePreview () {
    void props.client.ui.closeFullscreen()
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

  // Thumbnails of the folder's images, read through Studio as the Web UI reads them.
  const thumbnails = ref<Record<string, string>>({})
  const thumbnailKeys = new Map<string, string>()
  watch(entries, async current => {
    if (previewMode) {
      return
    }
    for (const entry of current) {
      if (entry.kind !== 'file' || entry.external || previewKind(entry.contentType) !== 'image') {
        continue
      }
      const key = JSON.stringify(entry.element.value ?? null)
      if (thumbnailKeys.get(entry.path) === key) {
        continue
      }
      thumbnailKeys.set(entry.path, key)
      try {
        const content = await props.client.ui.readFile(submodelId.value, entry.path)
        const previous = thumbnails.value[entry.path]
        thumbnails.value = { ...thumbnails.value, [entry.path]: URL.createObjectURL(new Blob([content.bytes as BlobPart], { type: content.contentType || entry.contentType })) }
        if (previous) {
          URL.revokeObjectURL(previous)
        }
      } catch {
        // No thumbnail: the card shows the image icon.
      }
    }
  }, { immediate: true })
  onBeforeUnmount(() => {
    for (const url of Object.values(thumbnails.value)) URL.revokeObjectURL(url)
  })

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

  // The preview closes on Escape, as a dialog does; Studio's page does not get the frame's keys.
  function onKeydown (event: KeyboardEvent) {
    if (previewMode && event.key === 'Escape') {
      closePreview()
    }
  }

  onMounted(() => {
    window.addEventListener('dragend', endDrag)
    window.addEventListener('keydown', onKeydown)
    void load()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('dragend', endDrag)
    window.removeEventListener('keydown', onKeydown)
  })
</script>
