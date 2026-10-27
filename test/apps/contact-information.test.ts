import type { JsonObject } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { childMatching, conceptOf, fieldText, matchesSpec, textFieldOf } from '@basyx/studio-app-kit/aas'
import { addressLines, addressText, channelType, channelTypeText, contactMatches, contactName, contactRole, contactRows, contactText, contactVCard, countryName, linkUrl, mailtoUrl, mapUrl, parseContactInformation, parseContactInformations, roleText, telUrl, vCardFileName } from '@basyx/studio-app-kit/contacts'
import { describe, expect, it } from 'vitest'
import { appMethodParamsSchemas, isExternalUrl } from '#shared/contract'
import { contactHeading } from '../../apps/contact-information/ui/src/presentation'

// The app kit's reading of IDTA 02002 Contact Information (`./contacts`),
// which the Contacts and Digital Nameplate apps share, and the element
// matching of `./aas` it is built on, on the nameplate demo of the open
// infrastructure (test-setup/fixtures/generate-nameplate.mjs).

const environment = JSON.parse(readFileSync(new URL('../../test-setup/fixtures/nameplate/studio-nameplate.json', import.meta.url), 'utf8')) as { submodels: JsonObject[] }
const submodel = (id: string) => environment.submodels.find(entry => entry.id === id)!
const contactsSubmodel = submodel('urn:studio:test:sm:nameplate:contact-information')

describe('element matching (app kit ./aas)', () => {
  it('compares IRDIs without their version, in either spelling', () => {
    expect(conceptOf('0173-1#02-AAO128#002')).toBe('0173-1#02-AAO128')
    expect(conceptOf('https://api.eclass-cdp.com/0173-1-02-AAO128-003')).toBe('0173-1#02-AAO128')
    expect(conceptOf('0173-1#02-ABI218#003/0173-1#01-AGZ672#004')).toBe('0173-1#02-ABI218')
    expect(conceptOf('0112/2///61987#ABA565#009')).toBe('0112/2///61987#ABA565')
    expect(conceptOf('0112/2///61360_7#AAS011#001')).toBe('0112/2///61360_7#AAS011')
    expect(conceptOf('https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/IPCommunication/')).toBe('https://admin-shell.io/zvei/nameplate/1/0/contactinformations/ipcommunication')
  })

  it('matches numbered idShorts, URL semantic IDs by their last segment, and IRDIs of other versions', () => {
    const spec = { names: ['Phone'], semanticIds: ['0173-1#02-AAQ833#005'] }
    expect(matchesSpec({ idShort: 'Phone__00__' }, spec)).toBe(true)
    expect(matchesSpec({ idShort: 'Phone01' }, spec)).toBe(true)
    expect(matchesSpec({ idShort: 'Phone{00}' }, spec)).toBe(true)
    expect(matchesSpec({ idShort: 'Telephone', semanticId: { keys: [{ value: 'https://example.com/contact/Phone/' }] } }, spec)).toBe(true)
    expect(matchesSpec({ idShort: 'Telephone', semanticId: { keys: [{ value: '0173-1#02-AAQ833#004' }] } }, spec)).toBe(true)
    expect(matchesSpec({ idShort: 'PhoneBook' }, spec)).toBe(false)
  })

  it('reads Properties and MultiLanguageProperties as text fields, with their value IDs', () => {
    const contact = { element: (contactsSubmodel.submodelElements as JsonObject[])[0]!, path: 'ContactInformation__00__' }
    const role = textFieldOf(childMatching(contact, { names: ['RoleOfContactPerson'] }))
    expect(role).toEqual({ path: 'ContactInformation__00__.RoleOfContactPerson', modelType: 'Property', values: [{ language: '', text: '0173-1#07-AAS931#001' }], valueId: '' })
    const department = textFieldOf(childMatching(contact, { names: ['Department'] }))
    expect(fieldText(department, 'de')).toBe('Forschung und Entwicklung')
    expect(fieldText(department, 'ja')).toBe('Research and development')
    expect(textFieldOf(childMatching(contact, { names: ['Phone'] }))).toBeUndefined()
  })
})

describe('parseContactInformations', () => {
  const contacts = parseContactInformations(contactsSubmodel)

  it('reads every contact of the demo', () => {
    expect(contacts.map(contact => contact.path)).toEqual(['ContactInformation__00__', 'ContactInformation__01__', 'ContactInformation__02__', 'ContactInformation__03__'])
    expect(contacts.map(contact => contactName(contact, 'en'))).toEqual(['Ms Dr. Jane Q. Doe', '', 'Alex Kim', ''])
    expect(contactName(contacts[0]!, 'de')).toBe('Frau Dr. Jane Q. Doe')
  })

  it('reads roles from the value list, by IRDI or by name', () => {
    expect(contacts.map(contact => contactRole(contact))).toEqual(['technical', 'commercial', 'hazardousGoods', 'other'])
    expect(roleText(contacts[0]!, 'en')).toBe('Technical contact')
    expect(roleText(contacts[0]!, 'de')).toBe('Technischer Kontakt')
    expect(roleText(contacts[3]!, 'fr')).toBe('Autre contact')
  })

  it('reads phone, fax and email with their types, times and keys, and further links and languages', () => {
    const [jane, sales] = contacts
    expect(jane!.channels.map(channel => [channel.kind, fieldText(channel.value, 'en'), channelType(channel)])).toEqual([
      ['phone', '+49 (0)631 123456-21', 'officeMobile'],
      ['email', 'jane.doe@example.com', 'office'],
    ])
    expect(channelTypeText(jane!.channels[0]!, 'de')).toBe('Mobil (geschäftlich)')
    expect(fieldText(jane!.channels[0]!.availableTime, 'de')).toBe('Mo–Do 9:00–16:00 MEZ')
    expect(fieldText(jane!.channels[1]!.publicKey, 'en')).toContain('7C2A')
    expect(jane!.languages.map(entry => fieldText(entry, 'en'))).toEqual(['de', 'en'])
    expect(jane!.links.map(link => [fieldText(link.address, 'en'), fieldText(link.type, 'en')])).toEqual([['https://meet.example.com/jane.doe', 'Video call']])
    expect(sales!.channels.map(channel => channel.kind)).toEqual(['phone', 'fax', 'email'])
  })

  it('composes addresses, with the PO box where there is no street and the country by name', () => {
    expect(addressLines(contacts[0]!, 'en')).toEqual(['Industriestraße 12', '67663 Kaiserslautern', 'Rhineland-Palatinate', 'Germany'])
    expect(addressText(contacts[0]!, 'de')).toBe('Industriestraße 12, 67663 Kaiserslautern, Rheinland-Pfalz, Deutschland')
    expect(addressLines(contacts[2]!, 'en')).toEqual(['PO Box 1234', '67653 Kaiserslautern', 'Germany'])
    expect(addressText(contacts[3]!, 'en')).toBe('200 Example Avenue, 60601 Chicago, IL, United States')
    expect(countryName('xx-not', 'en')).toBe('xx-not')
  })

  it('searches every text, also translated roles and types', () => {
    const search = (query: string, locale = 'en') => contacts.filter(contact => contactMatches(contact, query, locale)).map(contact => contact.path)
    expect(search('')).toHaveLength(4)
    expect(search('jane doe')).toEqual(['ContactInformation__00__'])
    expect(search('chicago')).toEqual(['ContactInformation__03__'])
    expect(search('gefahrgut', 'de')).toEqual(['ContactInformation__02__'])
    expect(search('sales@')).toEqual(['ContactInformation__01__'])
  })
})

describe('contactRows', () => {
  const [jane, sales] = parseContactInformations(contactsSubmodel)

  it('shows the contact in the template\'s order, with links, the map and copy texts', () => {
    const rows = contactRows(jane!, 'en')
    expect(rows.map(row => row.key)).toEqual(['role', 'company', 'department', 'address', 'phone', 'email', 'publicKey', 'link', 'languages', 'timeZone', 'details'])
    const byKey = Object.fromEntries(rows.map(row => [row.key, row]))
    expect(byKey.address).toMatchObject({ label: 'Address', value: 'Industriestraße 12\n67663 Kaiserslautern\nRhineland-Palatinate\nGermany', map: mapUrl('Industriestraße 12, 67663 Kaiserslautern, Rhineland-Palatinate, Germany') })
    // An address opens its map, it is not copied.
    expect(byKey.address!.copy).toBeUndefined()
    expect(mapUrl('Industriestraße 12, Kaiserslautern')).toBe('https://www.google.com/maps/search/?api=1&query=Industriestra%C3%9Fe%2012%2C%20Kaiserslautern')
    expect(byKey.phone).toMatchObject({ value: '+49 (0)631 123456-21', type: 'Office mobile', note: 'Mon–Thu 9:00–16:00 CET', url: 'tel:+49631123456-21', copy: '+49 (0)631 123456-21' })
    expect(byKey.email).toMatchObject({ url: 'mailto:jane.doe@example.com', type: 'Office' })
    expect(byKey.publicKey).toMatchObject({ type: 'OpenPGP fingerprint' })
    expect(byKey.link).toMatchObject({ url: 'https://meet.example.com/jane.doe', type: 'Video call', note: 'By appointment' })
    expect(byKey.languages!.value).toBe('German, English')
    expect(contactRows(jane!, 'de').find(row => row.key === 'languages')!.value).toBe('Deutsch, Englisch')
    expect(contactRows(sales!, 'en').find(row => row.key === 'fax')).toMatchObject({ label: 'Fax', value: '+49 631 123456-39', url: undefined })
  })

  it('in edit mode, has a row for every element, each with its field', () => {
    const rows = contactRows(jane!, 'de', { edit: true })
    expect(rows.every(row => row.key === 'field' && row.field)).toBe(true)
    expect(rows.map(row => row.label)).toContain('Akademischer Titel')
    expect(rows.find(row => row.field!.path === 'ContactInformation__00__.Phone.TypeOfTelephone')).toMatchObject({ label: 'Art des Telefons', value: '0173-1#07-AAS755#001' })
    expect(rows.filter(row => row.label === 'Sprache')).toHaveLength(2)
    expect(rows.find(row => row.field!.path === 'ContactInformation__00__.IPCommunication__00__.TypeOfCommunication')).toBeDefined()
  })

  it('labels in Studio\'s locales, its dialects as their language, English for others', () => {
    expect(contactText('labels.address', 'de-saar')).toBe('Adresse')
    expect(contactText('labels.address', 'zh-Hans')).toBe('地址')
    expect(contactText('labels.address', 'pt')).toBe('Address')
  })
})

describe('the vCard', () => {
  const [jane, sales, alex] = parseContactInformations(contactsSubmodel)
  /** Its lines, unfolded. */
  const vCardLines = (vcard: string) => vcard.replaceAll('\r\n ', '').trimEnd().split('\r\n')

  it('is vCard 3.0 with the name in its parts, organization, role, address and channels', () => {
    const vcard = contactVCard(jane!, 'en')
    expect(vcard.endsWith('\r\n')).toBe(true)
    const lines = vCardLines(vcard)
    expect(lines.slice(0, 4)).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;Jane;Q.;Ms Dr.;', 'FN:Ms Dr. Jane Q. Doe'])
    expect(lines).toContain('ORG:Example Drives GmbH;Research and development')
    expect(lines).toContain('ROLE:Technical contact')
    expect(lines).toContain('ADR;TYPE=WORK:;;Industriestraße 12;Kaiserslautern;Rhineland-Palatinate;67663;Germany')
    expect(lines).toContain('TEL;TYPE=WORK,CELL:+49 (0)631 123456-21')
    expect(lines).toContain('EMAIL;TYPE=INTERNET,WORK:jane.doe@example.com')
    expect(lines).toContain('URL:https://meet.example.com/jane.doe')
    expect(lines).toContain('NOTE:Questions about commissioning and the frequency converter.')
    expect(lines.at(-1)).toBe('END:VCARD')
  })

  it('names a contact without a person by its company, with fax and PO box', () => {
    const lines = vCardLines(contactVCard(sales!, 'de'))
    expect(lines).toContain('FN:Example Drives GmbH')
    expect(lines).toContain('ORG:Example Drives GmbH;Vertrieb')
    expect(lines).toContain('TEL;TYPE=WORK,FAX:+49 631 123456-39')
    expect(lines).toContain('URL:https://example.com/sales')
    expect(vCardLines(contactVCard(alex!, 'en'))).toContain('ADR;TYPE=WORK:PO Box 1234;;;Kaiserslautern;;67653;Germany')
  })

  it('escapes its separators and folds long lines without splitting a character', () => {
    const contact = parseContactInformation({
      path: 'Contact',
      element: {
        idShort: 'Contact',
        modelType: 'SubmodelElementCollection',
        value: [
          { idShort: 'Company', modelType: 'MultiLanguageProperty', value: [{ language: 'en', text: String.raw`Smith, Jones; Partners\Co` }] },
          { idShort: 'FurtherDetailsOfContact', modelType: 'MultiLanguageProperty', value: [{ language: 'en', text: `Line one\nLine two ${'ü'.repeat(60)}` }] },
        ],
      },
    })
    const vcard = contactVCard(contact, 'en', { organization: 'ignored' })
    expect(vcard).toContain(String.raw`FN:Smith\, Jones\; Partners\\Co`)
    const note = vcard.split('\r\n').findIndex(line => line.startsWith('NOTE:'))
    const lines = vcard.split('\r\n')
    expect(lines[note]).toContain(String.raw`Line one\nLine two`)
    expect(lines[note + 1]!.startsWith(' ')).toBe(true)
    expect(lines.every(line => new TextEncoder().encode(line).length <= 75)).toBe(true)
    expect(vCardFileName(contact, 'en')).toBe(String.raw`Smith, Jones; Partners\Co.vcf`.replace('\\', ''))
  })

  it('takes the organization from the caller where the contact has no company', () => {
    const contact = parseContactInformation({ path: 'Address', element: { idShort: 'Address', modelType: 'SubmodelElementCollection', value: [] } })
    expect(contactVCard(contact, 'en', { organization: 'Example Drives GmbH' })).toContain('FN:Example Drives GmbH')
    expect(vCardFileName(contact, 'en', 'Example Drives GmbH')).toBe('Example Drives GmbH.vcf')
  })
})

describe('links', () => {
  it('dials numbers without spaces and the trunk prefix in brackets', () => {
    expect(telUrl('+49 (0)631 123456-21')).toBe('tel:+49631123456-21')
    expect(telUrl('0631 / 123 456')).toBe('tel:0631123456')
    expect(telUrl('n/a')).toBeNull()
  })

  it('writes email only to addresses, and opens links over https, mail or phone', () => {
    expect(mailtoUrl('info@example.com')).toBe('mailto:info@example.com')
    expect(mailtoUrl('info at example.com')).toBeNull()
    expect(linkUrl('example.com/contact')).toBe('https://example.com/contact')
    expect(linkUrl('mailto:info@example.com')).toBe('mailto:info@example.com')
    expect(linkUrl('http://example.com/')).toBeNull()
    expect(linkUrl('javascript:alert(1)')).toBeNull()
    expect(linkUrl('Video call')).toBeNull()
    // Values that URL would take for IPv4 addresses or bare hosts are no links.
    expect(linkUrl('40')).toBeNull()
    expect(linkUrl('2006/42/EC')).toBeNull()
    expect(linkUrl('I')).toBeNull()
    expect(linkUrl('Install with the terminal box facing up.')).toBeNull()
    expect(linkUrl('https://192.168.0.10/')).toBeNull()
  })

  it('lets Studio open email addresses and phone numbers (app API 0.1.14), and save text files', () => {
    expect(isExternalUrl('mailto:jane.doe@example.com')).toBe(true)
    expect(isExternalUrl('mailto:jane.doe@example.com?subject=GM-40')).toBe(true)
    expect(isExternalUrl('tel:+49631123456-21')).toBe(true)
    expect(isExternalUrl('mailto:not an address')).toBe(false)
    expect(isExternalUrl('tel:call-me')).toBe(false)
    expect(isExternalUrl('sms:+49631')).toBe(false)
    // A malformed escape is an invalid request, not an internal error.
    expect(isExternalUrl('tel:%')).toBe(false)
    expect(isExternalUrl('tel:%E0%A4%A')).toBe(false)
    expect(appMethodParamsSchemas['studio.ui.openExternal'].safeParse({ url: 'tel:%' }).success).toBe(false)
    expect(appMethodParamsSchemas['studio.ui.openExternal'].safeParse({ url: 'tel:+49631123456' }).success).toBe(true)
    expect(appMethodParamsSchemas['studio.ui.openExternal'].safeParse({ url: 'javascript:alert(1)' }).success).toBe(false)
    expect(appMethodParamsSchemas['studio.ui.saveFile'].safeParse({ fileName: 'Jane Doe.vcf', contentType: 'text/vcard', text: 'BEGIN:VCARD' }).success).toBe(true)
    expect(appMethodParamsSchemas['studio.ui.saveFile'].safeParse({ fileName: '../Jane.vcf', contentType: 'text/vcard', text: '' }).success).toBe(false)
    expect(appMethodParamsSchemas['studio.ui.saveFile'].safeParse({ fileName: 'big.txt', contentType: 'text/plain', text: 'x'.repeat(1024 * 1024 + 1) }).success).toBe(false)
  })
})

describe('the Contacts app\'s cards', () => {
  const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

  it('head a contact with the name, else the company, and its organization and role', () => {
    const [jane, sales] = parseContactInformations(contactsSubmodel)
    expect(contactHeading(t, jane!, 0, 'en')).toEqual({ title: 'Ms Dr. Jane Q. Doe', subtitle: 'Example Drives GmbH · Research and development', role: 'Technical contact', named: true })
    expect(contactHeading(t, sales!, 1, 'de')).toEqual({ title: 'Example Drives GmbH', subtitle: 'Vertrieb', role: 'Kaufmännischer Kontakt', named: false })
    const empty = parseContactInformation({ path: 'ContactInformation__09__', element: { modelType: 'SubmodelElementCollection', value: [] } })
    expect(contactHeading(t, empty, 9, 'en')).toEqual({ title: 'contacts.untitled{"number":10}', subtitle: '', role: '', named: false })
  })
})
