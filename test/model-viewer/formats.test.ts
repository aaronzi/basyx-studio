import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectModelFormat, fileExtension, refineModelFormat } from '../../packages/model-viewer/src/formats'
import { externalResources, gltfJson } from '../../packages/model-viewer/src/gltf'

// Which files the 3D view offers and reads (packages/model-viewer).

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-setup/fixtures/models3d/${name}`, import.meta.url)))

describe('fileExtension', () => {
  it('reads the extension of names, paths and URLs', () => {
    expect(fileExtension('bracket.STL')).toBe('stl')
    expect(fileExtension('/aasx/files/models3d/bracket.step')).toBe('step')
    expect(fileExtension('https://example.com/a/model.glb?token=1#x')).toBe('glb')
    expect(fileExtension('README')).toBe('')
    expect(fileExtension('.hidden')).toBe('')
    expect(fileExtension(null)).toBe('')
  })
})

describe('detectModelFormat', () => {
  it('knows the media types of every format', () => {
    expect(detectModelFormat({ contentType: 'model/stl' })).toBe('stl')
    expect(detectModelFormat({ contentType: 'application/vnd.ms-pki.stl' })).toBe('stl')
    expect(detectModelFormat({ contentType: 'model/obj' })).toBe('obj')
    expect(detectModelFormat({ contentType: 'model/gltf+json' })).toBe('gltf')
    expect(detectModelFormat({ contentType: 'model/gltf-binary; charset=binary' })).toBe('glb')
    expect(detectModelFormat({ contentType: 'model/ifc' })).toBe('ifc')
    expect(detectModelFormat({ contentType: 'MODEL/STEP' })).toBe('step')
  })

  it('falls back to the extension for generic media types', () => {
    expect(detectModelFormat({ contentType: 'application/octet-stream', fileName: '/files/part.stp' })).toBe('step')
    expect(detectModelFormat({ contentType: '', fileName: 'house.ifc' })).toBe('ifc')
    // IDTA 02026's template has image/png as DigitalFile media type; instances may keep it.
    expect(detectModelFormat({ contentType: 'image/png', fileName: 'model.glb' })).toBe('glb')
  })

  it('lets the extension tell IFC from STEP, which share media types', () => {
    expect(detectModelFormat({ contentType: 'application/x-step', fileName: 'workshop.ifc' })).toBe('ifc')
    expect(detectModelFormat({ contentType: 'model/step', fileName: 'part.step' })).toBe('step')
    expect(detectModelFormat({ contentType: 'application/step' })).toBe('step')
    expect(detectModelFormat({ contentType: 'model/gltf+json', fileName: 'model.glb' })).toBe('glb')
  })

  it('offers nothing for other files', () => {
    expect(detectModelFormat({ contentType: 'application/pdf', fileName: 'manual.pdf' })).toBeNull()
    expect(detectModelFormat({ contentType: 'application/octet-stream', fileName: 'gearbox.jt' })).toBeNull()
    expect(detectModelFormat({})).toBeNull()
  })
})

describe('refineModelFormat', () => {
  it('reads the schema of STEP files', () => {
    expect(refineModelFormat('step', fixture('workshop.ifc'))).toBe('ifc')
    expect(refineModelFormat('ifc', fixture('bracket.step'))).toBe('step')
  })

  it('tells binary from JSON glTF', () => {
    expect(refineModelFormat('gltf', fixture('bracket.glb'))).toBe('glb')
    expect(refineModelFormat('glb', fixture('bracket.gltf'))).toBe('gltf')
  })

  it('keeps other formats', () => {
    expect(refineModelFormat('stl', fixture('bracket.stl'))).toBe('stl')
    expect(refineModelFormat('step', new TextEncoder().encode('not a step file'))).toBe('step')
  })
})

describe('externalResources', () => {
  it('finds geometry in other files', () => {
    expect(externalResources(fixture('bracket-external.gltf'))).toEqual({ buffers: ['bracket.bin'], images: [] })
  })

  it('accepts embedded data', () => {
    expect(externalResources(fixture('bracket.gltf'))).toEqual({ buffers: [], images: [] })
    expect(externalResources(fixture('bracket.glb'))).toEqual({ buffers: [], images: [] })
  })

  it('reads the JSON chunk of a binary glTF', () => {
    expect(gltfJson(fixture('bracket.glb'))?.asset).toEqual({ version: '2.0', generator: 'BaSyx Studio test fixtures' })
    expect(gltfJson(new TextEncoder().encode('{ broken'))).toBeNull()
  })
})
