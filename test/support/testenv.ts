// Connection details of the local test environment in `test-setup/`.
// Tests that need it are skipped unless STUDIO_TESTENV=1.

export const testenvAvailable = process.env.STUDIO_TESTENV === '1'

export const testenvDatabaseUrl = 'postgres://studio:studio@localhost:15432/studio'
export const testenvIssuer = 'http://keycloak.localhost:18080/realms/basyx-studio'
export const openTargetUrl = 'http://localhost:18081'
export const securedTargetUrl = 'http://localhost:18082'

export async function testUserAccessToken (username: string, scope = 'openid basyx-api'): Promise<string> {
  const response = await fetch(`${testenvIssuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // Test-only users of the test realm; their password equals the user name.
    body: new URLSearchParams({ grant_type: 'password', client_id: 'test-cli', username, password: username, scope }),
  })
  const body = await response.json() as { access_token?: string }
  if (!body.access_token) {
    throw new Error(`Could not obtain a test token for ${username}.`)
  }
  return body.access_token
}
