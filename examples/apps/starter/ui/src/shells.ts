import type { ModelFormat } from '@basyx/model-viewer'
import type { Node } from '@basyx/studio-app-kit/aas'
import type { JsonObject } from '@basyx/studio-sdk'
import { detectViewerKind, viewerKindIcon } from '@basyx/file-viewer'
import { detectModelFormat } from '@basyx/model-viewer'
import { childrenOf } from '@basyx/studio-app-kit/aas'

// What the app shows, without Vue: unit-tested in test/.

export interface ModelFile {
  /** idShortPath in the submodel, for `client.ui.readFile`. */
  path: string
  fileName: string
  format: ModelFormat
  /** The file's icon, as Studio's file viewer shows it (`@basyx/file-viewer`). */
  icon: string
}

/** Every File element of a submodel that holds a 3D model `@basyx/model-viewer` reads. */
export function modelFiles (submodel: JsonObject): ModelFile[] {
  const found: ModelFile[] = []
  const visit = (node: Node | JsonObject) => {
    for (const child of childrenOf(node)) {
      const { element } = child
      if (element.modelType === 'File' && typeof element.value === 'string') {
        const file = { contentType: element.contentType as string | undefined, fileName: element.value }
        const format = detectModelFormat(file)
        if (format) {
          found.push({ path: child.path, fileName: element.value.split('/').pop() ?? element.value, format, icon: viewerKindIcon(detectViewerKind(file)) })
        }
      }
      visit(child)
    }
  }
  visit(submodel)
  return found
}

// The module's sub-path is its own route: `` or `shells/<key>`, with the
// shell ID as base64url, since IDs hold slashes and colons.

export function shellPath (shellId: string): string {
  const key = btoa(String.fromCodePoint(...new TextEncoder().encode(shellId))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `shells/${key}`
}

export function shellIdOf (subPath: string): string | null {
  const key = /^shells\/([\w-]+)$/.exec(subPath)?.[1]
  if (!key) {
    return null
  }
  const binary = atob(key.replaceAll('-', '+').replaceAll('_', '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.codePointAt(0)!))
}
