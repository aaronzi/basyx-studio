// A test app for one origin per installation and declared third-party
// origins (ADR 0045). It embeds a page and fetches from its declared origin
// (embed.localhost, served by the end-to-end test), tries the same at an
// undeclared one, and writes what happened into #results.
const results = {}
const violations = []
document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective))

const declared = 'http://embed.localhost:3402'
const undeclared = 'http://undeclared.localhost:3402'
const ownBase = new URL('../', import.meta.url).href

async function attempt (name, action) {
  try {
    const value = await action()
    results[name] = value === undefined ? 'allowed' : value
  } catch (error) {
    results[name] = `blocked (${error?.name ?? 'Error'})`
  }
}

function settle (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Studio's bridge, without the SDK: the port reaches this frame's origin.
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
const context = await new Promise(resolve => {
  port.addEventListener('message', event => resolve(event.data))
  port.postMessage({ type: 'request', id: 1, method: 'studio.ui.getContext', params: {} })
})
results.bridge = context.type === 'response' ? 'connected' : 'failed'

results.origin = self.origin
await attempt('localStorage', () => {
  localStorage.setItem('probe', '1')
  return 'allowed'
})
await attempt('parentDocument', () => parent.document.title)
await attempt('declaredFetch', async () => (await fetch(`${declared}/data.json`)).status)
await attempt('undeclaredFetch', async () => (await fetch(`${undeclared}/data.json`)).status)
await attempt('foreignAppScript', () => import(`${ownBase.replace(/app-[\da-f]{16}/g, 'app-0000000000000000')}ui/probe.js`))
await attempt('serviceWorker', () => navigator.serviceWorker.register('./probe.js').then(() => 'allowed'))

// Embedded pages report their own origin and whether they may use cookies.
const embeds = new Map()
addEventListener('message', event => {
  if (event.data?.type === 'embed') {
    embeds.set(event.origin, event.data)
  }
})
for (const origin of [declared, undeclared]) {
  const frame = document.createElement('iframe')
  frame.src = `${origin}/embed.html`
  document.body.append(frame)
}
await settle(1500)
const embed = [...embeds.values()][0]
results.embedOrigin = embed?.origin ?? 'none'
results.embedCookies = embed?.cookies ?? 'none'
results.embeds = embeds.size

results.violations = [...new Set(violations)].toSorted()
document.querySelector('#results').textContent = JSON.stringify(results, null, 2)
document.body.dataset.done = 'true'
