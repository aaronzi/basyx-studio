// A test app for structural writes and attachments (ADR 0049). On each
// click of Run it creates a shell with a submodel, adds a folder and a file,
// uploads and reads the file, renames the folder and deletes the shell with
// its submodel, through Studio's bridge without the SDK, and writes each
// step's outcome into #results, where the end-to-end tests read it.

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
function call (method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    port.addEventListener('message', function listener (event) {
      if (event.data?.id === id) {
        port.removeEventListener('message', listener)
        if (event.data.type === 'error') {
          reject(event.data.problem)
        } else {
          resolve(event.data.result)
        }
      }
    })
    port.postMessage({ type: 'request', id, method, params })
  })
}

async function run () {
  const results = {}
  let shellId = null
  try {
    const created = await call('studio.aas.createShell', { shell: { idShort: 'WriterShell' }, submodels: [{ idShort: 'Files' }] })
    shellId = created.shell.id
    const submodelId = created.steps.find(step => step.resource === 'submodel').id
    results.created = created.steps.map(step => `${step.resource}:${step.outcome}`)
    const top = await call('studio.aas.getSubmodelSnapshot', { submodelId })
    const folder = await call('studio.aas.addElement', {
      submodelId,
      element: { modelType: 'SubmodelElementCollection', idShort: 'FOLDER_1', displayName: [{ language: 'en', text: 'Manuals' }] },
      structureRevision: top.structureRevision,
    })
    const file = await call('studio.aas.addElement', {
      submodelId,
      parentPath: folder.idShortPath,
      element: { modelType: 'File', idShort: 'Readme', contentType: 'text/plain' },
      structureRevision: folder.structureRevision,
    })
    results.file = file.idShortPath
    const data = new TextEncoder().encode('written by an app')
    const uploaded = await call('studio.aas.putAttachment', { submodelId, idShortPath: file.idShortPath, fileName: 'readme.txt', contentType: 'text/plain', data: data.buffer, revision: file.revision })
    results.uploaded = uploaded.value.contentType
    const read = await call('studio.ui.readFile', { submodelId, idShortPath: file.idShortPath })
    results.read = new TextDecoder().decode(read.bytes)
    try {
      await call('studio.aas.putAttachment', { submodelId, idShortPath: file.idShortPath, fileName: 'readme.txt', contentType: 'text/plain', data: data.buffer, revision: file.revision })
      results.stale = 'allowed'
    } catch (error) {
      results.stale = error.code
    }
    const current = await call('studio.aas.getElement', { submodelId, idShortPath: folder.idShortPath })
    const renamed = await call('studio.aas.putElement', { submodelId, idShortPath: folder.idShortPath, element: { ...current.value, idShort: 'FOLDER_2', value: undefined }, revision: current.revision })
    results.renamed = renamed.idShortPath
    results.children = renamed.value.value.map(child => child.idShort)
    results.submodelId = submodelId
    results.shellId = shellId
  } catch (error) {
    results.error = error.code ?? String(error)
  } finally {
    if (shellId) {
      const deleted = await call('studio.aas.deleteShell', { shellId, deleteSubmodels: true }).catch(error => ({ steps: [error.code] }))
      results.deleted = deleted.steps.map(step => step.resource ? `${step.resource}:${step.outcome}` : step)
    }
  }
  document.querySelector('#results').textContent = JSON.stringify(results)
  document.body.dataset.runs = String(Number(document.body.dataset.runs ?? 0) + 1)
}

const button = document.querySelector('#run')
button.addEventListener('click', () => void run())
button.disabled = false
