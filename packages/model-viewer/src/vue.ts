import type { ViewerTheme } from './viewer-core.ts'
import type { UseModelViewerOptions } from './vue-core.ts'
import type { Ref } from 'vue'
import { ifcParser } from './ifc.ts'
import { stepParser } from './step.ts'
import { useModelViewer as useViewerCore } from './vue-core.ts'

// The viewer in a Vue component with every format. An app that needs fewer
// registers its parsers with `@basyx/model-viewer/vue/core`, so its build
// leaves the others' WebAssembly out.

export * from './vue-core.ts'

export function useModelViewer (container: Ref<HTMLElement | null | undefined>, theme: () => ViewerTheme, options: UseModelViewerOptions = {}) {
  return useViewerCore(container, theme, { parsers: [ifcParser, stepParser], ...options })
}
