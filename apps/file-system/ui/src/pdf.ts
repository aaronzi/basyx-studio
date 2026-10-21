import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument } from 'pdfjs-dist'
import * as worker from 'pdfjs-dist/build/pdf.worker.min.mjs'

// PDF.js (ADR 0050), loaded only when a PDF is shown. It parses on the
// page instead of in a worker, so the app needs no `workers` sandbox: PDF.js
// takes the worker's message handler from `globalThis.pdfjsWorker`. PDF.js 6
// uses no `eval`; without `wasmUrl` it loads no WebAssembly decoders, and it
// fetches nothing: the bytes come from `studio.ui.readFile`.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker

export function openPdf (bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes, useWorkerFetch: false, stopAtErrors: false }).promise
}
