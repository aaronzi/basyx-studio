// Generates the nameplate demo (open/studio-nameplate.aasx, and its
// submodels as JSON in nameplate/ for the unit tests) for the Digital
// Nameplate and Contacts apps: a gear motor with an IDTA 02006 Digital
// Nameplate 3.0 (logo, address with phone, fax and email, versions, four
// markings with images, certificates and dates, one expired, and asset
// specific properties of two guidelines) and an IDTA 02002 Contact
// Information 1.0 submodel with four contacts, and two more shells with the
// nameplate as 2.0 (`ContactInformation`, ECLASS semantic IDs, numbered
// markings) and as 1.0 (`Address`). Verified with AAS Core 3.1; every file is
// drawn here, so the fixture carries no third-party content.
//
// Run with: pnpm testenv:fixtures

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { unzipSync, zipSync } from 'fflate'

const require = createRequire(import.meta.url)
const { jsonization, verification } = require('@aas-core-works/aas-core3.1-typescript')
const { NewPackaging } = require('aas-package3-typescript')

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A PNG of rectangles on a background: the shell thumbnail. */
function png (width, height, background, rects) {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels.set(background, i * 3)
  }
  for (const [x, y, w, h, color] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        pixels.set(color, (j * width + i) * 3)
      }
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = []
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), Buffer.from(pixels.subarray(y * width * 3, (y + 1) * width * 3)))
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function svg (width, height, body) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${body}
</svg>
`)
}

const purple = '#5a3d99'
const ink = '#212121'

/** The manufacturer's logo: a gear and its name. */
const logoSvg = svg(240, 80, `  <rect width="240" height="80" rx="8" fill="#ffffff"/>
  <g transform="translate(40 40)" fill="${purple}">
    <circle r="22"/>
    ${Array.from({ length: 8 }, (_, index) => `<rect x="-5" y="-30" width="10" height="12" transform="rotate(${index * 45})"/>`).join('\n    ')}
    <circle r="9" fill="#ffffff"/>
  </g>
  <text x="80" y="36" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${ink}">EXAMPLE</text>
  <text x="80" y="60" font-family="Arial, sans-serif" font-size="20" fill="${purple}">DRIVES</text>`)

/** Marking images: drawn letters in a frame, not the official artwork. */
function markingSvg (letters, extra = '') {
  return svg(120, 120, `  <rect x="4" y="4" width="112" height="112" rx="10" fill="#ffffff" stroke="${ink}" stroke-width="4"/>
  <text x="60" y="76" text-anchor="middle" font-family="Georgia, serif" font-size="${letters.length > 2 ? 34 : 52}" font-weight="700" fill="${ink}">${letters}</text>${extra}`)
}

const weeeSvg = svg(120, 120, `  <rect x="4" y="4" width="112" height="112" rx="10" fill="#ffffff" stroke="${ink}" stroke-width="4"/>
  <path d="M38 34 h44 l-5 56 h-34 z" fill="none" stroke="${ink}" stroke-width="5"/>
  <path d="M32 34 h56" stroke="${ink}" stroke-width="5"/>
  <path d="M28 26 L92 98 M92 26 L28 98" stroke="${ink}" stroke-width="5"/>
  <rect x="34" y="102" width="52" height="8" fill="${ink}"/>`)

/** The rating plate as a photo would show it, for the asset specific properties. */
const ratingPlatePng = png(320, 180, [236, 239, 241], [
  [12, 12, 296, 156, [255, 255, 255]],
  [24, 24, 120, 14, [90, 61, 153]],
  ...[52, 74, 96, 118, 140].map(y => [24, y, 272, 8, [189, 189, 189]]),
])

/** Files of the demo, by name, stored under /aasx/files/nameplate/. */
const files = {
  'example-drives-logo.svg': { contentType: 'image/svg+xml', content: logoSvg },
  'marking-ce.svg': { contentType: 'image/svg+xml', content: markingSvg('CE') },
  'marking-ukca.svg': { contentType: 'image/svg+xml', content: markingSvg('UKCA') },
  'marking-weee.svg': { contentType: 'image/svg+xml', content: weeeSvg },
  'marking-ex.svg': { contentType: 'image/svg+xml', content: markingSvg('Ex', `\n  <path d="M60 14 L106 40 V80 L60 106 L14 80 V40 Z" fill="none" stroke="${ink}" stroke-width="3"/>`) },
  'rating-plate.png': { contentType: 'image/png', content: ratingPlatePng },
}
const filePath = name => `/aasx/files/nameplate/${name}`

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const reference = value => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const en = text => [{ language: 'en', text }]

function prop (idShort, semanticId, value, valueType = 'xs:string') {
  return { idShort, modelType: 'Property', ...(semanticId ? { semanticId: reference(semanticId) } : {}), valueType, ...(value === undefined ? {} : { value: String(value) }) }
}

/** A MultiLanguageProperty from a text, or from `{ en, de, ... }`. */
function mlp (idShort, semanticId, texts) {
  const value = typeof texts === 'string' ? en(texts) : Object.entries(texts).map(([language, text]) => ({ language, text }))
  return { idShort, modelType: 'MultiLanguageProperty', ...(semanticId ? { semanticId: reference(semanticId) } : {}), value }
}

function smc (idShort, semanticId, value, extra = {}) {
  return { ...(idShort ? { idShort } : {}), modelType: 'SubmodelElementCollection', ...(semanticId ? { semanticId: reference(semanticId) } : {}), ...extra, value }
}

function sml (idShort, semanticId, itemSemanticId, value) {
  return {
    idShort,
    modelType: 'SubmodelElementList',
    semanticId: reference(semanticId),
    orderRelevant: true,
    semanticIdListElement: reference(itemSemanticId),
    typeValueListElement: 'SubmodelElementCollection',
    value: value.map(item => smc(undefined, itemSemanticId, item)),
  }
}

function file (idShort, semanticId, name) {
  return { idShort, modelType: 'File', ...(semanticId ? { semanticId: reference(semanticId) } : {}), contentType: files[name].contentType, value: filePath(name) }
}

// IDTA 02002 Contact Information 1.0 (as server/lib/templates/contact-information-smc.json).
const ci = 'https://admin-shell.io/zvei/nameplate/1/0/ContactInformations'
const contactIds = {
  contactInformation: `${ci}/ContactInformation`,
  role: '0173-1#02-AAO204#003',
  nationalCode: '0173-1#02-AAO134#002',
  language: `${ci}/ContactInformation/Language`,
  timeZone: `${ci}/ContactInformation/TimeZone`,
  cityTown: '0173-1#02-AAO132#002',
  company: '0173-1#02-AAW001#001',
  department: '0173-1#02-AAO127#003',
  phone: `${ci}/ContactInformation/Phone`,
  telephoneNumber: '0173-1#02-AAO136#002',
  typeOfTelephone: '0173-1#02-AAO137#003',
  availableTime: `${ci}/ContactInformation/AvailableTime/`,
  fax: '0173-1#02-AAQ834#005',
  faxNumber: '0173-1#02-AAO195#002',
  typeOfFaxNumber: '0173-1#02-AAO196#003',
  email: '0173-1#02-AAQ836#005',
  emailAddress: '0173-1#02-AAO198#002',
  publicKey: '0173-1#02-AAO200#002',
  typeOfEmailAddress: '0173-1#02-AAO199#003',
  typeOfPublicKey: '0173-1#02-AAO201#002',
  ipCommunication: `${ci}/IPCommunication/`,
  addressOfAdditionalLink: '0173-1#02-AAQ326#002',
  typeOfCommunication: `${ci}/ContactInformation/IPCommunication/TypeOfCommunication`,
  street: '0173-1#02-AAO128#002',
  zipcode: '0173-1#02-AAO129#002',
  poBox: '0173-1#02-AAO130#002',
  zipCodeOfPOBox: '0173-1#02-AAO131#002',
  stateCounty: '0173-1#02-AAO133#002',
  nameOfContact: '0173-1#02-AAO205#002',
  firstName: '0173-1#02-AAO206#002',
  middleNames: '0173-1#02-AAO207#002',
  title: '0173-1#02-AAO208#003',
  academicTitle: '0173-1#02-AAO209#003',
  furtherDetailsOfContact: '0173-1#02-AAO210#002',
}

// ECLASS value lists of IDTA 02002.
const roles = { technical: '0173-1#07-AAS931#001', commercial: '0173-1#07-AAS928#001', hazardousGoods: '0173-1#07-AAS930#001' }
const types = { office: '0173-1#07-AAS754#001', officeMobile: '0173-1#07-AAS755#001', secretary: '0173-1#07-AAS756#001' }

function phone (number, type, available) {
  return smc('Phone', contactIds.phone, [
    mlp('TelephoneNumber', contactIds.telephoneNumber, number),
    prop('TypeOfTelephone', contactIds.typeOfTelephone, type),
    ...(available ? [mlp('AvailableTime', contactIds.availableTime, available)] : []),
  ])
}
const fax = (number, type) => smc('Fax', contactIds.fax, [mlp('FaxNumber', contactIds.faxNumber, number), prop('TypeOfFaxNumber', contactIds.typeOfFaxNumber, type)])
function email (address, type, publicKey) {
  return smc('Email', contactIds.email, [
    prop('EmailAddress', contactIds.emailAddress, address),
    ...(publicKey ? [mlp('PublicKey', contactIds.publicKey, publicKey.key), mlp('TypeOfPublicKey', contactIds.typeOfPublicKey, publicKey.type)] : []),
    prop('TypeOfEmailAddress', contactIds.typeOfEmailAddress, type),
  ])
}

/** The manufacturer's postal address, in the elements of IDTA 02002. */
const factoryAddress = [
  mlp('Street', contactIds.street, { en: 'Industriestraße 12', de: 'Industriestraße 12' }),
  mlp('Zipcode', contactIds.zipcode, '67663'),
  mlp('CityTown', contactIds.cityTown, 'Kaiserslautern'),
  mlp('StateCounty', contactIds.stateCounty, { en: 'Rhineland-Palatinate', de: 'Rheinland-Pfalz' }),
  mlp('NationalCode', contactIds.nationalCode, 'DE'),
]

// ---------------------------------------------------------------------------
// Digital Nameplate 3.0 (IDTA 02006-3-0, as server/lib/templates/digital-nameplate.json)
// ---------------------------------------------------------------------------

const ids = {
  shell: 'urn:studio:test:aas:nameplate',
  asset: 'urn:studio:test:asset:nameplate:gm40-000123',
  nameplate: 'urn:studio:test:sm:nameplate:3-0',
  contacts: 'urn:studio:test:sm:nameplate:contact-information',
  shell2: 'urn:studio:test:aas:nameplate-2-0',
  asset2: 'urn:studio:test:asset:nameplate:gm40-000045',
  nameplate2: 'urn:studio:test:sm:nameplate:2-0',
  shell1: 'urn:studio:test:aas:nameplate-1-0',
  asset1: 'urn:studio:test:asset:nameplate:gm25-000007',
  nameplate1: 'urn:studio:test:sm:nameplate:1-0',
}

const np3 = {
  marking: '0112/2///61360_7#AAS009#001',
  guideline: '0173-1#01-AHD205#004',
  arbitraryProperty: 'https://admin-shell.io/SMT/General/ArbitraryProp',
  arbitraryMlp: 'https://admin-shell.io/SMT/General/ArbitraryMLP',
  arbitraryFile: 'https://admin-shell.io/SMT/General/ArbitraryFile',
}

function marking3 ({ name, designation, issued, expires, image, text }) {
  return [
    prop('MarkingName', '0112/2///61987#ABA231#009', name),
    ...(designation ? [prop('DesignationOfCertificateOrApproval', '0112/2///61987#ABH783#003', designation)] : []),
    ...(issued ? [prop('IssueDate', '0112/2///61987#ABO097#001', issued, 'xs:date')] : []),
    ...(expires ? [prop('ExpiryDate', '0112/2///61987#ABH830#002', expires, 'xs:date')] : []),
    file('MarkingFile', '0112/2///61987#ABO100#002', image),
    ...(text ? [prop('MarkingAdditionalText', '0112/2///61987#ABB146#007', text)] : []),
  ]
}

const nameplate3 = {
  modelType: 'Submodel',
  id: ids.nameplate,
  idShort: 'Nameplate',
  semanticId: reference('https://admin-shell.io/idta/nameplate/3/0/Nameplate'),
  administration: { version: '3', revision: '0' },
  submodelElements: [
    prop('URIOfTheProduct', '0112/2///61987#ABN590#002', 'https://example.com/products/gm-40'),
    mlp('ManufacturerName', '0112/2///61987#ABA565#009', { en: 'Example Drives GmbH', de: 'Example Drives GmbH' }),
    mlp('ManufacturerProductDesignation', '0112/2///61987#ABA567#009', { en: 'Gear motor GM-40', de: 'Getriebemotor GM-40' }),
    smc('AddressInformation', `${ci}/AddressInformation`, [
      mlp('Company', contactIds.company, 'Example Drives GmbH'),
      mlp('Department', contactIds.department, { en: 'Customer service', de: 'Kundendienst' }),
      ...factoryAddress,
      phone('+49 631 123456-0', types.office, { en: 'Mon–Fri 8:00–17:00 CET', de: 'Mo–Fr 8:00–17:00 MEZ' }),
      fax('+49 631 123456-99', types.office),
      email('info@example.com', types.office),
      prop('AddressOfAdditionalLink', contactIds.addressOfAdditionalLink, 'https://example.com/contact'),
    ]),
    mlp('ManufacturerProductRoot', '0112/2///61360_7#AAS011#001', { en: 'Gear motors', de: 'Getriebemotoren' }),
    mlp('ManufacturerProductFamily', '0112/2///61987#ABP464#002', 'GM'),
    prop('ManufacturerProductType', '0112/2///61987#ABA300#008', 'GM-40-230-B3'),
    prop('OrderCodeOfManufacturer', '0112/2///61987#ABA950#008', 'GM40-230-B3-IP55'),
    prop('ProductArticleNumberOfManufacturer', '0112/2///61987#ABA581#007', '4711-0040'),
    prop('SerialNumber', '0112/2///61987#ABA951#009', 'GM40-2025-000123'),
    prop('YearOfConstruction', '0112/2///61987#ABP000#002', '2025'),
    prop('DateOfManufacture', '0112/2///61987#ABB757#007', '2025-03-12', 'xs:date'),
    prop('HardwareVersion', '0112/2///61987#ABA926#008', '1.2'),
    prop('FirmwareVersion', '0112/2///61987#ABA302#006', '3.4.1'),
    prop('SoftwareVersion', '0112/2///61987#ABA601#008', '2.0.0'),
    prop('CountryOfOrigin', '0112/2///61987#ABP462#001', 'DE'),
    prop('UniqueFacilityIdentifier', 'https://admin-shell.io/idta/nameplate/3/0/UniqueFacilityIdentifier', 'urn:example:facility:kaiserslautern-1'),
    file('CompanyLogo', '0112/2///61987#ABP463#001', 'example-drives-logo.svg'),
    sml('Markings', '0112/2///61360_7#AAS006#001', np3.marking, [
      marking3({ name: 'CE', designation: 'EU-DoC GM40-2025-01', issued: '2025-02-15', expires: '2030-02-14', image: 'marking-ce.svg', text: 'Machinery Directive 2006/42/EC, Low Voltage Directive 2014/35/EU' }),
      marking3({ name: 'UKCA', designation: 'UK-DoC GM40-2025-01', issued: '2025-02-15', image: 'marking-ukca.svg' }),
      marking3({ name: 'WEEE', image: 'marking-weee.svg', text: 'Dispose of separately from household waste.' }),
      marking3({ name: 'Ex', designation: 'ATEX EX-2019-0815', issued: '2019-06-01', expires: '2024-05-31', image: 'marking-ex.svg', text: 'II 3G Ex ec IIC T4 Gc' }),
    ]),
    smc('AssetSpecificProperties', '0173-1#02-ABI218#003/0173-1#01-AGZ672#004', [
      sml('GuidelineSpecificProperties', '0173-1#02-ABI219#003/0173-1#01-AHD205#004', np3.guideline, [
        [
          prop('GuidelineForConformityDeclaration', '0173-1#02-AAO856#002', '2006/42/EC'),
          prop('MaxAmbientTemperature', np3.arbitraryProperty, '40', 'xs:integer'),
          mlp('InstallationNote', np3.arbitraryMlp, { en: 'Install with the terminal box facing up.', de: 'Mit dem Klemmenkasten nach oben einbauen.' }),
        ],
        [
          prop('GuidelineForConformityDeclaration', '0173-1#02-AAO856#002', '2014/35/EU'),
          prop('RatedVoltage', np3.arbitraryProperty, '230', 'xs:integer'),
          prop('ProtectionClass', np3.arbitraryProperty, 'I'),
        ],
      ]),
      file('RatingPlate', np3.arbitraryFile, 'rating-plate.png'),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// Contact Information 1.0 (IDTA 02002-1-0)
// ---------------------------------------------------------------------------

const contactInformation = (idShort, value) => smc(idShort, contactIds.contactInformation, value)

const contacts = {
  modelType: 'Submodel',
  id: ids.contacts,
  idShort: 'ContactInformations',
  semanticId: reference(ci),
  administration: { version: '1', revision: '0' },
  submodelElements: [
    contactInformation('ContactInformation__00__', [
      prop('RoleOfContactPerson', contactIds.role, roles.technical),
      mlp('Title', contactIds.title, { en: 'Ms', de: 'Frau' }),
      mlp('AcademicTitle', contactIds.academicTitle, 'Dr.'),
      mlp('FirstName', contactIds.firstName, 'Jane'),
      mlp('MiddleNames', contactIds.middleNames, 'Q.'),
      mlp('NameOfContact', contactIds.nameOfContact, 'Doe'),
      mlp('Company', contactIds.company, 'Example Drives GmbH'),
      mlp('Department', contactIds.department, { en: 'Research and development', de: 'Forschung und Entwicklung' }),
      ...factoryAddress,
      prop('Language__00__', contactIds.language, 'de'),
      prop('Language__01__', contactIds.language, 'en'),
      prop('TimeZone', contactIds.timeZone, '+01:00'),
      phone('+49 (0)631 123456-21', types.officeMobile, { en: 'Mon–Thu 9:00–16:00 CET', de: 'Mo–Do 9:00–16:00 MEZ' }),
      email('jane.doe@example.com', types.office, { key: '7C2A 91F0 3D4B 55E8 A1C6 0B9D 2E7F 4A13 C8D5 6B20', type: 'OpenPGP fingerprint' }),
      smc('IPCommunication__00__', contactIds.ipCommunication, [
        prop('AddressOfAdditionalLink', contactIds.addressOfAdditionalLink, 'https://meet.example.com/jane.doe'),
        prop('TypeOfCommunication', contactIds.typeOfCommunication, 'Video call'),
        mlp('AvailableTime', contactIds.availableTime, { en: 'By appointment', de: 'Nach Vereinbarung' }),
      ]),
      mlp('FurtherDetailsOfContact', contactIds.furtherDetailsOfContact, { en: 'Questions about commissioning and the frequency converter.', de: 'Fragen zur Inbetriebnahme und zum Frequenzumrichter.' }),
    ]),
    contactInformation('ContactInformation__01__', [
      prop('RoleOfContactPerson', contactIds.role, roles.commercial),
      mlp('Company', contactIds.company, 'Example Drives GmbH'),
      mlp('Department', contactIds.department, { en: 'Sales', de: 'Vertrieb' }),
      ...factoryAddress,
      phone('+49 631 123456-30', types.office, { en: 'Mon–Fri 8:00–17:00 CET', de: 'Mo–Fr 8:00–17:00 MEZ' }),
      fax('+49 631 123456-39', types.office),
      email('sales@example.com', types.office),
      prop('AddressOfAdditionalLink', contactIds.addressOfAdditionalLink, 'https://example.com/sales'),
    ]),
    contactInformation('ContactInformation__02__', [
      prop('RoleOfContactPerson', contactIds.role, roles.hazardousGoods),
      mlp('FirstName', contactIds.firstName, 'Alex'),
      mlp('NameOfContact', contactIds.nameOfContact, 'Kim'),
      mlp('Company', contactIds.company, 'Example Drives GmbH'),
      mlp('Department', contactIds.department, { en: 'Logistics', de: 'Logistik' }),
      mlp('POBox', contactIds.poBox, { en: 'PO Box 1234', de: 'Postfach 1234' }),
      mlp('ZipCodeOfPOBox', contactIds.zipCodeOfPOBox, '67653'),
      mlp('CityTown', contactIds.cityTown, 'Kaiserslautern'),
      mlp('NationalCode', contactIds.nationalCode, 'DE'),
      phone('+49 631 123456-50', types.secretary),
      email('dangerous-goods@example.com', types.office),
    ]),
    contactInformation('ContactInformation__03__', [
      // A role by its English name instead of the value list's IRDI.
      prop('RoleOfContactPerson', contactIds.role, 'Other contact'),
      mlp('Company', contactIds.company, 'Example Drives Inc.'),
      mlp('Department', contactIds.department, 'Service hotline'),
      mlp('Street', contactIds.street, '200 Example Avenue'),
      mlp('Zipcode', contactIds.zipcode, '60601'),
      mlp('CityTown', contactIds.cityTown, 'Chicago'),
      mlp('StateCounty', contactIds.stateCounty, 'IL'),
      mlp('NationalCode', contactIds.nationalCode, 'US'),
      prop('Language__00__', contactIds.language, 'en'),
      prop('TimeZone', contactIds.timeZone, '-06:00'),
      phone('+1 312 555 0100', types.office, '24/7'),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// Digital Nameplate 2.0 (IDTA 02006-2-0) and 1.0 (ZVEI)
// ---------------------------------------------------------------------------

const np2 = 'https://admin-shell.io/zvei/nameplate/2/0/Nameplate'

const nameplate2 = {
  modelType: 'Submodel',
  id: ids.nameplate2,
  idShort: 'Nameplate',
  semanticId: reference(np2),
  administration: { version: '2', revision: '0' },
  submodelElements: [
    mlp('ManufacturerName', '0173-1#02-AAO677#002', 'Example Drives GmbH'),
    mlp('ManufacturerProductDesignation', '0173-1#02-AAW338#001', { en: 'Gear motor GM-40', de: 'Getriebemotor GM-40' }),
    smc('ContactInformation', contactIds.contactInformation, [
      prop('RoleOfContactPerson', contactIds.role, roles.commercial),
      mlp('Company', contactIds.company, 'Example Drives GmbH'),
      ...factoryAddress,
      phone('+49 631 123456-0', types.office),
      email('info@example.com', types.office),
    ]),
    mlp('ManufacturerProductRoot', '0173-1#02-AAU732#001', 'Gear motors'),
    mlp('ManufacturerProductFamily', '0173-1#02-AAU731#001', 'GM'),
    mlp('ManufacturerProductType', '0173-1#02-AAO057#002', 'GM-40-230-B3'),
    prop('OrderCodeOfManufacturer', '0173-1#02-AAO227#002', 'GM40-230-B3-IP55'),
    prop('ProductArticleNumberOfManufacturer', '0173-1#02-AAO676#003', '4711-0040'),
    prop('SerialNumber', '0173-1#02-AAM556#002', 'GM40-2023-000045'),
    prop('YearOfConstruction', '0173-1#02-AAP906#001', '2023'),
    prop('DateOfManufacture', '0173-1#02-AAR972#002', '2023-11-07', 'xs:date'),
    mlp('HardwareVersion', '0173-1#02-AAN270#002', '1.1'),
    mlp('FirmwareVersion', '0173-1#02-AAM985#002', '3.1.0'),
    mlp('SoftwareVersion', '0173-1#02-AAM737#002', '1.8.2'),
    prop('CountryOfOrigin', '0173-1#02-AAO259#004', 'DE'),
    file('CompanyLogo', `${np2}/CompanyLogo`, 'example-drives-logo.svg'),
    smc('Markings', `${np2}/Markings`, [
      smc('Marking01', `${np2}/Markings/Marking`, [
        prop('MarkingName', `${np2}/Markings/Marking/MarkingName`, 'CE'),
        prop('DesignationOfCertificateOrApproval', '0112/2///61987#ABH783#001', 'EU-DoC GM40-2023-04'),
        prop('IssueDate', `${np2}/Markings/Marking/IssueDate`, '2023-10-01', 'xs:date'),
        file('MarkingFile', `${np2}/Markings/Marking/MarkingFile`, 'marking-ce.svg'),
      ]),
      smc('Marking02', `${np2}/Markings/Marking`, [
        prop('MarkingName', `${np2}/Markings/Marking/MarkingName`, 'WEEE'),
        file('MarkingFile', `${np2}/Markings/Marking/MarkingFile`, 'marking-weee.svg'),
        prop('MarkingAdditionalText01', `${np2}/Markings/Marking/MarkingAdditionalText`, 'Dispose of separately from household waste.'),
      ]),
    ]),
    smc('AssetSpecificProperties', `${np2}/AssetSpecificProperties`, [
      smc('GuidelineSpecificProperties01', `${np2}/AssetSpecificProperties/GuidelineSpecificProperties`, [
        prop('GuidelineForConformityDeclaration', `${np2}/AssetSpecificProperties/GuidelineSpecificProperties/GuidelineForConformityDeclaration`, '2006/42/EC'),
        prop('MaxAmbientTemperature', undefined, '40', 'xs:integer'),
      ]),
    ]),
  ],
}

const np1 = 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate'

const nameplate1 = {
  modelType: 'Submodel',
  id: ids.nameplate1,
  idShort: 'Nameplate',
  semanticId: reference(np1),
  administration: { version: '1', revision: '0' },
  submodelElements: [
    mlp('ManufacturerName', '0173-1#02-AAO677#002', 'Example Drives GmbH'),
    mlp('ManufacturerProductDesignation', '0173-1#02-AAW338#001', { en: 'Gear motor GM-25', de: 'Getriebemotor GM-25' }),
    smc('Address', '0173-1#02-AAQ832#005', [
      mlp('Department', contactIds.department, { en: 'Customer service', de: 'Kundendienst' }),
      ...factoryAddress,
      smc('Phone', '0173-1#02-AAQ833#005', [mlp('TelephoneNumber', contactIds.telephoneNumber, '+49 631 123456-0'), prop('TypeOfTelephone', contactIds.typeOfTelephone, types.office)]),
      email('info@example.com', types.office),
    ]),
    mlp('ManufacturerProductFamily', '0173-1#02-AAU731#001', 'GM'),
    prop('SerialNumber', '0173-1#02-AAM556#002', 'GM25-2021-000007'),
    prop('YearOfConstruction', '0173-1#02-AAP906#001', '2021'),
    smc('Markings', 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate/Markings', [
      smc('Marking', 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate/Markings/Marking', [
        prop('MarkingName', 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate/Markings/Marking/MarkingName', 'CE'),
        file('MarkingFile', 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate/Markings/Marking/MarkingFile', 'marking-ce.svg'),
      ]),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// Shells, verification and the package
// ---------------------------------------------------------------------------

function shell (id, idShort, name, description, assetId, submodels) {
  return {
    modelType: 'AssetAdministrationShell',
    id,
    idShort,
    displayName: en(name),
    description: en(description),
    assetInformation: { assetKind: 'Instance', globalAssetId: assetId, defaultThumbnail: { path: '/thumbnail.png', contentType: 'image/png' } },
    submodels: submodels.map(value => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value }] })),
  }
}

const environment = {
  assetAdministrationShells: [
    shell(ids.shell, 'NameplateDemo', 'Nameplate demo', 'A gear motor with an IDTA 02006 Digital Nameplate 3.0 and IDTA 02002 Contact Information, for the Digital Nameplate and Contacts apps.', ids.asset, [ids.nameplate, ids.contacts]),
    shell(ids.shell2, 'NameplateDemo20', 'Nameplate demo 2.0', 'The gear motor\'s Digital Nameplate as IDTA 02006 2.0.', ids.asset2, [ids.nameplate2]),
    shell(ids.shell1, 'NameplateDemo10', 'Nameplate demo 1.0', 'An older gear motor with a ZVEI Digital Nameplate 1.0.', ids.asset1, [ids.nameplate1]),
  ],
  submodels: [nameplate3, contacts, nameplate2, nameplate1],
}

/** The environment as AAS Core 3.1 writes it, after verifying it. */
function verified (environmentJson) {
  const parsed = jsonization.environmentFromJsonable(environmentJson)
  if (parsed.error !== null) {
    throw new Error(`deserialization failed at ${parsed.error.path}: ${parsed.error.message}`)
  }
  const errors = [...verification.verify(parsed.mustValue())]
  if (errors.length > 0) {
    throw new Error(errors.map(error => `${error.path}: ${error.message}`).join('\n'))
  }
  return jsonization.toJsonable(parsed.mustValue())
}

/** An AASX package of the environment, its files and a thumbnail (as generate-file-previews.mjs writes them). */
async function writeAasx (aasxPath, canonical, parts, thumbnail) {
  const pkg = await NewPackaging().Create(aasxPath)
  try {
    const spec = await pkg.PutPart(new URL('https://package.local/aasx/data.json'), 'application/json', new TextEncoder().encode(JSON.stringify(canonical)))
    await pkg.MakeSpec(spec)
    for (const [path, contentType, content] of parts) {
      const part = await pkg.PutPart(new URL(`https://package.local${path}`), contentType, new Uint8Array(content))
      await pkg.RelateSupplementaryToSpec(part, spec)
    }
    await pkg.SetThumbnail(await pkg.PutPart(new URL('https://package.local/thumbnail.png'), 'image/png', new Uint8Array(thumbnail)))
    await pkg.Flush()
  } finally {
    pkg.Close()
  }
  writeFileSync(aasxPath, zipSync(unzipSync(readFileSync(aasxPath)), { level: 9, mtime: new Date('2026-10-27T00:00:00Z') }))
}

const canonical = verified(environment)
const thumbnail = png(160, 120, [255, 255, 255], [[20, 30, 90, 60, [90, 61, 153]], [110, 50, 30, 20, [33, 33, 33]], [20, 96, 120, 6, [189, 189, 189]]])
await writeAasx(join(fixturesDir, 'open', 'studio-nameplate.aasx'), canonical, Object.entries(files).map(([name, { content, contentType }]) => [filePath(name), contentType, content]), thumbnail)
writeFileSync(join(fixturesDir, 'nameplate', 'studio-nameplate.json'), `${JSON.stringify(canonical, null, 2)}\n`)
console.log(`wrote open/studio-nameplate.aasx (${Object.keys(files).length} files) and nameplate/studio-nameplate.json`)
