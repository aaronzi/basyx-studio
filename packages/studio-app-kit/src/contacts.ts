import type { ElementSpec, LangString, Node, TextField } from './aas.ts'
import type { JsonObject } from '@basyx/studio-sdk'
import { childMatching, childrenMatching, childrenOf, conceptOf, fieldText, langText, matchesSpec, textFieldOf } from './aas.ts'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import nl from './locales/nl.json'
import zhHans from './locales/zh-Hans.json'

// Contact information of IDTA 02002 Contact Information 1.0
// (`https://admin-shell.io/zvei/nameplate/1/0/ContactInformations`), as
// collections of that submodel, as the manufacturer's address of the Digital
// Nameplate (IDTA 02006: `AddressInformation` in 3.0, `ContactInformation`
// in 2.0, `Address` in 1.0), or anywhere else: names, postal addresses,
// phone, fax, email and further channels, with their value lists in Studio's
// seven UI locales, as rows to show and as vCard (app API 0.1.14). Without
// Vue or Vuetify. Based on the BaSyx AAS Web UI's ContactInformation_v1_0Utils
// (https://github.com/eclipse-basyx/basyx-aas-web-ui), © the Eclipse BaSyx
// Authors, MIT License, and extended to every element of the template.

export const contactInformationsSemanticId = 'https://admin-shell.io/zvei/nameplate/1/0/ContactInformations'

const spec = {
  contactInformation: { names: ['ContactInformation'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation`] },
  roleOfContactPerson: { names: ['RoleOfContactPerson'], semanticIds: ['0173-1#02-AAO204#003'] },
  nationalCode: { names: ['NationalCode', 'CountryCode'], semanticIds: ['0173-1#02-AAO134#002'] },
  language: { names: ['Language'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation/Language`] },
  timeZone: { names: ['TimeZone'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation/TimeZone`] },
  cityTown: { names: ['CityTown'], semanticIds: ['0173-1#02-AAO132#002'] },
  company: { names: ['Company'], semanticIds: ['0173-1#02-AAW001#001'] },
  department: { names: ['Department'], semanticIds: ['0173-1#02-AAO127#003'] },
  street: { names: ['Street'], semanticIds: ['0173-1#02-AAO128#002'] },
  zipcode: { names: ['Zipcode', 'ZipCode', 'Zip'], semanticIds: ['0173-1#02-AAO129#002'] },
  poBox: { names: ['POBox'], semanticIds: ['0173-1#02-AAO130#002'] },
  zipCodeOfPOBox: { names: ['ZipCodeOfPOBox'], semanticIds: ['0173-1#02-AAO131#002'] },
  stateCounty: { names: ['StateCounty'], semanticIds: ['0173-1#02-AAO133#002'] },
  nameOfContact: { names: ['NameOfContact'], semanticIds: ['0173-1#02-AAO205#002'] },
  firstName: { names: ['FirstName'], semanticIds: ['0173-1#02-AAO206#002'] },
  middleNames: { names: ['MiddleNames'], semanticIds: ['0173-1#02-AAO207#002'] },
  title: { names: ['Title'], semanticIds: ['0173-1#02-AAO208#003'] },
  academicTitle: { names: ['AcademicTitle'], semanticIds: ['0173-1#02-AAO209#003'] },
  furtherDetailsOfContact: { names: ['FurtherDetailsOfContact'], semanticIds: ['0173-1#02-AAO210#002'] },
  addressOfAdditionalLink: { names: ['AddressOfAdditionalLink'], semanticIds: ['0173-1#02-AAQ326#002'] },
  vatNumber: { names: ['VATNumber'], semanticIds: ['0173-1#02-AAO135#002'] },
  addressRemarks: { names: ['AddressRemarks'], semanticIds: ['0173-1#02-AAO202#003'] },
  phone: { names: ['Phone'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation/Phone`, '0173-1#02-AAQ833#005'] },
  telephoneNumber: { names: ['TelephoneNumber'], semanticIds: ['0173-1#02-AAO136#002'] },
  typeOfTelephone: { names: ['TypeOfTelephone'], semanticIds: ['0173-1#02-AAO137#003'] },
  fax: { names: ['Fax'], semanticIds: ['0173-1#02-AAQ834#005'] },
  faxNumber: { names: ['FaxNumber'], semanticIds: ['0173-1#02-AAO195#002'] },
  typeOfFaxNumber: { names: ['TypeOfFaxNumber'], semanticIds: ['0173-1#02-AAO196#003'] },
  email: { names: ['Email'], semanticIds: ['0173-1#02-AAQ836#005'] },
  emailAddress: { names: ['EmailAddress'], semanticIds: ['0173-1#02-AAO198#002'] },
  typeOfEmailAddress: { names: ['TypeOfEmailAddress'], semanticIds: ['0173-1#02-AAO199#003'] },
  publicKey: { names: ['PublicKey'], semanticIds: ['0173-1#02-AAO200#002'] },
  typeOfPublicKey: { names: ['TypeOfPublicKey'], semanticIds: ['0173-1#02-AAO201#002'] },
  availableTime: { names: ['AvailableTime'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation/AvailableTime`] },
  ipCommunication: { names: ['IPCommunication'], semanticIds: [`${contactInformationsSemanticId}/IPCommunication`] },
  typeOfCommunication: { names: ['TypeOfCommunication'], semanticIds: [`${contactInformationsSemanticId}/ContactInformation/IPCommunication/TypeOfCommunication`] },
} satisfies Record<string, ElementSpec>

/** The fields of a contact that hold one text each. */
export const contactFieldKeys = [
  'roleOfContactPerson',
  'title',
  'academicTitle',
  'firstName',
  'middleNames',
  'nameOfContact',
  'company',
  'department',
  'street',
  'zipcode',
  'cityTown',
  'poBox',
  'zipCodeOfPOBox',
  'stateCounty',
  'nationalCode',
  'vatNumber',
  'addressRemarks',
  'timeZone',
  'addressOfAdditionalLink',
  'furtherDetailsOfContact',
] as const satisfies ReadonlyArray<keyof typeof spec>

export type ContactFieldKey = (typeof contactFieldKeys)[number]

export type ChannelKind = 'phone' | 'fax' | 'email'

/** A phone number, fax number or email address with its type and when it is answered. */
export interface ContactChannel {
  kind: ChannelKind
  /** The collection's idShortPath, e.g. `ContactInformation__00__.Phone`. */
  path: string
  value: TextField | undefined
  type: TextField | undefined
  availableTime: TextField | undefined
  publicKey: TextField | undefined
  typeOfPublicKey: TextField | undefined
}

/** A further way to reach the contact: `IPCommunication`, e.g. a chat or video call address. */
export interface ContactLink {
  path: string
  address: TextField | undefined
  type: TextField | undefined
  availableTime: TextField | undefined
}

export interface ContactInformation {
  /** The collection's idShortPath. */
  path: string
  idShort: string
  displayName: LangString[]
  fields: Partial<Record<ContactFieldKey, TextField>>
  /** `Language`, which the template allows several times. */
  languages: TextField[]
  channels: ContactChannel[]
  links: ContactLink[]
}

const channelSpecs: Record<ChannelKind, { collection: ElementSpec, value: ElementSpec, type: ElementSpec }> = {
  phone: { collection: spec.phone, value: spec.telephoneNumber, type: spec.typeOfTelephone },
  fax: { collection: spec.fax, value: spec.faxNumber, type: spec.typeOfFaxNumber },
  email: { collection: spec.email, value: spec.emailAddress, type: spec.typeOfEmailAddress },
}

function field (node: Node, key: keyof typeof spec): TextField | undefined {
  return textFieldOf(childMatching(node, spec[key]))
}

/** The elements of a list, or numbered collections next to each other. */
function entries (node: Node, entry: ElementSpec): Node[] {
  return childrenMatching(node, entry).flatMap(item => (item.element.modelType === 'SubmodelElementList' ? childrenOf(item) : [item]))
}

/** One contact: a `ContactInformation` collection, a nameplate's `AddressInformation`, or any collection with its elements. */
export function parseContactInformation (node: Node): ContactInformation {
  const fields: Partial<Record<ContactFieldKey, TextField>> = {}
  for (const key of contactFieldKeys) {
    const value = field(node, key)
    if (value) {
      fields[key] = value
    }
  }
  const channels = (Object.keys(channelSpecs) as ChannelKind[]).flatMap(kind => {
    const { collection, value, type } = channelSpecs[kind]
    return entries(node, collection)
      .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
      .map(entry => ({
        kind,
        path: entry.path,
        value: textFieldOf(childMatching(entry, value)),
        type: textFieldOf(childMatching(entry, type)),
        availableTime: field(entry, 'availableTime'),
        publicKey: field(entry, 'publicKey'),
        typeOfPublicKey: field(entry, 'typeOfPublicKey'),
      }))
  })
  return {
    path: node.path,
    idShort: String(node.element.idShort ?? ''),
    displayName: Array.isArray(node.element.displayName) ? node.element.displayName as LangString[] : [],
    fields,
    languages: entries(node, spec.language).map(entry => textFieldOf(entry)).filter((entry): entry is TextField => entry !== undefined),
    channels,
    links: entries(node, spec.ipCommunication)
      .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
      .map(entry => ({ path: entry.path, address: field(entry, 'addressOfAdditionalLink'), type: field(entry, 'typeOfCommunication'), availableTime: field(entry, 'availableTime') })),
  }
}

/** The contacts of a Contact Information submodel (IDTA 02002), as numbered collections or in a list. */
export function parseContactInformations (submodel: JsonObject): ContactInformation[] {
  const root: Node = { element: submodel, path: '' }
  return entries(root, spec.contactInformation)
    .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
    .map(entry => parseContactInformation(entry))
}

/** Whether an element is a `ContactInformation` collection (IDTA 02002). */
export function isContactInformation (element: JsonObject): boolean {
  return element.modelType === 'SubmodelElementCollection' && matchesSpec(element, spec.contactInformation)
}

// ---------------------------------------------------------------------------
// Texts

interface Texts {
  [key: string]: string | Texts
}

const catalogs: Record<string, Texts> = { en, de, es, fr, ja, nl, 'zh-Hans': zhHans }

function lookup (catalog: Texts | undefined, path: string): string | undefined {
  let node: Texts | string | undefined = catalog
  for (const name of path.split('.')) {
    if (typeof node !== 'object' || !Object.hasOwn(node, name)) {
      return undefined
    }
    node = node[name]
  }
  return typeof node === 'string' ? node : undefined
}

/** The catalog of a locale: `zh-Hans-CN` → `zh-Hans`, `de-saar` → `de`. */
function catalogOf (locale: string): Texts | undefined {
  const parts = locale.split('-')
  for (let length = parts.length; length > 0; length--) {
    const code = parts.slice(0, length).join('-')
    const found = Object.keys(catalogs).find(entry => entry.toLowerCase() === code.toLowerCase())
    if (found) {
      return catalogs[found]
    }
  }
  return parts[0]?.toLowerCase() === 'zh' ? catalogs['zh-Hans'] : undefined
}

/**
 * A text of the contacts module in Studio's locale, English where it has
 * none: `fields.<ContactFieldKey>`, `labels.<ContactRow key>`,
 * `roles.<ContactRole>`, `types.<ChannelType>`.
 */
export function contactText (key: string, locale: string): string {
  return lookup(catalogOf(locale), key) ?? lookup(catalogs.en, key) ?? key
}

// ---------------------------------------------------------------------------
// Value lists (ECLASS)

/** RoleOfContactPerson (`0173-1#02-AAO204`). */
const roles = {
  '0173-1#07-AAS927': 'administrative',
  '0173-1#07-AAS928': 'commercial',
  '0173-1#07-AAS929': 'other',
  '0173-1#07-AAS930': 'hazardousGoods',
  '0173-1#07-AAS931': 'technical',
} as const

export type ContactRole = (typeof roles)[keyof typeof roles]

/** TypeOfTelephone, TypeOfFaxNumber, TypeOfEmailAddress (`0173-1#02-AAO137`, `AAO196`, `AAO199`). */
const channelTypes = {
  '0173-1#07-AAS754': 'office',
  '0173-1#07-AAS755': 'officeMobile',
  '0173-1#07-AAS756': 'secretary',
  '0173-1#07-AAS757': 'substitute',
  '0173-1#07-AAS758': 'home',
  '0173-1#07-AAS759': 'privateMobile',
} as const

export type ChannelType = (typeof channelTypes)[keyof typeof channelTypes]

/** The entry of a value list a field names: by its value or `valueId` (an IRDI in any version), or by the entry's English name. */
function listEntry<T extends string> (list: Record<string, T>, value: TextField | undefined): T | undefined {
  if (!value) {
    return undefined
  }
  const candidates = [value.valueId, ...value.values.map(entry => entry.text)].filter(Boolean)
  for (const candidate of candidates) {
    const byIrdi = list[conceptOf(candidate)]
    if (byIrdi) {
      return byIrdi
    }
    const name = candidate.toLowerCase().replaceAll(/[^a-z]/g, '').replace(/contact$/, '')
    const byName = Object.values(list).find(entry => entry.toLowerCase() === name || (entry === 'administrative' && name === 'administrativ'))
    if (byName) {
      return byName
    }
  }
  return undefined
}

/** The contact's role, e.g. `technical`; `undefined` where it names none of the value list. */
export function contactRole (contact: ContactInformation): ContactRole | undefined {
  return listEntry<ContactRole>(roles, contact.fields.roleOfContactPerson)
}

/** A value list field as text: its entry in the locale, else its own text. */
function listText (key: string | undefined, field: TextField | undefined, prefix: string, locale: string): string {
  return key ? contactText(`${prefix}.${key}`, locale) : fieldText(field, locale)
}

/** The role as text, e.g. "Technical contact". */
export function roleText (contact: ContactInformation, locale: string): string {
  return listText(contactRole(contact), contact.fields.roleOfContactPerson, 'roles', locale)
}

/** A channel's type, e.g. `office`; `undefined` where it names none of the value list. */
export function channelType (channel: ContactChannel): ChannelType | undefined {
  return listEntry<ChannelType>(channelTypes, channel.type)
}

/** A channel's type as text, e.g. "Office". */
export function channelTypeText (channel: ContactChannel, locale: string): string {
  return listText(channelType(channel), channel.type, 'types', locale)
}

// ---------------------------------------------------------------------------
// Names, addresses and links

const text = (contact: ContactInformation, key: ContactFieldKey, locale: string) => fieldText(contact.fields[key], locale)

/** `DE` → "Germany" in the locale; other values as they are. */
export function countryName (code: string, locale: string): string {
  const value = code.trim()
  if (!/^[a-z]{2}$/i.test(value)) {
    return value
  }
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'code' }).of(value.toUpperCase()) ?? value
  } catch {
    return value
  }
}

/** `de` → "German" in the locale; other values as they are. */
export function languageName (code: string, locale: string): string {
  const value = code.trim()
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'code' }).of(value) ?? value
  } catch {
    return value
  }
}

/** E.g. "Dr. Jane Q. Doe": title, academic title, first, middle and last name. */
export function contactName (contact: ContactInformation, locale: string): string {
  return (['title', 'academicTitle', 'firstName', 'middleNames', 'nameOfContact'] as const)
    .map(key => text(contact, key, locale))
    .filter(Boolean)
    .join(' ')
}

/** The postal address in lines: street (or PO box), postcode and town, state, country. */
export function addressLines (contact: ContactInformation, locale: string): string[] {
  const street = text(contact, 'street', locale)
  const poBox = text(contact, 'poBox', locale)
  const postcode = street ? text(contact, 'zipcode', locale) || text(contact, 'zipCodeOfPOBox', locale) : text(contact, 'zipCodeOfPOBox', locale) || text(contact, 'zipcode', locale)
  const nationalCode = text(contact, 'nationalCode', locale)
  return [
    street || poBox,
    [postcode, text(contact, 'cityTown', locale)].filter(Boolean).join(' '),
    text(contact, 'stateCounty', locale),
    nationalCode ? countryName(nationalCode, locale) : '',
  ].filter(Boolean)
}

/** The postal address on one line, e.g. "Hauptstraße 1, 67663 Kaiserslautern, Germany". */
export function addressText (contact: ContactInformation, locale: string): string {
  return addressLines(contact, locale).join(', ')
}

/** Google Maps' search for an address (Maps URLs), to open in a new browser tab. */
export function mapUrl (address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/** `+49 (0)631 1234-56` → `tel:+496311234-56`; `null` without digits. */
export function telUrl (number: string): string | null {
  let value = number.trim()
  if (value.startsWith('+')) {
    // The trunk prefix in brackets is not dialled from abroad.
    value = value.replace(/\(0\)/, '')
  }
  value = value.replaceAll(/[^\d+-]/g, '').replace(/(?!^)\+/g, '')
  return /\d{2}/.test(value) ? `tel:${value}` : null
}

/** `info@example.com` → `mailto:info@example.com`; `null` for anything else. */
export function mailtoUrl (address: string): string | null {
  const value = address.trim().replace(/^mailto:/i, '')
  return /^[^\s/?#@]+@[^\s#/?@][^\s#./?@]*\.[^\s#/?@]+$/.test(value) ? `mailto:${value}` : null
}

/**
 * An address of a contact's link as https URL, else `null`: with `https://`,
 * or a bare host name with a top-level domain (`example.com/contact`), not
 * any text (`40` would be the IPv4 address 0.0.0.40).
 */
function webUrl (value: string): string | null {
  const trimmed = value.trim()
  if (/\s/.test(trimmed)) {
    return null
  }
  const explicit = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  const url = URL.parse(explicit ? trimmed : `https://${trimmed}`)
  return url && url.protocol === 'https:' && /^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(url.hostname) ? url.href : null
}

/** The URL a link's address opens: https, email or phone; `null` for others. */
export function linkUrl (value: string): string | null {
  const trimmed = value.trim()
  if (/^mailto:/i.test(trimmed)) {
    return mailtoUrl(trimmed)
  }
  if (/^tel:/i.test(trimmed)) {
    return telUrl(trimmed.slice(4))
  }
  if (/^http:/i.test(trimmed)) {
    return null
  }
  return webUrl(trimmed)
}

/** Whether every word of the query is in the contact's texts. */
export function contactMatches (contact: ContactInformation, query: string | null | undefined, locale: string): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const fields = [
    ...Object.values(contact.fields),
    ...contact.languages,
    ...contact.channels.flatMap(channel => [channel.value, channel.type, channel.availableTime]),
    ...contact.links.flatMap(link => [link.address, link.type]),
  ].filter((entry): entry is TextField => entry !== undefined)
  const haystack = [
    ...fields.flatMap(entry => entry.values.map(value => value.text)),
    roleText(contact, locale),
    ...contact.channels.map(channel => channelTypeText(channel, locale)),
    addressText(contact, locale),
    langText(contact.displayName, locale),
    contact.idShort,
  ].join('\n').toLowerCase()
  return words.every(word => haystack.includes(word))
}

// ---------------------------------------------------------------------------
// Rows

/** What a row shows. */
export type ContactRowKey = 'role' | 'company' | 'department' | 'address' | 'phone' | 'fax' | 'email' | 'link' | 'languages' | 'timeZone' | 'vatNumber' | 'remarks' | 'details' | 'publicKey' | 'field'

export interface ContactRow {
  key: ContactRowKey
  label: string
  value: string
  icon: string
  /** The channel's or link's type, e.g. "Office", "Chat". */
  type?: string
  /** When the contact answers, e.g. "Mon–Fri 8:00–17:00". */
  note?: string
  /** What the value opens: an https, `mailto:` or `tel:` URL. */
  url?: string
  /** The address in Google Maps. */
  map?: string
  /** The text to copy; channels and links only (an address opens its map instead). */
  copy?: string
  /** The field that changing the row changes; every row in edit mode. */
  field?: TextField
}

const channelIcons: Record<ChannelKind, string> = { phone: 'mdi-phone-outline', fax: 'mdi-fax', email: 'mdi-email-outline' }
const fieldIcons: Partial<Record<ContactFieldKey, string>> = {
  roleOfContactPerson: 'mdi-account-tie-outline',
  company: 'mdi-domain',
  department: 'mdi-account-group-outline',
  addressOfAdditionalLink: 'mdi-link-variant',
  timeZone: 'mdi-clock-outline',
  furtherDetailsOfContact: 'mdi-information-outline',
  vatNumber: 'mdi-receipt-text-outline',
  addressRemarks: 'mdi-map-marker-outline',
}

function present (row: ContactRow): boolean {
  return row.value.trim() !== ''
}

/**
 * The rows of a contact, labelled in the locale, in the order of the
 * template: role, company and department, address, channels, links,
 * languages, time zone and further details. Names are left to the heading
 * (`contactName`). With `edit`, one row per element instead, empty ones
 * too, each with its field, so that every value can be changed.
 */
export function contactRows (contact: ContactInformation, locale: string, options: { edit?: boolean } = {}): ContactRow[] {
  const label = (key: string) => contactText(key, locale)
  if (options.edit) {
    const fieldRow = (key: string, value: TextField | undefined, icon = 'mdi-form-textbox'): ContactRow | null => (value
      ? { key: 'field', label: label(key), value: fieldText(value, locale), icon, field: value }
      : null)
    return [
      ...contactFieldKeys.map(key => fieldRow(`fields.${key}`, contact.fields[key], fieldIcons[key])),
      ...contact.languages.map(entry => fieldRow('fields.language', entry, 'mdi-translate')),
      ...contact.channels.flatMap(channel => [
        fieldRow(`fields.${channel.kind}`, channel.value, channelIcons[channel.kind]),
        fieldRow(`fields.${channel.kind}Type`, channel.type, channelIcons[channel.kind]),
        fieldRow('fields.availableTime', channel.availableTime, 'mdi-clock-outline'),
        fieldRow('fields.publicKey', channel.publicKey, 'mdi-key-outline'),
        fieldRow('fields.typeOfPublicKey', channel.typeOfPublicKey, 'mdi-key-outline'),
      ]),
      ...contact.links.flatMap(link => [
        fieldRow('fields.addressOfAdditionalLink', link.address, 'mdi-link-variant'),
        fieldRow('fields.typeOfCommunication', link.type, 'mdi-link-variant'),
        fieldRow('fields.availableTime', link.availableTime, 'mdi-clock-outline'),
      ]),
    ].filter((row): row is ContactRow => row !== null)
  }

  const address = addressText(contact, locale)
  const link = text(contact, 'addressOfAdditionalLink', locale)
  const rows: ContactRow[] = [
    { key: 'role', label: label('labels.role'), value: roleText(contact, locale), icon: fieldIcons.roleOfContactPerson! },
    { key: 'company', label: label('labels.company'), value: text(contact, 'company', locale), icon: fieldIcons.company! },
    { key: 'department', label: label('labels.department'), value: text(contact, 'department', locale), icon: fieldIcons.department! },
    { key: 'address', label: label('labels.address'), value: addressLines(contact, locale).join('\n'), icon: 'mdi-map-marker-outline', map: address ? mapUrl(address) : undefined },
    { key: 'remarks', label: label('labels.remarks'), value: text(contact, 'addressRemarks', locale), icon: fieldIcons.addressRemarks! },
    ...contact.channels.map((channel): ContactRow => {
      const value = fieldText(channel.value, locale)
      return {
        key: channel.kind,
        label: label(`labels.${channel.kind}`),
        value,
        icon: channelIcons[channel.kind],
        type: channelTypeText(channel, locale) || undefined,
        note: fieldText(channel.availableTime, locale) || undefined,
        url: (channel.kind === 'email' ? mailtoUrl(value) : (channel.kind === 'phone' ? telUrl(value) : null)) ?? undefined,
        copy: value,
      }
    }),
    ...contact.channels.filter(channel => channel.kind === 'email' && channel.publicKey).map((channel): ContactRow => ({
      key: 'publicKey',
      label: label('labels.publicKey'),
      value: fieldText(channel.publicKey, locale),
      icon: 'mdi-key-outline',
      type: fieldText(channel.typeOfPublicKey, locale) || undefined,
      copy: fieldText(channel.publicKey, locale),
    })),
    { key: 'link', label: label('labels.link'), value: link, icon: fieldIcons.addressOfAdditionalLink!, url: linkUrl(link) ?? undefined, copy: link },
    ...contact.links.map((entry): ContactRow => {
      const value = fieldText(entry.address, locale)
      return {
        key: 'link',
        label: label('labels.link'),
        value,
        icon: fieldIcons.addressOfAdditionalLink!,
        type: fieldText(entry.type, locale) || undefined,
        note: fieldText(entry.availableTime, locale) || undefined,
        url: linkUrl(value) ?? undefined,
        copy: value,
      }
    }),
    { key: 'languages', label: label('labels.languages'), value: contact.languages.map(entry => fieldText(entry, locale)).filter(Boolean).map(code => languageName(code, locale)).join(', '), icon: 'mdi-translate' },
    { key: 'timeZone', label: label('labels.timeZone'), value: text(contact, 'timeZone', locale), icon: fieldIcons.timeZone! },
    { key: 'vatNumber', label: label('labels.vatNumber'), value: text(contact, 'vatNumber', locale), icon: fieldIcons.vatNumber! },
    { key: 'details', label: label('labels.details'), value: text(contact, 'furtherDetailsOfContact', locale), icon: fieldIcons.furtherDetailsOfContact! },
  ]
  return rows.filter(row => present(row))
}

// ---------------------------------------------------------------------------
// vCard

/** Escapes a vCard 3.0 text value (RFC 2426). */
function escape (value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(/\r?\n/g, String.raw`\n`).replaceAll(',', String.raw`\,`).replaceAll(';', String.raw`\;`)
}

/** Folds a content line after 75 octets (RFC 2425), without splitting a character. */
function fold (line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const length = encoder.encode(char).length
    if (size + length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += length
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const phoneTypes: Partial<Record<ChannelType, string>> = { office: 'WORK,VOICE', officeMobile: 'WORK,CELL', secretary: 'WORK,VOICE', substitute: 'WORK,VOICE', home: 'HOME,VOICE', privateMobile: 'CELL' }

export interface VCardOptions {
  /** The organization where the contact has no `Company`, e.g. a nameplate's manufacturer. */
  organization?: string
}

/**
 * The contact as vCard 3.0 (RFC 2426): name (`N`, `FN`; the company where
 * there is no name), organization and department, role, postal address,
 * phone and fax numbers, email addresses, links and notes. Texts in the
 * locale's language where the AAS has them.
 */
export function contactVCard (contact: ContactInformation, locale: string, options: VCardOptions = {}): string {
  const value = (key: ContactFieldKey) => text(contact, key, locale)
  const company = value('company') || options.organization || ''
  const name = contactName(contact, locale)
  const prefixes = [value('title'), value('academicTitle')].filter(Boolean).join(' ')
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${[value('nameOfContact'), value('firstName'), value('middleNames'), prefixes, ''].map(entry => escape(entry)).join(';')}`,
    `FN:${escape(name || company || langText(contact.displayName, locale) || contact.idShort)}`,
  ]
  if (company || value('department')) {
    lines.push(`ORG:${[company, value('department')].filter(Boolean).map(entry => escape(entry)).join(';')}`)
  }
  const role = roleText(contact, locale)
  if (role) {
    lines.push(`ROLE:${escape(role)}`)
  }
  const nationalCode = value('nationalCode')
  const address = [value('poBox'), '', value('street'), value('cityTown'), value('stateCounty'), value('zipcode') || value('zipCodeOfPOBox'), nationalCode ? countryName(nationalCode, locale) : '']
  if (address.some(Boolean)) {
    lines.push(`ADR;TYPE=WORK:${address.map(entry => escape(entry)).join(';')}`)
  }
  for (const channel of contact.channels) {
    const number = fieldText(channel.value, locale)
    if (!number) {
      continue
    }
    if (channel.kind === 'email') {
      lines.push(`EMAIL;TYPE=INTERNET${channelType(channel) === 'home' ? ',HOME' : ',WORK'}:${escape(number)}`)
    } else if (channel.kind === 'fax') {
      lines.push(`TEL;TYPE=${channelType(channel) === 'home' ? 'HOME' : 'WORK'},FAX:${escape(number)}`)
    } else {
      lines.push(`TEL;TYPE=${phoneTypes[channelType(channel) ?? 'office'] ?? 'WORK,VOICE'}:${escape(number)}`)
    }
  }
  for (const link of [value('addressOfAdditionalLink'), ...contact.links.map(entry => fieldText(entry.address, locale))]) {
    const url = link ? linkUrl(link) : null
    if (url?.startsWith('https:')) {
      lines.push(`URL:${escape(url)}`)
    }
  }
  const details = value('furtherDetailsOfContact')
  if (details) {
    lines.push(`NOTE:${escape(details)}`)
  }
  lines.push('END:VCARD')
  return `${lines.map(line => fold(line)).join('\r\n')}\r\n`
}

/** A file name for the contact's vCard, e.g. `Jane Doe.vcf`. */
export function vCardFileName (contact: ContactInformation, locale: string, fallback = 'contact'): string {
  const name = contactName(contact, locale) || text(contact, 'company', locale) || fallback
  return `${name.replaceAll(/[/\\:*?"<>|\0]/g, '').trim().slice(0, 120) || fallback}.vcf`
}
