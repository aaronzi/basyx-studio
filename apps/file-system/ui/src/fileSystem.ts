import type { JsonObject } from '@basyx/studio-sdk'

// The FileSystem submodel as the FileSystem plugin of the BaSyx AAS Web UI
// writes it (aas-web-ui/src/components/Plugins/Submodels/FileSystem at
// 1a5b5557, https://github.com/eclipse-basyx/basyx-aas-web-ui), © the Eclipse
// BaSyx Authors, MIT License:
// - folders are SubmodelElementCollections with the semantic ID
//   `https://basyx.org/submodels/Folder`, an idShort `FOLDER_<timestamp>` and
//   their name as English displayName;
// - files are File elements, named after the uploaded file (its name without
//   extension as idShort); the server keeps the file name in the value;
// - only folders and files are listed, folders first, then by name.
// Other elements of the submodel (e.g. the plugin's PreviewCollection) are
// left alone.

export const fileSystemSemanticId = 'https://basyx.org/FileSystem/FileSystem/0/1'
export const folderSemanticId = 'https://basyx.org/submodels/Folder'

export type Entry = FolderEntry | FileEntry

/** What the menu of a folder or file offers. */
export type EntryAction = 'open' | 'download' | 'rename' | 'move' | 'delete'

interface EntryBase {
  /** The idShortPath in the submodel. */
  path: string
  idShort: string
  /** The name shown: the displayName, else what the Web UI shows. */
  name: string
  /** The path of the parent folder; `''` for the top level. */
  parent: string
  element: JsonObject
}

export interface FolderEntry extends EntryBase {
  kind: 'folder'
  children: Entry[]
}

export interface FileEntry extends EntryBase {
  kind: 'file'
  contentType: string
  /** An http(s) address the File names instead of content on the server. */
  external: string | null
  /** The file name to store or download it under. */
  fileName: string
}

type LangString = { language: string, text: string }

function langStrings (value: unknown): LangString[] {
  return Array.isArray(value) ? value.filter((item): item is LangString => typeof item?.language === 'string' && typeof item?.text === 'string') : []
}

/** The text for a locale, then English, then any. */
export function displayName (element: JsonObject, locale: string): string | null {
  const names = langStrings(element.displayName).filter(name => name.text.trim())
  const language = locale.split('-', 1)[0]
  const pick = names.find(name => name.language === locale) ?? names.find(name => name.language === language) ?? names.find(name => name.language === 'en') ?? names[0]
  return pick?.text ?? null
}

function semanticIdOf (element: JsonObject): string | null {
  const keys = (element.semanticId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys
  return typeof keys?.[0]?.value === 'string' ? keys[0].value : null
}

export function isFolder (element: JsonObject): boolean {
  return element.modelType === 'SubmodelElementCollection' && semanticIdOf(element) === folderSemanticId
}

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/** The extension the Web UI gives a media type (`bin` for unknown ones). */
export function extensionOf (contentType: string): string {
  return extensions[contentType.toLowerCase()] ?? 'bin'
}

/** The last segment of a File's value, e.g. `report.pdf` of `/aasx/files/…/report.pdf`. */
function storedName (value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const last = value.split(/[?#]/, 1)[0]!.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last) || null
  } catch {
    return last || null
  }
}

function externalAddress (value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : null
}

function childPath (parent: string, idShort: string): string {
  return parent ? `${parent}.${idShort}` : idShort
}

function byName (a: Entry, b: Entry): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function entriesOf (elements: unknown, parent: string, locale: string): Entry[] {
  if (!Array.isArray(elements)) {
    return []
  }
  const entries: Entry[] = []
  for (const element of elements as JsonObject[]) {
    if (typeof element?.idShort !== 'string') {
      continue
    }
    const path = childPath(parent, element.idShort)
    if (isFolder(element)) {
      entries.push({ kind: 'folder', path, idShort: element.idShort, parent, element, name: displayName(element, locale) ?? element.idShort, children: entriesOf(element.value, path, locale) })
    } else if (element.modelType === 'File') {
      const contentType = typeof element.contentType === 'string' ? element.contentType : ''
      const stored = storedName(element.value)
      const fileName = stored && stored.includes('.') ? stored : `${element.idShort}.${extensionOf(contentType)}`
      entries.push({ kind: 'file', path, idShort: element.idShort, parent, element, name: displayName(element, locale) ?? fileName, contentType, external: externalAddress(element.value), fileName })
    }
  }
  return entries.toSorted(byName)
}

/** The folders and files of a FileSystem submodel, as a tree. */
export function readFileSystem (submodel: JsonObject, locale: string): Entry[] {
  return entriesOf(submodel.submodelElements, '', locale)
}

/** Every entry of the tree, depth first. */
export function flatten (entries: Entry[]): Entry[] {
  return entries.flatMap(entry => entry.kind === 'folder' ? [entry, ...flatten(entry.children)] : [entry])
}

export function findEntry (entries: Entry[], path: string): Entry | null {
  return flatten(entries).find(entry => entry.path === path) ?? null
}

/** The folders, with their paths and depth, e.g. to choose where to move to. */
export function folders (entries: Entry[]): FolderEntry[] {
  return flatten(entries).filter((entry): entry is FolderEntry => entry.kind === 'folder')
}

/** `path` is `folder` or inside it. */
export function isWithin (path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}.`)
}

const idShortPattern = /^[a-z][\w-]*\w$/i

/**
 * An idShort for an uploaded file, as the Web UI derives it: the name
 * without extension, without diacritics, other characters as `_`. Unlike
 * the Web UI, it is made a valid idShort (starting with a letter, at least
 * two characters) and unique among `taken`.
 */
export function fileIdShort (fileName: string, taken: Iterable<string>): string {
  const base = fileName.includes('.') ? fileName.split('.').slice(0, -1).join('.') : fileName
  let idShort = base.normalize('NFD').replaceAll(/\p{Mn}/gu, '').replaceAll(/[^a-z0-9]/gi, '_').slice(0, 100)
  if (!idShortPattern.test(idShort)) {
    idShort = `File_${idShort}`.replace(/_+$/, '') || 'File'
    if (!idShortPattern.test(idShort)) {
      idShort = 'File'
    }
  }
  return unique(idShort, taken)
}

/** `idShort`, or `idShort_2`, `idShort_3`, … where it is taken. */
export function unique (idShort: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(value => value.toLowerCase()))
  if (!used.has(idShort.toLowerCase())) {
    return idShort
  }
  let index = 2
  while (used.has(`${idShort}_${index}`.toLowerCase())) {
    index++
  }
  return `${idShort}_${index}`
}

/** A new folder as the Web UI creates it, without `value` (AAS Core refuses an empty one). */
export function newFolder (name: string, taken: Iterable<string>, now = Date.now()): JsonObject {
  return {
    modelType: 'SubmodelElementCollection',
    idShort: unique(`FOLDER_${now}`, taken),
    displayName: [{ language: 'en', text: name }],
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: folderSemanticId }] },
  }
}

/**
 * The element with a new name: the English displayName, and the one of the
 * locale the name was read in, where it has one.
 */
export function renamed (element: JsonObject, name: string, locale: string): JsonObject {
  const names = langStrings(element.displayName)
  const languages = new Set(['en', ...names.filter(entry => entry.language === locale || entry.language === locale.split('-', 1)[0]).map(entry => entry.language)])
  const next = names.map(entry => languages.has(entry.language) ? { ...entry, text: name } : entry)
  if (!next.some(entry => entry.language === 'en')) {
    next.push({ language: 'en', text: name })
  }
  return { ...element, displayName: next }
}

/** A copy of an element to add elsewhere: without the content of a File, which is uploaded again, nor a container's children. */
export function copyOf (element: JsonObject, idShort: string): JsonObject {
  const { value, ...rest } = element
  const external = externalAddress(value)
  return { ...rest, idShort, ...(external ? { value: external } : {}) }
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'none'

const textTypes = /^(?:text\/|application\/(?:json|xml|yaml|x-yaml|javascript|csv|x-sh|sql|graphql|ld\+json)$|application\/[\w.-]+\+(?:json|xml)$)/

/** How the view shows a file of a media type; `none` offers it to open or download. */
export function previewKind (contentType: string): PreviewKind {
  const type = contentType.split(';', 1)[0]!.trim().toLowerCase()
  if (type === 'application/pdf') {
    return 'pdf'
  }
  // SVG too: as an image, a browser runs none of its scripts.
  if (type.startsWith('image/') && type !== 'image/tiff') {
    return 'image'
  }
  if (type.startsWith('video/')) {
    return 'video'
  }
  if (type.startsWith('audio/')) {
    return 'audio'
  }
  return textTypes.test(type) ? 'text' : 'none'
}

/** The entry's icon, as the Web UI's plugin shows it. */
export function iconOf (entry: Entry): string {
  if (entry.kind === 'folder') {
    return 'mdi-folder'
  }
  if (entry.external) {
    return 'mdi-file-link'
  }
  switch (previewKind(entry.contentType)) {
    case 'image': {
      return 'mdi-image'
    }
    case 'pdf': {
      return 'mdi-file-pdf-box'
    }
    case 'video': {
      return 'mdi-video'
    }
    case 'audio': {
      return 'mdi-music'
    }
    case 'text': {
      return 'mdi-file-document'
    }
    default: {
      return 'mdi-file'
    }
  }
}

/** The colour of the entry's icon, as the Web UI's plugin shows it. */
export function iconColorOf (entry: Entry): string {
  if (entry.kind === 'folder') {
    return 'yellow-darken-2'
  }
  switch (previewKind(entry.contentType)) {
    case 'image': {
      return 'blue-darken-2'
    }
    case 'pdf': {
      return 'red'
    }
    case 'video': {
      return 'orange-darken-1'
    }
    default: {
      return 'grey'
    }
  }
}

/** The entries in a folder (`''` for the top level), folders first. */
export function childrenAt (entries: Entry[], folder: string): Entry[] {
  if (!folder) {
    return entries
  }
  const entry = findEntry(entries, folder)
  return entry?.kind === 'folder' ? entry.children : []
}

/** The folders from the top level down to `folder`, for breadcrumbs. */
export function trail (entries: Entry[], folder: string): FolderEntry[] {
  const path: FolderEntry[] = []
  let level = entries
  for (const idShort of folder ? folder.split('.') : []) {
    const next = level.find((entry): entry is FolderEntry => entry.kind === 'folder' && entry.idShort === idShort)
    if (!next) {
      break
    }
    path.push(next)
    level = next.children
  }
  return path
}

/** The folder that holds `path`; `''` for the top level. */
export function parentOf (path: string): string {
  return path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : ''
}

/** A size in bytes for people, e.g. `1.4 MB`. */
export function formatSize (bytes: number, locale: string): string {
  const units = ['B', 'kB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`
}
