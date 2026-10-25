import type { ExportFormat } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { AasTarget, BinaryContent } from '../targets/aas-target'
import type { PackagedFile } from '../workspaces/package'
import type { CopyRoot } from './plan'
import type { CopyReader } from './source'
import { jsonization, xmlization } from '@aas-core-works/aas-core3.1-typescript'
import { submodelIdsOf } from '../aas/sync'
import { indentXml } from '../aas/xml'
import { StudioProblem } from '../problem'
import { hasPackagedThumbnail, packagedFiles, semanticIdsOf } from './content'

/** Writes an environment and its files as an AASX package, in the Workspace Worker (`pack`). */
export type Packer = (environment: JsonObject, files: PackagedFile[]) => Promise<Uint8Array>

const mediaTypes: Record<ExportFormat, string> = {
  aasx: 'application/asset-administration-shell-package+xml',
  json: 'application/json',
  xml: 'application/xml',
}

async function readable<T> (read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    // A dangling reference, or a concept kept elsewhere: not part of the export.
    return null
  }
}

/**
 * The environment of resources and what they need (package editing plan,
 * E2): a shell's submodels, the concept descriptions the source has for
 * their semantic IDs, and the files inside the source.
 */
export async function collectEnvironment (reader: CopyReader, roots: readonly CopyRoot[]): Promise<{ environment: JsonObject, files: PackagedFile[] }> {
  const shells = new Map<string, JsonObject>()
  const submodels = new Map<string, JsonObject>()
  const concepts = new Map<string, JsonObject>()
  const files: PackagedFile[] = []
  const semantics = new Set<string>()

  const addSubmodel = async (id: string) => {
    if (submodels.has(id)) {
      return
    }
    const submodel = await readable(() => reader.submodel(id))
    if (!submodel) {
      return
    }
    submodels.set(id, submodel)
    for (const semanticId of semanticIdsOf(submodel)) {
      semantics.add(semanticId)
    }
    for (const file of packagedFiles(submodel)) {
      const content = await readable(() => reader.attachment(id, file.idShortPath))
      if (content) {
        files.push({ path: file.location, contentType: content.contentType, bytes: content.bytes })
      }
    }
  }

  for (const root of roots) {
    if (root.type === 'shell' && !shells.has(root.id)) {
      const shell = await reader.shell(root.id)
      shells.set(root.id, shell)
      if (hasPackagedThumbnail(shell)) {
        const thumbnail = await readable(() => reader.thumbnail(root.id))
        const path = ((shell.assetInformation as JsonObject).defaultThumbnail as JsonObject).path as string
        if (thumbnail) {
          files.push({ path, contentType: thumbnail.contentType, bytes: thumbnail.bytes })
        }
      }
      for (const submodelId of submodelIdsOf(shell)) {
        await addSubmodel(submodelId)
      }
    } else if (root.type === 'submodel') {
      if (!submodels.has(root.id)) {
        // The submodel the user chose must be readable; its dependencies may not be.
        await reader.submodel(root.id)
      }
      await addSubmodel(root.id)
    } else if (root.type === 'conceptDescription' && !concepts.has(root.id)) {
      concepts.set(root.id, await reader.conceptDescription(root.id))
    }
  }
  for (const id of semantics) {
    if (!concepts.has(id)) {
      const concept = await readable(() => reader.conceptDescription(id))
      if (concept) {
        concepts.set(id, concept)
      }
    }
  }
  return {
    environment: {
      assetAdministrationShells: [...shells.values()],
      submodels: [...submodels.values()],
      conceptDescriptions: [...concepts.values()],
    },
    files,
  }
}

/** Resources and what they need as an AAS environment in JSON, XML or AASX (E2). */
export async function exportEnvironment (reader: CopyReader, roots: readonly CopyRoot[], format: ExportFormat, pack: Packer): Promise<BinaryContent> {
  const { environment, files } = await collectEnvironment(reader, roots)
  if (format === 'aasx') {
    return { bytes: await pack(environment, files), contentType: mediaTypes.aasx, fileName: null }
  }
  const parsed = jsonization.environmentFromJsonable(environment as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', `The content cannot be serialized: ${parsed.error.message} (${parsed.error.path.toString()})`)
  }
  const text = format === 'xml'
    ? `<?xml version="1.0" encoding="UTF-8"?>\n${indentXml(xmlization.toXmlString(parsed.mustValue()))}`
    : JSON.stringify(jsonization.toJsonable(parsed.mustValue()), null, 2)
  return { bytes: new TextEncoder().encode(text), contentType: mediaTypes[format], fileName: null }
}

/** Every shell, every submodel no shell references, and every concept description of a target, page by page. */
export async function allRoots (target: Pick<AasTarget, 'listShells' | 'listSubmodels' | 'conceptDescriptions' | 'shell'>): Promise<CopyRoot[]> {
  const collect = async <T>(list: (limit: number, cursor: string | undefined) => Promise<{ items: T[], page: { nextCursor: string | null } }>) => {
    const items: T[] = []
    let cursor: string | undefined
    do {
      const page = await list(500, cursor)
      items.push(...page.items)
      cursor = page.page.nextCursor ?? undefined
    } while (cursor)
    return items
  }
  const shells = await collect(target.listShells)
  const referenced = new Set<string>()
  for (const shell of shells) {
    for (const id of submodelIdsOf(await target.shell(shell.id))) {
      referenced.add(id)
    }
  }
  const submodels = await collect(target.listSubmodels)
  const concepts = await collect(target.conceptDescriptions)
  return [
    ...shells.map(shell => ({ type: 'shell' as const, id: shell.id })),
    ...submodels.filter(submodel => !referenced.has(submodel.id)).map(submodel => ({ type: 'submodel' as const, id: submodel.id })),
    ...concepts.map(concept => ({ type: 'conceptDescription' as const, id: concept.id })),
  ]
}
