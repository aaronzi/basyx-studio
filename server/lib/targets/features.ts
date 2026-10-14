import type { InfrastructureRecord } from '../infrastructures'
import type { DetectedFeatures } from './aas-target'
import { StudioProblem } from '../problem'

const ttlMs = 5 * 60 * 1000

interface Entry {
  features: DetectedFeatures
  expiresAt: number
}

/**
 * Detected optional features per infrastructure configuration. They describe
 * the server, not the user, so one probe serves every session; a probe that
 * needed authorization is not cached.
 */
export class FeatureCache {
  readonly #entries = new Map<string, Entry>()
  readonly #inflight = new Map<string, Promise<DetectedFeatures>>()

  constructor (private readonly now: () => number = Date.now) {}

  /** The cached features, or `null` when they have not been detected (recently). */
  peek (record: Pick<InfrastructureRecord, 'id' | 'revision'>): DetectedFeatures | null {
    const entry = this.#entries.get(this.#key(record))
    return entry && entry.expiresAt > this.now() ? entry.features : null
  }

  async get (record: Pick<InfrastructureRecord, 'id' | 'revision'>, detect: () => Promise<DetectedFeatures>): Promise<DetectedFeatures> {
    const cached = this.peek(record)
    if (cached) {
      return cached
    }
    const key = this.#key(record)
    let pending = this.#inflight.get(key)
    if (!pending) {
      pending = detect()
        .then(features => {
          this.#entries.set(key, { features, expiresAt: this.now() + ttlMs })
          return features
        })
        .finally(() => this.#inflight.delete(key))
      this.#inflight.set(key, pending)
    }
    return pending
  }

  /** Forgets an infrastructure, e.g. after it was edited or probed again. */
  forget (id: string): void {
    for (const key of this.#entries.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.#entries.delete(key)
      }
    }
  }

  #key (record: Pick<InfrastructureRecord, 'id' | 'revision'>): string {
    return `${record.id}:${record.revision}`
  }
}

/** Whether a detection failure means "ask again later" rather than "not available". */
export function isAuthorizationProblem (error: unknown): boolean {
  return error instanceof StudioProblem && (error.code === 'target_auth_required' || error.code === 'target_credentials_rejected')
}
