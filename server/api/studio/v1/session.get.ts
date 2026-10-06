import type { StudioSession } from '#shared/contract'
import { StudioProblem } from '~~/server/lib/problem'

export default defineStudioHandler(async (event): Promise<StudioSession> => {
  const resolved = await currentSession(event)
  if (!resolved) {
    throw new StudioProblem('unauthenticated')
  }
  return {
    user: { subject: resolved.actor.subject, name: resolved.actor.name, roles: resolved.actor.roles },
    isAdmin: resolved.actor.isAdmin,
    csrfToken: resolved.session.csrfToken,
    expiresAt: resolved.session.expiresAt?.toISOString() ?? null,
  }
})
