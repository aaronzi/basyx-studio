import type { KeyObject } from 'node:crypto'
import { createHash, createPublicKey, sign, verify } from 'node:crypto'

// Detached signatures of app packages (ADR 0044): ECDSA P-256 with SHA-256
// over the exact package bytes, DER-encoded and base64, as written by
//
//   cosign sign-blob --key cosign.key --output-signature app.zip.sig app.zip
//
// cosign 3 writes a Sigstore bundle by default (`--bundle`); its message
// signature is the same value.
//
// @basyx/studio-app-kit (`studio-app sign` and `verify`) has the same code.
// Import it from the kit once the kit is published, and delete this file:
// https://github.com/eclipse-basyx/basyx-studio/issues/65

/** Longer than any signature or key-based bundle; bundles with certificate chains stay below it. */
export const maxSignatureLength = 16 * 1024

export class SignatureFormatError extends Error {}

/** A public key that may sign app packages. */
export interface SigningKey {
  key: KeyObject
  /** `sha256:<hex>` of the DER-encoded SubjectPublicKeyInfo; cosign shows it base64 as the key hint. */
  fingerprint: string
}

/** Reads a PEM public key; only ECDSA P-256 keys are accepted. */
export function parsePublicKey (pem: string): SigningKey {
  let key: KeyObject
  try {
    key = createPublicKey({ key: pem, format: 'pem' })
  } catch {
    throw new SignatureFormatError('is not a PEM public key')
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new SignatureFormatError('is not an ECDSA P-256 key, as cosign generate-key-pair writes')
  }
  return { key, fingerprint: publicKeyFingerprint(key) }
}

export function publicKeyFingerprint (key: KeyObject): string {
  return `sha256:${createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')}`
}

export interface PackageSignature {
  /** The DER-encoded ECDSA signature. */
  signature: Buffer
  /** The fingerprint of the signing key, when a bundle names it. */
  keyFingerprint: string | null
  /** `sha256:<hex>` of the signed bytes, when a bundle names it. */
  digest: string | null
}

const base64 = /^[A-Z0-9+/]+={0,2}$/i

function decodeBase64 (value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || !base64.test(value) || value.length % 4 !== 0) {
    throw new SignatureFormatError(`${what} is not base64`)
  }
  return Buffer.from(value, 'base64')
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the content of a `.sig` file: a base64 signature, or a Sigstore bundle with a message signature. */
export function parseSignature (text: string): PackageSignature {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new SignatureFormatError('the signature is empty')
  }
  if (trimmed.length > maxSignatureLength) {
    throw new SignatureFormatError('the signature is longer than 16 KiB')
  }
  if (!trimmed.startsWith('{')) {
    return { signature: decodeBase64(trimmed, 'the signature'), keyFingerprint: null, digest: null }
  }

  let bundle: unknown
  try {
    bundle = JSON.parse(trimmed)
  } catch {
    throw new SignatureFormatError('the signature is neither base64 nor a Sigstore bundle')
  }
  const message = isRecord(bundle) ? bundle.messageSignature : undefined
  if (!isRecord(bundle) || typeof bundle.mediaType !== 'string' || !bundle.mediaType.startsWith('application/vnd.dev.sigstore.bundle') || !isRecord(message)) {
    throw new SignatureFormatError('the Sigstore bundle has no message signature (sign with cosign sign-blob)')
  }
  const messageDigest = message.messageDigest
  let digest: string | null = null
  if (isRecord(messageDigest)) {
    if (messageDigest.algorithm !== 'SHA2_256') {
      throw new SignatureFormatError('the Sigstore bundle uses another digest than SHA-256')
    }
    digest = `sha256:${decodeBase64(messageDigest.digest, 'the bundle digest').toString('hex')}`
  }
  const material = bundle.verificationMaterial
  const hint = isRecord(material) && isRecord(material.publicKey) ? material.publicKey.hint : undefined
  const keyFingerprint = typeof hint === 'string' && base64.test(hint) ? `sha256:${Buffer.from(hint, 'base64').toString('hex')}` : null
  return { signature: decodeBase64(message.signature, 'the bundle signature'), keyFingerprint, digest }
}

/** Whether `signature` is a valid signature of `bytes` by `key`. Malformed signatures are invalid. */
export function verifySignature (bytes: Uint8Array, signature: Uint8Array, key: KeyObject): boolean {
  try {
    return verify('sha256', bytes, { key, dsaEncoding: 'der' }, signature)
  } catch {
    return false
  }
}

/** Signs a package as `cosign sign-blob` does; the result is the content of the `.sig` file. */
export function signPackage (bytes: Uint8Array, privateKey: KeyObject): string {
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'der' }).toString('base64')
}
