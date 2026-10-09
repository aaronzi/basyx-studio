import { afterAll, describe, expect, it } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { delegated, policy, record } from '../support/live'
import { openTargetUrl, securedTargetUrl, testenvAvailable, testUserAccessToken } from '../support/testenv'

const edgeCases = 'urn:studio:test:sm:edge-cases'
const nameplate = 'urn:studio:test:secured:sm:public-nameplate'

function open () {
  return new LiveAasTarget({
    record: record(openTargetUrl, { mode: 'unsecured' }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

async function secured (username: string) {
  return new LiveAasTarget({
    record: record(securedTargetUrl, delegated),
    access: { accessToken: await testUserAccessToken(username), downstreamIdentity: null },
    policy: policy(securedTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

describe.runIf(testenvAvailable)('LiveAasTarget writes against the test environment', () => {
  // The test environment is shared, so every test restores what it changed.
  const restore: Array<() => Promise<unknown>> = []
  afterAll(async () => {
    const failures: unknown[] = []
    for (const step of restore.toReversed()) {
      await step().catch(error => failures.push(error))
    }
    expect(failures).toEqual([])
  })

  async function setAndRestore (target: LiveAasTarget, submodelId: string, path: string, value: string | Array<{ language: string, text: string }> | null) {
    const before = await target.element(submodelId, path)
    const original = before.value.value ?? null
    restore.push(async () => {
      const current = await target.element(submodelId, path)
      await target.setElementValue(submodelId, path, original as string | null, current.revision)
    })
    return target.setElementValue(submodelId, path, value, before.revision)
  }

  it('reads elements with a strong revision from BaSyx Go', async () => {
    const snapshot = await open().element(edgeCases, 'SimpleString')
    expect(snapshot.concurrency).toBe('strong')
    expect(snapshot.revision).toMatch(/^h\./)
  })

  it('sets a Property value and returns the new revision', async () => {
    const target = open()
    const before = await target.element(edgeCases, 'SimpleString')
    const after = await setAndRestore(target, edgeCases, 'SimpleString', 'changed by Studio')
    expect(after.value).toMatchObject({ modelType: 'Property', value: 'changed by Studio' })
    expect(after.revision).not.toBe(before.revision)
    expect((await target.element(edgeCases, 'SimpleString')).value.value).toBe('changed by Studio')
  })

  it('sets a MultiLanguageProperty value', async () => {
    const target = open()
    const before = await target.element(edgeCases, 'Title')
    const original = before.value.value as Array<{ language: string, text: string }>
    restore.push(async () => {
      const current = await target.element(edgeCases, 'Title')
      await target.setElementValue(edgeCases, 'Title', original, current.revision)
    })
    const after = await target.setElementValue(edgeCases, 'Title', [{ language: 'en', text: 'Edited title' }], before.revision)
    expect(after.value.value).toEqual([{ language: 'en', text: 'Edited title' }])
  })

  it('rejects a write based on an outdated revision', async () => {
    const target = open()
    const stale = await target.element(edgeCases, 'Name-With-Hyphen')
    await setAndRestore(target, edgeCases, 'Name-With-Hyphen', 'first writer')
    await expect(target.setElementValue(edgeCases, 'Name-With-Hyphen', 'second writer', stale.revision))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
    expect((await target.element(edgeCases, 'Name-With-Hyphen')).value.value).toBe('first writer')
  })

  it('accepts a write after another element of the same submodel changed', async () => {
    // BaSyx Go keeps one revision per submodel; Studio must not report this as a conflict.
    const target = open()
    const temperature = await target.element(edgeCases, 'Temperature')
    await setAndRestore(target, edgeCases, 'EmptyValue', 'sibling change')
    const after = await setAndRestore(target, edgeCases, 'Temperature', '22.5')
    expect(after.value.value).toBe('22.5')
    expect(after.revision).not.toBe(temperature.revision)
  })

  it('validates values against the value type with AAS Core', async () => {
    const target = open()
    const before = await target.element(edgeCases, 'Temperature')
    await expect(target.setElementValue(edgeCases, 'Temperature', 'warm', before.revision))
      .rejects
      .toMatchObject({ code: 'validation_failed' })
  })

  it('refuses to edit element kinds without an editable value', async () => {
    const target = open()
    const range = await target.element(edgeCases, 'OperatingRange')
    await expect(target.setElementValue(edgeCases, 'OperatingRange', '1', range.revision))
      .rejects
      .toMatchObject({ code: 'unsupported_operation' })
  })

  it('lets an editor write and a reader only read on the secured target', async () => {
    const dave = await secured('dave')
    const after = await setAndRestore(dave, nameplate, 'SerialNumber', 'SEC-0002')
    expect(after.value.value).toBe('SEC-0002')

    const alice = await secured('alice')
    const current = await alice.element(nameplate, 'SerialNumber')
    await expect(alice.setElementValue(nameplate, 'SerialNumber', 'SEC-9999', current.revision))
      .rejects
      .toMatchObject({ code: 'target_forbidden' })
  })

  it('requires a revision', async () => {
    await expect(open().setElementValue(edgeCases, 'SimpleString', 'x', ''))
      .rejects
      .toMatchObject({ code: 'precondition_required' })
  })
})
