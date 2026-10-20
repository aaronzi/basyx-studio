import type { ArchiveLimits, Finding } from './manifest.ts'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { appArchiveLimits, checkCompatibility, checkManifestConsistency, contentTypeOf, isArchiveLitter, manifestFileName, maxManifestBytes, parseManifest } from './manifest.ts'

// Packing and checking app packages outside Studio (`studio-app pack` and
// `verify`, ADR 0043), with the checks of Studio's upload (ADR 0016).

const MiB = 1024 * 1024

export interface PackageCheck {
  /** The manifest, when it passed the schema. */
  manifest: AppManifest | null
  /** The package's files without the manifest, as Studio stores them. */
  files: string[]
  /** Empty when Studio would accept the package. */
  findings: Finding[]
}

// Relative, slash-separated names without empty, `.` or `..` segments,
// backslashes, drive letters or control characters, as Studio's archive
// checks require (server/lib/workspaces/archive.ts in the Studio repository).
// eslint-disable-next-line no-control-regex
const forbiddenCharacters = /[\u0000-\u001F\u007F\\:]/

function isSafeEntryName (name: string): boolean {
  if (!name || name.length > 1024 || name.startsWith('/') || forbiddenCharacters.test(name)) {
    return false
  }
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * The archive's first problem, from its central directory, before anything
 * is decompressed. The messages are those of Studio's upload.
 */
function inspectArchive (bytes: Uint8Array, limits: ArchiveLimits): string | null {
  if (bytes.length > limits.maxArchiveBytes) {
    return `is larger than ${Math.round(limits.maxArchiveBytes / MiB)} MiB`
  }
  const names = new Set<string>()
  let totalBytes = 0
  let problem: string | null = null
  const stop = (message: string) => {
    problem = message
    throw new Error(message)
  }
  try {
    unzipSync(bytes, {
      filter: entry => {
        if (names.size >= limits.maxEntries) {
          stop(`has more than ${limits.maxEntries} entries`)
        }
        if (!isSafeEntryName(entry.name)) {
          stop(`contains an unsafe entry name: ${JSON.stringify(entry.name.slice(0, 200))}`)
        }
        const key = entry.name.toLowerCase()
        if (names.has(key)) {
          stop(`contains the entry ${JSON.stringify(entry.name)} twice`)
        }
        names.add(key)
        if (entry.compression !== 0 && entry.compression !== 8) {
          stop(`uses an unsupported compression method (${entry.compression})`)
        }
        if (entry.originalSize > limits.maxEntryBytes) {
          stop(`The entry ${JSON.stringify(entry.name)} is larger than ${Math.round(limits.maxEntryBytes / MiB)} MiB`)
        }
        if (entry.originalSize > limits.ratioThresholdBytes && entry.originalSize > entry.size * limits.maxCompressionRatio) {
          stop(`The entry ${JSON.stringify(entry.name)} is compressed suspiciously well`)
        }
        totalBytes += entry.originalSize
        if (totalBytes > limits.maxTotalBytes) {
          stop(`expands to more than ${Math.round(limits.maxTotalBytes / MiB)} MiB`)
        }
        return false
      },
    })
  } catch {
    return problem ?? 'is not a valid app package (ZIP)'
  }
  return null
}

/**
 * Checks an app package (ZIP) as Studio's upload does: the archive limits,
 * entry names and file types, the manifest's schema and references, and the
 * app API range against the installed `@basyx/studio-sdk`. The runtime is
 * not checked; it depends on the Studio that installs the package.
 */
export function checkPackage (bytes: Uint8Array): PackageCheck {
  const archive = inspectArchive(bytes, appArchiveLimits)
  if (archive) {
    return { manifest: null, files: [], findings: [{ path: '(archive)', message: archive }] }
  }

  const entries = unzipSync(bytes)
  let names = Object.keys(entries).filter(name => !name.endsWith('/') && !isArchiveLitter(name))
  // Archives of a folder: a single top-level directory holding the manifest is stripped.
  if (!names.includes(manifestFileName)) {
    const tops = new Set(names.map(name => name.split('/', 1)[0]))
    const [top] = tops
    if (tops.size === 1 && names.includes(`${top}/${manifestFileName}`)) {
      const prefix = `${top}/`
      for (const name of names) {
        entries[name.slice(prefix.length)] = entries[name]!
      }
      names = names.map(name => name.slice(prefix.length))
    }
  }

  const findings: Finding[] = []
  const files: string[] = []
  for (const path of names) {
    if (path === manifestFileName) {
      continue
    }
    if (contentTypeOf(path)) {
      files.push(path)
    } else {
      findings.push({ path, message: 'has a file type that apps may not contain' })
    }
  }

  const manifestBytes = entries[manifestFileName]
  if (!manifestBytes) {
    return { manifest: null, files, findings: [...findings, { path: manifestFileName, message: 'is missing at the package root' }] }
  }
  if (manifestBytes.length > maxManifestBytes) {
    return { manifest: null, files, findings: [...findings, { path: manifestFileName, message: 'is larger than 64 KiB' }] }
  }
  const parsed = parseManifest(new TextDecoder('utf-8', { fatal: false }).decode(manifestBytes))
  if (!parsed.manifest) {
    return { manifest: null, files, findings: [...findings, ...parsed.findings] }
  }
  findings.push(
    ...checkManifestConsistency(parsed.manifest, new Set(files)),
    ...checkCompatibility(parsed.manifest, null, { provider: 'the installed @basyx/studio-sdk' }),
  )
  return { manifest: parsed.manifest, files, findings }
}

export interface PackOptions {
  /** The project folder, with `studio-app.json`. Default: the working directory. */
  project?: string
  /** The build output, packaged at the paths below it. Default `dist`. */
  dist?: string
  /** Folders of the project packaged at their own path, e.g. `backend`. */
  include?: string[]
  /** The ZIP file to write, or a folder for `<id>-<version>.zip`. Default: the project folder. */
  output?: string
}

export interface PackResult extends PackageCheck {
  /** The package written, or `null` when there are findings. */
  file: string | null
  bytes: Uint8Array | null
}

async function filesBelow (directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).toSorted()
}

/** A fixed time for every entry, so the same files give the same package and signature. */
const entryTime = new Date(1980, 0, 1)

/**
 * Packages an app: `studio-app.json`, the files below `dist` at their paths
 * there, and the `include` folders at theirs. Writes the package only when
 * `checkPackage` has no findings.
 */
export async function packApp (options: PackOptions = {}): Promise<PackResult> {
  const project = resolve(options.project ?? '.')
  const fail = (finding: Finding): PackResult => ({ manifest: null, files: [], findings: [finding], file: null, bytes: null })
  const manifestPath = join(project, manifestFileName)
  if (!existsSync(manifestPath)) {
    return fail({ path: manifestFileName, message: `is missing in ${project}` })
  }
  const entries: Record<string, Uint8Array> = { [manifestFileName]: new Uint8Array(await readFile(manifestPath)) }
  const sources = [
    { base: join(project, options.dist ?? 'dist'), prefix: '' },
    ...(options.include ?? []).map(folder => ({ base: join(project, folder), prefix: `${relative(project, join(project, folder)).split('\\').join('/')}/` })),
  ]
  for (const { base, prefix } of sources) {
    if (!existsSync(base) || !(await stat(base)).isDirectory()) {
      return fail({ path: relative(project, base) || '.', message: prefix ? 'is not a folder of the project' : 'does not exist; build the app first' })
    }
    for (const file of await filesBelow(base)) {
      const path = prefix + relative(base, file).split('\\').join('/')
      if (isArchiveLitter(path)) {
        continue
      }
      if (entries[path]) {
        return fail({ path, message: 'comes from more than one folder' })
      }
      entries[path] = new Uint8Array(await readFile(file))
    }
  }

  const bytes = zipSync(Object.fromEntries(Object.keys(entries).toSorted().map(path => [path, entries[path]!])), { mtime: entryTime })
  const check = checkPackage(bytes)
  if (check.findings.length > 0 || !check.manifest) {
    return { ...check, file: null, bytes: null }
  }
  const output = resolve(project, options.output ?? '.')
  const file = output.endsWith('.zip') ? output : join(output, `${check.manifest.id}-${check.manifest.version}.zip`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return { ...check, file, bytes }
}
