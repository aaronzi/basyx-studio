import { connectionsHandler, createTestStudio } from '@basyx/studio-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import modelsManifest from '../../apps/models-3d/studio-app.json'
import manifest from '../../examples/apps/work-orders/studio-app.json'

// The test Studio built from an app's manifest as imported from JSON
// (external apps follow-up plan W1): its permissions and connections,
// without a cast.

describe('createTestStudio({ manifest })', () => {
  it('checks calls against the manifest\'s permissions', async () => {
    const studio = createTestStudio({ manifest, handlers: { 'studio.aas.listShells': () => ({ items: [], page: { nextCursor: null, hasMore: false } }) } })
    await expect(studio.client.aas.listShells()).resolves.toMatchObject({ items: [] })
    await expect(studio.client.ui.navigate('x')).rejects.toMatchObject({ code: 'app_permission_not_declared' })
  })

  it('takes the app ID and its first contribution into the context, unless the test sets them', () => {
    expect(createTestStudio({ manifest }).context).toMatchObject({ appId: manifest.id, contribution: { kind: 'module', id: 'orders' } })
    expect(createTestStudio({ manifest: modelsManifest }).context.contribution).toEqual({ kind: 'submodelView', id: 'models-3d' })
    expect(createTestStudio({ manifest, context: { contribution: { kind: 'module', id: 'other' } } }).context.contribution.id).toBe('other')
  })

  it('narrows the permissions to those a test names', async () => {
    const studio = createTestStudio({ manifest, permissions: ['studio.aas.read'] })
    await expect(studio.client.ui.notify('x')).rejects.toMatchObject({ code: 'app_permission_not_declared' })
    expect(() => createTestStudio({ manifest, permissions: ['studio.aas.write'] })).toThrow('permissions names studio.aas.write, which the manifest of org.eclipse.basyx.examples.work-orders does not declare.')
  })

  it('fails for a permission Studio does not know', () => {
    expect(() => createTestStudio({ manifest: { ...manifest, permissions: ['studio.aas.read', 'studio.everything'] } }))
      .toThrow('The manifest of org.eclipse.basyx.examples.work-orders declares permissions Studio does not know: studio.everything.')
  })

  it('refuses connections and operations the manifest does not declare, before any handler', async () => {
    const listOrders = vi.fn(() => ({ body: [] }))
    const deleteOrder = vi.fn(() => ({ status: 204 }))
    const studio = createTestStudio({
      manifest,
      handlers: { 'studio.connections.call': connectionsHandler({ orders: { listOrders, deleteOrder }, billing: { listInvoices: () => ({ body: [] }) } }) },
    })
    await expect(studio.client.connections.call({ connection: 'orders', operation: 'listOrders' })).resolves.toMatchObject({ status: 200, body: [] })
    await expect(studio.client.connections.call({ connection: 'orders', operation: 'deleteOrder' })).rejects.toMatchObject({ code: 'connection_operation_not_declared' })
    await expect(studio.client.connections.call({ connection: 'billing', operation: 'listInvoices' })).rejects.toMatchObject({ code: 'connection_operation_not_declared' })
    expect(deleteOrder).not.toHaveBeenCalled()
    expect(listOrders).toHaveBeenCalledOnce()
  })
})
