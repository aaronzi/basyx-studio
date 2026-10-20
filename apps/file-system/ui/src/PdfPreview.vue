<template>
  <div data-test="pdf-preview">
    <v-alert v-if="failed" :text="t('preview.pdfFailed')" type="warning" />

    <template v-else>
      <v-progress-linear v-if="!pages" />

      <canvas ref="canvas" :aria-label="t('preview.pdfPage', { page, pages: pages ?? 1 })" class="d-block w-100 h-auto border rounded" role="img" />

      <div v-if="pages && pages > 1" class="d-flex align-center justify-center ga-2 mt-2">
        <v-btn
          :aria-label="t('preview.previousPage')"
          data-test="pdf-previous"
          :disabled="page <= 1 || rendering"
          icon="mdi-chevron-left"
          @click="page--"
        />

        <span class="text-body-2" data-test="pdf-page">{{ t('preview.pdfPage', { page, pages }) }}</span>

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

  const canvas = ref<HTMLCanvasElement | null>(null)
  const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
  const pages = ref<number | null>(null)
  const page = ref(1)
  const failed = ref(false)
  const rendering = ref(false)
  let task: RenderTask | null = null

  /** Drawn this wide in CSS pixels at most, sharper on dense screens. */
  const maxWidth = 1200

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
      const width = Math.min(maxWidth, canvas.value.parentElement?.clientWidth || base.width)
      const viewport = pdfPage.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) })
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

  onBeforeUnmount(() => {
    task?.cancel()
    void pdfDocument.value?.loadingTask.destroy()
  })
</script>
