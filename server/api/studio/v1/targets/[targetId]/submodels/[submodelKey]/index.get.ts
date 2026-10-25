import type { SubmodelDetail } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { toAasXml } from '~~/server/lib/aas/xml'
import { exportEnvironment } from '~~/server/lib/copies/serialize'
import { StudioProblem } from '~~/server/lib/problem'
import { revisionOf } from '~~/server/lib/targets/revision'
import { sendBinary } from '~~/server/utils/files'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelQuerySchema } from '#shared/contract'

/**
 * A submodel's metadata, or the whole submodel as JSON, AAS XML or (now
 * only) an AASX package with its concept descriptions and files, now or
 * (with `at`) as it was at a point in time; with `download`, the JSON as a
 * file.
 */
export default defineStudioHandler(async (event): Promise<SubmodelDetail | Uint8Array> => {
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const { at, content, format, download } = queryValidated(event, submodelQuerySchema)
  const opened = await openTarget(event)
  if (at) {
    await requireCapability(opened, 'history')
  }
  if (content === 'metadata' && format === 'json' && !at) {
    const metadata = await opened.target.submodelMetadata(submodelId)
    event.res.headers.set('ETag', `"${revisionOf(metadata)}"`)
    return { key, submodel: metadata, revision: revisionOf(metadata) }
  }
  // A package holds the submodel as it is: no point in time (its files have no history).
  if (format === 'aasx' && at) {
    throw new StudioProblem('invalid_request', 'A submodel as it was at a point in time is available as JSON or XML only.')
  }
  if (format === 'aasx') {
    const studio = await useStudio()
    const inspector = studio.inspector
    if (!inspector) {
      throw new StudioProblem('unsupported_operation', 'Packages need the Workspace Worker, which is not available.')
    }
    const file = await exportEnvironment(opened.target, [{ type: 'submodel', id: submodelId }], 'aasx', (environment, files) => inspector.request({ op: 'pack', environment, files }))
    const metadata = await opened.target.submodelMetadata(submodelId)
    return sendBinary(event, { ...file, fileName: `${String(metadata.idShort ?? 'submodel').replaceAll(/[^\w-]/g, '_')}.aasx` })
  }
  const submodel = at
    ? await opened.target.submodelAt(submodelId, new Date(at).toISOString())
    : await opened.target.submodel(submodelId)
  const name = String(submodel.idShort ?? 'submodel').replaceAll(/[^\w-]/g, '_')
  if (format === 'xml') {
    return sendBinary(event, { bytes: new TextEncoder().encode(toAasXml(submodel, 'submodel')), contentType: 'application/xml', fileName: `${name}.xml` })
  }
  if (download) {
    return sendBinary(event, { bytes: new TextEncoder().encode(JSON.stringify(submodel, null, 2)), contentType: 'application/json', fileName: `${name}.json` })
  }
  return { key, submodel }
})
