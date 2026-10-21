import type { AppInstallationRecord } from '~~/server/lib/apps/store'
import type { AasTarget } from '~~/server/lib/targets/aas-target'
import { describe, expect, it, vi } from 'vitest'
import { authorizeAppCall, checkViewToOpen } from '~~/server/lib/apps/calls'
import { viewToOpen } from '~~/server/lib/apps/contributions'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { StudioProblem } from '~~/server/lib/problem'
import { appMethodParamsSchemas } from '#shared/contract'
import { manifestOf } from './support'

// Views of other apps in Studio's dialog (studio.ui.openView, ADR 0051).

const timeSeries = 'https://admin-shell.io/idta/TimeSeries/1/1'
const baseUrl = 'https://{installation}.apps.example.org/app/'

function installation (index: number, appId: string, views: { id: string, semanticIds: string[] }[], bundled = false): AppInstallationRecord {
  return {
    id: `app-000000000000000${index}`,
    appId,
    digest: `sha256:${index}`,
    trust: bundled ? 'bundled' : 'unsigned',
    bundled,
    keyFingerprint: null,
    manifest: manifestOf({
      id: appId,
      permissions: ['studio.aas.read'],
      contributes: { submodelViews: views.map(view => ({ ...view, title: { en: view.id }, entry: 'ui/index.html' })) },
    }),
  } as AppInstallationRecord
}

describe('the view studio.ui.openView shows', () => {
  const installations = [
    installation(1, 'org.example.charts', [{ id: 'trend', semanticIds: [timeSeries] }, { id: 'table', semanticIds: [timeSeries] }]),
    installation(2, 'org.eclipse.basyx.studio.time-series', [{ id: 'time-series', semanticIds: [timeSeries] }], true),
    installation(3, 'org.example.other', [{ id: 'nameplate', semanticIds: ['urn:nameplate'] }]),
  ]

  it('is the one the Overview shows first: the apps shipped with Studio before installed ones', () => {
    const view = viewToOpen(installations, baseUrl, timeSeries)
    expect(view).toMatchObject({ kind: 'submodelView', appId: 'org.eclipse.basyx.studio.time-series', id: 'time-series', installationId: 'app-0000000000000002', reason: { semanticId: timeSeries } })
    expect(view.entryUrl).toBe('https://app-0000000000000002.apps.example.org/app/app-0000000000000002/ui/index.html')
    expect(view.frameOrigin).toBe('https://app-0000000000000002.apps.example.org')
  })

  it('is the first view of the app the caller names, or the named one of it', () => {
    expect(viewToOpen(installations, baseUrl, timeSeries, { appId: 'org.example.charts' }).id).toBe('trend')
    expect(viewToOpen(installations, baseUrl, timeSeries, { appId: 'org.example.charts', viewId: 'table' }).id).toBe('table')
  })

  it('is refused when no installed view fits', () => {
    expect(() => viewToOpen(installations, baseUrl, 'urn:unknown')).toThrow(expect.objectContaining({ code: 'unsupported_operation' }))
    expect(() => viewToOpen(installations, baseUrl, timeSeries, { appId: 'org.example.other' })).toThrow(expect.objectContaining({ code: 'unsupported_operation' }))
    expect(() => viewToOpen(installations, baseUrl, timeSeries, { appId: 'org.example.charts', viewId: 'missing' })).toThrow(expect.objectContaining({ code: 'unsupported_operation' }))
  })
})

describe('opening a view from an app', () => {
  function fakeTarget (): AasTarget {
    return {
      shell: vi.fn(async (id: string) => ({ id })),
      submodelIds: vi.fn(async () => ['urn:sm:series', 'urn:sm:plain']),
      submodelMetadata: vi.fn(async (id: string) => {
        if (id === 'urn:sm:secret') {
          throw new StudioProblem('target_forbidden')
        }
        return id === 'urn:sm:plain'
          ? { id, idShort: 'Plain' }
          : { id, idShort: 'Series', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: timeSeries }] } }
      }),
    } as unknown as AasTarget
  }

  it('reads the submodel as the user for its semantic ID, and checks that the shell references it', async () => {
    const target = fakeTarget()
    await expect(checkViewToOpen(target, { submodelId: 'urn:sm:series' })).resolves.toEqual({ id: 'urn:sm:series', semanticId: timeSeries, idShort: 'Series' })
    expect(target.shell).not.toHaveBeenCalled()
    await expect(checkViewToOpen(target, { submodelId: 'urn:sm:series', shellId: 'urn:shell' })).resolves.toMatchObject({ semanticId: timeSeries })
    expect(target.shell).toHaveBeenCalledWith('urn:shell')
    await expect(checkViewToOpen(target, { submodelId: 'urn:sm:other', shellId: 'urn:shell' })).rejects.toMatchObject({ code: 'target_resource_not_found' })
    await expect(checkViewToOpen(target, { submodelId: 'urn:sm:secret' })).rejects.toMatchObject({ code: 'target_forbidden' })
    await expect(checkViewToOpen(target, { submodelId: 'urn:sm:plain' })).rejects.toMatchObject({ code: 'unsupported_operation' })
  })

  it('needs studio.ui.navigation, from a frame', () => {
    const record = installation(4, 'org.example.pages', [])
    expect(() => authorizeAppCall(record, 'studio.ui.openView', 'host', emptyTrustStore)).toThrow(expect.objectContaining({ code: 'app_permission_not_declared' }))
    const navigating = { ...record, manifest: manifestOf({ permissions: ['studio.ui.navigation'] }) }
    expect(() => authorizeAppCall(navigating, 'studio.ui.openView', 'host', emptyTrustStore)).not.toThrow()
    expect(() => authorizeAppCall(navigating, 'studio.ui.openView', 'backend', emptyTrustStore)).toThrow(expect.objectContaining({ code: 'unsupported_operation' }))
  })

  it('names a view by app ID and contribution ID, and a view only with its app', () => {
    const schema = appMethodParamsSchemas['studio.ui.openView']
    expect(schema.safeParse({ submodelId: 'urn:sm:series', shellId: 'urn:shell', appId: 'org.example.charts', viewId: 'trend' }).success).toBe(true)
    expect(schema.safeParse({ submodelId: 'urn:sm:series', viewId: 'trend' }).success).toBe(false)
    expect(schema.safeParse({ submodelId: 'urn:sm:series', appId: 'Not An Id' }).success).toBe(false)
    expect(schema.safeParse({ submodelId: 'urn:sm:series', installationId: 'app-0000000000000001' }).success).toBe(false)
  })
})
