import type { StudioConfig } from './config'
import type { SecretCipher } from './crypto/cipher'
import type { StudioDatabase } from './database/client'

/** Explicit dependencies of Studio services, so they stay testable without Nitro. */
export interface StudioDeps {
  config: StudioConfig
  db: StudioDatabase
  cipher: SecretCipher
}

export interface Actor {
  subject: string
  name: string
  roles: string[]
  isAdmin: boolean
  /** Session that owns per-user target credentials. */
  sessionId: string
}
