import type { OpenModel, ParsedModel } from '../types.ts'
import type { ParserRequest, ParserResponse } from './protocol.ts'

// Answers a parser's requests, in its worker or, where workers are not
// available, on the main thread. One model is open at a time.

export function createParserHandler (open: OpenModel, send: (response: ParserResponse) => void) {
  let model: ParsedModel | null = null

  return async function handle (request: ParserRequest): Promise<void> {
    try {
      if (request.type === 'element') {
        if (!model?.element) {
          throw new Error('No IFC model is open.')
        }
        send({ type: 'element', id: request.id, element: await model.element(request.expressId) })
        return
      }
      model?.close?.()
      model = null
      model = await open(request.bytes, request.wasmUrl, progress => send({ type: 'progress', id: request.id, progress }))
      send({ type: 'meshes', id: request.id, meshes: model.meshes })
    } catch (error) {
      send({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
}
