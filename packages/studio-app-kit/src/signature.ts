import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto'

// Detached package signatures (external apps plan U1, ADR 0043, ADR 0044):
// ECDSA P-256 with SHA-256 over the exact bytes of `<package>.zip`,
// DER-encoded and base64, in `<package>.zip.sig`. This is what
// `cosign sign-blob --key` writes with `--output-signature`; cosign 3 writes
// a Sigstore bundle by default, whose message signature is the same value.
// Studio verifies uploads with this module, so `studio-app verify` and
// Studio read the same files.

export const signatureExtension = '.sig'

/** Longer than any signature or key-based bundle; bundles with certificate chains stay below it. */
export const maxSignatureLength = 16 * 1024

/** A signature or public key that cannot be read; the message says why. */
export class SignatureFormatError extends Error {}

/** A key in PEM form, or a key object. */
export type KeyInput = string | Uint8Array | KeyObject

function isP256 (key: KeyObject): boolean {
  return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
}

function p256 (key: KeyObject, role: string): KeyObject {
  if (!isP256(key)) {
    throw new Error(`The ${role} is not an ECDSA P-256 key.`)
  }
  return key
}

/** A private ECDSA P-256 key from PEM (PKCS#8 or SEC1); an encrypted PKCS#8 key needs its passphrase. */
export function privateKeyOf (key: KeyInput, passphrase?: string): KeyObject {
  if (key instanceof KeyObject) {
    return p256(key, 'private key')
  }
  return p256(createPrivateKey(passphrase === undefined ? { key: Buffer.from(key) } : { key: Buffer.from(key), passphrase }), 'private key')
}

/** The public key of a public key, a certificate or a private key. */
export function publicKeyOf (key: KeyInput): KeyObject {
  if (key instanceof KeyObject) {
    return p256(key.type === 'private' ? createPublicKey(key) : key, 'public key')
  }
  return p256(createPublicKey(Buffer.from(key)), 'public key')
}

/** `sha256:<hex>` of the key's DER SubjectPublicKeyInfo, to tell keys apart; cosign shows it base64 as the key hint. */
export function keyFingerprint (publicKey: KeyInput): string {
  const der = publicKeyOf(publicKey).export({ type: 'spki', format: 'der' })
  return `sha256:${createHash('sha256').update(der).digest('hex')}`
}

/** A public key that may sign app packages. */
export interface SigningKey {
  key: KeyObject
  /** See `keyFingerprint`. */
  fingerprint: string
}

/**
 * Reads a PEM public key, as Studio's trust store lists them; only ECDSA
 * P-256 keys are accepted. Throws `SignatureFormatError`.
 */
export function parsePublicKey (pem: string): SigningKey {
  let key: KeyObject
  try {
    key = createPublicKey({ key: pem, format: 'pem' })
  } catch {
    throw new SignatureFormatError('is not a PEM public key')
  }
  if (!isP256(key)) {
    throw new SignatureFormatError('is not an ECDSA P-256 key, as cosign generate-key-pair writes')
  }
  return { key, fingerprint: keyFingerprint(key) }
}

/**
 * Signs a package. The private key is PEM: PKCS#8, or SEC1 (`EC PRIVATE
 * KEY`); an encrypted PKCS#8 key needs its passphrase. Returns the base64
 * signature, the content of `<package>.zip.sig`.
 */
export function signPackage (bytes: Uint8Array, privateKey: KeyInput, passphrase?: string): string {
  return sign('sha256', bytes, privateKeyOf(privateKey, passphrase)).toString('base64')
}

const base64 = /^[a-z0-9+/]+={0,2}$/i

function decodeBase64 (value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || !base64.test(value) || value.length % 4 !== 0) {
    throw new SignatureFormatError(`${what} is not base64`)
  }
  return Buffer.from(value, 'base64')
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface PackageSignature {
  /** The DER-encoded ECDSA signature. */
  signature: Buffer
  /** The fingerprint of the signing key, when a Sigstore bundle names it. */
  keyFingerprint: string | null
  /** `sha256:<hex>` of the signed bytes, when a Sigstore bundle names it. */
  digest: string | null
}

/**
 * Reads the content of a `.sig` file: a base64 signature, or a Sigstore
 * bundle with a message signature (cosign 3's default). Throws
 * `SignatureFormatError` for anything else.
 */
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

/** Whether `signature` (DER) is a valid signature of `bytes` by this key. Malformed signatures and keys are invalid. */
export function verifySignature (bytes: Uint8Array, signature: Uint8Array, publicKey: KeyInput): boolean {
  try {
    return verify('sha256', bytes, publicKeyOf(publicKey), signature)
  } catch {
    return false
  }
}

/**
 * Whether the content of a `.sig` file (see `parseSignature`) signs exactly
 * these bytes with this key. Malformed signatures are invalid.
 */
export function verifyPackageSignature (bytes: Uint8Array, signatureFile: string, publicKey: KeyInput): boolean {
  let parsed: PackageSignature
  try {
    parsed = parseSignature(signatureFile)
  } catch {
    return false
  }
  if (parsed.digest && parsed.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) {
    return false
  }
  return verifySignature(bytes, parsed.signature, publicKey)
}
