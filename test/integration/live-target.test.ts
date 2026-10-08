import type { InfrastructureRecord } from '~~/server/lib/infrastructures'
import type { OutboundPolicy } from '~~/server/lib/network/guarded-fetch'
import { describe, expect, it, vi } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { openTargetUrl, securedTargetUrl, testenvAvailable, testUserAccessToken } from '../support/testenv'

function record (url: string, security: InfrastructureRecord['security']): InfrastructureRecord {
  return {
    id: 'test',
    name: 'test',
    description: null,
    endpoints: [{ type: 'aasRepository', url }, { type: 'submodelRepository', url }],
    security,
    secretCiphertext: null,
    allowPrivateNetwork: true,
    revision: 1,
    createdBy: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function policy (url: string, overrides: Partial<OutboundPolicy> = {}): OutboundPolicy {
  return { allowedOrigins: new Set([new URL(url).origin]), allowPrivateNetwork: true, timeoutMs: 10_000, maxResponseBytes: 10_000_000, ...overrides }
}

const delegated: InfrastructureRecord['security'] = {
  mode: 'delegated_user',
  issuer: 'http://keycloak.localhost:18080/realms/basyx-studio',
  clientId: 'studio-web',
  scopes: ['openid', 'basyx-api'],
  clientSecret: null,
  desktopLoopbackHost: '127.0.0.1',
}

describe.runIf(testenvAvailable)('LiveAasTarget against the test environment', () => {
  const open = (overrides: Partial<OutboundPolicy> = {}) => new LiveAasTarget({
    record: record(openTargetUrl, { mode: 'unsecured' }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl, overrides),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })

  async function secured (username: string | undefined, onUnauthorized = async () => {}) {
    return new LiveAasTarget({
      record: record(securedTargetUrl, delegated),
      access: { accessToken: username ? await testUserAccessToken(username) : undefined, downstreamIdentity: null },
      policy: policy(securedTargetUrl),
      requestId: 'test-request',
      onUnauthorized,
    })
  }

  it('pages through all shells with the cursor', async () => {
    const target = open()
    let cursor: string | undefined
    let total = 0
    for (let page = 0; page < 10; page++) {
      const result = await target.listShells(25, cursor)
      total += result.items.length
      cursor = result.page.nextCursor ?? undefined
      if (!cursor) {
        break
      }
    }
    expect(total).toBe(62)
  })

  it('reads nested elements and lists of lists as JSON', async () => {
    const target = open()
    expect(await target.element('urn:studio:test:sm:edge-cases', 'Level1.Level2.Items[1].Details.Deepest'))
      .toMatchObject({ modelType: 'Property', value: 'deepest value of item 1' })
    expect(await target.element('urn:studio:test:sm:edge-cases', 'NestedLists[1][0]'))
      .toMatchObject({ modelType: 'Property', value: 'c' })
  })

  it('resolves submodel references including the dangling one', async () => {
    const target = open()
    const ids = await target.submodelIds('urn:studio:test:aas:edge-cases')
    expect(ids).toEqual(['urn:studio:test:sm:edge-cases', 'urn:studio:test:sm:large', 'urn:studio:test:sm:missing'])
    await expect(target.submodelMetadata('urn:studio:test:sm:missing')).rejects.toMatchObject({ code: 'target_resource_not_found' })
    expect(await target.submodelMetadata('urn:studio:test:sm:edge-cases')).toMatchObject({ idShort: 'EdgeCases' })
  })

  it('maps downstream authorization failures', async () => {
    await expect((await secured(undefined)).listShells(10, undefined)).rejects.toMatchObject({ code: 'target_forbidden' })
    await expect((await secured('bob')).listShells(10, undefined)).rejects.toMatchObject({ code: 'target_forbidden' })
    const carol = await secured('carol')
    expect((await carol.listShells(10, undefined)).items.map(shell => shell.idShort)).toEqual(['SecuredPublicShell'])
    await expect(carol.submodelMetadata('urn:studio:test:secured:sm:restricted-costs')).rejects.toMatchObject({ code: 'target_forbidden' })
  })

  it('treats a token for another audience as rejected and invalidates it', async () => {
    const onUnauthorized = vi.fn(async () => {})
    const target = new LiveAasTarget({
      record: record(securedTargetUrl, delegated),
      access: { accessToken: await testUserAccessToken('alice', 'openid'), downstreamIdentity: null },
      policy: policy(securedTargetUrl),
      requestId: 'test-request',
      onUnauthorized,
    })
    await expect(target.listShells(10, undefined)).rejects.toMatchObject({ code: 'target_auth_required' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('blocks origins and private addresses outside the policy', async () => {
    await expect(open({ allowedOrigins: new Set(['http://localhost:9']) }).listShells(10, undefined))
      .rejects
      .toMatchObject({ code: 'target_blocked' })
    await expect(open({ allowPrivateNetwork: false }).listShells(10, undefined))
      .rejects
      .toMatchObject({ code: 'target_blocked' })
  })

  it('enforces the response size limit', async () => {
    await expect(open({ maxResponseBytes: 1000 }).submodel('urn:studio:test:sm:large'))
      .rejects
      .toMatchObject({ code: 'target_invalid_response' })
  })
})
