import type { StudioDeps } from '../deps'
import type { PendingAuthorization } from './client'
import { and, eq, gt } from 'drizzle-orm'
import { oidcTransactions } from '../../database/schema'

const transactionTtlMs = 10 * 60 * 1000

export type TransactionPurpose = 'studio_login' | 'target_authorization'

export interface AuthorizationTransaction {
  state: string
  purpose: TransactionPurpose
  sessionId: string | null
  targetId: string | null
  codeVerifier: string
  nonce: string
  redirectUri: string
  returnTo: string
}

/**
 * Persists the PKCE verifier, nonce and redirect URI server-side, keyed by
 * `state`. Desktop callbacks arrive in the system browser without any Studio
 * cookie, so the transaction must not depend on the browser.
 */
export async function saveTransaction (
  deps: StudioDeps,
  pending: PendingAuthorization,
  details: { purpose: TransactionPurpose, sessionId: string | null, targetId: string | null, redirectUri: string, returnTo: string },
): Promise<void> {
  await deps.db.insert(oidcTransactions).values({
    state: pending.state,
    purpose: details.purpose,
    sessionId: details.sessionId,
    targetId: details.targetId,
    codeVerifierCiphertext: deps.cipher.encrypt(pending.codeVerifier, 'oidc_transactions.code_verifier'),
    nonce: pending.nonce,
    redirectUri: details.redirectUri,
    returnTo: details.returnTo,
    expiresAt: new Date(Date.now() + transactionTtlMs),
  })
}

/** Removes and returns the transaction, so every `state` can be used once. */
export async function consumeTransaction (deps: StudioDeps, state: string): Promise<AuthorizationTransaction | undefined> {
  const [row] = await deps.db.delete(oidcTransactions)
    .where(and(eq(oidcTransactions.state, state), gt(oidcTransactions.expiresAt, new Date())))
    .returning()
  if (!row) {
    return undefined
  }
  return {
    state: row.state,
    purpose: row.purpose,
    sessionId: row.sessionId,
    targetId: row.targetId,
    codeVerifier: deps.cipher.decrypt(row.codeVerifierCiphertext, 'oidc_transactions.code_verifier'),
    nonce: row.nonce,
    redirectUri: row.redirectUri,
    returnTo: row.returnTo,
  }
}
