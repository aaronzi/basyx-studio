import type { ShellSummary } from '#shared/contract'
import { describe, expect, it } from 'vitest'
import { administrationOf, ownersOf, toSubmodelSummary } from '~~/server/lib/aas/submodels'

const shell = (id: string): ShellSummary => ({ key: id, id, idShort: id, displayName: [], description: [], assetKind: null, globalAssetId: null, thumbnail: false, thumbnailUrl: null })

describe('submodel summaries', () => {
  it('reads a submodel or its registry descriptor, which has no kind', () => {
    const submodel = {
      id: 'urn:sm:1',
      idShort: 'Nameplate',
      kind: 'Template',
      displayName: [{ language: 'en', text: 'Nameplate' }],
      semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate' }] },
      administration: { version: '3', revision: '0' },
    }
    expect(toSubmodelSummary(submodel)).toEqual({
      key: 'dXJuOnNtOjE',
      id: 'urn:sm:1',
      idShort: 'Nameplate',
      displayName: [{ language: 'en', text: 'Nameplate' }],
      description: [],
      kind: 'Template',
      semanticId: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate',
      administration: { version: '3', revision: '0', templateId: null },
    })
    const { kind: _, ...descriptor } = submodel
    expect(toSubmodelSummary({ ...descriptor, endpoints: [] })).toMatchObject({ kind: null, idShort: 'Nameplate' })
  })

  it('keeps administration only where it names something', () => {
    expect(administrationOf({ version: '', revision: '' })).toBeNull()
    expect(administrationOf({ templateId: 'https://admin-shell.io/idta/nameplate/3/0' })).toEqual({ version: null, revision: null, templateId: 'https://admin-shell.io/idta/nameplate/3/0' })
    expect(administrationOf(undefined)).toBeNull()
  })

  it('groups the shells that reference each submodel, each shell once', () => {
    const owners = ownersOf(['urn:sm:1', 'urn:sm:2'], [
      { summary: shell('urn:aas:a'), submodelIds: ['urn:sm:1', 'urn:sm:1', 'urn:sm:other'] },
      { summary: shell('urn:aas:b'), submodelIds: ['urn:sm:1'] },
    ])
    expect(owners['urn:sm:1']!.map(entry => entry.id)).toEqual(['urn:aas:a', 'urn:aas:b'])
    expect(owners['urn:sm:2']).toEqual([])
    expect(owners['urn:sm:other']).toBeUndefined()
  })
})
