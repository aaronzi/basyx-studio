import type { ConceptInfo, JsonObject } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { fieldText } from '@basyx/studio-app-kit/aas'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'
import { appMethodParamsSchemas } from '#shared/contract'
import { areaTitle, classificationChip, classificationRows, conceptMap, conceptQuery, conceptSpellings, dateText, filterRows, furtherRows, generalRows, headline, numberText, rangeText, sheetRows, templateLabel, typedText } from '../../apps/technical-data/ui/src/presentation'
import { parseTechnicalData, referencedPath, sheetConceptIds, templateVersion } from '../../apps/technical-data/ui/src/technicalData'

// The Technical Data app's reading of IDTA 02003 2.0 and ZVEI 1.2, and what
// its data sheets show, on the technical data demo of the open
// infrastructure (test-setup/fixtures/generate-technical-data.mjs), with the
// demo's concept descriptions through the test Studio (app API 0.1.15).

const environment = JSON.parse(readFileSync(new URL('../../test-setup/fixtures/technical-data/studio-technical-data.json', import.meta.url), 'utf8')) as { submodels: JsonObject[], conceptDescriptions: JsonObject[] }
const submodel = (id: string) => environment.submodels.find(entry => entry.id === id)!
const v2 = parseTechnicalData(submodel('urn:studio:test:sm:technical-data:2-0'))
const v12 = parseTechnicalData(submodel('urn:studio:test:sm:technical-data:1-2'))
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

/** The demo's concept descriptions, as the app asks Studio for them. */
async function conceptsOf (data: ReturnType<typeof parseTechnicalData>) {
  const aas = memoryAas({ conceptDescriptions: environment.conceptDescriptions })
  const { client } = createTestStudio({ handlers: aas.handlers })
  const { concepts } = await client.aas.describeConcepts(conceptQuery(sheetConceptIds(data)))
  return conceptMap(concepts as Array<ConceptInfo | null>)
}

describe('reading technical data', () => {
  it('names the template version', () => {
    expect(templateVersion('0173-1#01-AHX837#002')).toBe('2.0')
    expect(templateVersion('https://admin-shell.io/idta/TechnicalData/Submodel/2/0')).toBe('2.0')
    expect(templateVersion('https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2')).toBe('1.2')
    expect(templateVersion('https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/1/')).toBe('1.1')
    expect(templateVersion('https://example.com/other')).toBeNull()
    expect([v2.version, v12.version]).toEqual(['2.0', '1.2'])
    expect([templateLabel('2.0'), templateLabel('1.2'), templateLabel(null)]).toEqual(['IDTA 02003-2-0', 'ZVEI Technical Data 1.2', 'IDTA 02003'])
  })

  it('reads the general information, logo and images of 2.0 and of 1.2', () => {
    expect(headline(t, v2, 'de')).toEqual({ title: 'Servoantrieb SD-200', manufacturer: 'Example Drives GmbH', details: 'general.articleShort{"value":"SD-200-400-3"} · general.orderShort{"value":"SD200-4-3-B"}' })
    expect(v2.logo).toMatchObject({ path: 'GeneralInformation.CompanyLogo', name: 'example-drives-logo.svg' })
    expect(v12.logo).toMatchObject({ path: 'GeneralInformation.ManufacturerLogo' })
    // 2.0: a list of ImageFile and ImageNote, each image its own (the Web UI showed the first one three times).
    expect(v2.images.map(image => [image.path, image.file.name, fieldText(image.note, 'en')])).toEqual([
      ['GeneralInformation.ProductImages[0]', 'sd-200-front.png', 'Front view'],
      ['GeneralInformation.ProductImages[1]', 'sd-200-side.png', 'Connectors at the bottom'],
      ['GeneralInformation.ProductImages[2]', 'sd-200-mounting.png', ''],
    ])
    // 1.2: numbered ProductImage files.
    expect(v12.images.map(image => image.file.path)).toEqual(['GeneralInformation.ProductImage01', 'GeneralInformation.ProductImage02'])
    expect(generalRows(t, v2, 'en', false).map(row => [row.key, row.value, row.copy])).toEqual([
      ['manufacturerName', 'Example Drives GmbH', undefined],
      ['productDesignation', 'Servo drive SD-200', undefined],
      ['articleNumber', 'SD-200-400-3', 'SD-200-400-3'],
      ['orderCode', 'SD200-4-3-B', 'SD200-4-3-B'],
    ])
  })

  it('reads classifications in the template\'s fields, whichever are there, and the area one refers to', () => {
    expect(v2.classifications.map(entry => [classificationChip(entry, 'en'), fieldText(entry.url, 'en'), entry.areaPath])).toEqual([
      ['ECLASS 14.0 · 27-02-31-90', 'https://eclass.eu', 'TechnicalPropertyAreas[0]'],
      ['IEC CDD 2.0 · ZZB001', '', null],
    ])
    // 1.2 calls the system ProductClassificationSystem.
    expect(v12.classifications.map(entry => classificationChip(entry, 'en'))).toEqual(['ECLASS 11.1 · 27-02-31-90'])
    expect(v2.areas[0]!.path).toBe('TechnicalPropertyAreas[0]')
    expect(classificationRows(t, v2.classifications[1]!, 'en').map(row => row.label)).toEqual(['classification.fields.system', 'classification.fields.version', 'classification.fields.classId', 'classification.fields.codedName'])
  })

  it('turns model references into idShortPaths, list items with their index', () => {
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }, { type: 'SubmodelElementList', value: 'Areas' }, { type: 'SubmodelElementCollection', value: '1' }, { type: 'Property', value: 'P' }] })).toBe('Areas[1].P')
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }, { type: 'SubmodelElementCollection', value: 'A' }, { type: 'SubmodelElementCollection', value: 'B' }] })).toBe('A.B')
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }] })).toBeNull()
    expect(referencedPath(undefined)).toBeNull()
  })

  it('reads ValidDate by its idShort although 1.2 gives it ManufacturerOrderCode\'s semantic ID', () => {
    expect(fieldText(v12.further?.validDate, 'en')).toBe('2023-06-01')
    expect(furtherRows(t, v2, 'de', false).map(row => [row.label, row.value])).toEqual([
      ['further.validDate', '15.01.2026'],
      ['further.statement', 'Werte bei 40 °C Umgebungstemperatur und 8 kHz Schaltfrequenz.'],
      ['further.statement', 'Technische Änderungen vorbehalten.'],
    ])
  })
})

describe('the data sheets', () => {
  it('asks for every element\'s semantic and supplemental IDs, ECLASS IRDIs in both spellings, without placeholders', () => {
    const ids = sheetConceptIds(v2)
    expect(ids).toContain('https://example.com/ids/cd/technical-data/SafetyIntegrityLevel')
    expect(ids).not.toContain('https://admin-shell.io/SMT/General/Arbitrary')
    expect(sheetConceptIds(v12)).not.toContain('https://admin-shell.io/SemanticIdNotAvailable/1/1')
    expect(conceptSpellings('0173-1#02-ZZA001#001')).toEqual(['0173-1#02-ZZA001#001', 'https://api.eclass-cdp.com/0173-1-02-ZZA001-001'])
    expect(conceptSpellings('https://api.eclass-cdp.com/0173-1-02-zza001-001')).toEqual(['https://api.eclass-cdp.com/0173-1-02-zza001-001', '0173-1#02-ZZA001#001'])
    expect(conceptSpellings('https://example.com/a')).toEqual(['https://example.com/a'])
    expect(conceptQuery(['0173-1#02-ZZA001#001', '0173-1#02-ZZA001#001'])).toHaveLength(2)
  })

  it('shows an area as property, value and unit rows, sections above their elements, with names and units of the concepts', async () => {
    const concepts = await conceptsOf(v2)
    const rows = sheetRows(t, v2.areas[0]!, concepts, 'en', false)
    expect(rows.map(row => [row.kind, row.depth, row.label, row.value, row.unit])).toEqual([
      ['value', 0, 'Rated power', '3.0', 'kW'],
      ['value', 0, 'Rated voltage', '400', 'V'],
      // Its concept description is under the api.eclass-cdp.com spelling.
      ['value', 0, 'Rated current', '7.25', 'A'],
      ['section', 0, 'Power supply', '', ''],
      ['value', 1, 'Supply frequency', '50 – 60', 'Hz'],
      ['value', 1, 'Number of phases', '3', '1'],
      ['section', 1, 'Protection', '', ''],
      ['value', 2, 'Overvoltage protection', 'value.yes', ''],
      ['value', 2, 'Short-circuit current rating', '65', 'kA'],
      ['value', 0, 'Ambient temperature in operation', '-20 – 40', '°C'],
      ['value', 0, 'Installation altitude', '≤ 1000', 'm'],
      ['value', 0, 'Integrated brake chopper', 'value.no', ''],
      ['value', 0, 'Firmware release date', 'Mar 1, 2026', ''],
      ['value', 0, 'Dimension drawing', 'sd-200-dimensions.svg', ''],
      ['value', 0, 'Application note', 'For synchronous servo motors up to 3 kW.', ''],
    ])
    expect(rows[0]!.definition).toBe('Mechanical power at the shaft in continuous operation at rated values.')
    expect(rows.find(row => row.label === 'Dimension drawing')).toMatchObject({ file: { path: 'TechnicalPropertyAreas[0].DimensionDrawing' }, copy: undefined })
    expect(rows.find(row => row.label === 'Supply frequency')!.field).toMatchObject({ modelType: 'Range', min: '50', max: '60' })
    // German names and numbers from the same concepts.
    expect(sheetRows(t, v2.areas[0]!, concepts, 'de', false).slice(0, 3).map(row => [row.label, row.value])).toEqual([['Bemessungsleistung', '3,0'], ['Bemessungsspannung', '400'], ['Bemessungsstrom', '7,25']])
    // Without concept descriptions: idShorts and no units.
    expect(sheetRows(t, v2.areas[0]!, new Map(), 'en', false)[0]).toMatchObject({ label: 'Rated power', unit: '' })
    expect(sheetRows(t, v2.areas[1]!, new Map(), 'en', false)[0]).toMatchObject({ label: 'Weight', value: '4.85', unit: '' })
  })

  it('names areas by their display name and specific descriptions by a supplemental semantic ID\'s concept', async () => {
    const concepts = await conceptsOf(v2)
    expect(v2.areas.map((area, index) => areaTitle(t, area, index, concepts, 'de'))).toEqual(['Elektrisch', 'Mechanisch'])
    expect(sheetRows(t, v2.specificDescriptions[0]!, concepts, 'en', false).map(row => [row.label, row.value])).toEqual([
      ['Safety function', 'STO (Safe torque off)'],
      ['Safety integrity level', 'SIL 3'],
      ['Performance level', 'PL e'],
    ])
    expect(areaTitle(t, { ...v2.areas[0]!, displayName: [] }, 0, concepts, 'en')).toBe('sheet.area{"number":1}')
  })

  it('reads 1.2\'s main and sub sections, and elements without a dictionary ID', async () => {
    const concepts = await conceptsOf(v12)
    expect(v12.areas).toHaveLength(1)
    expect(sheetRows(t, v12.areas[0]!, concepts, 'en', false).map(row => [row.depth, row.label, row.value, row.unit])).toEqual([
      [0, 'Electrical', '', ''],
      [1, 'Rated power', '3.0', 'kW'],
      [1, 'Rated voltage', '400', 'V'],
      [1, 'Supply', '', ''],
      [2, 'Supply frequency', '50 – 60', 'Hz'],
      [0, 'Mechanical', '', ''],
      [1, 'Weight', '4.9', 'kg'],
      [0, 'Colour of housing', 'Anthracite', ''],
    ])
  })

  it('finds rows by every word, in their label, value, unit or section, keeping the sections above them', async () => {
    const rows = sheetRows(t, v2.areas[0]!, await conceptsOf(v2), 'en', false)
    expect(filterRows(rows, '')).toBe(rows)
    expect(filterRows(rows, 'kA').map(row => row.label)).toEqual(['Power supply', 'Protection', 'Short-circuit current rating'])
    expect(filterRows(rows, 'supply phases').map(row => row.label)).toEqual(['Power supply', 'Number of phases'])
    expect(filterRows(rows, 'POWER rated').map(row => row.label)).toEqual(['Rated power'])
    expect(filterRows(rows, 'nothing like this')).toEqual([])
  })

  it('lists every value in edit mode, empty ones too, and hides sections without values', async () => {
    const [weight] = v2.areas[1]!.children
    const area = { ...v2.areas[1]!, children: [...v2.areas[1]!.children, { ...weight!, path: 'X.Empty', idShort: 'Empty', conceptIds: [], field: { path: 'X.Empty', modelType: 'Property' as const, values: [], valueId: '' } }] }
    const concepts = await conceptsOf(v2)
    expect(sheetRows(t, area, concepts, 'en', false).map(row => row.label)).not.toContain('Empty')
    expect(sheetRows(t, area, concepts, 'en', true).map(row => row.label)).toContain('Empty')
  })
})

describe('values', () => {
  it('formats numbers with the decimals given, dates, and booleans by their type', () => {
    expect(numberText('3.0', 'de')).toBe('3,0')
    expect(numberText('1500', 'en')).toBe('1500')
    expect(numberText('15000.5', 'en')).toBe('15,000.5')
    expect(numberText('-20', 'en')).toBe('-20')
    expect(numberText('1e3', 'en')).toBe('1e3')
    expect(numberText('n/a', 'en')).toBe('n/a')
    expect(typedText(t, '1', 'xs:boolean', 'en')).toBe('value.yes')
    expect(typedText(t, 'maybe', 'xs:boolean', 'en')).toBe('maybe')
    expect(typedText(t, 'IP65', 'xs:string', 'en')).toBe('IP65')
    expect(dateText('2026-01-15', 'en')).toBe('Jan 15, 2026')
    expect(dateText('2026-13-45', 'en')).toBe('2026-13-45')
    expect(dateText('soon', 'en')).toBe('soon')
    expect([rangeText('1', '2'), rangeText('1', ''), rangeText('', '2'), rangeText('', '')]).toEqual(['1 – 2', '≥ 1', '≤ 2', ''])
  })
})

describe('describing concepts (app API 0.1.15)', () => {
  it('answers in the order asked, null for IDs without a concept description', async () => {
    const aas = memoryAas({ conceptDescriptions: environment.conceptDescriptions })
    const { client } = createTestStudio({ handlers: aas.handlers })
    const { concepts } = await client.aas.describeConcepts(['urn:unknown', 'https://example.com/ids/cd/technical-data/RatedPower', 'urn:unknown'])
    expect(concepts[0]).toBeNull()
    expect(concepts[1]).toMatchObject({ id: 'https://example.com/ids/cd/technical-data/RatedPower', unit: 'kW', shortName: [{ language: 'en', text: 'P' }], dataType: 'REAL_MEASURE' })
    expect(concepts[2]).toBeNull()
  })

  it('takes up to 500 IDs', () => {
    const schema = appMethodParamsSchemas['studio.aas.describeConcepts']
    expect(schema.safeParse({ ids: Array.from({ length: 500 }, (_, index) => `urn:x:${index}`) }).success).toBe(true)
    expect(schema.safeParse({ ids: Array.from({ length: 501 }, (_, index) => `urn:x:${index}`) }).success).toBe(false)
    expect(schema.safeParse({ ids: [''] }).success).toBe(false)
  })
})
