import { openIfc } from './ifc.ts'
import { serveParser } from './worker.ts'

serveParser(openIfc)
