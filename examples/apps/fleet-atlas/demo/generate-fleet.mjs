// Generates the demo fleet for Fleet Atlas: a fictitious bottling plant with
// lines, machines and components, each an Asset Administration Shell with the
// IDTA submodels Fleet Atlas reads (Digital Nameplate 3.0, Technical Data 1.2,
// Carbon Footprint 1.0, Handover Documentation, Hierarchical Structures 1.1)
// and operational data for the live lens. Some values are left empty on
// purpose, so passport readiness has gaps to find and fix.
//
// Run with: pnpm testenv:demo (writes test-setup/fixtures/demo/ and starts the
// "demo" target on http://localhost:18084).

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { jsonization, verification } = require('@aas-core-works/aas-core3.1-typescript')

const output = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'test-setup', 'fixtures', 'demo', 'fleet-atlas-demo.json')

// A seeded generator, so the fleet is the same on every run.
let seed = 20_261_015
function random () {
  seed = (seed + 0x6D_2B_79_F5) % 4_294_967_296
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}
const pick = items => items[Math.floor(random() * items.length)]
const between = (min, max, digits = 0) => (min + random() * (max - min)).toFixed(digits)
const chance = probability => random() < probability

// ---------------------------------------------------------------------------
// AAS builders
// ---------------------------------------------------------------------------

const base = 'https://demo.rheinfeld-bottling.example'
const externalRef = value => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const modelRef = (...keys) => ({ type: 'ModelReference', keys: keys.map(([type, value]) => ({ type, value })) })
const semantic = value => ({ semanticId: externalRef(value) })

function prop (idShort, valueType, value, extra = {}) {
  return { ...(idShort ? { idShort } : {}), modelType: 'Property', valueType, ...(value === undefined || value === null ? {} : { value: String(value) }), ...extra }
}
function mlp (idShort, text, extra = {}) {
  return { idShort, modelType: 'MultiLanguageProperty', ...(text ? { value: [{ language: 'en', text }] } : {}), ...extra }
}
function smc (idShort, value, extra = {}) {
  return { ...(idShort ? { idShort } : {}), modelType: 'SubmodelElementCollection', ...extra, value }
}
function sml (idShort, typeValueListElement, value, extra = {}) {
  return { ...(idShort ? { idShort } : {}), modelType: 'SubmodelElementList', orderRelevant: true, typeValueListElement, ...extra, value }
}
const qualifier = (type, valueType, value) => ({ type, valueType, value: String(value) })

// ---------------------------------------------------------------------------
// Catalogue: what the plant is made of
// ---------------------------------------------------------------------------

const countries = ['DE', 'DE', 'DE', 'AT', 'CH', 'IT', 'FR', 'NL', 'CZ', 'SE', 'JP', 'US']

/** Component kinds with their manufacturers, technical data and live signals. */
const components = {
  motor: {
    noun: 'Motor',
    manufacturers: ['Voltrix Drives', 'Nordwerk Elektromotoren', 'Kessler Antriebstechnik'],
    family: ['VX3 IE4 Synchronous', 'NM-Series IE3', 'K-Line Servo'],
    technical: () => {
      const power = pick([0.75, 1.1, 1.5, 2.2, 4, 5.5, 7.5, 11, 15, 22, 37, 55, 75])
      return { RatedPower: power, RatedVoltage: 400, RatedCurrent: (power * 1.9).toFixed(1), RatedSpeed: pick([1450, 1475, 2930, 3000]), Weight: (power * 6 + 8).toFixed(1), EfficiencyClass: pick(['IE3', 'IE4']) }
    },
    pcf: technical => Number(technical.Weight) * 9.5,
    signals: [
      { idShort: 'WindingTemperature', unit: '°C', base: 62, swing: 8, warn: 80, alarm: 90 },
      { idShort: 'Vibration', unit: 'mm/s', base: 1.6, swing: 0.6, warn: 4.5, alarm: 7.1, digits: 2 },
      { idShort: 'Speed', unit: 'rpm', base: 1460, swing: 15 },
    ],
  },
  drive: {
    noun: 'Frequency converter',
    manufacturers: ['Voltrix Drives', 'Kessler Antriebstechnik'],
    family: ['VXD-500', 'KFC Compact'],
    technical: () => ({ RatedPower: pick([2.2, 4, 7.5, 11, 22, 45]), RatedVoltage: 400, ProtectionClass: pick(['IP20', 'IP55']), Weight: between(3, 22, 1) }),
    pcf: technical => Number(technical.Weight) * 21,
    signals: [{ idShort: 'HeatsinkTemperature', unit: '°C', base: 48, swing: 6, warn: 75, alarm: 85 }],
  },
  pump: {
    noun: 'Centrifugal pump',
    manufacturers: ['Hydra Pumpen', 'Aquilon Fluid Systems'],
    family: ['HCP Hygienic', 'AQ-Inline'],
    technical: () => {
      const power = pick([1.5, 3, 5.5, 7.5, 11, 18.5, 30, 55, 75, 90])
      return { RatedPower: power, FlowRate: (power * 4.2).toFixed(0), MaxPressure: pick([6, 10, 16]), Weight: (power * 4 + 25).toFixed(1), Material: pick(['1.4404', '1.4301']) }
    },
    pcf: technical => Number(technical.Weight) * 7.8,
    signals: [
      { idShort: 'DischargePressure', unit: 'bar', base: 4.2, swing: 0.4, warn: 8.5, alarm: 9.5, digits: 2 },
      { idShort: 'FlowRate', unit: 'm³/h', base: 22, swing: 3, digits: 1 },
    ],
  },
  valve: {
    noun: 'Process valve',
    manufacturers: ['Aquilon Fluid Systems', 'Brennecke Ventiltechnik'],
    family: ['AV Butterfly', 'BV Double Seat'],
    technical: () => ({ NominalDiameter: pick([25, 40, 50, 65, 80, 100]), MaxPressure: pick([10, 16]), Weight: between(1.2, 9, 1), Material: '1.4404' }),
    pcf: technical => Number(technical.Weight) * 6.1,
  },
  sensor: {
    noun: 'Sensor',
    manufacturers: ['Brightline Sensorik', 'Lumetra Instruments'],
    family: ['BL Pressure Transmitter', 'LT Level Radar', 'BL Flow Meter', 'LT Temperature Probe'],
    technical: () => ({ SupplyVoltage: 24, ProtectionClass: pick(['IP67', 'IP69K']), Weight: between(0.2, 1.4, 2) }),
    pcf: technical => Number(technical.Weight) * 38,
  },
  plc: {
    noun: 'Controller',
    manufacturers: ['Kessler Automation', 'Orbis Control Systems'],
    family: ['KA-1500 PLC', 'Orbis Edge Controller'],
    technical: () => ({ SupplyVoltage: 24, DigitalInputs: pick([16, 32, 64]), Weight: between(0.6, 2.4, 2) }),
    pcf: technical => Number(technical.Weight) * 54,
    signals: [{ idShort: 'CpuLoad', unit: '%', base: 34, swing: 12, warn: 85, alarm: 95 }],
  },
  compressor: {
    noun: 'Screw compressor',
    manufacturers: ['Aerotec Kompressoren'],
    family: ['ATS-Series Oil-free'],
    technical: () => ({ RatedPower: pick([45, 55, 75, 90]), MaxPressure: 10, FreeAirDelivery: between(6, 15, 1), Weight: between(1100, 2100) }),
    pcf: technical => Number(technical.Weight) * 4.1,
    signals: [
      { idShort: 'OutletPressure', unit: 'bar', base: 7.4, swing: 0.3, warn: 9.2, alarm: 9.8, digits: 2 },
      { idShort: 'OilTemperature', unit: '°C', base: 74, swing: 5, warn: 95, alarm: 105 },
    ],
  },
  robot: {
    noun: 'Palletizing robot',
    manufacturers: ['Lumen Robotics'],
    family: ['LR-4 Palletizer'],
    technical: () => ({ Payload: pick([160, 240, 315]), Reach: pick([2400, 3100]), RatedPower: 11, Weight: between(980, 1350) }),
    pcf: technical => Number(technical.Weight) * 6.6,
    signals: [{ idShort: 'CycleTime', unit: 's', base: 6.2, swing: 0.4, warn: 8, alarm: 10, digits: 1 }],
  },
}

/** Machines: designation, maker and which components they contain. */
const machines = {
  rinser: { noun: 'Rinser', maker: 'Krones-Werk Neustadt', parts: ['motor', 'drive', 'pump', 'valve', 'valve', 'sensor', 'plc'] },
  filler: { noun: 'Rotary filler', maker: 'Krones-Werk Neustadt', parts: ['motor', 'motor', 'drive', 'drive', 'pump', 'valve', 'valve', 'valve', 'sensor', 'sensor', 'sensor', 'plc'] },
  capper: { noun: 'Capper', maker: 'Capsella Maschinenbau', parts: ['motor', 'drive', 'sensor', 'plc'] },
  inspector: { noun: 'Inspection unit', maker: 'Lumetra Instruments', parts: ['sensor', 'sensor', 'plc'] },
  conveyor: { noun: 'Bottle conveyor', maker: 'Transflux Fördertechnik', parts: ['motor', 'drive', 'sensor'] },
  labeler: { noun: 'Labeler', maker: 'Etikett & Co.', parts: ['motor', 'motor', 'drive', 'sensor', 'plc'] },
  packer: { noun: 'Shrink packer', maker: 'Capsella Maschinenbau', parts: ['motor', 'motor', 'drive', 'sensor', 'plc'] },
  palletizer: { noun: 'Palletizer cell', maker: 'Lumen Robotics', parts: ['robot', 'motor', 'drive', 'sensor', 'plc'] },
  wrapper: { noun: 'Stretch wrapper', maker: 'Transflux Fördertechnik', parts: ['motor', 'drive', 'sensor'] },
  compressors: { noun: 'Compressed air station', maker: 'Aerotec Kompressoren', parts: ['compressor', 'compressor', 'sensor', 'valve', 'plc'] },
  chiller: { noun: 'Process chiller', maker: 'Nordvent Kältetechnik', parts: ['motor', 'pump', 'pump', 'sensor', 'plc'] },
  cip: { noun: 'CIP skid', maker: 'Aquilon Fluid Systems', parts: ['pump', 'pump', 'valve', 'valve', 'valve', 'sensor', 'sensor', 'plc'] },
  water: { noun: 'Water treatment', maker: 'Aquilon Fluid Systems', parts: ['pump', 'pump', 'valve', 'sensor', 'sensor'] },
}

const plant = {
  name: 'Rheinfeld Bottling Plant',
  lines: [
    { name: 'Line 1 – Filling', machines: ['rinser', 'conveyor', 'filler', 'capper', 'inspector', 'conveyor'] },
    { name: 'Line 2 – Labeling & Packaging', machines: ['conveyor', 'labeler', 'conveyor', 'packer', 'palletizer', 'wrapper'] },
    { name: 'Utilities', machines: ['compressors', 'chiller', 'cip', 'water'] },
  ],
  // Spare parts in the warehouse: twins without a place in the structure.
  spares: ['motor', 'motor', 'motor', 'pump', 'pump', 'drive', 'drive', 'valve', 'sensor', 'sensor', 'plc', 'motor'],
}

// ---------------------------------------------------------------------------
// Twins
// ---------------------------------------------------------------------------

const shells = []
const submodels = []
const counters = {}

function slug (text) {
  return text.toLowerCase().replaceAll(/[^a-z\d]+/g, '-').replaceAll(/^-|-$/g, '')
}

function idShortOf (text) {
  const words = text.replaceAll(/[^A-Z\d ]+/gi, ' ').split(' ').filter(Boolean)
  const joined = words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return /^[A-Z]/i.test(joined) ? joined : `Asset${joined}`
}

/** Nameplate 3.0 with the passport-relevant properties; `gaps` leaves values empty. */
function nameplate (id, twin, gaps) {
  const value = key => (gaps.has(key) ? null : twin[key])
  return {
    modelType: 'Submodel',
    id,
    idShort: 'Nameplate',
    kind: 'Instance',
    ...semantic('https://admin-shell.io/idta/nameplate/3/0/Nameplate'),
    submodelElements: [
      prop('URIOfTheProduct', 'xs:string', value('uri'), semantic('0112/2///61987#ABN590#002')),
      mlp('ManufacturerName', value('manufacturer'), semantic('0112/2///61987#ABA565#009')),
      mlp('ManufacturerProductDesignation', value('designation'), semantic('0112/2///61987#ABA567#009')),
      mlp('ManufacturerProductFamily', twin.family, semantic('0112/2///61987#ABP464#002')),
      prop('ManufacturerProductType', 'xs:string', twin.type, semantic('0112/2///61987#ABA300#008')),
      prop('SerialNumber', 'xs:string', value('serial'), semantic('0112/2///61987#ABA951#009')),
      prop('YearOfConstruction', 'xs:string', value('year'), semantic('0112/2///61987#ABP000#002')),
      prop('DateOfManufacture', 'xs:date', value('date'), semantic('0112/2///61987#ABB757#007')),
      prop('CountryOfOrigin', 'xs:string', value('country'), semantic('0112/2///61987#ABP462#001')),
      prop('HardwareVersion', 'xs:string', twin.hardware, semantic('0112/2///61987#ABA926#008')),
    ],
  }
}

function technicalData (id, twin, technical) {
  return {
    modelType: 'Submodel',
    id,
    idShort: 'TechnicalData',
    kind: 'Instance',
    ...semantic('https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2'),
    submodelElements: [
      smc('GeneralInformation', [
        prop('ManufacturerName', 'xs:string', twin.manufacturer),
        mlp('ManufacturerProductDesignation', twin.designation),
        prop('ManufacturerArticleNumber', 'xs:string', twin.type),
      ], semantic('https://admin-shell.io/ZVEI/TechnicalData/GeneralInformation/1/1')),
      smc('TechnicalProperties', Object.entries(technical).map(([key, entry]) => {
        const numeric = typeof entry === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(entry))
        return prop(key, numeric ? 'xs:double' : 'xs:string', entry)
      }), semantic('https://admin-shell.io/ZVEI/TechnicalData/TechnicalProperties/1/1')),
    ],
  }
}

function carbonFootprint (id, value) {
  return {
    modelType: 'Submodel',
    id,
    idShort: 'CarbonFootprint',
    kind: 'Instance',
    ...semantic('https://admin-shell.io/idta/CarbonFootprint/CarbonFootprint/1/0'),
    submodelElements: [
      sml('ProductCarbonFootprints', 'SubmodelElementCollection', [
        smc(undefined, [
          sml('PcfCalculationMethods', 'Property', [prop(undefined, 'xs:string', 'GHG Protocol')], { valueTypeListElement: 'xs:string' }),
          prop('PcfCO2eq', 'xs:double', value),
          prop('ReferenceImpactUnitForCalculation', 'xs:string', 'piece'),
          prop('QuantityOfMeasureForCalculation', 'xs:double', '1'),
          sml('LifeCyclePhases', 'Property', [prop(undefined, 'xs:string', 'A1-A3')], { valueTypeListElement: 'xs:string' }),
        ]),
      ]),
    ],
  }
}

function documentation (id, twin, count) {
  const titles = ['Operating instructions', 'Declaration of conformity', 'Maintenance manual', 'Spare parts list']
  return {
    modelType: 'Submodel',
    id,
    idShort: 'HandoverDocumentation',
    kind: 'Instance',
    ...semantic('0173-1#01-AHF578#003'),
    submodelElements: [
      sml('Documents', 'SubmodelElementCollection', titles.slice(0, count).map((title, index) => smc(undefined, [
        sml('DocumentIds', 'SubmodelElementCollection', [smc(undefined, [
          prop('DocumentDomainId', 'xs:string', slug(twin.manufacturer)),
          prop('DocumentIdentifier', 'xs:string', `${twin.type}-D${index + 1}`),
        ])]),
        sml('DocumentVersions', 'SubmodelElementCollection', [smc(undefined, [
          sml('Languages', 'Property', [prop(undefined, 'xs:string', 'en')], { valueTypeListElement: 'xs:string' }),
          prop('Version', 'xs:string', '1.0'),
          mlp('Title', `${title} – ${twin.designation}`),
          prop('StatusSetDate', 'xs:date', twin.date ?? '2024-01-15'),
          prop('StatusValue', 'xs:string', 'Released'),
        ])]),
      ]))),
    ],
  }
}

/** Hierarchical Structures 1.1, archetype OneDown: the twin and its direct parts. */
function hierarchy (id, twin, parts) {
  const entry = 'EntryNode'
  return {
    modelType: 'Submodel',
    id,
    idShort: 'HierarchicalStructures',
    kind: 'Instance',
    ...semantic('https://admin-shell.io/idta/HierarchicalStructuresEnablingBoM/1/1/Submodel'),
    submodelElements: [
      prop('ArcheType', 'xs:string', 'OneDown', semantic('https://admin-shell.io/idta/HierarchicalStructures/ArcheType/1/0')),
      {
        idShort: entry,
        modelType: 'Entity',
        entityType: 'SelfManagedEntity',
        globalAssetId: twin.assetId,
        ...semantic('https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0'),
        statements: [
          ...parts.map((part, index) => ({
            idShort: `Node${String(index + 1).padStart(2, '0')}`,
            modelType: 'Entity',
            entityType: 'SelfManagedEntity',
            globalAssetId: part.assetId,
            ...semantic('https://admin-shell.io/idta/HierarchicalStructures/Node/1/0'),
          })),
          ...parts.map((part, index) => ({
            idShort: `HasPart${String(index + 1).padStart(2, '0')}`,
            modelType: 'RelationshipElement',
            ...semantic('https://admin-shell.io/idta/HierarchicalStructures/HasPart/1/0'),
            first: modelRef(['Submodel', id], ['Entity', entry]),
            second: modelRef(['Submodel', id], ['Entity', entry], ['Entity', `Node${String(index + 1).padStart(2, '0')}`]),
          })),
        ],
      },
    ],
  }
}

function operationalData (id, signals) {
  return {
    modelType: 'Submodel',
    id,
    idShort: 'OperationalData',
    kind: 'Instance',
    ...semantic('urn:basyx:studio:demo:OperationalData:1:0'),
    submodelElements: signals.map(signal => prop(signal.idShort, 'xs:double', (signal.base + (random() - 0.5) * signal.swing).toFixed(signal.digits ?? 1), {
      qualifiers: [
        qualifier('Unit', 'xs:string', signal.unit),
        ...(signal.warn === undefined ? [] : [qualifier('WarningAbove', 'xs:double', signal.warn)]),
        ...(signal.alarm === undefined ? [] : [qualifier('AlarmAbove', 'xs:double', signal.alarm)]),
      ],
    })),
  }
}

/** Creates one twin and its submodels; returns its asset reference for its parent. */
function twin ({ name, designation, manufacturer, family, kind, technical, pcf, signals, parts = [], level }) {
  counters[kind] = (counters[kind] ?? 0) + 1
  const key = `${slug(kind)}-${String(counters[kind]).padStart(3, '0')}`
  const year = Number(between(2008, 2025))
  const record = {
    key,
    assetId: `${base}/asset/${key}`,
    shellId: `${base}/aas/${key}`,
    manufacturer,
    designation,
    family,
    type: `${slug(manufacturer).slice(0, 3).toUpperCase()}-${between(1000, 9999)}`,
    serial: `SN${between(100_000, 999_999)}`,
    year: String(year),
    date: `${year}-${String(Number(between(1, 12))).padStart(2, '0')}-${String(Number(between(1, 28))).padStart(2, '0')}`,
    country: pick(countries),
    uri: `https://products.${slug(manufacturer)}.example/${slug(family ?? designation)}`,
    hardware: `${between(1, 4)}.${between(0, 9)}`,
  }
  // Passport gaps: assemblies are usually better documented than parts.
  const gapRate = level === 'component' ? 1 : 0.4
  const gaps = new Set()
  if (chance(0.22 * gapRate)) {
    gaps.add('country')
  }
  if (chance(0.14 * gapRate)) {
    gaps.add('serial')
  }
  if (chance(0.1 * gapRate)) {
    gaps.add('year')
  }
  if (chance(0.08 * gapRate)) {
    gaps.add('uri')
  }
  if (chance(0.05 * gapRate)) {
    gaps.add('manufacturer')
  }

  const ids = []
  const add = (suffix, build) => {
    const id = `${base}/sm/${key}/${suffix}`
    submodels.push(build(id))
    ids.push(id)
  }
  add('nameplate', id => nameplate(id, record, gaps))
  if (technical && chance(level === 'component' ? 0.85 : 0.95)) {
    add('technical-data', id => technicalData(id, record, technical))
  }
  if (pcf !== undefined && chance(level === 'component' ? 0.72 : 0.9)) {
    add('carbon-footprint', id => carbonFootprint(id, chance(0.15) ? null : pcf.toFixed(1)))
  }
  if (chance(level === 'component' ? 0.55 : 0.92)) {
    add('documentation', id => documentation(id, record, Number(between(1, 4))))
  }
  if (parts.length > 0) {
    add('hierarchy', id => hierarchy(id, record, parts))
  }
  if (signals?.length) {
    add('operational-data', id => operationalData(id, signals))
  }

  shells.push({
    modelType: 'AssetAdministrationShell',
    id: record.shellId,
    idShort: idShortOf(name),
    displayName: [{ language: 'en', text: name }],
    assetInformation: { assetKind: 'Instance', globalAssetId: record.assetId },
    submodels: ids.map(id => modelRef(['Submodel', id])),
  })
  return { assetId: record.assetId, pcf: pcf ?? 0 }
}

function component (kind, owner) {
  const spec = components[kind]
  const index = Math.floor(random() * spec.manufacturers.length)
  const technical = spec.technical()
  const family = spec.family[index % spec.family.length]
  const designation = kind === 'sensor' ? family.replace(/^(BL|LT) /, '') : `${spec.noun} ${family}`
  return twin({
    name: owner ? `${owner} · ${designation}` : `Spare · ${designation}`,
    designation,
    manufacturer: spec.manufacturers[index],
    family,
    kind,
    technical,
    pcf: spec.pcf(technical) * Number(between(0.85, 1.15, 2)),
    signals: owner ? spec.signals : undefined,
    level: 'component',
  })
}

const lineRefs = plant.lines.map((line, lineIndex) => {
  const seen = {}
  const machineRefs = line.machines.map(kind => {
    const spec = machines[kind]
    seen[kind] = (seen[kind] ?? 0) + 1
    const name = `L${lineIndex + 1} ${spec.noun}${line.machines.filter(item => item === kind).length > 1 ? ` ${seen[kind]}` : ''}`
    const parts = spec.parts.map(part => component(part, name))
    const weight = 800 + spec.parts.length * 260
    return twin({
      name,
      designation: spec.noun,
      manufacturer: spec.maker,
      family: `${spec.noun} ${pick(['Modular', 'Compact', 'Hygienic', 'HighSpeed'])}`,
      kind,
      technical: { RatedPower: parts.length * 3 + Number(between(4, 30)), Throughput: pick([24_000, 36_000, 48_000]), Weight: weight },
      pcf: weight * 3.4 + parts.reduce((sum, part) => sum + part.pcf, 0) * 0.2,
      parts,
      level: 'machine',
    })
  })
  return twin({ name: line.name, designation: 'Production line', manufacturer: 'Rheinfeld Bottling GmbH', kind: 'line', parts: machineRefs, level: 'line' })
})
twin({ name: plant.name, designation: 'Bottling plant', manufacturer: 'Rheinfeld Bottling GmbH', kind: 'plant', parts: lineRefs, level: 'plant' })
for (const kind of plant.spares) {
  component(kind, null)
}

// ---------------------------------------------------------------------------
// Verify and write
// ---------------------------------------------------------------------------

const environment = { assetAdministrationShells: shells, submodels }
const parsed = jsonization.environmentFromJsonable(environment)
if (parsed.error !== null) {
  throw new Error(`deserialization failed at ${parsed.error.path}: ${parsed.error.message}`)
}
const errors = [...verification.verify(parsed.mustValue())]
if (errors.length > 0) {
  throw new Error(errors.slice(0, 20).map(error => `${error.path}: ${error.message}`).join('\n'))
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(jsonization.toJsonable(parsed.mustValue()))}\n`)
console.info(`wrote ${shells.length} shells and ${submodels.length} submodels to ${output}`)
