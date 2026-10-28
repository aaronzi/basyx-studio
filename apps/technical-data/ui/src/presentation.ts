import type { Classification, GeneralFieldKey, SheetArea, SheetNode, TechnicalData } from './technicalData'
import type { EditableField, FileRef, LangString } from '@basyx/studio-app-kit/aas'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import type { ConceptInfo } from '@basyx/studio-sdk'
import { fieldText, humanize, langText } from '@basyx/studio-app-kit/aas'

// What the view shows of the technical data: the product at a glance, label
// and value rows for the general and further information, and the data
// sheets of the property areas as rows of a table, with units, readable
// names and definitions from the target's concept descriptions. In edit
// mode, every element with a value is a row, empty ones too, so that each
// can be changed.

export interface DetailRow {
  key: string
  label: string
  value: string
  icon?: string
  /** An https URL the value opens. */
  url?: string
  /** The text a copy button copies. */
  copy?: string
  /** The field the row changes in edit mode. */
  field?: EditableField
}

export interface SheetRow {
  key: string
  kind: 'section' | 'value'
  /** How deep the row lies in its area: 0 for the area's own elements. */
  depth: number
  label: string
  /** The concept's definition, else the element's description; empty without one. */
  definition: string
  value: string
  unit: string
  field?: EditableField
  file?: FileRef
  /** The keys of the sections the row lies in, outermost first. */
  sections: string[]
  /** Everything search looks at, in lower case: label, idShort, value, unit and the sections' labels. */
  haystack: string
}

/** The concept descriptions `aas.describeConcepts` found, by ID. */
export type Concepts = ReadonlyMap<string, ConceptInfo>

const eclassIrdi = /^(\d{4}-\d)#(\d{2})-([A-Z\d]{6})#(\d{3})$/
const eclassUrl = /^https:\/\/api\.eclass-cdp\.com\/(\d{4}-\d)-(\d{2})-([A-Z\d]{6})-(\d{3})$/i

/** An ID and its other spelling: ECLASS IRDIs also as `api.eclass-cdp.com` URLs, and back. */
export function conceptSpellings (id: string): string[] {
  const irdi = eclassIrdi.exec(id)
  if (irdi) {
    return [id, `https://api.eclass-cdp.com/${irdi[1]}-${irdi[2]}-${irdi[3]}-${irdi[4]}`]
  }
  const url = eclassUrl.exec(id)
  return url ? [id, `${url[1]}#${url[2]}-${url[3]!.toUpperCase()}#${url[4]}`] : [id]
}

/** The IDs to ask `aas.describeConcepts` for: each in both spellings, once. */
export function conceptQuery (ids: string[]): string[] {
  return [...new Set(ids.flatMap(id => conceptSpellings(id)))]
}

/** The answer of `aas.describeConcepts`, by ID. */
export function conceptMap (concepts: Array<ConceptInfo | null>): Concepts {
  return new Map(concepts.filter((concept): concept is ConceptInfo => concept !== null).map(concept => [concept.id, concept]))
}

/** The concept of an element: of its semantic ID first, then of the supplemental ones, in either spelling. */
export function conceptOf (node: { conceptIds: string[] }, concepts: Concepts): ConceptInfo | undefined {
  for (const id of node.conceptIds) {
    for (const spelling of conceptSpellings(id)) {
      const concept = concepts.get(spelling)
      if (concept) {
        return concept
      }
    }
  }
  return undefined
}

interface Named {
  idShort: string
  displayName: LangString[]
  description: LangString[]
  conceptIds: string[]
}

/** An element's label: its display name, else its concept's preferred name, else its idShort; `fallback` without any. */
export function labelOf (node: Named, concepts: Concepts, locale: string, fallback = ''): string {
  return langText(node.displayName, locale)
    || langText(conceptOf(node, concepts)?.preferredName ?? [], locale)
    || (node.idShort ? humanize(node.idShort) : fallback)
}

/** What an element means: its concept's definition, else its description. */
export function definitionOf (node: Named, concepts: Concepts, locale: string): string {
  return langText(conceptOf(node, concepts)?.definition ?? [], locale) || langText(node.description, locale)
}

const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:positiveInteger', 'xs:negativeInteger',
  'xs:nonNegativeInteger', 'xs:nonPositiveInteger'])

/** A number in the user's format, with the decimals it was given: `3.0` → "3,0" in German; other values as they are. */
export function numberText (value: string, locale: string): string {
  const match = /^[+-]?\d+(?:\.(\d+))?$/.exec(value.trim())
  if (!match) {
    return value
  }
  const decimals = match[1]?.length ?? 0
  try {
    return new Intl.NumberFormat([locale, 'en'], { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: 'min2' }).format(Number(value))
  } catch {
    return value
  }
}

/** A date (`YYYY-MM-DD`) or date and time in the user's format; other values as they are. */
export function dateText (value: string, locale: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  try {
    if (date) {
      const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])))
      // A day that does not exist, such as month 13, as it is: Date would roll it over.
      return parsed.toISOString().slice(0, 10) === value.trim() ? new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) : value
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim())) {
      const parsed = new Date(value.trim())
      return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
    }
  } catch {
    // An unknown locale: as it is.
  }
  return value
}

/** A value by its type: numbers and dates in the user's format, booleans as yes or no. */
export function typedText (t: Translate, value: string, valueType: string, locale: string): string {
  if (value === '') {
    return ''
  }
  if (numericTypes.has(valueType)) {
    return numberText(value, locale)
  }
  if (valueType === 'xs:boolean' && ['true', 'false', '1', '0'].includes(value)) {
    return t(value === 'true' || value === '1' ? 'value.yes' : 'value.no')
  }
  if (valueType === 'xs:date' || valueType === 'xs:dateTime') {
    return dateText(value, locale)
  }
  return value
}

/** A Range: "min – max", or "≥ min" / "≤ max" when one end is open. */
export function rangeText (min: string, max: string): string {
  if (min && max) {
    return `${min} – ${max}`
  }
  if (min) {
    return `≥ ${min}`
  }
  return max ? `≤ ${max}` : ''
}

/** A field's value as the view shows it. */
export function fieldValue (t: Translate, field: EditableField | undefined, valueType: string, locale: string): string {
  if (!field) {
    return ''
  }
  if (field.modelType === 'Range') {
    return rangeText(typedText(t, field.min, field.valueType, locale), typedText(t, field.max, field.valueType, locale))
  }
  return field.modelType === 'Property' ? typedText(t, fieldText(field, locale), valueType, locale) : fieldText(field, locale)
}

function valueOf (t: Translate, node: Extract<SheetNode, { kind: 'value' }>, locale: string): string {
  if (node.field) {
    return fieldValue(t, node.field, node.valueType, locale)
  }
  return node.file?.name ?? node.text
}

/**
 * An area's data sheet as table rows, depth first: a row per section, above
 * its elements, and a row per value with its unit. Without values, a
 * section has no row, except in edit mode, where every value is a row.
 */
export function sheetRows (t: Translate, area: SheetArea, concepts: Concepts, locale: string, edit: boolean): SheetRow[] {
  const rows: SheetRow[] = []
  const visit = (nodes: SheetNode[], depth: number, sections: Array<{ key: string, label: string }>) => {
    for (const [index, node] of nodes.entries()) {
      const label = labelOf(node, concepts, locale, t('sheet.entry', { number: index + 1 }))
      const definition = definitionOf(node, concepts, locale)
      if (node.kind === 'section') {
        const at = rows.length
        visit(node.children, depth + 1, [...sections, { key: node.path, label }])
        if (rows.length > at) {
          rows.splice(at, 0, {
            key: node.path,
            kind: 'section',
            depth,
            label,
            definition,
            value: '',
            unit: '',
            sections: sections.map(section => section.key),
            haystack: [label, node.idShort, ...sections.map(section => section.label)].join(' ').toLowerCase(),
          })
        }
        continue
      }
      const value = valueOf(t, node, locale)
      if (!edit && value === '') {
        continue
      }
      const unit = value === '' ? '' : (conceptOf(node, concepts)?.unit ?? '')
      rows.push({
        key: node.path,
        kind: 'value',
        depth,
        label,
        definition,
        value,
        unit,
        field: node.field,
        file: node.file ?? undefined,
        sections: sections.map(section => section.key),
        haystack: [label, node.idShort, value, unit, ...sections.map(section => section.label)].join(' ').toLowerCase(),
      })
    }
  }
  visit(area.children, 0, [])
  return rows
}

/**
 * The rows that match every word of a search, with the sections they lie in;
 * all rows for an empty search. A section's label matches its elements.
 */
export function filterRows (rows: SheetRow[], query: string): SheetRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) {
    return rows
  }
  const matches = rows.filter(row => row.kind === 'value' && words.every(word => row.haystack.includes(word)))
  const sections = new Set(matches.flatMap(row => row.sections))
  return rows.filter(row => (row.kind === 'section' ? sections.has(row.key) : matches.includes(row)))
}

/** An area's title: its label, else "Area n". */
/**
 * The titles of areas: each one's label, else `fallback` with its number;
 * a title several areas share, such as their concept's "Technical property
 * area", is numbered.
 */
export function areaTitles (areas: SheetArea[], concepts: Concepts, locale: string, fallback: (number: number) => string): string[] {
  const titles = areas.map((area, index) => labelOf(area, concepts, locale, fallback(index + 1)))
  const seen = new Map<string, number>()
  return titles.map(title => {
    if (titles.filter(other => other === title).length < 2) {
      return title
    }
    const number = (seen.get(title) ?? 0) + 1
    seen.set(title, number)
    return `${title} ${number}`
  })
}

/** E.g. "IDTA 02003-2-0"; 1.2 and 1.1 were ZVEI's. */
export function templateLabel (version: string | null): string {
  if (version === null) {
    return 'IDTA 02003'
  }
  return version.startsWith('1.') ? `ZVEI Technical Data ${version}` : `IDTA 02003-${version.replace('.', '-')}`
}

const generalIcons: Record<GeneralFieldKey, string> = {
  manufacturerName: 'mdi-factory',
  productDesignation: 'mdi-tag-outline',
  articleNumber: 'mdi-pound',
  orderCode: 'mdi-cart-outline',
}

const text = (data: TechnicalData, key: GeneralFieldKey, locale: string) => fieldText(data.general[key], locale)

/** The heading: the product, its manufacturer, article number and order code. */
export function headline (t: Translate, data: TechnicalData, locale: string) {
  const article = text(data, 'articleNumber', locale)
  const order = text(data, 'orderCode', locale)
  return {
    title: text(data, 'productDesignation', locale) || t('technicalData.untitled'),
    manufacturer: text(data, 'manufacturerName', locale),
    details: [article && t('general.articleShort', { value: article }), order && t('general.orderShort', { value: order })].filter(Boolean).join(' · '),
  }
}

/** The general information as rows; in view mode only what has a value. */
export function generalRows (t: Translate, data: TechnicalData, locale: string, edit: boolean): DetailRow[] {
  return (['manufacturerName', 'productDesignation', 'articleNumber', 'orderCode'] as const)
    .map((key): DetailRow | null => {
      const field = data.general[key]
      if (!field) {
        return null
      }
      const value = fieldText(field, locale)
      return { key, label: t(`general.${key}`), value, icon: generalIcons[key], field, copy: key === 'articleNumber' || key === 'orderCode' ? value : undefined }
    })
    .filter((row): row is DetailRow => row !== null && (edit || row.value !== ''))
}

/** A classification's short name: "ECLASS 13.0 · 27-02-24-01". */
export function classificationChip (classification: Classification, locale: string): string {
  const system = [fieldText(classification.system, locale), fieldText(classification.version, locale)].filter(Boolean).join(' ')
  return [system, fieldText(classification.classId, locale)].filter(Boolean).join(' · ')
}

/** A classification's class: its name, else its coded name. */
export function className (classification: Classification, locale: string): string {
  return fieldText(classification.className, locale) || fieldText(classification.codedName, locale)
}

/** An https URL a value names; `null` for other values. */
export function httpsUrl (value: string): string | null {
  const url = URL.parse(value.trim())
  return url?.protocol === 'https:' && url.hostname.includes('.') ? url.href : null
}

/** The further information as rows: the valid date first, then the statements. */
export function furtherRows (t: Translate, data: TechnicalData, locale: string, edit: boolean): DetailRow[] {
  const further = data.further
  if (!further) {
    return []
  }
  const rows: DetailRow[] = []
  if (further.validDate) {
    rows.push({ key: 'validDate', label: t('further.validDate'), value: dateText(fieldText(further.validDate, locale), locale), icon: 'mdi-calendar-check-outline', field: further.validDate })
  }
  for (const [index, statement] of further.statements.entries()) {
    rows.push({ key: `statement:${index}`, label: t('further.statement'), value: fieldText(statement, locale), icon: 'mdi-text', field: statement })
  }
  return rows.filter(row => edit || row.value !== '')
}

/** A classification's fields as rows, to change them in edit mode. */
export function classificationRows (t: Translate, classification: Classification, locale: string): DetailRow[] {
  const fields = [
    ['system', classification.system],
    ['version', classification.version],
    ['url', classification.url],
    ['classId', classification.classId],
    ['codedName', classification.codedName],
    ['className', classification.className],
  ] as const
  return fields
    .filter(([, field]) => field !== undefined)
    .map(([key, field]) => ({ key: `${classification.path}:${key}`, label: t(`classification.fields.${key}`), value: fieldText(field, locale), field }))
}
