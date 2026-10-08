// Entry point of the Workspace Worker process. It is bundled separately
// (modules/workspace-worker.ts) and forked by the Studio Service on desktop.
import { serveWorker } from '../lib/workspaces/worker'

serveWorker()
