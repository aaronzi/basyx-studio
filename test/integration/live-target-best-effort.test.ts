import type * as GuardedFetch from '~~/server/lib/network/guarded-fetch'
import { describe, expect, it, vi } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// Simulates an AAS server without ETags (other implementations, older BaSyx
// Go): responses lose their ETag and conditional headers are not sent.
vi.mock('~~/server/lib/network/guarded-fetch', async original => {
  const actual = await original<typeof GuardedFetch>()
  return {
    ...actual,
    createGuardedFetch: (...args: Parameters<typeof actual.createGuardedFetch>): typeof fetch => {
      const guarded = actual.createGuardedFetch(...args)
      return async (input, init) => {
        const request = new Request(input, init)
        request.headers.delete('If-Match')
        const response = await guarded(request)
        const headers = new Headers(response.headers)
        headers.delete('ETag')
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
      }
    },
  }
})

// Other test files edit the edge-case submodel in parallel; this one uses its own element.
const large = 'urn:studio:test:sm:large'

function open () {
  return new LiveAasTarget({
    record: record(openTargetUrl, { mode: 'unsecured' }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

describe.runIf(testenvAvailable)('LiveAasTarget against a target without ETags', () => {
  it('reports best-effort concurrency and still detects a change before the write', async () => {
    const target = open()
    const before = await target.element(large, 'Value000')
    expect(before.concurrency).toBe('best_effort')

    const first = await target.setElementValue(large, 'Value000', '1', before.revision)
    try {
      expect(first.value.value).toBe('1')
      // The stale revision no longer matches the element, so the write is refused.
      await expect(target.setElementValue(large, 'Value000', '2', before.revision))
        .rejects
        .toMatchObject({ code: 'revision_conflict' })
    } finally {
      await target.setElementValue(large, 'Value000', before.value.value as string, first.revision)
    }
  })
})
