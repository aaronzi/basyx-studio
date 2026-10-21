import type { AddressInfo } from 'node:net'
import type { InfrastructureRecord } from '~~/server/lib/infrastructures'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { policy, record } from '../support/live'

// A stand-in repository and registry for the asset fields of shell summaries
// (external apps follow-up plan R1) and File elements without a value (R3).

const encode = (id: string) => Buffer.from(id).toString('base64url')
const submodelId = 'urn:studio:test:sm:files'
const assetInformation = {
  assetKind: 'Instance',
  assetType: 'urn:example:type:pump',
  globalAssetId: 'urn:example:asset:pump-1',
  specificAssetIds: [
    { name: 'serialNumber', value: 'P-1', externalSubjectId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:example:maker' }] } },
    { name: 'partOf', value: 'urn:example:asset:line-1' },
  ],
}

describe('LiveAasTarget shell summaries and File contents', () => {
  let url = ''
  let requests: string[] = []

  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://x').pathname
    requests.push(path)
    const json = (status: number, value: unknown) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    const elements = `/submodels/${encode(submodelId)}/submodel-elements`
    switch (path) {
      case '/shells': {
        return json(200, {
          paging_metadata: {},
          result: [{ modelType: 'AssetAdministrationShell', id: 'urn:example:aas:pump-1', idShort: 'Pump1', assetInformation }],
        })
      }
      case '/shell-descriptors': {
        return json(200, {
          paging_metadata: {},
          result: [{ id: 'urn:example:aas:pump-1', idShort: 'Pump1', ...assetInformation, endpoints: [] }],
        })
      }
      case `${elements}/Empty`: {
        return json(200, { modelType: 'File', idShort: 'Empty', contentType: 'application/pdf' })
      }
      case `${elements}/Manual`: {
        return json(200, { modelType: 'File', idShort: 'Manual', contentType: 'application/pdf', value: '/aasx/files/manual.pdf' })
      }
      case `${elements}/Manual/attachment`: {
        return response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(Buffer.from([1, 2, 3]))
      }
      default: {
        // As AAS servers answer the attachment of a File without a value.
        return json(500, { messages: [{ text: `no content for ${path}` }] })
      }
    }
  })

  const target = (overrides: Partial<InfrastructureRecord> = {}) => new LiveAasTarget({
    record: { ...record(url, { mode: 'unsecured' }), ...overrides },
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(url),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  beforeEach(() => {
    requests = []
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  const expected = {
    assetType: 'urn:example:type:pump',
    specificAssetIds: [{ name: 'serialNumber', value: 'P-1' }, { name: 'partOf', value: 'urn:example:asset:line-1' }],
  }

  it('lists the asset type and specific asset IDs of shells from the repository', async () => {
    const page = await target().listShells(10, undefined)
    expect(page.items).toEqual([expect.objectContaining({ id: 'urn:example:aas:pump-1', ...expected })])
  })

  it('lists them from registry descriptors too', async () => {
    const page = await target({
      listSource: 'registry',
      endpoints: [{ type: 'aasRepository', url }, { type: 'submodelRepository', url }, { type: 'aasRegistry', url }],
    }).listShells(10, undefined)
    expect(page.items).toEqual([expect.objectContaining({ id: 'urn:example:aas:pump-1', ...expected })])
    expect(requests).toEqual(['/shell-descriptors'])
  })

  it('answers a File without a value as not found, without asking for its content', async () => {
    await expect(target().attachment(submodelId, 'Empty')).rejects.toMatchObject({ code: 'target_resource_not_found', status: 404 })
    expect(requests).toEqual([`/submodels/${encode(submodelId)}/submodel-elements/Empty`])
  })

  it('still reads a File with a value', async () => {
    const file = await target().attachment(submodelId, 'Manual')
    expect(file).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', fileName: 'manual.pdf' })
  })
})
