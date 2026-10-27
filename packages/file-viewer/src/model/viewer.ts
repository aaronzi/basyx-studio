import type { ModelViewerOptions } from './viewer-core.ts'
import { ifcParser } from './ifc.ts'
import { stepParser } from './step.ts'
import { ModelViewer as ViewerCore } from './viewer-core.ts'

// The viewer with every format: STL, OBJ, glTF, IFC and STEP. An app that
// needs fewer registers its parsers with `@basyx/file-viewer/model/viewer/core`,
// so its build leaves the others' WebAssembly out.

export * from './viewer-core.ts'

/** The IFC and STEP parsers, which `@basyx/file-viewer/model/viewer` and `/vue` register. */
export const allParsers = [ifcParser, stepParser] as const

export class ModelViewer extends ViewerCore {
  constructor (container: HTMLElement, options: ModelViewerOptions) {
    super(container, { parsers: allParsers, ...options })
  }
}
