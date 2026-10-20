#!/usr/bin/env node
import type { Finding } from './manifest.ts'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkPackage, packApp } from './package.ts'
import { keyFingerprint, signatureExtension, signPackage, verifyPackageSignature } from './signature.ts'

// The `studio-app` command (ADR 0043): pack, sign and verify Studio app
// packages with the checks of Studio's upload.

const usage = `Usage: studio-app <command> [options]

Commands:
  pack [project]         Package studio-app.json, dist/ and --include folders
                         as <id>-<version>.zip, with Studio's checks.
      --dist <folder>      The build output (default: dist)
      --include <folder>   A folder packaged at its own path, e.g. backend (repeatable)
      --out <path>         The ZIP file, or a folder for it (default: the project)
  sign <package.zip>     Write <package.zip>.sig (ECDSA P-256, SHA-256, base64;
                         the format of cosign sign-blob --key).
      --key <file>         The private key, PEM (PKCS#8 or SEC1). An encrypted
                           key takes its passphrase from STUDIO_APP_KEY_PASSPHRASE.
      --out <file>         The signature file (default: <package.zip>.sig)
  verify <package.zip>   Run Studio's checks on a package.
      --key <file>         Also check <package.zip>.sig against this public key (PEM).
      --signature <file>   The signature file, base64 or a Sigstore bundle as cosign 3
                           writes it (default: <package.zip>.sig)
`

function report (findings: Finding[]): void {
  for (const finding of findings) {
    console.error(`  ${finding.path}: ${finding.message}`)
  }
}

function fail (message: string): never {
  console.error(message)
  process.exit(1)
}

async function pack (positionals: string[], values: Record<string, string | string[] | boolean | undefined>): Promise<void> {
  const project = resolve(positionals[0] ?? '.')
  const result = await packApp({
    project,
    dist: values.dist as string | undefined,
    include: values.include as string[] | undefined,
    output: values.out as string | undefined,
  })
  if (!result.file) {
    console.error(`The package has ${result.findings.length === 1 ? '1 finding' : `${result.findings.length} findings`}:`)
    report(result.findings)
    process.exit(1)
  }
  console.info(`${relative(process.cwd(), result.file) || result.file}: ${result.manifest!.id} ${result.manifest!.version}, ${result.files.length + 1} files`)
}

async function sign (positionals: string[], values: Record<string, string | string[] | boolean | undefined>): Promise<void> {
  const [file] = positionals
  if (!file || typeof values.key !== 'string') {
    fail('studio-app sign needs a package and --key <private key file>.')
  }
  const bytes = await readFile(file)
  let signature: string
  try {
    signature = signPackage(bytes, await readFile(values.key), process.env.STUDIO_APP_KEY_PASSPHRASE)
  } catch (error) {
    fail(`The package could not be signed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const output = typeof values.out === 'string' ? values.out : `${file}${signatureExtension}`
  await writeFile(output, signature)
  console.info(`${output}: signed with ${keyFingerprint(await readFile(values.key))}`)
}

async function verify (positionals: string[], values: Record<string, string | string[] | boolean | undefined>): Promise<void> {
  const [file] = positionals
  if (!file) {
    fail('studio-app verify needs a package.')
  }
  const bytes = new Uint8Array(await readFile(file))
  const check = checkPackage(bytes)
  if (check.findings.length > 0 || !check.manifest) {
    console.error(`${file}: the package has ${check.findings.length === 1 ? '1 finding' : `${check.findings.length} findings`}:`)
    report(check.findings)
    process.exit(1)
  }
  console.info(`${file}: ${check.manifest.id} ${check.manifest.version} passes Studio's package checks.`)
  if (typeof values.key === 'string') {
    const signatureFile = typeof values.signature === 'string' ? values.signature : `${file}${signatureExtension}`
    if (!existsSync(signatureFile)) {
      fail(`${signatureFile} does not exist.`)
    }
    const publicKey = await readFile(values.key)
    let valid: boolean
    try {
      valid = verifyPackageSignature(bytes, await readFile(signatureFile, 'utf8'), publicKey)
    } catch (error) {
      fail(`The signature could not be checked: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!valid) {
      fail(`${signatureFile} is not a valid signature of ${file} by ${keyFingerprint(publicKey)}.`)
    }
    console.info(`${signatureFile}: signed by ${keyFingerprint(publicKey)}.`)
  }
}

const commands = { pack, sign, verify }

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dist: { type: 'string' },
    include: { type: 'string', multiple: true },
    out: { type: 'string' },
    key: { type: 'string' },
    signature: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [command, ...rest] = positionals
if (values.help || !command) {
  console.info(usage)
} else if (Object.hasOwn(commands, command)) {
  await commands[command as keyof typeof commands](rest, values)
} else {
  fail(`Unknown command ${JSON.stringify(command)}.\n\n${usage}`)
}
