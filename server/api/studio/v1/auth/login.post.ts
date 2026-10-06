import type { AuthorizationStart } from '#shared/contract'
import { getOidcClient, OidcError, startAuthorization } from '~~/server/lib/oidc/client'
import { saveTransaction } from '~~/server/lib/oidc/transactions'
import { StudioProblem } from '~~/server/lib/problem'
import { callbackUri } from '~~/server/lib/urls'
import { loginRequestSchema } from '#shared/contract'

export default defineStudioHandler(async (event): Promise<AuthorizationStart> => {
  const studio = await useStudio()
  const { returnTo } = await readValidated(event, loginRequestSchema)
  const login = studio.config.login
  if (!login) {
    throw new StudioProblem('invalid_request', 'This Studio deployment has no user login.')
  }
  try {
    // The Studio IdP is deployment configuration, so it may be on a private network.
    const client = await getOidcClient({ ...login, allowPrivateNetwork: true })
    const redirectUri = callbackUri(studio.config)
    const pending = await startAuthorization(client, { redirectUri, scopes: login.scopes })
    await saveTransaction(studio, pending, { purpose: 'studio_login', sessionId: null, targetId: null, redirectUri, returnTo: returnTo ?? '/' })
    return { authorizationUrl: pending.url, mode: 'navigate' }
  } catch (error) {
    if (error instanceof OidcError) {
      throw new StudioProblem('internal_error', 'The Studio identity provider is not available.', { cause: error })
    }
    throw error
  }
})
