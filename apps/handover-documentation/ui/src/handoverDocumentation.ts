import type { Node } from '@basyx/studio-app-kit/aas'
import type { JsonObject } from '@basyx/studio-sdk'
import { childrenOf, langText } from '@basyx/studio-app-kit/aas'

// Reading the handover documentation of an asset: IDTA 02004-2-0 (lists:
// `Documents`, `DocumentVersions`, `DigitalFiles`), IDTA 02004-1-2 and older
// (numbered collections: `Document01`, `DocumentVersion01`, `DigitalFile01`)
// and VDI 2770 submodels of AASX files before the IDTA template. Based on the
// BaSyx AAS Web UI's HandoverDocumentation_v1_2 and _v2_0 plugins
// (https://github.com/eclipse-basyx/basyx-aas-web-ui), © the Eclipse BaSyx
// Authors, MIT License, and extended to every element of the templates.
//
// Elements are found by idShort (a trailing number allowed: `Document01`),
// by their ECLASS IRDI in any version (`0173-1#02-ABI500#001` and `#003`, also
// as `https://api.eclass-cdp.com/0173-1-02-ABI500-003`), or by the last
// segment of a VDI 2770 semantic ID. Elements that the versions name
// differently (`ValueId` and `DocumentIdentifier`, `Summary` and
// `Description`, `RefersTo` and `RefersToEntities`) are read as one. Lists
// may also be collections, and collections numbered siblings.

export interface LangString {
  language: string
  text: string
}

/** A File element: its idShortPath (for `readFile` and `previewFile`), media type and value. */
export interface FileRef {
  path: string
  contentType: string
  value: string
  /** The file name, from the value's last segment. */
  name: string
  /** The value is an http(s) address at another host. */
  external: boolean
}

export interface DocumentId {
  domain: string
  value: string
  primary: boolean
}

export interface Classification {
  id: string
  name: LangString[]
  system: string
}

export interface ReferenceKey {
  type: string
  value: string
}

export interface Organization {
  shortName: string
  officialName: string
}

export interface DocumentVersion {
  /** The version's idShortPath. */
  key: string
  version: string
  languages: string[]
  title: LangString[]
  subtitle: LangString[]
  description: LangString[]
  keywords: LangString[]
  status: string
  setDate: string
  organization: Organization | null
  digitalFiles: FileRef[]
  preview: FileRef | null
  /** The keys of `RefersTo`, `BasedOn` and `TranslationOf` references. */
  refersTo: ReferenceKey[][]
  basedOn: ReferenceKey[][]
  translationOf: ReferenceKey[][]
}

export interface HandoverDocument {
  /** The document's idShortPath. */
  key: string
  ids: DocumentId[]
  classifications: Classification[]
  versions: DocumentVersion[]
  /** The keys of the entities (or shells) the document is about. */
  documentedEntities: ReferenceKey[][]
}

/** An entity of the submodel's `Entities` that documents refer to. */
export interface DocumentedEntity {
  path: string
  name: string
  globalAssetId: string
}

export interface HandoverDocumentation {
  documents: HandoverDocument[]
  entities: DocumentedEntity[]
}

export const handoverSemanticIds = {
  v2: '0173-1#01-AHF578#003',
  v1: '0173-1#01-AHF578#001',
  vdi2770: 'https://admin-shell.io/vdi/2770/1/0/Documentation',
}

interface ElementName {
  /** idShorts without their number, and VDI 2770 semantic ID segments, of one element. */
  names: string[]
  /** Names of a list or collection that holds the elements. */
  plural?: string[]
  /** ECLASS IRDIs without their version. */
  irdis?: string[]
}

const elements = {
  document: { names: ['Document'], plural: ['Documents'], irdis: ['0173-1#02-ABI500'] },
  documentId: { names: ['DocumentId'], plural: ['DocumentIds'], irdis: ['0173-1#02-ABI501'] },
  domainId: { names: ['DocumentDomainId', 'DomainId'], irdis: ['0173-1#02-ABH994'] },
  identifier: { names: ['DocumentIdentifier', 'ValueId'], irdis: ['0173-1#02-AAO099'] },
  isPrimary: { names: ['DocumentIsPrimary', 'IsPrimary', 'IsPrimaryDocumentId'], irdis: ['0173-1#02-ABH995'] },
  classification: { names: ['DocumentClassification'], plural: ['DocumentClassifications'], irdis: ['0173-1#02-ABI502'] },
  classId: { names: ['ClassId'], irdis: ['0173-1#02-ABH996'] },
  className: { names: ['ClassName'], irdis: ['0173-1#02-ABJ219', '0173-1#02-AAO102'] },
  classificationSystem: { names: ['ClassificationSystem'], irdis: ['0173-1#02-ABH997'] },
  version: { names: ['DocumentVersion'], plural: ['DocumentVersions'], irdis: ['0173-1#02-ABI503'] },
  language: { names: ['Language'], plural: ['Languages'], irdis: ['0173-1#02-AAN468'] },
  versionId: { names: ['Version', 'DocumentVersionId'], irdis: ['0173-1#02-AAP003', '0173-1#02-AAO100'] },
  title: { names: ['Title'], irdis: ['0173-1#02-ABG940', '0173-1#02-AAO105'] },
  subtitle: { names: ['Subtitle'], irdis: ['0173-1#02-ABH998'] },
  description: { names: ['Description', 'Summary'], irdis: ['0173-1#02-AAN466', '0173-1#02-AAO106'] },
  keywords: { names: ['KeyWords', 'Keyword'], irdis: ['0173-1#02-ABH999'] },
  setDate: { names: ['StatusSetDate', 'SetDate'], irdis: ['0173-1#02-ABI000'] },
  status: { names: ['StatusValue'], irdis: ['0173-1#02-ABI001'] },
  organizationName: { names: ['OrganizationShortName', 'OrganizationName'], irdis: ['0173-1#02-ABI002'] },
  organizationOfficialName: { names: ['OrganizationOfficialName'], irdis: ['0173-1#02-ABI004'] },
  digitalFile: { names: ['DigitalFile'], plural: ['DigitalFiles'], irdis: ['0173-1#02-ABI504', '0173-1#02-ABK126'] },
  previewFile: { names: ['PreviewFile'], irdis: ['0173-1#02-ABI505', '0173-1#02-ABK127'] },
  refersTo: { names: ['RefersTo'], plural: ['RefersToEntities'], irdis: ['0173-1#02-ABI006', '0173-1#02-ABK288'] },
  basedOn: { names: ['BasedOn'], plural: ['BasedOnReferences'], irdis: ['0173-1#02-ABI005', '0173-1#02-ABK289'] },
  translationOf: { names: ['TranslationOf'], plural: ['TranslationOfEntities'], irdis: ['0173-1#02-ABI007', '0173-1#02-ABK290'] },
  documentedEntity: { names: ['DocumentedEntity'], plural: ['DocumentedEntities'] },
  entity: { names: ['Entity', 'EntityForDocumentation'], plural: ['Entities', 'EntitiesForDocumentation'] },
} satisfies Record<string, ElementName>

type ElementKey = keyof typeof elements

function semanticIdOf (element: JsonObject): string {
  const keys = (element.semanticId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys ?? []
  return typeof keys[0]?.value === 'string' ? keys[0].value : ''
}

/** An ECLASS IRDI in either spelling: `0173-1#02-ABI500#003` or `0173-1-02-ABI500-003` (in an `api.eclass-cdp.com` URL). */
const irdiPattern = /(\d{4}-\d)[#-](\d{2})[#-]([A-Z]{2}[A-Z\d]\d{3})/g

/** `0173-1#02-ABI500#003/0173-1#01-AHF579#003` and `https://api.eclass-cdp.com/0173-1-02-ABI500-003` → `0173-1#02-ABI500`. */
export function irdiOf (semanticId: string): string {
  const [match] = semanticId.matchAll(irdiPattern)
  return match ? `${match[1]}#${match[2]}-${match[3]}` : ''
}

/**
 * Whether a semantic ID is composite: a property's IRDI and its class's, as
 * the items of IDTA 02004 lists have them
 * (`0173-1#02-ABI500#003/0173-1#01-AHF579#003`, or the same as
 * `https://api.eclass-cdp.com/0173-1-02-ABI500-003/0173-1-01-AHF579-003`).
 */
export function isCompositeIrdi (semanticId: string): boolean {
  return [...semanticId.matchAll(irdiPattern)].length > 1
}

/** The name a URL semantic ID gives its element: `…/2770/1/0/Document/DocumentId` → `documentid`. */
function semanticName (semanticId: string): string {
  return /^https?:\/\//i.test(semanticId) ? semanticId.replace(/\/?\d+\/\d+\/?$/, '').split('/').pop()?.toLowerCase() ?? '' : ''
}

const lower = (values: string[] | undefined) => new Set((values ?? []).map(value => value.toLowerCase()))

function nameOf (element: JsonObject): string {
  return String(element.idShort ?? '').toLowerCase().replace(/\d+$/, '')
}

/**
 * Whether an element holds the elements of a kind: by name, or as a
 * collection with the list's IRDI. IDTA 02004 gives a list its property's
 * IRDI (`0173-1#02-ABI503#003`) and the items a composite one
 * (`0173-1#02-ABI503#003/0173-1#01-AHF582#003`).
 */
function isPlural (element: JsonObject, name: ElementName): boolean {
  const plural = lower(name.plural)
  const semanticId = semanticIdOf(element)
  return plural.has(nameOf(element)) || plural.has(semanticName(semanticId))
    || (plural.size > 0 && element.modelType === 'SubmodelElementCollection' && !isCompositeIrdi(semanticId) && (name.irdis?.includes(irdiOf(semanticId)) ?? false))
}

function matches (element: JsonObject, name: ElementName): boolean {
  const semanticId = semanticIdOf(element)
  const names = lower(name.names)
  return names.has(nameOf(element)) || names.has(semanticName(semanticId)) || isPlural(element, name)
    || (name.irdis?.includes(irdiOf(semanticId)) ?? false)
}

function children (node: Node | undefined): Node[] {
  return node ? childrenOf(node) : []
}

/** The elements of a kind: a list's (or plural collection's) items, or numbered siblings. */
function entries (node: Node | undefined, key: ElementKey): Node[] {
  const name: ElementName = elements[key]
  return children(node)
    .filter(entry => matches(entry.element, name))
    .flatMap(entry => (entry.element.modelType === 'SubmodelElementList' || (entry.element.modelType === 'SubmodelElementCollection' && isPlural(entry.element, name)) ? children(entry) : [entry]))
}

function child (node: Node | undefined, key: ElementKey): Node | undefined {
  return entries(node, key)[0]
}

function scalar (element: JsonObject | undefined): string {
  const value = element?.value
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : ''
}

function text (node: Node | undefined, key: ElementKey): string {
  return scalar(child(node, key)?.element)
}

/** A MultiLanguageProperty's texts; a Property's value as a text without language. */
function langStrings (node: Node | undefined, key: ElementKey): LangString[] {
  const element = child(node, key)?.element
  if (Array.isArray(element?.value)) {
    return (element.value as unknown[])
      .filter((entry): entry is LangString => typeof (entry as LangString)?.text === 'string' && (entry as LangString).text.trim() !== '')
      .map(entry => ({ language: String(entry.language ?? ''), text: entry.text.trim() }))
  }
  const value = scalar(element)
  return value ? [{ language: '', text: value }] : []
}

function isTrue (value: string): boolean {
  return value.toLowerCase() === 'true' || value === '1'
}

function fileRef (node: Node): FileRef | null {
  const value = scalar(node.element)
  if (node.element.modelType !== 'File' || value === '') {
    return null
  }
  const external = /^https?:\/\//i.test(value)
  const segment = (external ? URL.parse(value)?.pathname ?? value : value).split('/').pop() ?? ''
  let name = segment
  try {
    name = decodeURIComponent(segment)
  } catch {
    // Not percent-encoded: as it is.
  }
  return { path: node.path, contentType: String(node.element.contentType ?? '').trim(), value, name, external }
}

function referenceKeys (value: unknown): ReferenceKey[] {
  const keys = (value as { keys?: Array<{ type?: unknown, value?: unknown }> } | null)?.keys ?? []
  return keys.map(key => ({ type: String(key.type ?? ''), value: String(key.value ?? '') })).filter(key => key.value !== '')
}

function references (node: Node | undefined, key: ElementKey): ReferenceKey[][] {
  return entries(node, key)
    .filter(entry => entry.element.modelType === 'ReferenceElement')
    .map(entry => referenceKeys(entry.element.value))
    .filter(keys => keys.length > 0)
}

function parseIds (node: Node): DocumentId[] {
  // VDI 2770: `DocumentId` is a Property, with `IsPrimaryDocumentId` next to it.
  const flat = entries(node, 'documentId').filter(entry => entry.element.modelType === 'Property')
  if (flat.length > 0) {
    const primary = isTrue(text(node, 'isPrimary'))
    return flat.map((entry, index) => ({ domain: '', value: scalar(entry.element), primary: primary && index === 0 })).filter(id => id.value !== '')
  }
  return entries(node, 'documentId')
    .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
    .map(entry => ({ domain: text(entry, 'domainId'), value: text(entry, 'identifier'), primary: isTrue(text(entry, 'isPrimary')) }))
    .filter(id => id.value !== '' || id.domain !== '')
}

function parseVersion (node: Node): DocumentVersion {
  const organization = { shortName: text(node, 'organizationName'), officialName: text(node, 'organizationOfficialName') }
  return {
    key: node.path,
    version: text(node, 'versionId'),
    languages: [...new Set(entries(node, 'language').map(entry => scalar(entry.element)).filter(Boolean))],
    title: langStrings(node, 'title'),
    subtitle: langStrings(node, 'subtitle'),
    description: langStrings(node, 'description'),
    keywords: langStrings(node, 'keywords'),
    status: text(node, 'status'),
    setDate: text(node, 'setDate'),
    organization: organization.shortName || organization.officialName ? organization : null,
    digitalFiles: entries(node, 'digitalFile').map(entry => fileRef(entry)).filter((entry): entry is FileRef => entry !== null),
    preview: entries(node, 'previewFile').map(entry => fileRef(entry)).find(entry => entry !== null) ?? null,
    refersTo: references(node, 'refersTo'),
    basedOn: references(node, 'basedOn'),
    translationOf: references(node, 'translationOf'),
  }
}

function parseDocument (node: Node): HandoverDocument {
  return {
    key: node.path,
    ids: parseIds(node),
    classifications: entries(node, 'classification')
      .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
      .map(entry => ({ id: text(entry, 'classId'), name: langStrings(entry, 'className'), system: text(entry, 'classificationSystem') }))
      .filter(entry => entry.id || entry.name.length > 0),
    versions: entries(node, 'version').filter(entry => entry.element.modelType === 'SubmodelElementCollection').map(entry => parseVersion(entry)),
    documentedEntities: references(node, 'documentedEntity'),
  }
}

/** The documents of a handover documentation submodel, and the entities they document. */
export function parseHandoverDocumentation (submodel: JsonObject): HandoverDocumentation {
  const root: Node = { element: submodel, path: '' }
  return {
    documents: entries(root, 'document')
      .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
      .map(entry => parseDocument(entry)),
    entities: entries(root, 'entity')
      .filter(entry => entry.element.modelType === 'Entity')
      .map(entry => {
        const globalAssetId = typeof entry.element.globalAssetId === 'string' ? entry.element.globalAssetId : ''
        // List items have no idShort: the display name, else the asset.
        return { path: entry.path, name: langText(entry.element.displayName, 'en') || String(entry.element.idShort ?? '') || globalAssetId, globalAssetId }
      }),
  }
}

/** The version shown first: the latest `StatusSetDate` (YYYY-MM-DD), the last listed on equal dates. */
export function latestVersion (versions: DocumentVersion[]): DocumentVersion | undefined {
  return versions.reduce<DocumentVersion | undefined>((latest, version) => (!latest || version.setDate >= latest.setDate ? version : latest), undefined)
}

/** Newest first; equal dates keep the listed order, last first. */
export function sortVersions (versions: DocumentVersion[]): DocumentVersion[] {
  return versions
    .map((version, index) => ({ version, index }))
    .toSorted((a, b) => b.version.setDate.localeCompare(a.version.setDate) || b.index - a.index)
    .map(entry => entry.version)
}

export function pickText (values: LangString[], locale: string): string {
  return langText(values, locale)
}

/** The primary identifier, else the first. */
export function primaryId (document: HandoverDocument): DocumentId | undefined {
  return document.ids.find(id => id.primary) ?? document.ids[0]
}

/** The version's title, else its file's name or the document's identifier; empty without any. */
export function documentTitle (document: HandoverDocument, version: DocumentVersion | undefined, locale: string): string {
  return pickText(version?.title ?? [], locale)
    || version?.digitalFiles[0]?.name
    || primaryId(document)?.value
    || ''
}

/** The classification of VDI 2770 (which IDTA 02004 requires), else the first. */
export function mainClassification (document: HandoverDocument): Classification | undefined {
  return document.classifications.find(entry => /vdi\s*2770/i.test(entry.system)) ?? document.classifications[0]
}

/** A filter value for a classification: its system and class. */
export function classificationKey (classification: Classification): string {
  return `${classification.system}|${classification.id || langText(classification.name, 'en')}`
}

/** Whether a document's texts, identifiers or classes contain every word of the query. */
export function matchesQuery (document: HandoverDocument, query: string | null | undefined): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const haystack = [
    ...document.ids.flatMap(id => [id.value, id.domain]),
    ...document.classifications.flatMap(entry => [entry.id, ...entry.name.map(name => name.text)]),
    ...document.versions.flatMap(version => [
      version.version,
      ...[version.title, version.subtitle, version.description, version.keywords].flatMap(values => values.map(value => value.text)),
      ...version.digitalFiles.map(file => file.name),
    ]),
  ].join('\n').toLowerCase()
  return words.every(word => haystack.includes(word))
}

/** The idShortPath a model reference into this submodel names, e.g. `Documents[2]`; null for other targets. */
export function referencePath (keys: ReferenceKey[], submodelId: string): string | null {
  if (keys[0]?.type !== 'Submodel' || keys[0].value !== submodelId || keys.length < 2) {
    return null
  }
  let path = ''
  let inList = false
  for (const key of keys.slice(1)) {
    path = inList ? `${path}[${key.value}]` : (path ? `${path}.${key.value}` : key.value)
    inList = key.type === 'SubmodelElementList'
  }
  return path
}

/** The document a path lies in: the document itself or one of its elements. */
export function documentAt (documents: HandoverDocument[], path: string): HandoverDocument | undefined {
  return documents.find(document => path === document.key || path.startsWith(`${document.key}.`) || path.startsWith(`${document.key}[`))
}

/** The shell a reference names, if its first key is one. */
export function referencedShell (keys: ReferenceKey[]): string | null {
  return keys[0]?.type === 'AssetAdministrationShell' ? keys[0].value : null
}
