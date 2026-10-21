// A submodel view that reports what it may do (ADR 0051): embedded in
// another app's page, it connects to Studio's page with the token in its
// URL, as the SDK does, and is read-only; in Studio's dialog it runs as
// usual. It writes what happened into #results.
const results = {}
const embed = new URLSearchParams(location.search).get('studio-embed')
const host = embed ? top : parent

const connected = new Promise(resolve => {
  addEventListener('message', event => {
    if (event.source === host && event.data?.type === 'connect' && event.ports[0]) {
      resolve(event.ports[0])
    }
  })
})
host.postMessage(embed ? { protocol: 'studio-sdk/0', type: 'hello', embed } : { protocol: 'studio-sdk/0', type: 'hello' }, '*')
const port = await connected
port.start()
let nextId = 1
const pending = new Map()
port.addEventListener('message', event => {
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
results.embedded = context.embedded ?? false
results.mode = context.mode
results.submodel = context.submodel?.id ?? null
results.read = outcome(await call('studio.aas.getSubmodel', { submodelId: context.submodel.id }))
const element = (await call('studio.aas.getElement', { submodelId: context.submodel.id, idShortPath: 'Value' })).result
results.write = outcome(await call('studio.aas.setElementValue', { submodelId: context.submodel.id, idShortPath: 'Value', value: 'changed', revision: element.revision }))
results.openExternal = outcome(await call('studio.ui.openExternal', { url: 'https://example.org/' }))
document.querySelector('#fullscreen').addEventListener('click', () => call('studio.ui.openFullscreen', { state: 'probe' }))

document.querySelector('#results').textContent = JSON.stringify(results, null, 2)
document.body.dataset.done = 'true'
