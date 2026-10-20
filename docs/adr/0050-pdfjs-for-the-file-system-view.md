# 0050: PDF.js for the FileSystem view's PDF preview

- Status: Proposed
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Requirements: PROD-001, ARCH-002, ARCH-005

## Context

The bundled *Files* app shows the FileSystem submodel of the BaSyx AAS
Web UI's FileSystem plugin (X3 of the
[external apps plan](../development/external-apps-plan.md)) with a preview of
the selected file. Images, text, audio and video show from the bytes that
`studio.ui.readFile` returns. PDFs do not: an app frame's policy has
`frame-src 'none'` and `object-src 'none'` (ADR 0017), so the browser's own
PDF viewer cannot be embedded, not even for a `blob:` URL. Studio's own
details drawer opens PDFs in a new tab instead.

## Decision

- The app draws PDFs with **PDF.js 6.4** (`pdfjs-dist`, Apache-2.0), one page
  at a time on a canvas, with buttons for the previous and next page.
- It is a dependency of `apps/file-system` only, not of Studio, and loaded as
  a chunk of its own when a PDF is shown.
- PDF.js parses on the page: the app sets `globalThis.pdfjsWorker` to the
  worker build's message handler, so the manifest needs no `workers`
  sandbox. PDF.js 6 uses no `eval`. Without `wasmUrl` it loads no
  WebAssembly decoders, so no `webAssembly` sandbox is needed either; it
  fetches nothing, because the bytes come from `studio.ui.readFile`.
- The optional native dependency `@napi-rs/canvas`, which PDF.js uses only in
  Node.js, is not part of the app's bundle.

## Consequences

- The app's package grows by about 500 KB (gzip) for the PDF.js chunk.
- PDFs whose images use JPEG 2000 or JBIG2 show those images blank, and
  fonts that are neither embedded nor available on the user's system fall
  back to similar ones. The view still offers to open or download the file.
- A large PDF is parsed on the page, so the view may pause while the first
  page renders. A worker can follow, with the `workers` sandbox, if this is
  noticeable.
- The library needs Eclipse IP review, as the libraries of ADR 0034,
  ADR 0039 and ADR 0041 did.

## Alternatives considered

- **Open PDFs in a new tab only:** works today (`studio.ui.openFile`), but
  the preview is what the view is for, and the Web UI's plugin previews
  PDFs.
- **A `frameOrigins` or `object-src` exception for `blob:`:** would let any
  app embed content the browser renders outside the app's policy; ADR 0045
  allows https origins only.
- **Rendering on Studio's server:** needs a PDF renderer in the Studio
  service for one view, and sends every preview through it.
