import type { Node } from '@basyx/studio-app-kit/aas'
import type { JsonObject, ShellSummary, StudioClient } from '@basyx/studio-sdk'
import { detectModelFormat } from '@basyx/file-viewer'
import { childrenOf } from '@basyx/studio-app-kit/aas'

// What the pages show, without Vue: unit-tested in Studio's test/apps.

/** Shells read for the overview and the list; a larger target shows the first ones. */
export const shellLimit = 1000

/** The first `shellLimit` shells of the target, page by page; `complete` is false if there are more. */
export async function loadShells (client: StudioClient): Promise<{ shells: ShellSummary[], complete: boolean }> {
  const shells: ShellSummary[] = []
  let cursor: string | undefined
  while (shells.length < shellLimit) {
    const { items, page } = await client.aas.listShells({ limit: 100, ...(cursor ? { cursor } : {}) })
    shells.push(...items)
    if (!page.hasMore || !page.nextCursor) {
      return { shells, complete: true }
    }
    cursor = page.nextCursor
  }
  return { shells: shells.slice(0, shellLimit), complete: false }
}

export interface ShellCounts {
  shells: number
  instances: number
  types: number
}

export function countShells (shells: ShellSummary[]): ShellCounts {
  return {
    shells: shells.length,
    instances: shells.filter(shell => shell.assetKind === 'Instance').length,
    types: shells.filter(shell => shell.assetKind === 'Type').length,
  }
}

// A shell's page is the route `/shells/<key>`, with the shell ID as
// base64url: Studio's sub-paths are segments of letters, digits and `-._~`.

export function shellKey (shellId: string): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(shellId))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function shellIdOf (key: string): string | null {
  if (!/^[\w-]+$/.test(key)) {
    return null
  }
  try {
    const binary = atob(key.replaceAll('-', '+').replaceAll('_', '/'))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.codePointAt(0)!))
  } catch {
    return null
  }
}

export interface IfcModel {
  /** idShortPath in the submodel, for `client.ui.readFile`. */
  path: string
  fileName: string
}

/** The File elements of a submodel that hold an IFC model. */
export function ifcModels (submodel: JsonObject): IfcModel[] {
  const found: IfcModel[] = []
  const visit = (node: Node | JsonObject) => {
    for (const child of childrenOf(node)) {
      const { element } = child
      if (element.modelType === 'File' && typeof element.value === 'string'
        && detectModelFormat({ contentType: element.contentType as string | undefined, fileName: element.value }) === 'ifc') {
        found.push({ path: child.path, fileName: element.value.split('/').pop() ?? element.value })
      }
      visit(child)
    }
  }
  visit(submodel)
  return found
}
