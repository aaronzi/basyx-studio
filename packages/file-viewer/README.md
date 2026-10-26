# @basyx/file-viewer

The file viewer of BaSyx Studio and its apps
([ADR 0052](../../docs/adr/0052-one-file-viewer-for-studio-and-apps.md)):

- images, an SVG also as its source;
- PDFs, with PDF.js;
- text in Monaco, Markdown rendered and sanitized, and CSV as a table;
- 3D models: STL, OBJ, glTF and GLB with three.js, IFC with web-ifc and
  STEP with occt-import-js (OpenCascade, LGPL-2.1), parsed in a worker
  ([ADR 0039](../../docs/adr/0039-3d-viewer-libraries.md));
- audio and video.

Studio shows every file this way, and apps use the same components.

```ts
// What a file is shown as, without Vue: before reading it, e.g. for an icon.
import { detectModelFormat, detectViewerKind, viewerKindIcon } from '@basyx/file-viewer'
// Once per app: the locale (and Monaco, where texts should be highlighted).
import { FileThumbnail, provideFileViewer, useFileViewerState, withCachedContent } from '@basyx/file-viewer/vue'
// The viewer itself; it brings PDF.js and the 3D viewer along.
import { FileViewer } from '@basyx/file-viewer/viewer'

provideFileViewer({ locale: () => client.context.locale })

const source = withCachedContent({
  key: path,
  name: 'manual.pdf',
  contentType: 'application/pdf',
  load: () => client.ui.readFile(submodelId, path),
})
const state = useFileViewerState(source)
```

```vue
<FileThumbnail :source="source" />
<FileViewer :state="state" />
```

In Studio, `client.ui.previewFile(submodelId, idShortPath)` shows a File or
Blob element in Studio's own full-screen viewer, so an app needs neither
component for that.

| Entry | What |
| --- | --- |
| `.` | What a file is shown as (`detectViewerKind`, `detectModelFormat`), text and CSV, without Vue or three.js |
| `./vue` | `provideFileViewer`, the state of a file, `FileThumbnail`: light, without PDF.js or three.js |
| `./viewer` | `FileViewer`, for every kind of file |
| `./model` | The 3D view in parts for an app's own frame: `useModelView`, `ModelCanvas`, `ModelElementPanel` |
| `./model/vue`, `./model/viewer` | The 3D viewer with every format: `useModelViewer` (Vue, no UI) or `ModelViewer` (no Vue) |
| `./model/vue/core`, `./model/viewer/core` | The same with STL, OBJ, glTF and GLB, and the parsers passed as `parsers` |
| `./model/ifc`, `./model/step` | `ifcParser` (web-ifc, MPL-2.0) and `stepParser` (occt-import-js, LGPL-2.1), each with its worker and WebAssembly |
| `./markdown`, `./monaco`, `./pdf` | Markdown rendering, Monaco's languages, PDF.js |

`./vue` stays light: thumbnails and the state only. `./viewer` loads PDF.js
and the 3D viewer when a file needs them, so a build that imports it holds
them. The components import the Vuetify components they use, so an app need
not register them; the published package holds them built, with Vue,
Vuetify and the libraries as imports. Vue and Vuetify are needed only for
the Vue entries.

## The 3D view in an app's own frame

An app that draws its own frame around the 3D view, as the 3D Models app
does, takes its parts from `./model`:

```ts
import { ModelCanvas, ModelElementPanel, useModelView } from '@basyx/file-viewer/model'

const view = useModelView(() => theme)
await view.load(async () => (await client.ui.readFile(submodelId, path)).bytes, 'ifc')
```

```vue
<v-responsive :aspect-ratio="4 / 3"><ModelCanvas :view="view" /></v-responsive>
<ModelElementPanel :view="view" />
```

## Only the formats an app needs

IFC and STEP are parsed with WebAssembly in a worker: web-ifc's module is
about 1.6 MB, occt-import-js's 7.6 MB of the 20 MiB an app package may
hold. `./viewer`, `./model`, `./model/vue` and `./model/viewer` register
both parsers, so every build that uses them holds both. An app that needs
fewer uses the viewer without parsers and registers its own:

```ts
import { ifcParser } from '@basyx/file-viewer/model/ifc'
import { useModelViewer } from '@basyx/file-viewer/model/vue/core'

const viewer = useModelViewer(container, () => theme, { parsers: [ifcParser] })
// Without Vue:
import { ModelViewer } from '@basyx/file-viewer/model/viewer/core'
new ModelViewer(container, { theme, parsers: [ifcParser] })
```

Only the registered parsers' workers and WebAssembly are part of the build.
A file in a format whose parser is not registered fails with the code
`format` (`ModelViewerError`, or `problem.code` of `useModelViewer`).
[`examples/apps/inventory`](../../examples/apps/inventory) registers only
`ifcParser`.

## Building with it

The 3D viewer imports its WebAssembly files and its worker as Vite assets
(`?url`, `?worker&url`), so an app that uses it is built with Vite. In a
Studio app, the `studioApp()` preset of `@basyx/studio-app-kit/vite` does
the rest:

- the app's manifest declares `sandbox: { webAssembly: true, workers: true }`
  ([ADR 0038](../../docs/adr/0038-webassembly-workers-and-file-reads-for-apps.md));
- occt-import-js is built without `new Function`, which an app frame's
  Content Security Policy forbids, also in the STEP worker;
- workers are ES modules;
- in the dev server, the package is not pre-bundled, and its CommonJS
  dependency occt-import-js is.

The app reads a file's bytes with `client.ui.readFile(submodelId,
idShortPath)` and hands them to the viewer.

Versions follow `@basyx/studio-sdk` ([version table](../studio-sdk/README.md#versions)).
