import type { AppContext, HostMessage, RequestMessage, ShellSummary } from '@basyx/studio-sdk'
import { portTransport, StudioClient, StudioError } from '@basyx/studio-sdk'
import { createTestStudio, studioError, testContext } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'

// The client on its transports (MVP-7 D1 and D2, ADR 0043): the MessagePort
// of studio-sdk/0 and the in-memory Studio for dev servers and tests.

const shell: ShellSummary = { id: 'urn:example:shell:1', idShort: 'Pump', displayName: [], assetKind: 'Instance', globalAssetId: null }

describe('portTransport', () => {
  /** A client on one end of a channel, and a host on the other that answers with `respond`. */
  function connected (respond: (request: RequestMessage) => HostMessage) {
    const channel = new MessageChannel()
    channel.port2.addEventListener('message', event => channel.port2.postMessage(respond(event.data as RequestMessage)))
    channel.port2.start()
    const client = new StudioClient(portTransport(channel.port1), testContext())
    return { client, host: channel.port2 }
  }

  it('answers calls and refusals from the host', async () => {
    const { client } = connected(request => request.method === 'studio.aas.getShell'
      ? { type: 'error', id: request.id, problem: { code: 'target_resource_not_found', title: 'Not found', status: 404, retryable: false } }
      : { type: 'response', id: request.id, result: { items: [shell], page: { nextCursor: null, hasMore: false } } })
    await expect(client.aas.listShells()).resolves.toMatchObject({ items: [shell] })
    const refused = await client.aas.getShell('urn:missing').catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(StudioError)
    expect((refused as StudioError).code).toBe('target_resource_not_found')
    client.close()
  })

  it('follows the context the host sends', async () => {
    const { client, host } = connected(request => ({ type: 'response', id: request.id, result: null }))
    const seen = new Promise<AppContext>(resolve => client.onContext(resolve))
    host.postMessage({ type: 'context', context: testContext({ subPath: 'shells/1' }) } satisfies HostMessage)
    expect((await seen).subPath).toBe('shells/1')
    expect(client.context.subPath).toBe('shells/1')
    client.close()
  })

  it('rejects calls after close', async () => {
    const { client } = connected(request => ({ type: 'response', id: request.id, result: null }))
    client.close()
    await expect(client.ui.setHeight(10)).rejects.toThrow('closed')
  })
})

describe('createTestStudio', () => {
  it('answers with the handlers and records the calls', async () => {
    const studio = createTestStudio({
      handlers: { 'studio.aas.listShells': ({ limit }) => ({ items: [shell].slice(0, limit), page: { nextCursor: null, hasMore: false } }) },
    })
    const page = await studio.client.aas.listShells({ limit: 1 })
    expect(page.items).toEqual([shell])
    expect(studio.calls).toEqual([{ method: 'studio.aas.listShells', params: { limit: 1 } }])
  })

  it('copies values as a MessagePort does', async () => {
    const items = [shell]
    const studio = createTestStudio({ handlers: { 'studio.aas.listShells': () => ({ items, page: { nextCursor: null, hasMore: false } }) } })
    const page = await studio.client.aas.listShells()
    page.items.pop()
    expect(items).toHaveLength(1)
    await expect(studio.client.call('studio.ui.notify', { message: 'x', level: 'info', extra: () => 1 } as never)).rejects.toThrow()
  })

  it('answers Studio’s UI methods and moves the sub-path on navigate', async () => {
    const studio = createTestStudio({ context: { locale: 'de' } })
    const changed = new Promise<AppContext>(resolve => studio.client.onContext(resolve))
    await studio.client.ui.navigate('shells/1')
    expect((await changed).subPath).toBe('shells/1')
    expect(studio.client.context).toMatchObject({ subPath: 'shells/1', locale: 'de' })
    await studio.client.ui.notify('Saved', 'success')
    expect(studio.notifications).toEqual([{ message: 'Saved', level: 'success' }])
    await expect(studio.client.call('studio.ui.getContext', {})).resolves.toMatchObject({ subPath: 'shells/1' })
  })

  it('sends a changed context to the app', () => {
    const studio = createTestStudio()
    studio.setContext({ theme: { dark: true, colors: {} } })
    expect(studio.client.context.theme.dark).toBe(true)
  })

  it('refuses methods without a handler and undeclared permissions as Studio does', async () => {
    const studio = createTestStudio({
      permissions: ['studio.aas.read'],
      handlers: { 'studio.ui.copyText': () => null },
    })
    await expect(studio.client.aas.getShell('x')).rejects.toMatchObject({ code: 'unsupported_operation' })
    await expect(studio.client.ui.copyText('x')).rejects.toMatchObject({ code: 'app_permission_not_declared', problem: { status: 403 } })
    await expect(studio.client.call('studio.nothing' as never, {} as never)).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('passes refusals from handlers on and reports other errors as internal errors', async () => {
    const studio = createTestStudio({
      handlers: {
        'studio.aas.getShell': () => {
          throw studioError('target_forbidden', 'No access.', 403)
        },
        'studio.aas.getSubmodel': () => {
          throw new Error('broken fixture')
        },
      },
    })
    await expect(studio.client.aas.getShell('x')).rejects.toMatchObject({ code: 'target_forbidden', message: 'No access.' })
    await expect(studio.client.aas.getSubmodel('x')).rejects.toMatchObject({ code: 'internal_error', message: 'broken fixture' })
  })

  it('rejects calls after close', async () => {
    const studio = createTestStudio()
    studio.close()
    await expect(studio.client.ui.setHeight(1)).rejects.toThrow('closed')
  })
})
