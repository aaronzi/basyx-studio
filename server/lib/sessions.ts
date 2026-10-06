import type { StudioDeps } from './deps'
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import { oidcTransactions, studioSessions } from '../database/schema'
import { randomToken, sha256 } from './crypto/cipher'

export type SessionRecord = typeof studioSessions.$inferSelect

/** The desktop Studio has exactly one local user and no session cookie. */
export const desktopSessionId = 'desktop-local'

export async function createSession (
  deps: StudioDeps,
  user: { subject: string, displayName: string, roles: string[], idToken: string | undefined },
): Promise<{ token: string, session: SessionRecord }> {
  const token = randomToken()
  const [session] = await deps.db.insert(studioSessions).values({
    id: sha256(token),
    subject: user.subject,
    displayName: user.displayName,
    roles: user.roles,
    csrfToken: randomToken(),
    idTokenCiphertext: user.idToken ? deps.cipher.encrypt(user.idToken, 'studio_sessions.id_token') : null,
    expiresAt: new Date(Date.now() + deps.config.sessionTtlMs),
  }).returning()
  return { token, session: session! }
}

export async function findSession (deps: StudioDeps, token: string): Promise<SessionRecord | undefined> {
  const [session] = await deps.db.select().from(studioSessions).where(and(
    eq(studioSessions.id, sha256(token)),
    or(isNull(studioSessions.expiresAt), gt(studioSessions.expiresAt, new Date())),
  ))
  return session
}

export async function findSessionById (deps: StudioDeps, id: string): Promise<SessionRecord | undefined> {
  const [session] = await deps.db.select().from(studioSessions).where(eq(studioSessions.id, id))
  return session
}

export async function deleteSession (deps: StudioDeps, id: string): Promise<SessionRecord | undefined> {
  const [session] = await deps.db.delete(studioSessions).where(eq(studioSessions.id, id)).returning()
  return session
}

export function sessionIdToken (deps: StudioDeps, session: SessionRecord): string | undefined {
  return session.idTokenCiphertext ? deps.cipher.decrypt(session.idTokenCiphertext, 'studio_sessions.id_token') : undefined
}

/** The local desktop session never expires; it owns the user's target credentials. */
export async function ensureDesktopSession (deps: StudioDeps): Promise<void> {
  await deps.db.insert(studioSessions).values({
    id: desktopSessionId,
    subject: 'local-user',
    displayName: 'Local user',
    roles: [deps.config.adminRole],
    csrfToken: randomToken(),
    expiresAt: null,
  }).onConflictDoNothing()
}

export async function deleteExpiredRecords (deps: StudioDeps): Promise<void> {
  const now = new Date()
  await deps.db.delete(studioSessions).where(lt(studioSessions.expiresAt, now))
  await deps.db.delete(oidcTransactions).where(lt(oidcTransactions.expiresAt, now))
}
