import type { AppInstallationRecord } from '~~/server/lib/apps/store'
import type { AasTarget } from '~~/server/lib/targets/aas-target'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { authorizeAppCall, checkShellToOpen, executeAasMethod } from '~~/server/lib/apps/calls'
import { capabilityTokenKey, capabilityTokenTtlMs, issueCapabilityToken, verifyCapabilityToken } from '~~/server/lib/apps/tokens'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { StudioProblem } from '~~/server/lib/problem'
import { manifestOf } from './support'

describe('capability tokens', () => {
  const key = capabilityTokenKey(randomBytes(32))
  const claims = { installationId: 'app-0123456789abcdef', digest: 'sha256:0123', sessionId: 'session', targetId: 'target', mode: 'edit' as const }

  it('round-trips the claims until the token expires', () => {
    const now = Date.now()
    const token = issueCapabilityToken(key, claims, now)
    expect(verifyCapabilityToken(key, token, now + 1000)).toEqual({ ...claims, expiresAt: now + capabilityTokenTtlMs })
    expect(verifyCapabilityToken(key, token, now + capabilityTokenTtlMs)).toBeNull()
  })

  it('rejects tokens signed with another key, altered, or malformed', () => {
    const token = issueCapabilityToken(key, claims)
    expect(verifyCapabilityToken(capabilityTokenKey(randomBytes(32)), token)).toBeNull()
    const [prefix, payload, mac] = token.split('.')
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), t: 'other' })).toString('base64url')
    expect(verifyCapabilityToken(key, `${prefix}.${altered}.${mac}`)).toBeNull()
    expect(verifyCapabilityToken(key, 'sct.x')).toBeNull()
    expect(verifyCapabilityToken(key, `${token}.extra`)).toBeNull()
  })
})

describe('app call authorization', () => {
  const installation = { id: 'app-0123456789abcdef', appId: 'org.example.test', trust: 'unsigned', bundled: false, keyFingerprint: null, manifest: manifestOf({ permissions: ['studio.aas.read'] }) } as AppInstallationRecord

  function code (action: () => void): string {
    try {
      action()
    } catch (error) {
      return (error as StudioProblem).code
    }
    return 'allowed'
  }

  it('allows declared permissions and context, and refuses undeclared ones', () => {
    expect(code(() => authorizeAppCall(installation, 'studio.aas.getElement', 'host', emptyTrustStore))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.getContext', 'host', emptyTrustStore))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.aas.setElementValue', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.notify', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall(installation, 'studio.backend.call', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.openShell', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
    const navigating = { ...installation, manifest: manifestOf({ permissions: ['studio.ui.navigation'] }) }
    expect(code(() => authorizeAppCall(navigating, 'studio.ui.openShell', 'host', emptyTrustStore))).toBe('allowed')
    expect(code(() => authorizeAppCall(navigating, 'studio.ui.openShell', 'backend', emptyTrustStore))).toBe('unsupported_operation')
  })

  it('limits backends to AAS methods', () => {
    expect(code(() => authorizeAppCall(installation, 'studio.aas.listShells', 'backend', emptyTrustStore))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.getContext', 'backend', emptyTrustStore))).toBe('unsupported_operation')
    expect(code(() => authorizeAppCall(installation, 'studio.timeseries.read', 'backend', emptyTrustStore))).toBe('unsupported_operation')
  })

  it('runs structural writes only in edit mode, and attachments only from Studio\'s page (MVP-7 A1, A2)', () => {
    const writer = { ...installation, manifest: manifestOf({ permissions: ['studio.aas.read', 'studio.aas.write'] }) } as AppInstallationRecord
    expect(code(() => authorizeAppCall(writer, 'studio.aas.addElement', 'host', emptyTrustStore, 'view'))).toBe('app_edit_mode_required')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.addElement', 'host', emptyTrustStore))).toBe('app_edit_mode_required')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.addElement', 'host', emptyTrustStore, 'edit'))).toBe('allowed')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.deleteShell', 'backend', emptyTrustStore, 'view'))).toBe('app_edit_mode_required')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.deleteShell', 'backend', emptyTrustStore, 'edit'))).toBe('allowed')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.putAttachment', 'backend', emptyTrustStore, 'edit'))).toBe('unsupported_operation')
    // Value edits and reads keep working as before.
    expect(code(() => authorizeAppCall(writer, 'studio.aas.setElementValue', 'host', emptyTrustStore, 'view'))).toBe('allowed')
    expect(code(() => authorizeAppCall(writer, 'studio.aas.getSubmodelSnapshot', 'host', emptyTrustStore, 'view'))).toBe('allowed')
    // The permission is checked first.
    expect(code(() => authorizeAppCall(installation, 'studio.aas.addElement', 'host', emptyTrustStore, 'edit'))).toBe('app_permission_not_declared')
  })

  it('reserves time series reads for the apps shipped with Studio (ADR 0040)', () => {
    const manifest = manifestOf({ permissions: ['studio.aas.read', 'studio.timeseries.read'] })
    const installed = { ...installation, manifest, bundled: false } as AppInstallationRecord
    expect(code(() => authorizeAppCall(installed, 'studio.timeseries.read', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall({ ...installed, bundled: true }, 'studio.timeseries.read', 'host', emptyTrustStore))).toBe('allowed')
    expect(code(() => authorizeAppCall({ ...installation, bundled: true } as AppInstallationRecord, 'studio.timeseries.read', 'host', emptyTrustStore))).toBe('app_permission_not_declared')
  })
})

describe('AAS capability methods', () => {
  const noSync = async () => ({ registry: false, submodelRegistry: false, discovery: false })
  const callContext = (target: AasTarget) => ({ target, idScheme: { type: 'iri', prefix: 'https://example.com/ids/' } as const, syncPlan: noSync })

  function fakeTarget (): AasTarget {
    return {
      capabilities: { write: true, persistence: 'immediate' },
      listShells: vi.fn(async () => ({
        items: [{
          key: 'k',
          id: 'urn:shell',
          idShort: 'Shell',
          displayName: [],
          description: [],
          assetKind: null,
          globalAssetId: null,
          assetType: 'urn:type',
          specificAssetIds: [{ name: 'serialNumber', value: 'S-1' }],
        }],
        page: { nextCursor: null, hasMore: false },
      })),
      shell: vi.fn(async id => ({ id })),
      submodelIds: vi.fn(async () => ['urn:sm:1', 'urn:sm:2']),
      submodelMetadata: vi.fn(async id => {
        if (id === 'urn:sm:2') {
          throw new StudioProblem('target_forbidden')
        }
        return { id, idShort: 'Nameplate', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:semantic' }] } }
      }),
      submodel: vi.fn(async id => ({ id, submodelElements: [] })),
      element: vi.fn(async () => ({ value: { modelType: 'Property', value: 'a' }, revision: 'h.abc', concurrency: 'strong' as const })),
      setElementValue: vi.fn(async () => ({ value: { modelType: 'Property', value: 'b' }, revision: 'h.def', concurrency: 'strong' as const })),
    }
  }

  it('maps target results to SDK shapes', async () => {
    const target = fakeTarget()
    expect(await executeAasMethod(callContext(target), 'studio.aas.listShells', {})).toEqual({
      items: [{ id: 'urn:shell', idShort: 'Shell', displayName: [], assetKind: null, globalAssetId: null, assetType: 'urn:type', specificAssetIds: [{ name: 'serialNumber', value: 'S-1' }] }],
      page: { nextCursor: null, hasMore: false },
    })
    expect(await executeAasMethod(callContext(target), 'studio.aas.listSubmodels', { shellId: 'urn:shell' })).toEqual({
      items: [
        { id: 'urn:sm:1', idShort: 'Nameplate', semanticId: 'urn:semantic', status: 'available' },
        { id: 'urn:sm:2', idShort: null, semanticId: null, status: 'forbidden' },
      ],
    })
    expect(await executeAasMethod(callContext(target), 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: 'Contact.Phone[0]' }))
      .toEqual({ value: { modelType: 'Property', value: 'a' }, revision: 'h.abc', concurrency: 'strong', structureRevision: null })
    expect(target.element).toHaveBeenCalledWith('urn:sm:1', 'Contact.Phone[0]')
  })

  it('writes with the revision and refuses operation variables', async () => {
    const target = fakeTarget()
    await executeAasMethod(callContext(target), 'studio.aas.setElementValue', { submodelId: 'urn:sm:1', idShortPath: 'Serial', value: 'b', revision: 'h.abc' })
    expect(target.setElementValue).toHaveBeenCalledWith('urn:sm:1', 'Serial', 'b', 'h.abc')
    await expect(executeAasMethod(callContext(target), 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: 'Calibrate@input.Offset' }))
      .rejects
      .toMatchObject({ code: 'unsupported_operation' })
    await expect(executeAasMethod(callContext(target), 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: '../x' }))
      .rejects
      .toMatchObject({ code: 'invalid_request' })
  })

  it('opens only shells the user can read, and only submodels the shell references', async () => {
    const target = fakeTarget()
    await expect(checkShellToOpen(target, { shellId: 'urn:shell', submodelId: 'urn:sm:2' })).resolves.toBeUndefined()
    expect(target.shell).toHaveBeenCalledWith('urn:shell')
    await expect(checkShellToOpen(target, { shellId: 'urn:shell', submodelId: 'urn:sm:other' })).rejects.toMatchObject({ code: 'target_resource_not_found' })
    target.shell = vi.fn(async () => {
      throw new StudioProblem('target_forbidden')
    })
    await expect(checkShellToOpen(target, { shellId: 'urn:shell' })).rejects.toMatchObject({ code: 'target_forbidden' })
    expect(target.submodelIds).toHaveBeenCalledTimes(2)
  })
})
