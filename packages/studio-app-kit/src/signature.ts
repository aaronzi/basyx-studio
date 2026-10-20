import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto'

// Detached package signatures (external apps plan U1, ADR 0043, ADR 0044):
// ECDSA P-256 with SHA-256 over the exact bytes of `<package>.zip`,
// DER-encoded and base64, in `<package>.zip.sig`. This is what
// `cosign sign-blob --key` writes with `--output-signature`; cosign 3 writes
// a Sigstore bundle by default, whose message signature is the same value.
// Studio reads both, and so does `verifyPackageSignature`.

export const signatureExtension = '.sig'

/** A key in PEM form, or a key object. */
export type KeyInput = string | Uint8Array | KeyObject

function p256 (key: KeyObject, role: string): KeyObject {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
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

/**
 * Signs a package. The private key is PEM: PKCS#8, or SEC1 (`EC PRIVATE
 * KEY`); an encrypted PKCS#8 key needs its passphrase. Returns the base64
 * signature, the content of `<package>.zip.sig`.
 */
export function signPackage (bytes: Uint8Array, privateKey: KeyInput, passphrase?: string): string {
  return sign('sha256', bytes, privateKeyOf(privateKey, passphrase)).toString('base64')
}

const base64 = /^[a-z0-9+/]+={0,2}$/i

function decodeBase64 (value: unknown): Buffer | null {
  return typeof value === 'string' && base64.test(value) && value.length % 4 === 0 ? Buffer.from(value, 'base64') : null
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface SignatureFile {
  /** The DER-encoded ECDSA signature. */
  signature: Buffer
  /** `sha256:<hex>` of the signed bytes, when a Sigstore bundle names it. */
  digest: string | null
}

/**
 * Reads the content of a `.sig` file: a base64 signature, or a Sigstore
 * bundle with a message signature (cosign 3's default). `null` for
 * anything else.
 */
export function readSignatureFile (text: string): SignatureFile | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) {
    const signature = decodeBase64(trimmed)
    return signature ? { signature, digest: null } : null
  }
  let bundle: unknown
  try {
    bundle = JSON.parse(trimmed)
  } catch {
    return null
  }
  const message = isRecord(bundle) ? bundle.messageSignature : undefined
  if (!isRecord(bundle) || typeof bundle.mediaType !== 'string' || !bundle.mediaType.startsWith('application/vnd.dev.sigstore.bundle') || !isRecord(message)) {
    return null
  }
  let digest: string | null = null
  if (isRecord(message.messageDigest)) {
    const hash = decodeBase64(message.messageDigest.digest)
    if (message.messageDigest.algorithm !== 'SHA2_256' || !hash) {
      return null
    }
    digest = `sha256:${hash.toString('hex')}`
  }
  const signature = decodeBase64(message.signature)
  return signature ? { signature, digest } : null
}

/**
 * Whether the content of a `.sig` file (see `readSignatureFile`) signs
 * exactly these bytes with this key. Malformed signatures are invalid.
 */
export function verifyPackageSignature (bytes: Uint8Array, signatureFile: string, publicKey: KeyInput): boolean {
  const file = readSignatureFile(signatureFile)
  if (!file || (file.digest && file.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`)) {
    return false
  }
  try {
    return verify('sha256', bytes, publicKeyOf(publicKey), file.signature)
  } catch {
    return false
  }
}

/** `sha256:<hex>` of the key's DER SubjectPublicKeyInfo, to tell keys apart. */
export function keyFingerprint (publicKey: KeyInput): string {
  const der = publicKeyOf(publicKey).export({ type: 'spki', format: 'der' })
  return `sha256:${createHash('sha256').update(der).digest('hex')}`
}
