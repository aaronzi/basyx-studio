import type { ConnectionCallResult } from '@basyx/studio-sdk'
import { connectionsHandler, createTestStudio } from '@basyx/studio-sdk/testing'

// The app without Studio: a test Studio with one shell and the work-order
// service as functions per operation, as the manifest declares them.

interface Order { id: string, asset: string, title: string, status: 'open' | 'done', due: string | null, createdBy: string, version: number, photos: { id: string, caption: string, contentType: string }[] }

export function createDevStudio () {
  const orders = new Map<string, Order>()
  const photos = new Map<string, Uint8Array>()
  const found = (id: unknown): Partial<ConnectionCallResult> | Order => orders.get(String(id)) ?? { status: 404, contentType: 'application/problem+json', body: { title: 'No such order' } }

  return createTestStudio({
    permissions: ['studio.aas.read', 'studio.ui.notifications', 'studio.connections'],
    context: { connections: { orders: { bound: true } } },
    handlers: {
      'studio.aas.listShells': () => ({
        items: [{ id: 'urn:example:aas:pump-1', idShort: 'Pump1', displayName: [{ language: 'en', text: 'Pump 1' }], assetKind: 'Instance', globalAssetId: 'urn:example:asset:pump-1' }],
        page: { nextCursor: null, hasMore: false },
      }),
      'studio.connections.call': connectionsHandler({
        orders: {
          whoAmI: () => ({ body: { subject: 'developer', via: 'none' } }),
          listOrders: ({ query }) => ({ body: [...orders.values()].filter(order => order.asset === query?.asset) }),
          createOrder: ({ body }) => {
            const { asset, title, due } = body as Pick<Order, 'asset' | 'title' | 'due'>
            const order: Order = { id: String(orders.size + 1), asset, title, status: 'open', due: due ?? null, createdBy: 'developer', version: 1, photos: [] }
            orders.set(order.id, order)
            return { status: 201, body: order, etag: '"1"' }
          },
          getOrder: ({ path }) => {
            const order = found(path?.orderId)
            return 'id' in order ? { body: order, etag: `"${order.version}"` } : order
          },
          updateOrder: ({ path, headers, body }) => {
            const order = found(path?.orderId)
            if (!('id' in order)) {
              return order
            }
            if (headers?.['If-Match'] !== `"${order.version}"`) {
              return { status: 412, contentType: 'application/problem+json', body: { title: 'The order changed' } }
            }
            Object.assign(order, body, { version: order.version + 1 })
            return { body: order, etag: `"${order.version}"` }
          },
          addPhoto: ({ path, body }) => {
            const order = found(path?.orderId)
            const file = (body as { files?: Record<string, { contentType?: string, bytes: Uint8Array }> }).files?.file
            if (!('id' in order) || !file) {
              return { status: 400, contentType: 'application/problem+json', body: { title: 'No photo' } }
            }
            const id = String(order.photos.length + 1)
            photos.set(`${order.id}/${id}`, file.bytes)
            order.photos.push({ id, caption: (body as { fields?: { caption?: string } }).fields?.caption ?? '', contentType: file.contentType ?? 'image/png' })
            return { status: 201, body: order }
          },
          getPhoto: ({ path }) => ({ contentType: 'image/png', body: photos.get(`${path?.orderId}/${path?.photoId}`) ?? null }),
        },
      }),
    },
  })
}
