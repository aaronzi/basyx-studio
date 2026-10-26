import type { OpenModel } from '../types.ts'
import type { ParserRequest, ParserResponse, WorkerMessage } from './protocol.ts'
import { createParserHandler } from './handler.ts'
import { transferablesOf } from './protocol.ts'

// A parser worker: IFC and STEP are read off the main thread, so the page
// stays responsive while large models load. Each format has its own worker
// (./ifc.worker.ts, ./step.worker.ts), so an app's build holds only the
// parsers it registers.

// Typed here: the DOM and WebWorker libraries do not go together in one program.
const scope = globalThis as unknown as {
  postMessage: (message: WorkerMessage, transfer: Transferable[]) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent<ParserRequest>) => void) => void
}

export function serveParser (open: OpenModel): void {
  const handle = createParserHandler(open, (response: ParserResponse) => {
    scope.postMessage(response, response.type === 'meshes' ? transferablesOf(response.meshes) : [])
  })
  scope.addEventListener('message', event => void handle(event.data))
  // Tells the viewer the worker started; until then it sends nothing.
  scope.postMessage({ type: 'ready' }, [])
}
