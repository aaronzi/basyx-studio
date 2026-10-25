import type { CopyDependencies, CopyPlan, CopyReport } from '#shared/contract'
import type { CopyRun } from './execute'
import type { CopyRoot } from './plan'
import type { EnvironmentReader } from './source'
import { randomBytes } from 'node:crypto'
import { StudioProblem } from '../problem'

/** Plans expire after this, so a forgotten dialog does not pin content in memory. */
const planLifetimeMs = 30 * 60 * 1000
const maxPlans = 100

/** Where the copy reads: a target again when it runs, or the environment parsed for the plan. */
export type StoredCopySource
  = | { kind: 'target', targetId: string }
    | { kind: 'environment', reader: EnvironmentReader }

export interface StoredCopyPlan {
  plan: CopyPlan
  /** The user who made the plan; only they may read or execute it. */
  owner: string
  source: StoredCopySource
  roots: CopyRoot[]
  dependencies: CopyDependencies
  destinationShellId: string | null
  /** The revision of each resource as the plan read it, by plan key; never sent to the browser. */
  revisions: Map<string, string>
  run: CopyRun
  /**
   * Executions by `Idempotency-Key`, registered before the first await: a
   * repeated request, even one sent while the first still runs, shares its
   * report (DATA-015).
   */
  executions: Map<string, Promise<CopyReport>>
  /** The last execution of the plan; the next one waits for it, as they share `run`. */
  tail: Promise<unknown>
}

/** Copy plans of this Studio Service process, in memory (K8). */
export class CopyPlanStore {
  readonly #plans = new Map<string, StoredCopyPlan>()

  newId (): string {
    return `cp-${randomBytes(12).toString('base64url')}`
  }

  expiry (now = Date.now()): string {
    return new Date(now + planLifetimeMs).toISOString()
  }

  put (record: StoredCopyPlan): void {
    this.#prune()
    while (this.#plans.size >= maxPlans) {
      this.#plans.delete(this.#plans.keys().next().value!)
    }
    this.#plans.set(record.plan.id, record)
  }

  /** The plan, if it exists, has not expired and belongs to `owner`. */
  get (id: string, owner: string): StoredCopyPlan {
    this.#prune()
    const record = this.#plans.get(id)
    if (!record || record.owner !== owner) {
      throw new StudioProblem('not_found', 'The copy plan does not exist or has expired. Make a new plan.')
    }
    return record
  }

  #prune (now = Date.now()): void {
    for (const [id, record] of this.#plans) {
      if (Date.parse(record.plan.expiresAt) <= now) {
        this.#plans.delete(id)
      }
    }
  }
}
