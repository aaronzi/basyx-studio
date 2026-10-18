import type { z } from 'zod'
import { parseDocument } from 'yaml'
import { infrastructureInputSchema, managedInfrastructureKeySchema } from '#shared/contract'
import { ConfigurationError } from './config'

// The deployment's infrastructure file (ADR 0037): YAML with the fields of
// the infrastructure API input plus a stable key per entry.
//
//   version: 1
//   infrastructures:
//     - key: factory-a
//       name: Factory A
//       template: mono-all
//       endpoints:
//         - { type: aasEnvironment, url: https://basyx.example.org }
//       security: { mode: unsecured }

export type ParsedInfrastructureInput = z.output<typeof infrastructureInputSchema>

export interface DeclaredInfrastructure {
  key: string
  input: ParsedInfrastructureInput
  /** Where the entry was declared, for error messages. */
  source: string
}

export const infrastructureFileVersion = 1

const inputFields = new Set(Object.keys(infrastructureInputSchema.shape))

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses one infrastructure file. Every problem is collected with its place
 * (`infrastructures[1] (factory-a).endpoints.0.url: …`), so an operator can
 * fix the whole file in one go; any problem rejects the whole file.
 */
export function parseInfrastructureFile (text: string, source: string): DeclaredInfrastructure[] {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    const [error] = document.errors
    const line = error!.linePos?.[0]
    throw new ConfigurationError(`${source}: invalid YAML${line ? ` at line ${line.line}, column ${line.col}` : ''}: ${error!.message.split('\n', 1)[0]!.replace(/ at line \d+, column \d+:?$/, '')}`)
  }
  const content: unknown = document.toJS()
  if (content === null || content === undefined) {
    return []
  }
  if (!isRecord(content)) {
    throw new ConfigurationError(`${source}: expected a mapping with \`version\` and \`infrastructures\`.`)
  }

  const problems: string[] = []
  for (const field of Object.keys(content)) {
    if (field !== 'version' && field !== 'infrastructures') {
      problems.push(`${field}: unknown field`)
    }
  }
  if (content.version !== infrastructureFileVersion) {
    problems.push(`version: must be ${infrastructureFileVersion}`)
  }
  const entries = content.infrastructures ?? []
  if (!Array.isArray(entries)) {
    problems.push('infrastructures: must be a list')
  }

  const declared: DeclaredInfrastructure[] = []
  const keys = new Set<string>()
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const at = (key: unknown) => `infrastructures[${index}]${typeof key === 'string' && key ? ` (${key})` : ''}`
    if (!isRecord(entry)) {
      problems.push(`${at(undefined)}: must be a mapping`)
      continue
    }
    const { key, ...fields } = entry
    const parsedKey = managedInfrastructureKeySchema.safeParse(key)
    if (!parsedKey.success) {
      problems.push(`${at(key)}.key: ${key === undefined ? 'required' : parsedKey.error.issues[0]!.message}`)
    } else if (keys.has(parsedKey.data)) {
      problems.push(`${at(key)}.key: declared more than once`)
    }
    for (const field of Object.keys(fields)) {
      if (!inputFields.has(field)) {
        problems.push(`${at(key)}.${field}: unknown field`)
      }
    }
    const parsed = infrastructureInputSchema.safeParse(fields)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${at(key)}${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}: ${issue.message}`)
      }
    }
    if (parsedKey.success && parsed.success) {
      keys.add(parsedKey.data)
      declared.push({ key: parsedKey.data, input: parsed.data, source })
    }
  }

  if (problems.length > 0) {
    throw new ConfigurationError(`${source}: ${problems.join('; ')}`)
  }
  return declared
}

/** Parses all infrastructure sources of a deployment; a key may be declared only once across them. */
export function parseInfrastructureSources (sources: Array<{ source: string, text: string }>): DeclaredInfrastructure[] {
  const declared = sources.flatMap(({ source, text }) => parseInfrastructureFile(text, source))
  const seen = new Map<string, string>()
  for (const entry of declared) {
    const first = seen.get(entry.key)
    if (first !== undefined) {
      throw new ConfigurationError(`The infrastructure key ${entry.key} is declared in both ${first} and ${entry.source}.`)
    }
    seen.set(entry.key, entry.source)
  }
  return declared
}
