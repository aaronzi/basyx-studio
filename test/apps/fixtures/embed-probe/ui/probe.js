// A submodel view that reports what it may do (ADR 0051): embedded in
// another app's page, it connects to Studio's page with the token in its
// URL, as the SDK does (repeating its hello until it is answered), and is
// read-only; in Studio's dialog it runs as usual. It writes what happened
// into #results, the latest `context.fullscreenOpen` into #fullscreen-open,
// and what "Read again" got into #again.
const version = '1.0.0'
const results = { version }
const embed = new URLSearchParams(location.search).get('studio-embed')
const host = embed ? top : parent
const instance = [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('')

const connected = new Promise(resolve => {
  addEventListener('message', event => {
    if (event.source === host && event.data?.type === 'connect' && event.ports[0]) {
      resolve(event.ports[0])
    }
  })
})
const hello = () => host.postMessage(embed ? { protocol: 'studio-sdk/0', type: 'hello', embed, instance } : { protocol: 'studio-sdk/0', type: 'hello' }, '*')
const retry = setInterval(hello, 50)
hello()
const port = await connected
clearInterval(retry)
port.start()
let nextId = 1
const pending = new Map()
port.addEventListener('message', event => {
  if (event.data.type === 'context') {
    document.querySelector('#fullscreen-open').textContent = String(event.data.context.fullscreenOpen ?? false)
    return
  }
  const entry = pending.get(event.data.id)
  pending.delete(event.data.id)
  entry?.(event.data)
})
function call (method, params) {
  const id = nextId++
  return new Promise(resolve => {
    pending.set(id, resolve)
    port.postMessage({ type: 'request', id, method, params })
  })
}
const outcome = answer => answer.type === 'response' ? 'allowed' : answer.problem.code

const context = (await call('studio.ui.getContext', {})).result
document.querySelector('#fullscreen-open').textContent = String(context.fullscreenOpen ?? false)
results.embedded = context.embedded ?? false
results.mode = context.mode
results.submodel = context.submodel?.id ?? null
results.settings = context.settings ?? null
results.read = outcome(await call('studio.aas.getSubmodel', { submodelId: context.submodel.id }))
const element = (await call('studio.aas.getElement', { submodelId: context.submodel.id, idShortPath: 'Value' })).result
results.write = outcome(await call('studio.aas.setElementValue', { submodelId: context.submodel.id, idShortPath: 'Value', value: 'changed', revision: element.revision }))
results.openExternal = outcome(await call('studio.ui.openExternal', { url: 'https://example.org/' }))
results.backend = outcome(await call('studio.backend.call', { method: 'write' }))
results.connection = outcome(await call('studio.connections.call', { connection: 'orders', operation: 'createOrder' }))
document.querySelector('#fullscreen').addEventListener('click', () => call('studio.ui.openFullscreen', { state: 'probe' }))
let reads = 0
document.querySelector('#again').addEventListener('click', async () => {
  const read = ++reads
  document.querySelector('#again-result').textContent = `${read}: reading`
  document.querySelector('#again-result').textContent = `${read}: ${outcome(await call('studio.aas.getSubmodel', { submodelId: context.submodel.id }))}`
})

document.querySelector('#results').textContent = JSON.stringify(results, null, 2)
document.body.dataset.done = 'true'
