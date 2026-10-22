// A test app that embeds other apps' views in its page (ADR 0051): the
// Time Series view and the embed probe of the shell the end-to-end test
// creates. It tries to get at the views' connections and writes what
// happened into #results.
const results = {}
const shellId = 'urn:studio:test:e2e:embed'
const views = { timeSeries: `${shellId}:time-series`, probe: `${shellId}:probe` }

function settle (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Studio's bridge, without the SDK.
const connected = new Promise(resolve => {
  addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'connect' && event.ports[0]) {
      resolve(event.ports[0])
    }
  })
})
parent.postMessage({ protocol: 'studio-sdk/0', type: 'hello' }, '*')
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

const urls = {}
for (const [name, submodelId] of Object.entries(views)) {
  const answer = await call('studio.ui.embedView', { submodelId, shellId })
  if (answer.type !== 'response') {
    results[name] = answer.problem.code
    continue
  }
  urls[name] = answer.result.url
  const frame = document.createElement('iframe')
  frame.src = answer.result.url
  frame.title = name
  frame.width = '800'
  frame.height = '400'
  document.body.append(frame)
}

if (Object.keys(urls).length > 0) {
  results.viewOrigins = Object.values(urls).map(url => new URL(url).origin === self.origin ? 'same' : 'other')
  await settle(3000)
  // The view's document has another origin.
  const frame = document.querySelector('iframe[title="probe"]')
  try {
    results.viewDocument = frame.contentDocument === null ? 'blocked (null)' : 'allowed'
  } catch (error) {
    results.viewDocument = `blocked (${error.name})`
  }
  // Saying hello to Studio's page with the view's token gets this page no port.
  const token = new URL(urls.probe).searchParams.get('studio-embed')
  const stolen = new Promise(resolve => {
    addEventListener('message', event => {
      if (event.data?.type === 'connect' && event.ports[0]) {
        resolve('port')
      }
    })
    setTimeout(() => resolve('no port'), 2000)
  })
  top.postMessage({ protocol: 'studio-sdk/0', type: 'hello', embed: token }, '*')
  results.stolenHello = await stolen
}

document.querySelector('#results').textContent = JSON.stringify(results, null, 2)
document.body.dataset.done = 'true'
