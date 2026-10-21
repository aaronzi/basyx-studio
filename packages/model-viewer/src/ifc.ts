import type { ModelParser } from './types.ts'
import wasmUrl from 'web-ifc/web-ifc.wasm?url'
import workerUrl from './parsers/ifc.worker?worker&url'

// IFC with web-ifc (MPL-2.0): register `ifcParser` with the viewer of
// `@basyx/model-viewer/viewer/core` or `/vue/core`.

export const ifcParser: ModelParser = {
  format: 'ifc',
  workerUrl,
  wasmUrl,
  open: async () => (await import('./parsers/ifc.ts')).openIfc,
}
