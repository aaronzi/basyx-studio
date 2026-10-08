import type { ShellDetail } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<ShellDetail> => {
  const key = routeParam(event, 'shellKey')
  const shellId = decodeKey(key, 'shell key')
  const { target } = await openTarget(event)
  return { key, shell: await target.shell(shellId) }
})
