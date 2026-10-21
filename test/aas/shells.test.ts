import { describe, expect, it } from 'vitest'
import { descriptorSummary, externalUrl, toShellSummary } from '~~/server/lib/aas/shells'

describe('shell summaries', () => {
  it('names external thumbnails, which the browser loads directly', () => {
    const shell = (path: string) => ({ id: 'urn:a', assetInformation: { assetKind: 'Instance', defaultThumbnail: { path } } })
    expect(toShellSummary(shell('https://cdn.example.com/motor.png'))).toMatchObject({ thumbnail: true, thumbnailUrl: 'https://cdn.example.com/motor.png' })
    expect(toShellSummary(shell('/aasx/files/motor.png'))).toMatchObject({ thumbnail: true, thumbnailUrl: null })
    expect(toShellSummary({ id: 'urn:b' })).toMatchObject({ thumbnail: false, thumbnailUrl: null })
  })

  it('carries the asset type and the specific asset IDs with a name and a value', () => {
    expect(toShellSummary({
      id: 'urn:a',
      assetInformation: {
        assetKind: 'Instance',
        assetType: 'urn:example:type:pump',
        specificAssetIds: [{ name: 'serialNumber', value: 'P-1', externalSubjectId: { type: 'ExternalReference', keys: [] } }, { name: 'broken' }, 'x'],
      },
    })).toMatchObject({ assetType: 'urn:example:type:pump', specificAssetIds: [{ name: 'serialNumber', value: 'P-1' }] })
    expect(toShellSummary({ id: 'urn:b' })).toMatchObject({ assetType: null, specificAssetIds: [] })
    expect(descriptorSummary({ id: 'urn:c', assetType: 'urn:example:type:line', specificAssetIds: [{ name: 'line', value: 'L-1' }] }))
      .toMatchObject({ assetType: 'urn:example:type:line', specificAssetIds: [{ name: 'line', value: 'L-1' }] })
  })

  it('accepts only http and https as external addresses', () => {
    expect(externalUrl('HTTP://example.com/a.png')).toBe('HTTP://example.com/a.png')
    expect(externalUrl('javascript:alert(1)')).toBeNull()
    expect(externalUrl('file:///etc/passwd')).toBeNull()
    expect(externalUrl(42)).toBeNull()
  })
})
