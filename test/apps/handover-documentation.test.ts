import type { JsonObject } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classificationKey, documentAt, documentTitle, irdiOf, latestVersion, mainClassification, matchesQuery, parseHandoverDocumentation, referencePath, sortVersions } from '../../apps/handover-documentation/ui/src/handoverDocumentation'
import { dateText, documentSubtitle, fileLabel, statusColor, statusText, technicalGroups, titleText, versionFacts, versionLabel } from '../../apps/handover-documentation/ui/src/presentation'

// The Documents app's reading of IDTA 02004 Handover Documentation (2.0 and
// 1.2) and VDI 2770, on the demo of the open infrastructure
// (test-setup/fixtures/generate-file-previews.mjs).

const environment = JSON.parse(readFileSync(new URL('../../test-setup/fixtures/handover-documentation/studio-handover-documentation.json', import.meta.url), 'utf8')) as { submodels: JsonObject[] }
const v2 = environment.submodels.find(submodel => submodel.id === 'urn:studio:test:sm:handover-documentation:2-0')!
const v1 = environment.submodels.find(submodel => submodel.id === 'urn:studio:test:sm:handover-documentation:1-2')!
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

describe('parseHandoverDocumentation (IDTA 02004-2-0)', () => {
  const { documents, entities } = parseHandoverDocumentation(v2)

  it('reads every document of the demo', () => {
    expect(documents.map(document => document.ids[0]?.value)).toEqual(['GM40-OM', 'GM40-OM-DE', 'GM40-DOC', 'GM40-DRW-001', 'GM40-MI', 'GM40-SP', 'GM40-SI', 'GM40-DS', 'GM40-SC'])
    expect(documents.map(document => document.key)).toEqual(documents.map((_, index) => `Documents[${index}]`))
  })

  it('reads identifiers, classifications, versions and files', () => {
    const [manual] = documents
    expect(manual!.ids).toEqual([
      { domain: 'Example Drives', value: 'GM40-OM', primary: true },
      { domain: 'Customer', value: 'C-4711-0815', primary: false },
    ])
    expect(manual!.classifications.map(entry => [entry.system, entry.id])).toEqual([['VDI2770:2020', '03-02'], ['Example Drives document types', 'OM']])
    expect(manual!.versions).toHaveLength(2)
    expect(manual!.versions[1]).toMatchObject({
      key: 'Documents[0].DocumentVersions[1]',
      version: '2.0',
      languages: ['en', 'de'],
      status: 'Released',
      setDate: '2026-09-01',
      organization: { shortName: 'Example Drives', officialName: 'Example Drives GmbH' },
      preview: { path: 'Documents[0].DocumentVersions[1].PreviewFile', contentType: 'image/png', name: 'preview-operating-manual.png', external: false },
    })
    expect(manual!.versions[1]!.digitalFiles.map(file => [file.path, file.name])).toEqual([
      ['Documents[0].DocumentVersions[1].DigitalFiles[0]', 'gm40-operating-manual-en.pdf'],
      ['Documents[0].DocumentVersions[1].DigitalFiles[1]', 'gm40-betriebsanleitung-de.pdf'],
    ])
    expect(manual!.versions[1]!.title).toEqual([{ language: 'en', text: 'Operating manual' }, { language: 'de', text: 'Betriebsanleitung' }])
    expect(manual!.versions[1]!.keywords[0]!.text).toContain('frequency converter')
  })

  it('reads relations, documented entities and the entities', () => {
    const [manual, translation] = documents
    expect(manual!.versions[1]!.basedOn).toEqual([[
      { type: 'Submodel', value: 'urn:studio:test:sm:handover-documentation:2-0' },
      { type: 'SubmodelElementList', value: 'Documents' },
      { type: 'SubmodelElementCollection', value: '1' },
    ]])
    expect(translation!.versions[0]!.translationOf).toHaveLength(1)
    expect(documents[4]!.versions[1]!.refersTo).toHaveLength(2)
    expect(documents[3]!.documentedEntities.map(keys => keys[0]!.type)).toEqual(['Submodel', 'AssetAdministrationShell'])
    expect(entities).toEqual([{ path: 'Entities[0]', name: 'Gear motor GM-40, serial 0001', globalAssetId: 'urn:studio:test:asset:gear-motor-gm40' }])
  })

  it('reads external files and versions without a file', () => {
    expect(documents[7]!.versions[0]!.digitalFiles[0]).toMatchObject({ external: true, name: 'compressed.tracemonkey-pldi-09.pdf', contentType: 'application/pdf' })
    expect(documents[8]!.versions[0]!.digitalFiles).toEqual([])
    expect(documents[8]!.versions[0]!.preview).toBeNull()
  })
})

describe('parseHandoverDocumentation (IDTA 02004-1-2)', () => {
  const { documents, entities } = parseHandoverDocumentation(v1)

  it('reads numbered collections and the elements 1.2 names differently', () => {
    expect(documents.map(document => document.key)).toEqual(['Document01', 'Document02', 'Document03'])
    const manual = documents[0]!
    expect(manual.ids).toEqual([{ domain: 'Example Drives', value: 'GM40-OM', primary: true }])
    expect(manual.classifications[0]).toMatchObject({ id: '03-02', system: 'VDI2770:2020' })
    expect(manual.versions.map(version => version.key)).toEqual(['Document01.DocumentVersion01', 'Document01.DocumentVersion02'])
    expect(manual.versions[1]).toMatchObject({ version: '2.0', languages: ['en', 'de'], subtitle: [{ language: 'en', text: 'Gear motor GM-40' }], description: [{ language: 'en', text: 'With frequency converter operation.' }] })
    expect(manual.versions[1]!.digitalFiles.map(file => file.path)).toEqual(['Document01.DocumentVersion02.DigitalFile01', 'Document01.DocumentVersion02.DigitalFile02'])
    expect(manual.versions[1]!.preview?.path).toBe('Document01.DocumentVersion02.PreviewFile')
    expect(manual.documentedEntities).toHaveLength(1)
    expect(documents[1]!.versions[0]!.refersTo[0]).toEqual([
      { type: 'Submodel', value: 'urn:studio:test:sm:handover-documentation:1-2' },
      { type: 'SubmodelElementCollection', value: 'Document01' },
    ])
    expect(entities).toEqual([{ path: 'Entity01', name: 'Gear motor GM-40, serial 0001', globalAssetId: 'urn:studio:test:asset:gear-motor-gm40' }])
  })
})

describe('other shapes', () => {
  const property = (idShort: string, value: string, semanticId?: string): JsonObject => ({
    idShort,
    modelType: 'Property',
    valueType: 'xs:string',
    value,
    ...(semanticId ? { semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: semanticId }] } } : {}),
  })
  const collection = (idShort: string, value: JsonObject[], semanticId?: string): JsonObject => ({
    idShort,
    modelType: 'SubmodelElementCollection',
    value,
    ...(semanticId ? { semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: semanticId }] } } : {}),
  })
  const file = (idShort: string, value: string, contentType = 'application/pdf'): JsonObject => ({ idShort, modelType: 'File', contentType, value })

  it('reads VDI 2770 submodels: a DocumentId property, idShorts in other cases, URL semantic IDs', () => {
    const vdi = 'https://admin-shell.io/vdi/2770/1/0'
    const { documents } = parseHandoverDocumentation({
      modelType: 'Submodel',
      submodelElements: [collection('Document_01', [
        property('DocumentId', 'VDI-1', `${vdi}/Document/DocumentId`),
        property('IsPrimaryDocumentId', 'true', `${vdi}/Document/IsPrimaryDocumentId`),
        collection('DocumentClassification', [property('ClassId', '03-02'), property('ClassName', 'Operation'), property('ClassificationSystem', 'VDI2770:2018')]),
        collection('DocumentVersion', [
          property('language', 'en', `${vdi}/DocumentVersion/Language`),
          property('DocumentVersionId', '1'),
          property('Title', 'Manual'),
          property('Summary', 'A summary'),
          property('SetDate', '2020-01-01'),
          file('DigitalFile', '/aasx/manual.pdf'),
        ], `${vdi}/DocumentVersion`),
      ], `${vdi}/Document`)],
    })
    expect(documents).toHaveLength(1)
    expect(documents[0]!.ids).toEqual([{ domain: '', value: 'VDI-1', primary: true }])
    expect(documents[0]!.classifications[0]).toEqual({ id: '03-02', name: [{ language: '', text: 'Operation' }], system: 'VDI2770:2018' })
    expect(documents[0]!.versions[0]).toMatchObject({ version: '1', languages: ['en'], title: [{ language: '', text: 'Manual' }], setDate: '2020-01-01' })
    expect(documents[0]!.versions[0]!.digitalFiles[0]?.name).toBe('manual.pdf')
  })

  it('reads lists stored as collections, and elements found by IRDI only', () => {
    const { documents } = parseHandoverDocumentation({
      modelType: 'Submodel',
      submodelElements: [collection('Documents', [
        collection('Doc', [collection('Versions', [
          collection('V', [
            property('VersionNo', '3', 'https://api.eclass-cdp.com/0173-1-02-AAP003-005'),
            collection('DigitalFiles', [file('F', 'https://example.com/a%20b.pdf')]),
          ], '0173-1#02-ABI503#003/0173-1#01-AHF582#003'),
        ], '0173-1#02-ABI503#003')], '0173-1#02-ABI500#003/0173-1#01-AHF579#003'),
      ])],
    })
    expect(documents).toHaveLength(1)
    expect(documents[0]!.versions[0]!.version).toBe('3')
    expect(documents[0]!.versions[0]!.digitalFiles[0]).toMatchObject({ external: true, name: 'a b.pdf' })
  })

  it('normalizes IRDIs', () => {
    expect(irdiOf('0173-1#02-ABI500#003')).toBe('0173-1#02-ABI500')
    expect(irdiOf('0173-1#02-ABI500#001/0173-1#01-AHF579#001')).toBe('0173-1#02-ABI500')
    expect(irdiOf('https://api.eclass-cdp.com/0173-1-02-ABI002-003')).toBe('0173-1#02-ABI002')
    expect(irdiOf('https://admin-shell.io/vdi/2770/1/0/Document')).toBe('')
  })

  it('reads an empty submodel', () => {
    expect(parseHandoverDocumentation({ modelType: 'Submodel', submodelElements: [] })).toEqual({ documents: [], entities: [] })
  })
})

describe('versions, titles, search and references', () => {
  const { documents, entities } = parseHandoverDocumentation(v2)
  const maintenance = documents[4]!

  it('takes the latest version by date and lists versions newest first', () => {
    expect(latestVersion(maintenance.versions)?.version).toBe('3.0')
    expect(sortVersions(documents[0]!.versions).map(version => version.version)).toEqual(['2.0', '1.0'])
    expect(latestVersion([])).toBeUndefined()
  })

  it('titles documents in the user\'s language', () => {
    const manual = documents[0]!
    expect(documentTitle(manual, latestVersion(manual.versions), 'de')).toBe('Betriebsanleitung')
    expect(documentTitle(manual, latestVersion(manual.versions), 'fr')).toBe('Operating manual')
    expect(titleText(t, { key: 'x', ids: [], classifications: [], versions: [], documentedEntities: [] }, undefined, 2, 'en')).toBe('document.untitled{"number":3}')
    expect(documentSubtitle(t, manual, latestVersion(manual.versions), 'en')).toBe('Operation · v2.0')
  })

  it('prefers the VDI 2770 classification', () => {
    expect(mainClassification(documents[0]!)?.id).toBe('03-02')
    expect(classificationKey(documents[0]!.classifications[1]!)).toBe('Example Drives document types|OM')
  })

  it('searches titles, identifiers, classes, keywords and file names', () => {
    expect(documents.filter(document => matchesQuery(document, 'frequency converter')).map(document => document.ids[0]?.value)).toEqual(['GM40-OM'])
    expect(documents.filter(document => matchesQuery(document, 'gm40-sp')).map(document => document.ids[0]?.value)).toEqual(['GM40-SP'])
    expect(documents.filter(document => matchesQuery(document, 'spare-parts.csv'))).toHaveLength(1)
    expect(documents.filter(document => matchesQuery(document, 'Ersatzteile'))).toHaveLength(1)
    expect(documents.filter(document => matchesQuery(document, '  '))).toHaveLength(documents.length)
  })

  it('resolves references into the submodel', () => {
    const keys = maintenance.versions[1]!.refersTo[1]!
    expect(referencePath(keys, String(v2.id))).toBe('Documents[5]')
    expect(documentAt(documents, 'Documents[5].DocumentVersions[0]')?.ids[0]?.value).toBe('GM40-SP')
    expect(documentAt(documents, 'Documents[50]')).toBeUndefined()
    expect(referencePath(keys, 'urn:other')).toBeNull()
    expect(referencePath([{ type: 'Submodel', value: 'urn:sm' }, { type: 'SubmodelElementCollection', value: 'Document01' }, { type: 'File', value: 'DigitalFile01' }], 'urn:sm')).toBe('Document01.DigitalFile01')

    const context = { submodelId: String(v2.id), documents, entities, titleOf: (document: typeof documents[number]) => document.ids[0]!.value }
    const relations = technicalGroups(t, maintenance, maintenance.versions[1], context, 'en').find(group => group.key === 'relations')!
    expect(relations.rows).toEqual([
      { label: 'details.refersTo', value: 'GM40-OM', document: 'Documents[0]' },
      { label: 'details.refersTo', value: 'GM40-SP', document: 'Documents[5]' },
    ])
    const drawing = documents[3]!
    const entitiesRows = technicalGroups(t, drawing, drawing.versions[0], context, 'en').find(group => group.key === 'relations')!.rows
    expect(entitiesRows).toEqual([
      { label: 'details.documentedEntity', value: 'Gear motor GM-40, serial 0001 (urn:studio:test:asset:gear-motor-gm40)' },
      { label: 'details.documentedEntity', value: 'urn:studio:test:aas:models3d', shell: 'urn:studio:test:aas:models3d' },
    ])
  })
})

describe('presentation', () => {
  const { documents } = parseHandoverDocumentation(v2)

  it('labels and colors versions and their status', () => {
    expect(versionLabel(t, documents[0]!.versions[1]!, 1)).toBe('v2.0')
    expect(versionLabel(t, { ...documents[0]!.versions[1]!, version: '' }, 1)).toBe('version.number{"number":2}')
    expect(statusText(t, 'InReview')).toBe('values.InReview')
    expect(statusText(t, 'in review')).toBe('values.InReview')
    expect(statusText(t, 'Obsolete')).toBe('Obsolete')
    expect(statusColor('Released')).toBe('success')
    expect(statusColor('InReview')).toBe('warning')
    expect(statusColor('NotReleased')).toBe('error')
  })

  it('formats dates and lists the facts of a version', () => {
    expect(dateText('2026-09-01', 'en')).toBe('Sep 1, 2026')
    expect(dateText('2026-09-01', 'de')).toBe('01.09.2026')
    expect(dateText('soon', 'en')).toBe('soon')
    expect(versionFacts(t, documents[0]!.versions[1], 'en').map(row => [row.label, row.value])).toEqual([
      ['facts.version', '2.0'],
      ['facts.status', 'values.Released'],
      ['facts.date', 'Sep 1, 2026'],
      ['facts.organization', 'Example Drives (Example Drives GmbH)'],
      ['facts.languages', 'English, German'],
    ])
  })

  it('labels files by extension or media type', () => {
    const files = documents[3]!.versions[0]!.digitalFiles
    expect(files.map(file => fileLabel(file))).toEqual(['PNG', 'SVG'])
    expect(fileLabel({ path: 'x', contentType: 'application/x-yaml', value: 'config', name: 'config', external: false })).toBe('YAML')
  })

  it('groups the technical details and leaves out empty groups', () => {
    const groups = technicalGroups(t, documents[0]!, documents[0]!.versions[1], { submodelId: String(v2.id), documents, entities: [], titleOf: () => 'Translation' }, 'en')
    expect(groups.map(group => group.key)).toEqual(['identification', 'classification', 'files', 'relations'])
    expect(groups[0]!.rows).toEqual([
      { label: 'Example Drives', value: 'GM40-OM (details.primary)' },
      { label: 'Customer', value: 'C-4711-0815' },
    ])
    expect(groups[1]!.rows[0]).toEqual({ label: 'VDI2770:2020', value: '03-02 – Operation' })
    const external = technicalGroups(t, documents[7]!, documents[7]!.versions[0], { submodelId: String(v2.id), documents, entities: [], titleOf: () => '' }, 'en')
    expect(external.find(group => group.key === 'files')!.rows[0]!.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\//)
  })
})
