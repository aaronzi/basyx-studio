import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const version = 'v1'

/**
 * AES-256-GCM encryption for token material and stored secrets at rest. The
 * purpose string is bound as additional authenticated data, so a ciphertext
 * cannot be moved to a column with a different purpose.
 */
export class SecretCipher {
  readonly #key: Buffer

  constructor (key: Buffer) {
    if (key.length !== 32) {
      throw new Error('SecretCipher requires a 32-byte key.')
    }
    this.#key = Buffer.from(key)
  }

  encrypt (plaintext: string, purpose: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv)
    cipher.setAAD(Buffer.from(purpose))
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()])
    return `${version}.${iv.toString('base64url')}.${encrypted.toString('base64url')}`
  }

  decrypt (ciphertext: string, purpose: string): string {
    const [prefix, ivPart, payloadPart] = ciphertext.split('.')
    if (prefix !== version || !ivPart || !payloadPart) {
      throw new Error('Unsupported ciphertext format.')
    }
    const payload = Buffer.from(payloadPart, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(ivPart, 'base64url'))
    decipher.setAAD(Buffer.from(purpose))
    decipher.setAuthTag(payload.subarray(-16))
    return Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]).toString('utf8')
  }
}

export function randomToken (bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256 (value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
