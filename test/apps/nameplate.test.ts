import type { JsonObject } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { fieldText } from '@basyx/studio-app-kit/aas'
import { addressText } from '@basyx/studio-app-kit/contacts'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { draftValue, editLanguage } from '../../apps/nameplate/ui/src/fieldEditor'
import { isExpired, parseNameplate, templateVersion } from '../../apps/nameplate/ui/src/nameplate'
import { countryText, dateText, headline, manufacturerRows, markingExpired, markingName, markingRows, productRows, propertyGroups, templateLabel, versionChips } from '../../apps/nameplate/ui/src/presentation'

// The Digital Nameplate app's reading of IDTA 02006 3.0 and 2.0 and the ZVEI
// nameplate 1.0, on the nameplate demo of the open infrastructure
// (test-setup/fixtures/generate-nameplate.mjs).

const environment = JSON.parse(readFileSync(new URL('../../test-setup/fixtures/nameplate/studio-nameplate.json', import.meta.url), 'utf8')) as { submodels: JsonObject[] }
const submodel = (id: string) => environment.submodels.find(entry => entry.id === id)!
const v3 = parseNameplate(submodel('urn:studio:test:sm:nameplate:3-0'))
const v2 = parseNameplate(submodel('urn:studio:test:sm:nameplate:2-0'))
const v1 = parseNameplate(submodel('urn:studio:test:sm:nameplate:1-0'))
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`
const today = new Date('2026-10-27T12:00:00Z')

describe('parseNameplate (IDTA 02006-3-0)', () => {
  it('reads every field of the product and manufacturer', () => {
    expect(v3.version).toBe('3.0')
    expect(Object.keys(v3.fields)).toEqual([
      'uriOfTheProduct',
      'manufacturerName',
      'manufacturerProductDesignation',
      'manufacturerProductRoot',
      'manufacturerProductFamily',
      'manufacturerProductType',
      'orderCodeOfManufacturer',
      'productArticleNumberOfManufacturer',
      'serialNumber',
      'yearOfConstruction',
      'dateOfManufacture',
      'hardwareVersion',
      'firmwareVersion',
      'softwareVersion',
      'countryOfOrigin',
      'uniqueFacilityIdentifier',
    ])
    expect(fieldText(v3.fields.manufacturerProductDesignation, 'de')).toBe('Getriebemotor GM-40')
    expect(v3.fields.serialNumber).toMatchObject({ path: 'SerialNumber', modelType: 'Property' })
    expect(v3.logo).toMatchObject({ path: 'CompanyLogo', contentType: 'image/svg+xml', name: 'example-drives-logo.svg', external: false })
  })

  it('reads the address of `AddressInformation` through the kit', () => {
    expect(v3.contact?.path).toBe('AddressInformation')
    expect(addressText(v3.contact!, 'en')).toBe('Industriestraße 12, 67663 Kaiserslautern, Rhineland-Palatinate, Germany')
    expect(v3.contact!.channels.map(channel => channel.kind)).toEqual(['phone', 'fax', 'email'])
  })

  it('reads the markings of the list with their files, certificates and dates', () => {
    expect(v3.markings.map((marking, index) => markingName(t, marking, index, 'en'))).toEqual(['CE', 'UKCA', 'WEEE', 'Ex'])
    expect(v3.markings[0]).toMatchObject({
      path: 'Markings[0]',
      file: { path: 'Markings[0].MarkingFile', name: 'marking-ce.svg' },
    })
    expect(fieldText(v3.markings[0]!.designation, 'en')).toBe('EU-DoC GM40-2025-01')
    expect(v3.markings.map(marking => isExpired(fieldText(marking.expiryDate, 'en'), today))).toEqual([false, false, false, true])
    expect(markingExpired(v3.markings[0]!, 'en')).toBe(false)
  })

  it('reads the asset specific properties as a tree', () => {
    const root = v3.assetSpecificProperties!
    expect(root.path).toBe('AssetSpecificProperties')
    expect(root.children.map(child => child.idShort)).toEqual(['GuidelineSpecificProperties', 'RatingPlate'])
    expect(root.children.at(0)!.children.at(1)!.children.map(child => child.path)).toEqual([
      'AssetSpecificProperties.GuidelineSpecificProperties[1].GuidelineForConformityDeclaration',
      'AssetSpecificProperties.GuidelineSpecificProperties[1].RatedVoltage',
      'AssetSpecificProperties.GuidelineSpecificProperties[1].ProtectionClass',
    ])
    expect(root.children.at(1)!.file?.name).toBe('rating-plate.png')
  })
})

describe('parseNameplate (2.0 and 1.0)', () => {
  it('reads 2.0 by its ECLASS semantic IDs, `ContactInformation` and numbered markings', () => {
    expect(v2.version).toBe('2.0')
    expect(fieldText(v2.fields.serialNumber, 'en')).toBe('GM40-2023-000045')
    expect(fieldText(v2.fields.firmwareVersion, 'en')).toBe('3.1.0')
    expect(v2.contact?.path).toBe('ContactInformation')
    expect(fieldText(v2.contact!.fields.company, 'en')).toBe('Example Drives GmbH')
    expect(v2.markings.map(marking => [marking.path, fieldText(marking.name, 'en'), marking.additionalTexts.length])).toEqual([['Markings.Marking01', 'CE', 0], ['Markings.Marking02', 'WEEE', 1]])
  })

  it('reads 1.0\'s `Address`', () => {
    expect(v1.version).toBe('1.0')
    expect(v1.contact?.path).toBe('Address')
    expect(fieldText(v1.contact!.channels[0]!.value, 'en')).toBe('+49 631 123456-0')
    expect(v1.markings).toHaveLength(1)
    expect(v1.logo).toBeNull()
  })

  it('finds elements by semantic ID where the idShorts differ, and 1.0\'s `Marking_CE`', () => {
    const nameplate = parseNameplate({
      modelType: 'Submodel',
      semanticId: { keys: [{ value: 'https://admin-shell.io/zvei/nameplate/2/0/Nameplate' }] },
      submodelElements: [
        { idShort: 'Serial', modelType: 'Property', semanticId: { keys: [{ value: '0173-1#02-AAM556#001' }] }, value: 'S-1' },
        { idShort: 'Maker', modelType: 'MultiLanguageProperty', semanticId: { keys: [{ value: '0112/2///61987#ABA565#008' }] }, value: [{ language: 'en', text: 'Maker GmbH' }] },
        { idShort: 'Markings', modelType: 'SubmodelElementCollection', value: [{ idShort: 'Marking_CRUUS', modelType: 'SubmodelElementCollection', value: [] }] },
      ],
    })
    expect(fieldText(nameplate.fields.serialNumber, 'en')).toBe('S-1')
    expect(fieldText(nameplate.fields.manufacturerName, 'en')).toBe('Maker GmbH')
    expect(markingName(t, nameplate.markings[0]!, 0, 'en')).toBe('CRUUS')
    expect(nameplate.contact).toBeNull()
    expect(nameplate.assetSpecificProperties).toBeNull()
  })

  it('takes an element by its idShort before another one with its semantic ID', () => {
    // Published nameplates give the logo the country's IRDI and the country the firmware's.
    const nameplate = parseNameplate({
      modelType: 'Submodel',
      submodelElements: [
        { idShort: 'CompanyLogo', modelType: 'File', semanticId: { keys: [{ value: '0112/2///61987#ABP462#001' }] }, contentType: 'image/svg+xml', value: '/logo.svg' },
        { idShort: 'CountryOfOrigin', modelType: 'Property', semanticId: { keys: [{ value: '0112/2///61987#ABA302#006' }] }, value: 'DE' },
      ],
    })
    expect(fieldText(nameplate.fields.countryOfOrigin, 'en')).toBe('DE')
    expect(nameplate.fields.firmwareVersion).toBeUndefined()
    expect(nameplate.logo?.name).toBe('logo.svg')
  })

  it('names the template version', () => {
    expect(templateVersion('https://admin-shell.io/idta/nameplate/3/0/Nameplate')).toBe('3.0')
    expect(templateVersion('urn:example:nameplate')).toBeNull()
    expect([templateLabel('3.0'), templateLabel('2.0'), templateLabel('1.0'), templateLabel(null)]).toEqual(['IDTA 02006-3-0', 'IDTA 02006-2-0', 'ZVEI Digital Nameplate 1.0', 'IDTA 02006'])
  })
})

describe('presentation', () => {
  it('heads the view with product, manufacturer, type and serial number', () => {
    expect(headline(t, v3, 'en')).toEqual({ title: 'Gear motor GM-40', manufacturer: 'Example Drives GmbH', details: 'product.type{"value":"GM-40-230-B3"} · product.serial{"value":"GM40-2025-000123"}' })
    expect(headline(t, v1, 'de').title).toBe('Getriebemotor GM-25')
    expect(versionChips(t, v3, 'en').map(chip => chip.text)).toEqual(['product.hardwareVersion{"version":"1.2"}', 'product.firmwareVersion{"version":"3.4.1"}', 'product.softwareVersion{"version":"2.0.0"}'])
  })

  it('shows the product\'s other facts, the date and country in the user\'s language, the product page as link', () => {
    const rows = productRows(t, v3, 'de', false)
    expect(rows.map(row => row.key)).toEqual(['manufacturerProductRoot', 'manufacturerProductFamily', 'manufacturerProductType', 'orderCodeOfManufacturer', 'productArticleNumberOfManufacturer', 'serialNumber', 'yearOfConstruction', 'dateOfManufacture', 'countryOfOrigin', 'uriOfTheProduct'])
    expect(rows.find(row => row.key === 'dateOfManufacture')!.value).toBe(dateText('2025-03-12', 'de'))
    expect(rows.find(row => row.key === 'countryOfOrigin')!.value).toBe('Deutschland (DE)')
    expect(rows.find(row => row.key === 'uriOfTheProduct')).toMatchObject({ url: 'https://example.com/products/gm-40', copy: 'https://example.com/products/gm-40' })
    expect(countryText('Germany', 'en')).toBe('Germany')
  })

  it('in edit mode, has a row for every field, each with its field', () => {
    const rows = productRows(t, v3, 'en', true)
    expect(rows.map(row => row.key)).toContain('serialNumber')
    expect(rows.map(row => row.key)).toContain('manufacturerProductDesignation')
    expect(rows.every(row => row.field)).toBe(true)
  })

  it('shows the manufacturer\'s address and channels without repeating its name, and the facility', () => {
    const rows = manufacturerRows(t, v3, 'en', false)
    expect(rows.map(row => row.key.split(':', 1)[0])).toEqual(['department', 'address', 'phone', 'fax', 'email', 'link', 'uniqueFacilityIdentifier'])
    expect(rows.find(row => row.key.startsWith('phone'))).toMatchObject({ url: 'tel:+49631123456-0', note: 'Mon–Fri 8:00–17:00 CET', type: 'Office' })
    expect(manufacturerRows(t, v3, 'en', true).filter(row => row.key.startsWith('field')).length).toBeGreaterThan(10)
  })

  it('shows a marking\'s certificate, dates and note', () => {
    expect(markingRows(t, v3.markings[0]!, 'en', false).map(row => row.key)).toEqual(['designation', 'issued', 'expires', 'text:0'])
    expect(markingRows(t, v3.markings[1]!, 'en', false).map(row => row.key)).toEqual(['designation', 'issued'])
    expect(markingRows(t, v3.markings[1]!, 'en', true).map(row => row.key)).toEqual(['name', 'designation', 'issued'])
  })

  it('groups the asset specific properties by guideline', () => {
    const groups = propertyGroups(t, v3.assetSpecificProperties, 'de', false)
    expect(groups.map(group => group.title)).toEqual(['assetSpecific.general', 'assetSpecific.guideline{"value":"2006/42/EC"}', 'assetSpecific.guideline{"value":"2014/35/EU"}'])
    expect(groups[0]!.rows).toMatchObject([{ label: 'Rating plate', value: 'rating-plate.png', file: { path: 'AssetSpecificProperties.RatingPlate' } }])
    expect(groups[1]!.rows.map(row => [row.label, row.value])).toEqual([['Max ambient temperature', '40'], ['Installation note', 'Mit dem Klemmenkasten nach oben einbauen.']])
    expect(groups.flatMap(group => group.rows).filter(row => row.url)).toEqual([])
    // In edit mode, the guideline is a row too.
    expect(propertyGroups(t, v3.assetSpecificProperties, 'en', true)[1]!.rows[0]!.label).toBe('Guideline for conformity declaration')
    expect(propertyGroups(t, v2.assetSpecificProperties, 'en', false).map(group => group.title)).toEqual(['assetSpecific.guideline{"value":"2006/42/EC"}'])
  })
})

describe('changing values in place', () => {
  const property = { path: 'SerialNumber', modelType: 'Property' as const, values: [], valueId: '' }
  const mlp = { path: 'ManufacturerProductDesignation', modelType: 'MultiLanguageProperty' as const, values: [], valueId: '' }
  const texts = [{ language: 'en', text: 'Gear motor' }, { language: 'de', text: 'Getriebemotor' }]

  it('changes a MultiLanguageProperty in the language the view shows, keeping the others', () => {
    expect(editLanguage(texts, 'de-saar')).toBe('de')
    expect(editLanguage(texts, 'fr')).toBe('en')
    expect(editLanguage([], 'fr')).toBe('fr')
    expect(draftValue({ field: mlp, value: 'Getriebemotor GM-40', language: 'de', values: texts })).toEqual([{ language: 'en', text: 'Gear motor' }, { language: 'de', text: 'Getriebemotor GM-40' }])
    expect(draftValue({ field: mlp, value: 'Motoréducteur', language: 'fr', values: texts })).toEqual([...texts, { language: 'fr', text: 'Motoréducteur' }])
    expect(draftValue({ field: mlp, value: ' ', language: 'de', values: texts })).toEqual([{ language: 'en', text: 'Gear motor' }])
  })

  it('writes plain texts, which postMessage can clone, from the draft\'s reactive ones', () => {
    const draft = reactive({ field: mlp, value: 'Getriebemotor GM-40', language: 'de', values: texts.map(entry => ({ ...entry })) })
    expect(() => structuredClone(draftValue(draft))).not.toThrow()
    expect(() => structuredClone(draftValue({ ...draft, value: '' }))).not.toThrow()
  })

  it('writes a Property\'s text, and no value for an empty one', () => {
    expect(draftValue({ field: property, value: ' SN-1 ', language: '', values: [] })).toBe('SN-1')
    expect(draftValue({ field: property, value: '', language: '', values: [] })).toBeNull()
  })
})
