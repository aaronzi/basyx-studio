<template>
  <div class="d-flex flex-column h-100" data-test="pdf-preview">
    <v-alert v-if="failed" :text="t('preview.pdfFailed')" type="warning" />

    <template v-else>
      <v-progress-linear v-if="!pages" />

      <!-- The page fits the space: by its width, or by its height where that is the tighter one. -->
      <div ref="area" class="d-flex flex-grow-1 align-center justify-center overflow-hidden">
        <canvas
          ref="canvas"
          :aria-label="t('preview.pdfPage', { page, pages: pages ?? 1 })"
          class="d-block border rounded bg-white"
          :class="fitHeight ? 'h-100 w-auto' : 'w-100 h-auto'"
          role="img"
        />
      </div>

      <div v-if="pages && pages > 1" class="d-flex align-center justify-center ga-2 mt-2">
        <v-btn
          :aria-label="t('preview.previousPage')"
          data-test="pdf-previous"
          :disabled="page <= 1 || rendering"
          icon="mdi-chevron-left"
          @click="page--"
        />

        <span class="text-body-medium" data-test="pdf-page">{{ t('preview.pdfPage', { page, pages }) }}</span>

        <v-btn
          :aria-label="t('preview.nextPage')"
          data-test="pdf-next"
          :disabled="page >= pages || rendering"
          icon="mdi-chevron-right"
          @click="page++"
        />
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
  import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
  import { useI18n } from './i18n'

  // One page of a PDF at a time, drawn on a canvas by PDF.js (ADR 0050):
  // an app frame may not embed the browser's own PDF viewer.
  const props = defineProps<{ bytes: Uint8Array }>()
  const { t } = useI18n()

  const area = ref<HTMLElement | null>(null)
  const canvas = ref<HTMLCanvasElement | null>(null)
  /** The page is as tall as the area, and narrower than it. */
  const fitHeight = ref(false)
  const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
  const pages = ref<number | null>(null)
  const page = ref(1)
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
      const pdfPage = await pdf.getPage(page.value)
      const base = pdfPage.getViewport({ scale: 1 })
      const width = area.value?.clientWidth || base.width
      const height = area.value?.clientHeight || 0
      // Without a height of its own (in a flowing layout), the page takes the width.
      const scale = height > 0 ? Math.min(width / base.width, height / base.height) : width / base.width
      fitHeight.value = height > 0 && height / base.height < width / base.width
      const viewport = pdfPage.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
      canvas.value.width = Math.floor(viewport.width)
      canvas.value.height = Math.floor(viewport.height)
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
    page.value = 1
    await pdfDocument.value?.loadingTask.destroy()
    pdfDocument.value = null
    try {
      const { openPdf } = await import('./pdf')
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

  watch(page, render)

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
