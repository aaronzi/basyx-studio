import type { DeploymentMode } from '#shared/contract'
import type { StudioDeps } from '../lib/deps'
import { loadStudioConfig } from '../lib/config'
import { SecretCipher } from '../lib/crypto/cipher'
import { openDatabase } from '../lib/database/client'
import { applyMigrations, migrationsFromJournal } from '../lib/database/migrate'
import { ensureDesktopSession } from '../lib/sessions'
import { CredentialBroker } from '../lib/targets/credentials'

export interface StudioRuntime extends StudioDeps {
  broker: CredentialBroker
  close: () => Promise<void>
}

let runtime: Promise<StudioRuntime> | undefined

async function loadMigrationsFromAssets () {
  const storage = useStorage('assets:migrations')
  const raw = async (key: string) => {
    const value = await storage.getItemRaw(key)
    if (value === null || value === undefined) {
      throw new Error(`Migration asset ${key} is missing.`)
    }
    return typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf8')
  }
  return migrationsFromJournal(await raw('meta:_journal.json'), tag => raw(`${tag}.sql`))
}

async function initialize (): Promise<StudioRuntime> {
  const deploymentMode = useRuntimeConfig().studio.deploymentMode as DeploymentMode
  const config = loadStudioConfig(process.env, deploymentMode)
  const handle = await openDatabase(config.database)
  try {
    const applied = await applyMigrations(handle.db, await loadMigrationsFromAssets())
    if (applied.length > 0) {
      console.info(`[studio] applied database migrations: ${applied.join(', ')}`)
    }
    const deps: StudioDeps = { config, db: handle.db, cipher: new SecretCipher(config.dataKey) }
    if (config.deploymentMode === 'desktop') {
      await ensureDesktopSession(deps)
    }
    console.info(`[studio] ${config.deploymentMode} mode, ${config.database.kind} database, public URL ${config.publicUrl}`)
    return { ...deps, broker: new CredentialBroker(deps), close: handle.close }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** The process-wide Studio runtime (configuration, database, cipher, credential broker). */
export function useStudio (): Promise<StudioRuntime> {
  runtime ??= initialize().catch(error => {
    runtime = undefined
    throw error
  })
  return runtime
}

export async function closeStudio (): Promise<void> {
  const current = runtime
  runtime = undefined
  if (current) {
    await (await current.catch(() => undefined))?.close()
  }
}
