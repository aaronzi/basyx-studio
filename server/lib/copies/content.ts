import type { JsonObject } from '../aas/outline'
import { childProperties, hasNamedChildren } from '#shared/aas/defaults'
import { semanticKey } from '../aas/edits'
import { isPackagePath } from './source'

// Walks over the AAS JSON a copy writes: the files it carries, the concept
// descriptions it names and the references inside the copied set.

function isObject (value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function childrenOf (container: JsonObject): JsonObject[] {
  const property = childProperties[String(container.modelType)]
  const value = property ? container[property] : undefined
  return Array.isArray(value) ? value.filter(isObject) : []
}

/** File elements whose value is a file inside the source (not a URL): their idShortPath and that value. */
export function packagedFiles (submodel: JsonObject): Array<{ idShortPath: string, location: string }> {
  const files: Array<{ idShortPath: string, location: string }> = []
  const visit = (container: JsonObject, prefix: string) => {
    const named = hasNamedChildren(String(container.modelType))
    for (const [index, child] of childrenOf(container).entries()) {
      const path = named ? (prefix ? `${prefix}.${String(child.idShort)}` : String(child.idShort)) : `${prefix}[${index}]`
      if (child.modelType === 'File' && isPackagePath(child.value)) {
        files.push({ idShortPath: path, location: child.value })
      }
      visit(child, path)
    }
  }
  visit(submodel, '')
  return files
}

/** The idShortPaths of File elements whose value is a file inside the source. */
export function packagedFilePaths (submodel: JsonObject): string[] {
  return packagedFiles(submodel).map(file => file.idShortPath)
}

/** Whether a shell's default thumbnail is a file inside the source. */
export function hasPackagedThumbnail (shell: JsonObject): boolean {
  const information = isObject(shell.assetInformation) ? shell.assetInformation : {}
  return isObject(information.defaultThumbnail) && isPackagePath(information.defaultThumbnail.path)
}

/** The identifiers the semantic IDs of a submodel and all its elements name, operation variables included. */
export function semanticIdsOf (value: unknown): Set<string> {
  const ids = new Set<string>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }
    if (!isObject(node)) {
      return
    }
    const id = typeof node.modelType === 'string' ? semanticKey(node) : null
    if (id) {
      ids.add(id)
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'semanticId' && (Array.isArray(child) || isObject(child))) {
        visit(child)
      }
    }
  }
  visit(value)
  return ids
}

/**
 * A copy of the value with every reference key that names a remapped
 * identifier rewritten (K5): the shell's submodel references, `derivedFrom`,
 * and reference elements that point into the copied set.
 */
export function rewriteReferences<T> (value: T, identifiers: ReadonlyMap<string, string>): T {
  if (identifiers.size === 0) {
    return value
  }
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(item => visit(item))
    }
    if (!isObject(node)) {
      return node
    }
    const result: JsonObject = {}
    for (const [key, child] of Object.entries(node)) {
      result[key] = visit(child)
    }
    if (Array.isArray(node.keys) && typeof node.type === 'string') {
      result.keys = (node.keys as unknown[]).map(entry => isObject(entry) && typeof entry.value === 'string' && identifiers.has(entry.value)
        ? { ...entry, value: identifiers.get(entry.value) }
        : entry)
    }
    return result
  }
  return visit(value) as T
}
