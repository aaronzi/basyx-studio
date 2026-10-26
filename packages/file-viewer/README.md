# @basyx/file-viewer

The file viewer of BaSyx Studio and its apps
([ADR 0052](../../docs/adr/0052-one-file-viewer-for-studio-and-apps.md)):

- images, an SVG also as its source;
- PDFs, with PDF.js;
- text in Monaco, Markdown rendered and sanitized, and CSV as a table;
- 3D models, with `@basyx/model-viewer`;
- audio and video.

Studio shows every file this way, and apps use the same components.

```ts
// What a file is shown as, without Vue: before reading it, e.g. for an icon.
import { detectViewerKind, viewerKindIcon } from '@basyx/file-viewer'
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

`./vue` stays light: thumbnails and the state only. `./viewer` loads PDF.js
and the 3D viewer when a file needs them, so a build that imports it holds
them. The components import the Vuetify components they use, so an app need
not register them; the published package holds them built, with Vue,
Vuetify and the libraries as imports.
