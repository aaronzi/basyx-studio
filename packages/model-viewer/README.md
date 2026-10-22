# @basyx/model-viewer

The 3D viewer of BaSyx Studio and its apps: STL, OBJ, glTF and GLB with
three.js, IFC with web-ifc and STEP with occt-import-js (OpenCascade,
LGPL-2.1), parsed in a worker ([ADR 0039](../../docs/adr/0039-3d-viewer-libraries.md)).

```ts
import { detectModelFormat } from '@basyx/model-viewer'
// Vue: the viewer's life in a component; Studio's apps draw their own controls.
import { useModelViewer } from '@basyx/model-viewer/vue'
// Without Vue: `new ModelViewer(container, { theme })`.
import { ModelViewer } from '@basyx/model-viewer/viewer'
```

`@basyx/model-viewer` reads which files it shows without loading three.js;
`./viewer` and `./vue` load the renderer.

## Only the formats an app needs

IFC and STEP are parsed with WebAssembly in a worker: web-ifc's module is
about 1.6 MB, occt-import-js's 7.6 MB of the 20 MiB an app package may
hold. `./viewer` and `./vue` register both parsers, so every build that
uses them holds both. An app that needs fewer imports the viewer without
parsers and registers its own:

```ts
import { ifcParser } from '@basyx/model-viewer/ifc'
import { useModelViewer } from '@basyx/model-viewer/vue/core'

const viewer = useModelViewer(container, () => theme, { parsers: [ifcParser] })
// Without Vue:
import { ModelViewer } from '@basyx/model-viewer/viewer/core'
new ModelViewer(container, { theme, parsers: [ifcParser] })
```

| Entry | What |
| --- | --- |
| `./viewer/core`, `./vue/core` | The viewer with STL, OBJ, glTF and GLB, and the parsers passed as `parsers` |
| `./ifc` | `ifcParser`: IFC with web-ifc (MPL-2.0), its worker and WebAssembly |
| `./step` | `stepParser`: STEP with occt-import-js (LGPL-2.1), its worker and WebAssembly |
| `./viewer`, `./vue` | The viewer with both parsers, as before |

Only the registered parsers' workers and WebAssembly are part of the
build. A file in a format whose parser is not registered fails with the
code `format` (`ModelViewerError`, or `problem.code` of `useModelViewer`).
[`examples/apps/inventory`](../../examples/apps/inventory) registers only
`ifcParser`. Existing imports of `./viewer` and `./vue` need no change.

## Building with it

The viewer imports its WebAssembly files and its worker as Vite assets
(`?url`, `?worker&url`), so an app that uses it is built with Vite. In a
Studio app, the `studioApp()` preset of `@basyx/studio-app-kit/vite` does
the rest:

- the app's manifest declares `sandbox: { webAssembly: true, workers: true }`
  ([ADR 0038](../../docs/adr/0038-webassembly-workers-and-file-reads-for-apps.md));
- occt-import-js is built without `new Function`, which an app frame's
  Content Security Policy forbids, also in the STEP worker;
- workers are ES modules;
- in the dev server, the viewer is not pre-bundled, and its CommonJS
  dependency occt-import-js is.

The app reads a model's bytes with `client.ui.readFile(submodelId,
idShortPath)` and hands them to the viewer.

Versions follow `@basyx/studio-sdk` ([version table](../studio-sdk/README.md#versions)).
