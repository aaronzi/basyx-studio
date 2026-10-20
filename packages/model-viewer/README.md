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

## Building with it

The viewer imports its WebAssembly files and its worker as Vite assets
(`?url`, `?worker&url`), so an app that uses it is built with Vite. In a
Studio app, the `studioApp()` preset of `@basyx/studio-app-kit/vite` does
the rest:

- the app's manifest declares `sandbox: { webAssembly: true, workers: true }`
  ([ADR 0038](../../docs/adr/0038-webassembly-workers-and-file-reads-for-apps.md));
- occt-import-js is built without `new Function`, which an app frame's
  Content Security Policy forbids, also in the worker;
- workers are ES modules;
- in the dev server, the viewer is not pre-bundled, and its CommonJS
  dependency occt-import-js is.

The app reads a model's bytes with `client.ui.readFile(submodelId,
idShortPath)` and hands them to the viewer.

Versions follow `@basyx/studio-sdk` ([version table](../studio-sdk/README.md#versions)).
