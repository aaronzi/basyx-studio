import type { ModelParser } from './types.ts'
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'
import workerUrl from './parsers/step.worker?worker&url'

// STEP with occt-import-js (OpenCascade, LGPL-2.1): register `stepParser`
// with the viewer of `@basyx/model-viewer/viewer/core` or `/vue/core`. Its
// WebAssembly module is 7.6 MB.

export const stepParser: ModelParser = {
  format: 'step',
  workerUrl,
  wasmUrl,
  open: async () => (await import('./parsers/step.ts')).openStep,
}
