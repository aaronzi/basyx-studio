// Hosts compile this file with their own tsconfig, which does not include the
// worker's declarations; an import cannot bring ambient ones.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pdf-worker.d.ts" />
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument } from 'pdfjs-dist'
import * as worker from 'pdfjs-dist/build/pdf.worker.min.mjs'

// PDF.js (ADR 0050, ADR 0052), loaded only when a PDF is shown. It parses
// on the page instead of in a worker, so an app frame needs no `workers`
// sandbox: PDF.js takes the worker's message handler from
// `globalThis.pdfjsWorker`. PDF.js 6 uses no `eval`; without `wasmUrl` it
// loads no WebAssembly decoders, and it fetches nothing: the bytes come from
// the file source.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker

export type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/** Opens a PDF; PDF.js takes over the buffer, so pass a copy of bytes kept elsewhere. */
export function openPdf (bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes, useWorkerFetch: false, stopAtErrors: false }).promise
}
