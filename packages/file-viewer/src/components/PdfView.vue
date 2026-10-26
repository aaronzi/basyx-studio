<template>
  <div class="d-flex flex-column flex-grow-1 overflow-hidden" data-test="file-viewer-pdf">
    <v-alert v-if="failed" class="ma-4" :text="t('pdf.failed')" type="warning" />

    <template v-else>
      <v-progress-linear v-if="!pages" class="flex-shrink-0" indeterminate />

      <!-- Fitted, the page fills the space by its width or height; zoomed in, the area scrolls. -->
      <div
        ref="area"
        class="d-flex flex-grow-1 pa-4"
        :class="zoom > 1 ? 'overflow-auto' : 'align-center justify-center overflow-hidden'"
      >
        <!-- Zoomed in, the sheet gives the page its size in CSS pixels. -->
        <v-sheet
          v-if="zoom > 1"
          border
          class="flex-shrink-0 ma-auto"
          color="white"
          :height="cssSize.height"
          rounded
          :width="cssSize.width"
        >
          <canvas
            ref="canvas"
            :aria-label="t('pdf.page', { page: state.page.value, pages: pages ?? 1 })"
            class="d-block w-100 h-100"
            role="img"
          />
        </v-sheet>

        <canvas
          v-else
          ref="canvas"
          :aria-label="t('pdf.page', { page: state.page.value, pages: pages ?? 1 })"
          class="d-block border rounded bg-white"
          :class="fitHeight ? 'h-100 w-auto' : 'w-100 h-auto'"
          role="img"
        />
      </div>

      <div class="d-flex align-center justify-center ga-2 py-2 flex-shrink-0">
        <template v-if="pages && pages > 1">
          <v-btn
            :aria-label="t('pdf.previous')"
            data-test="pdf-previous"
            :disabled="state.page.value <= 1 || rendering"
            icon="mdi-chevron-left"
            size="small"
            @click="state.setPage(state.page.value - 1)"
          />

          <span class="text-body-medium" data-test="pdf-page">{{ t('pdf.page', { page: state.page.value, pages }) }}</span>

          <v-btn
            :aria-label="t('pdf.next')"
            data-test="pdf-next"
            :disabled="state.page.value >= pages || rendering"
            icon="mdi-chevron-right"
            size="small"
            @click="state.setPage(state.page.value + 1)"
          />

          <v-divider class="mx-2" vertical />
        </template>

        <v-btn
          v-tooltip="t('pdf.zoomOut')"
          :aria-label="t('pdf.zoomOut')"
          :disabled="zoom <= 1"
          icon="mdi-magnify-minus-outline"
          size="small"
          @click="zoom = Math.max(1, zoom / 1.25)"
        />

        <v-btn
          v-tooltip="t('pdf.fit')"
          :aria-label="t('pdf.fit')"
          :disabled="zoom === 1"
          icon="mdi-fit-to-page-outline"
          size="small"
          @click="zoom = 1"
        />

        <v-btn
          v-tooltip="t('pdf.zoomIn')"
          :aria-label="t('pdf.zoomIn')"
          :disabled="zoom >= 4"
          icon="mdi-magnify-plus-outline"
          size="small"
          @click="zoom = Math.min(4, zoom * 1.25)"
        />
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { PDFDocumentProxy, RenderTask } from '../pdf.ts'
  import type { FileViewerState } from '../state.ts'
  import { nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
  import { VAlert } from 'vuetify/components/VAlert'
  import { VBtn } from 'vuetify/components/VBtn'
  import { VDivider } from 'vuetify/components/VDivider'
  import { VProgressLinear } from 'vuetify/components/VProgressLinear'
  import { VSheet } from 'vuetify/components/VSheet'
  import { useFileViewerContext } from '../i18n.ts'

  // One page of a PDF at a time, drawn on a canvas by PDF.js (ADR 0050,
  // ADR 0052): neither app frames nor Electron may embed the browser's own
  // PDF viewer. The page is the state's, so the full-screen view opens where
  // the inline one was.
  const props = defineProps<{ bytes: Uint8Array, state: FileViewerState }>()

  const { t } = useFileViewerContext()
  const area = useTemplateRef<HTMLElement>('area')
  const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
  /** The page is as tall as the area, and narrower than it. */
  const fitHeight = ref(false)
  const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
  const pages = ref<number | null>(null)
  /** 1 fits the page into the view; more enlarges it. */
  const zoom = ref(1)
  const cssSize = ref({ width: 0, height: 0 })
  const failed = ref(false)
  const rendering = ref(false)
  let task: RenderTask | null = null

  async function render () {
    const pdf = pdfDocument.value
    if (!pdf || !canvas.value) {
      return
    }
    task?.cancel()
    rendering.value = true
    try {
      const page = Math.min(Math.max(1, props.state.page.value), pdf.numPages)
      const pdfPage = await pdf.getPage(page)
      const base = pdfPage.getViewport({ scale: 1 })
      // The area's content box: its padding (pa-4) is 16 px on each side.
      const width = Math.max(1, (area.value?.clientWidth || base.width) - 32)
      const height = Math.max(0, (area.value?.clientHeight || 0) - 32)
      // Without a height of its own (in a flowing layout), the page takes the width.
      const fit = height > 0 ? Math.min(width / base.width, height / base.height) : width / base.width
      fitHeight.value = height > 0 && height / base.height < width / base.width
      const scale = fit * zoom.value
      const viewport = pdfPage.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
      canvas.value.width = Math.floor(viewport.width)
      canvas.value.height = Math.floor(viewport.height)
      cssSize.value = { width: Math.floor(base.width * scale), height: Math.floor(base.height * scale) }
      task = pdfPage.render({ canvas: canvas.value, viewport })
      await task.promise
    } catch (error) {
      if ((error as { name?: string }).name !== 'RenderingCancelledException') {
        failed.value = true
      }
    } finally {
      rendering.value = false
    }
  }

  watch(() => props.bytes, async bytes => {
    failed.value = false
    pages.value = null
    await pdfDocument.value?.loadingTask.destroy()
    pdfDocument.value = null
    try {
      const { openPdf } = await import('../pdf.ts')
      // PDF.js takes over the buffer it is given.
      const pdf = await openPdf(bytes.slice())
      if (bytes !== props.bytes) {
        await pdf.loadingTask.destroy()
        return
      }
      pdfDocument.value = pdf
      pages.value = pdf.numPages
      await render()
    } catch {
      failed.value = true
    }
  }, { immediate: true })

  watch(() => props.state.page.value, render)
  // Zooming swaps the canvas (fitted or in its sheet): draw once the new one is there.
  watch(zoom, () => nextTick(render))

  // Drawn again for the space it has after the dialog or window changed size.
  let resized: ReturnType<typeof setTimeout> | undefined
  const observer = new ResizeObserver(() => {
    clearTimeout(resized)
    resized = setTimeout(() => void render(), 150)
  })
  watch(area, (element, previous) => {
    if (previous) {
      observer.unobserve(previous)
    }
    if (element) {
      observer.observe(element)
    }
  })

  onBeforeUnmount(() => {
    observer.disconnect()
    clearTimeout(resized)
    task?.cancel()
    void pdfDocument.value?.loadingTask.destroy()
  })
</script>
