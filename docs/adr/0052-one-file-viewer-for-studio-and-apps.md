# 0052: One file viewer for Studio and its apps

- Status: Proposed
- Date: 2026-10-26
- Deciders: BaSyx Studio maintainers
- Amends: [ADR 0050](0050-pdfjs-for-the-file-system-view.md) (PDF.js moves
  from the *Files* app into a shared package, also used by Studio)
- Decides: [issue 101](https://github.com/eclipse-basyx/basyx-studio/issues/101)

## Context

File elements were shown in several ways:

- The details pane drew images inline and opened everything else in a new
  tab. In Electron, a new tab goes to the system browser, which has no Studio
  session.
- The Visualization tab had a 3D view of its own.
- The *Files* app had its own previews: PDF.js, plain text, audio and video.
- The *Handover Documentation* app only opened files in a new tab.
- The *3D Models* app drew its own preview images.

Text files (Markdown, JSON, XML, CSV, code, logs) had no preview at all, and
Blobs showed only images. Each place loaded files its own way, and no two
looked alike.

## Decision

- **One package, `@basyx/file-viewer`** (MIT), which holds the 3D viewer of
  ADR 0039 (`src/model`), shows every kind of file. Its entry points:
  - `.`: what a file is shown as (`detectViewerKind`, refined by the bytes'
    signature, and `detectModelFormat`), text decoding and encoding, and
    CSV, without Vue or three.js.
  - `./vue`: `provideFileViewer()`, a viewer state per file, and
    `FileThumbnail`. It stays light, without PDF.js or three.js.
  - `./viewer`: `FileViewer`, which shows images (an SVG also as source),
    PDFs (PDF.js), text in Monaco, rendered Markdown, CSV as a table, 3D
    models, audio and video.
  - `./model`: the 3D view in parts (`useModelView`, `ModelCanvas`,
    `ModelElementPanel`) for an app that draws its own frame around it. The
    *3D Models* app keeps its card, controls and preview toggle, and takes
    the canvas, the loading state, the picked IFC element and the problem
    texts from here, as Studio's file view does.
  - `./model/vue`, `./model/viewer` (and `/core` without parsers),
    `./model/ifc`, `./model/step`: the 3D engine of ADR 0039, unchanged
    (`useModelViewer`, `ModelViewer`, the IFC and STEP parsers), for apps
    with a 3D UI of their own.
  - `./markdown`: Markdown rendering. `./monaco`: the languages Monaco needs.
  - `./pdf`: PDF.js.
- **Vue and Vuetify are optional peer dependencies**: the core and the 3D
  engine without Vue (`./model/viewer`) run without them.
- **Its components import the Vuetify components they use**, so they run in
  Studio and in apps without registration. In the workspace, Studio and the
  bundled apps compile them from source; for publishing, `tsc` builds the
  core and a Vite library build the Vue entries, with declarations from
  `vue-tsc`, so the package holds built output only (ADR 0043), as
  `scripts/check-app-tarballs.mjs` checks. Vue, Vuetify and the libraries
  stay imports. The texts come with the package in Studio's seven locales;
  the host passes its locale.
- **The host loads Monaco** (`provideFileViewer({ monaco })`), because only
  its bundler can load Monaco's workers. Studio passes its own setup. An app
  without Monaco shows texts without highlighting.
- **A file comes from a source** that the host builds:
  `{ key, name, contentType, external, load, save?, draft? }`. The viewer
  fetches nothing itself.
  - In Studio, an internal File comes from the attachment route.
  - An external File comes from its address, in the browser first and then
    through Studio's server (ADR 0042).
  - A Blob comes from its value.
  - Apps use `studio.ui.readFile` and `readExternalFile`.
- **One state per file** is shared by every place that shows it, so a
  thumbnail, the inline view and the full-screen dialog read the bytes once
  and keep the page, the view and unsaved text.
- **In Studio, the details tab describes the element and the Visualization
  tab renders it.**
  - The File and Blob card shows the file's details and a thumbnail, with
    "Show preview" and full screen. No viewer starts there.
  - The Visualization tab's first view is Studio's file view, which
    generalizes the former 3D-only view (`view=studio:model-3d` opens it).
- **There is exactly one full-screen file dialog: Studio's.** It opens from
  the details card, the file view, and from apps with the new app method
  **`studio.ui.previewFile`** (permission `studio.aas.read`, Studio app API
  0.1.12).
  - Studio reads the element as the user and applies its own rules in the
    dialog.
  - `studio.ui.openFullscreen` remains for showing a whole app view
    full-screen.
- **Editing text:**
  - Who may edit: in Studio's edit mode, users who may change the content
    can edit text. For a File that needs uploads, for a Blob structural
    writes. External files stay read-only.
  - How it is saved: back in the file's encoding, with the element's
    revision. A conflict offers to load the current version, download your
    own, or save it anyway.
  - Unsaved text is kept like editor drafts (ADR 0006) and is counted in the
    app bar.
- **Security:**
  - Markdown is rendered without raw HTML (markdown-it `html: false`) and
    sanitized by DOMPurify.
  - Only http(s) and mailto links remain, and they open without a referrer.
  - Images load only from `data:` URLs; one at an address becomes a link.
  - HTML is shown only as source, and SVG only as an image, so none of its
    scripts run.
  - The attachment route's headers do not change.

## Consequences

- Text files, PDFs and Blobs now preview where only images did. PDFs work
  the same in browsers and Electron.
- The *Files* app drops its own preview and PDF.js (its package shrinks by
  about 4 MB). The *3D Models* app drops its own 3D view code and texts and
  looks as before. *Files* and *Handover Documentation* need app API 0.1.12 for
  `previewFile`.
- New dependencies that need Eclipse IP review: `markdown-it` (MIT) and
  `dompurify` (Apache-2.0 / MPL-2.0). `pdfjs-dist` (ADR 0050) is now also a
  dependency of Studio.
- A build that imports `./viewer`, `./model` or `./model/vue` holds the 3D
  viewer's WebAssembly parsers. Apps that only need thumbnails import
  `./vue`; apps that need fewer formats register their parsers with
  `./model/vue/core` or `./model/viewer/core`.
- BaSyx Go drops the `charset` of a File's content type, so 8-bit texts are
  decoded as windows-1252 when they are not valid UTF-8.

## Alternatives considered

- **The browser's PDF viewer in a frame:** less code, but app frames forbid
  frames and objects, and Electron's viewer is not the browser's.
- **Previews in the details tab only:** simpler, but cramped for editing,
  paging and 3D, and it would start a heavy viewer for every selected file.
- **Apps draw their own full-screen previews:** each app would need the
  viewer's full size and dependencies, and dialogs would differ per app.
