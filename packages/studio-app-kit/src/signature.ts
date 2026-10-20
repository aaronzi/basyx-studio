import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto'

// Detached package signatures (external apps plan U1, ADR 0043): ECDSA
// P-256 with SHA-256 over the exact bytes of `<package>.zip`, DER-encoded and
// base64, in `<package>.zip.sig`. This is the format `cosign sign-blob --key`
// writes and `cosign verify-blob --key` reads, so a team can sign with
// either tool.

export const signatureExtension = '.sig'

/** A key in PEM form, or a key object. */
export type KeyInput = string | Uint8Array | KeyObject

function p256 (key: KeyObject, role: string): KeyObject {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`The ${role} is not an ECDSA P-256 key.`)
  }
  return key
}

function privateKeyOf (key: KeyInput, passphrase?: string): KeyObject {
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

/** Whether `signature` (base64, surrounding whitespace ignored) signs exactly these bytes with this key. */
export function verifyPackageSignature (bytes: Uint8Array, signature: string, publicKey: KeyInput): boolean {
  const text = signature.trim()
  if (!/^[a-z0-9+/]+={0,2}$/i.test(text)) {
    return false
  }
  try {
    return verify('sha256', bytes, publicKeyOf(publicKey), Buffer.from(text, 'base64'))
  } catch {
    return false
  }
}

/** `sha256:<hex>` of the key's DER SubjectPublicKeyInfo, to tell keys apart. */
export function keyFingerprint (publicKey: KeyInput): string {
  const der = publicKeyOf(publicKey).export({ type: 'spki', format: 'der' })
  return `sha256:${createHash('sha256').update(der).digest('hex')}`
}
