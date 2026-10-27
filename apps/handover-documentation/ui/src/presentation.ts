import type { DocumentedEntity, DocumentVersion, FileRef, HandoverDocument, ReferenceKey } from './handoverDocumentation'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import { documentAt, documentTitle, mainClassification, pickText, referencedShell, referencePath } from './handoverDocumentation'

// What the view shows of a document, as label and value rows, like the 3D
// Models app's presentation of IDTA 02026.

export interface DetailRow {
  label: string
  value: string
  icon?: string
  /** An http(s) address the row opens. */
  url?: string
  /** A document of this submodel the row selects. */
  document?: string
  /** A shell the row opens in Studio. */
  shell?: string
}

export interface DetailGroup {
  key: string
  title: string
  icon: string
  rows: DetailRow[]
}

/** What references are resolved against. */
export interface ReferenceContext {
  submodelId: string
  documents: HandoverDocument[]
  entities: DocumentedEntity[]
  /** A document's title as the list shows it. */
  titleOf: (document: HandoverDocument) => string
}

/** The values of `StatusValue` in IDTA 02004 and VDI 2770, with a translated label. */
const statuses = ['InReview', 'Released']

export function statusText (t: Translate, status: string): string {
  const known = statuses.find(entry => entry.toLowerCase() === status.replaceAll(/\s/g, '').toLowerCase())
  return known ? t(`values.${known}`) : status
}

/** Status values of the value list (InReview, Released) and common other terms; negative ones win. */
export function statusColor (status: string): string | undefined {
  const value = status.replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  if (/\b(?:obsolete|deprecated|withdrawn|rejected|invalid|retired|expired|unreleased|unapproved|not\s+(?:released|approved|published|valid|final))\b/.test(value)) {
    return 'error'
  }
  if (/\b(?:in\s+review|review|draft|progress|preliminary|proposed|pending)\b/.test(value)) {
    return 'warning'
  }
  if (/\b(?:released|approved|published|valid|final)\b/.test(value)) {
    return 'success'
  }
  return undefined
}

/** E.g. "v2.1"; versions without an ID by their position. */
export function versionLabel (t: Translate, version: DocumentVersion, index: number): string {
  return version.version ? `v${version.version.replace(/^v/i, '')}` : t('version.number', { number: index + 1 })
}

/** `de` → "German" in the user's language, `de-CH` → "Swiss High German". */
export function languageName (code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'code' }).of(code) ?? code
  } catch {
    // Not a language tag: as it is.
    return code
  }
}

/** A date (YYYY-MM-DD) in the user's format; other values as they are. */
export function dateText (value: string, locale: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return value
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  try {
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
  } catch {
    return value
  }
}

/** The title shown for a document; untitled ones by their position. */
export function titleText (t: Translate, document: HandoverDocument, version: DocumentVersion | undefined, index: number, locale: string): string {
  return documentTitle(document, version, locale) || t('document.untitled', { number: index + 1 })
}

/** E.g. "Operation · v2.1". */
export function documentSubtitle (t: Translate, document: HandoverDocument, version: DocumentVersion | undefined, locale: string): string {
  const classification = mainClassification(document)
  const index = version ? document.versions.indexOf(version) : -1
  return [classification && (pickText(classification.name, locale) || classification.id), version && versionLabel(t, version, index)].filter(Boolean).join(' · ')
}

/** A short label of a file for the file switch: its extension, else its media subtype, e.g. "PDF". */
export function fileLabel (file: FileRef): string {
  const extension = file.name.includes('.') ? file.name.split('.').pop() ?? '' : ''
  const subtype = file.contentType.split(';', 1)[0]!.split('/', 2)[1] ?? ''
  return (extension || subtype.replace(/^x-/, '') || file.name).toUpperCase()
}

function row (label: string, value: string | undefined, extra: Partial<DetailRow> = {}): DetailRow | null {
  return value && value.trim() !== '' ? { label, value, ...extra } : null
}

function compact (rows: Array<DetailRow | null>): DetailRow[] {
  return rows.filter((entry): entry is DetailRow => entry !== null)
}

const isUrl = (value: string) => /^https?:\/\//i.test(value)

function organizationText (version: DocumentVersion | undefined): string {
  const organization = version?.organization
  if (!organization) {
    return ''
  }
  return organization.officialName && organization.shortName && organization.officialName !== organization.shortName
    ? `${organization.shortName} (${organization.officialName})`
    : organization.officialName || organization.shortName
}

/** The facts next to the file: version, status, date, organization and languages. */
export function versionFacts (t: Translate, version: DocumentVersion | undefined, locale: string): DetailRow[] {
  if (!version) {
    return []
  }
  return compact([
    row(t('facts.version'), version.version, { icon: 'mdi-source-branch' }),
    row(t('facts.status'), version.status && statusText(t, version.status), { icon: 'mdi-check-decagram-outline' }),
    row(t('facts.date'), dateText(version.setDate, locale), { icon: 'mdi-calendar-outline' }),
    row(t('facts.organization'), organizationText(version), { icon: 'mdi-domain' }),
    row(t('facts.languages'), version.languages.map(code => languageName(code, locale)).join(', '), { icon: 'mdi-translate' }),
  ])
}

/** A reference as a row: a document of this submodel to select, an entity, a shell to open, or its keys. */
function referenceRow (label: string, keys: ReferenceKey[], context: ReferenceContext): DetailRow | null {
  const path = referencePath(keys, context.submodelId)
  if (path !== null) {
    const target = documentAt(context.documents, path)
    if (target) {
      return row(label, context.titleOf(target), { document: target.key })
    }
    const entity = context.entities.find(entry => entry.path === path)
    if (entity) {
      return row(label, entity.globalAssetId && entity.globalAssetId !== entity.name ? `${entity.name} (${entity.globalAssetId})` : entity.name)
    }
  }
  const shell = referencedShell(keys)
  if (shell) {
    return row(label, shell, { shell })
  }
  return row(label, keys.map(key => key.value).join(' / '))
}

/** Everything else of the document and version, in the "Technical details". */
export function technicalGroups (t: Translate, document: HandoverDocument, version: DocumentVersion | undefined, context: ReferenceContext, locale: string): DetailGroup[] {
  const groups: DetailGroup[] = [
    {
      key: 'identification',
      title: t('details.identification'),
      icon: 'mdi-identifier',
      rows: compact(document.ids.map(id => row(id.domain || t('details.identifier'), id.primary && document.ids.length > 1 ? `${id.value} (${t('details.primary')})` : id.value))),
    },
    {
      key: 'classification',
      title: t('details.classification'),
      icon: 'mdi-tag-outline',
      rows: compact(document.classifications.map(classification => row(
        classification.system || t('details.class'),
        [classification.id, pickText(classification.name, locale)].filter(Boolean).join(' – '),
      ))),
    },
    {
      key: 'files',
      title: t('details.files'),
      icon: 'mdi-paperclip',
      rows: compact([
        ...(version?.digitalFiles ?? []).map(file => row(t('details.digitalFile'), file.contentType ? `${file.name} (${file.contentType})` : file.name, { url: isUrl(file.value) ? file.value : undefined })),
        version?.preview ? row(t('details.previewFile'), version.preview.contentType ? `${version.preview.name} (${version.preview.contentType})` : version.preview.name) : null,
      ]),
    },
    {
      key: 'relations',
      title: t('details.relations'),
      icon: 'mdi-link-variant',
      rows: compact([
        ...(version?.refersTo ?? []).map(keys => referenceRow(t('details.refersTo'), keys, context)),
        ...(version?.basedOn ?? []).map(keys => referenceRow(t('details.basedOn'), keys, context)),
        ...(version?.translationOf ?? []).map(keys => referenceRow(t('details.translationOf'), keys, context)),
        ...document.documentedEntities.map(keys => referenceRow(t('details.documentedEntity'), keys, context)),
      ]),
    },
  ]
  return groups.filter(group => group.rows.length > 0)
}
