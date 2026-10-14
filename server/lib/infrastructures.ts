import type { Infrastructure, ProbeResult, SecretInput, ServiceProfiles } from '#shared/contract'
import type { StoredSecurity } from '../database/schema'
import type { Actor, StudioDeps } from './deps'
import type { OutboundPolicy } from './network/guarded-fetch'
import { readFile } from 'node:fs/promises'
import { and, asc, eq } from 'drizzle-orm'
import { infrastructureInputSchema } from '#shared/contract'
import { infrastructures } from '../database/schema'
import { recordAudit } from './audit'
import { randomToken } from './crypto/cipher'
import { checkHost, createGuardedFetch, NetworkFailure } from './network/guarded-fetch'
import { forgetOidcClients } from './oidc/client'
import { StudioProblem } from './problem'
import { announcedFeatures } from './targets/profiles'

export type InfrastructureRecord = typeof infrastructures.$inferSelect

interface SecretSummary {
  kind: 'env' | 'file' | 'stored'
  ref: string | null
}

const secretPurpose = 'infrastructures.client_secret'

export function toInfrastructure (record: InfrastructureRecord): Infrastructure {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    template: record.template,
    endpoints: record.endpoints,
    listSource: record.listSource,
    sync: record.sync,
    serviceProfiles: record.serviceProfiles,
    probedAt: record.probedAt?.toISOString() ?? null,
    announced: announcedFeatures(record),
    security: record.security,
    allowPrivateNetwork: record.allowPrivateNetwork,
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/** The AAS environment's base URL (serialization, upload), if the infrastructure has one. */
export function environmentUrl (record: Pick<InfrastructureRecord, 'endpoints'>): string | undefined {
  return record.endpoints.find(entry => entry.type === 'aasEnvironment')?.url.replace(/\/+$/, '')
}

/** The outbound policy for requests to a target's own endpoints. */
export function targetPolicy (deps: StudioDeps, record: InfrastructureRecord): OutboundPolicy {
  return {
    allowedOrigins: new Set(record.endpoints.map(endpoint => new URL(endpoint.url).origin)),
    allowPrivateNetwork: record.allowPrivateNetwork && deps.config.allowPrivateNetworkTargets,
    timeoutMs: 15_000,
    maxResponseBytes: 50 * 1024 * 1024,
  }
}

export async function listInfrastructures (deps: StudioDeps): Promise<InfrastructureRecord[]> {
  return deps.db.select().from(infrastructures).orderBy(asc(infrastructures.name))
}

export async function getInfrastructure (deps: StudioDeps, id: string): Promise<InfrastructureRecord> {
  const [record] = await deps.db.select().from(infrastructures).where(eq(infrastructures.id, id))
  if (!record) {
    throw new StudioProblem('not_found', 'No such target.')
  }
  return record
}

function parseInput (deps: StudioDeps, raw: unknown): ReturnType<typeof infrastructureInputSchema.parse> {
  const parsed = infrastructureInputSchema.safeParse(raw)
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', 'The infrastructure configuration is invalid.', {
      violations: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  const input = parsed.data
  if (input.allowPrivateNetwork && !deps.config.allowPrivateNetworkTargets) {
    throw new StudioProblem('endpoint_rejected', 'This Studio deployment does not allow private-network or loopback targets.')
  }
  return input
}

/** Checks endpoint and issuer URLs against the static URL rules and the address policy. */
async function validateUrls (input: ReturnType<typeof infrastructureInputSchema.parse>): Promise<void> {
  const urls: Array<[string, string]> = input.endpoints.map(endpoint => [endpoint.type, endpoint.url])
  if (input.security.mode !== 'unsecured') {
    urls.push(['security.issuer', input.security.issuer])
  }
  for (const [label, url] of urls) {
    try {
      await checkHost(new URL(url), { allowPrivateNetwork: input.allowPrivateNetwork })
    } catch (error) {
      if (error instanceof NetworkFailure) {
        throw new StudioProblem('endpoint_rejected', `${label}: ${error.message}`)
      }
      throw error
    }
  }
}

interface ResolvedSecurity {
  security: StoredSecurity
  secretCiphertext: string | null
}

function resolveSecurityInput (
  deps: StudioDeps,
  input: ReturnType<typeof infrastructureInputSchema.parse>['security'],
  previous: InfrastructureRecord | undefined,
): ResolvedSecurity {
  if (input.mode === 'unsecured') {
    return { security: { mode: 'unsecured' }, secretCiphertext: null }
  }

  let clientSecret: SecretSummary | null = null
  let secretCiphertext: string | null = null
  const previousSecret = previous && previous.security.mode !== 'unsecured' ? previous.security.clientSecret : null

  if (input.clientSecret) {
    ;({ clientSecret, secretCiphertext } = storeSecret(deps, input.clientSecret))
  } else if (previousSecret) {
    clientSecret = previousSecret
    secretCiphertext = previous!.secretCiphertext
  }

  if (input.mode === 'deployment_client_credentials' && !clientSecret) {
    throw new StudioProblem('invalid_request', 'Client credentials require a client secret.', {
      violations: [{ path: 'security.clientSecret', message: 'required' }],
    })
  }

  const oidcFields = { issuer: input.issuer, clientId: input.clientId, scopes: input.scopes, clientSecret }
  return {
    security: input.mode === 'delegated_user'
      ? { mode: 'delegated_user', ...oidcFields, desktopLoopbackHost: input.desktopLoopbackHost }
      : { mode: 'deployment_client_credentials', ...oidcFields },
    secretCiphertext,
  }
}

function storeSecret (deps: StudioDeps, secret: SecretInput): { clientSecret: SecretSummary, secretCiphertext: string | null } {
  if ('value' in secret) {
    if (deps.config.deploymentMode !== 'desktop') {
      throw new StudioProblem('invalid_request', 'Hosted Studio accepts client secrets only as env: or file: references to deployment secrets.', {
        violations: [{ path: 'security.clientSecret', message: 'use a secret reference' }],
      })
    }
    return {
      clientSecret: { kind: 'stored', ref: null },
      secretCiphertext: deps.cipher.encrypt(secret.value, secretPurpose),
    }
  }
  const [kind, ...rest] = secret.ref.split(':')
  return {
    clientSecret: { kind: kind as 'env' | 'file', ref: rest.join(':') },
    secretCiphertext: null,
  }
}

/** Resolves the client secret of a target's OIDC client, or undefined for public clients. */
export async function resolveClientSecret (deps: StudioDeps, record: InfrastructureRecord): Promise<string | undefined> {
  if (record.security.mode === 'unsecured' || !record.security.clientSecret) {
    return undefined
  }
  const { kind, ref } = record.security.clientSecret
  let value: string | undefined
  if (kind === 'stored' && record.secretCiphertext) {
    value = deps.cipher.decrypt(record.secretCiphertext, secretPurpose)
  } else if (kind === 'env' && ref) {
    value = process.env[ref]
  } else if (kind === 'file' && ref) {
    value = await readFile(ref, 'utf8').then(content => content.trim(), () => undefined)
  }
  if (!value) {
    throw new StudioProblem('target_credentials_rejected', 'The client secret reference of this target could not be resolved.')
  }
  return value
}

/** The `profiles` of a `/description` answer, or `null` if it has none. */
async function profilesOf (response: Response): Promise<string[] | null> {
  if (!response.ok) {
    await response.body?.cancel()
    return null
  }
  try {
    const body = await response.json() as { profiles?: unknown }
    return Array.isArray(body.profiles) ? body.profiles.filter((profile): profile is string => typeof profile === 'string').slice(0, 200) : null
  } catch {
    return null
  }
}

/**
 * Asks every endpoint for its self-description. Any HTTP answer proves
 * reachability (`/description` may need authorization); its profiles say
 * which optional features the service offers (MVP-4 plan, I6).
 */
export async function probeEndpoints (deps: StudioDeps, record: Pick<InfrastructureRecord, 'endpoints' | 'allowPrivateNetwork'>): Promise<ProbeResult> {
  const policy = targetPolicy(deps, record as InfrastructureRecord)
  const guardedFetch = createGuardedFetch(policy)
  const results = await Promise.all(record.endpoints.map(async endpoint => {
    const started = performance.now()
    try {
      const response = await guardedFetch(`${endpoint.url.replace(/\/+$/, '')}/description`, { headers: { Accept: 'application/json' } })
      const latencyMs = Math.round(performance.now() - started)
      return { type: endpoint.type, reachable: response.status < 500, status: response.status, latencyMs, error: null, profiles: await profilesOf(response) }
    } catch (error) {
      return { type: endpoint.type, reachable: false, status: null, latencyMs: null, error: error instanceof Error ? error.message : 'request failed', profiles: null }
    }
  }))
  return { checkedAt: new Date().toISOString(), endpoints: results }
}

/** The profiles of a probe, per endpoint type, as stored with the infrastructure. */
function storedProfiles (probe: ProbeResult): ServiceProfiles {
  return Object.fromEntries(probe.endpoints.map(endpoint => [endpoint.type, endpoint.profiles]))
}

async function requireReachable (deps: StudioDeps, record: Pick<InfrastructureRecord, 'endpoints' | 'allowPrivateNetwork'>): Promise<ProbeResult> {
  const probe = await probeEndpoints(deps, record)
  const failed = probe.endpoints.filter(endpoint => !endpoint.reachable)
  if (failed.length > 0) {
    throw new StudioProblem('infrastructure_unreachable', failed.map(endpoint => `${endpoint.type}: ${endpoint.error ?? `HTTP ${endpoint.status}`}`).join('; '))
  }
  return probe
}

/** Probes an infrastructure again and stores the profiles it reports. */
export async function reprobeInfrastructure (deps: StudioDeps, id: string): Promise<ProbeResult> {
  const record = await getInfrastructure(deps, id)
  const probe = await probeEndpoints(deps, record)
  await deps.db.update(infrastructures)
    .set({ serviceProfiles: storedProfiles(probe), probedAt: new Date(probe.checkedAt) })
    .where(eq(infrastructures.id, id))
  return probe
}

export async function createInfrastructure (deps: StudioDeps, actor: Actor, raw: unknown, requestId: string): Promise<InfrastructureRecord> {
  const input = parseInput(deps, raw)
  await validateUrls(input)
  const { security, secretCiphertext } = resolveSecurityInput(deps, input.security, undefined)
  const probe = await requireReachable(deps, input)

  const [record] = await deps.db.insert(infrastructures).values({
    id: randomToken(12),
    name: input.name,
    description: input.description ?? null,
    template: input.template,
    endpoints: input.endpoints,
    listSource: input.listSource,
    sync: input.sync,
    serviceProfiles: storedProfiles(probe),
    probedAt: new Date(probe.checkedAt),
    security,
    secretCiphertext,
    allowPrivateNetwork: input.allowPrivateNetwork,
    createdBy: actor.subject,
  }).returning()
  await recordAudit(deps, { action: 'infrastructure.create', outcome: 'success', requestId, actorSubject: actor.subject, targetId: record!.id })
  return record!
}

export async function updateInfrastructure (
  deps: StudioDeps,
  actor: Actor,
  id: string,
  expectedRevision: number,
  raw: unknown,
  requestId: string,
): Promise<InfrastructureRecord> {
  const previous = await getInfrastructure(deps, id)
  const input = parseInput(deps, raw)
  await validateUrls(input)
  const { security, secretCiphertext } = resolveSecurityInput(deps, input.security, previous)
  const probe = await requireReachable(deps, input)

  const [record] = await deps.db.update(infrastructures).set({
    name: input.name,
    description: input.description ?? null,
    template: input.template,
    endpoints: input.endpoints,
    listSource: input.listSource,
    sync: input.sync,
    serviceProfiles: storedProfiles(probe),
    probedAt: new Date(probe.checkedAt),
    security,
    secretCiphertext,
    allowPrivateNetwork: input.allowPrivateNetwork,
    revision: expectedRevision + 1,
    updatedAt: new Date(),
  }).where(and(eq(infrastructures.id, id), eq(infrastructures.revision, expectedRevision))).returning()
  if (!record) {
    throw new StudioProblem('revision_conflict', 'The infrastructure was changed in the meantime. Reload it and try again.')
  }
  forgetOidcClients()
  await recordAudit(deps, { action: 'infrastructure.update', outcome: 'success', requestId, actorSubject: actor.subject, targetId: id })
  return record
}

export async function deleteInfrastructure (deps: StudioDeps, actor: Actor, id: string, requestId: string): Promise<void> {
  const [deleted] = await deps.db.delete(infrastructures).where(eq(infrastructures.id, id)).returning({ id: infrastructures.id })
  if (!deleted) {
    throw new StudioProblem('not_found', 'No such infrastructure.')
  }
  forgetOidcClients()
  await recordAudit(deps, { action: 'infrastructure.delete', outcome: 'success', requestId, actorSubject: actor.subject, targetId: id })
}

export { type InfrastructureInput } from '#shared/contract'
