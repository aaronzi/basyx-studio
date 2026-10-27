// Text files as the viewer reads and writes them: which bytes are text, in
// which encoding, and back to the same bytes when an edit is saved.

/** The encodings the viewer reads and writes; others are read as windows-1252. */
export type TextEncoding = 'utf8' | 'utf8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export interface DecodedText {
  text: string
  /** `null` for a charset the viewer can read but not write back, so the text stays read-only. */
  encoding: TextEncoding | null
}

/** The text view shows files up to this size, and lets them be edited. */
export const textLimit = 10 * 1024 * 1024
/** Of a larger file, the view shows this much, read-only. */
export const truncatedTextLength = 256 * 1024

const sampleLength = 8192

function hasUtf16Bom (bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return 'utf-16le'
  }
  return bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' : null
}

function hasUtf8Bom (bytes: Uint8Array): boolean {
  return bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
}

/**
 * Whether the bytes are text: a UTF-16 byte order mark, or no NUL byte and
 * hardly any control characters in the first 8 KiB. Latin-1 and other 8-bit
 * texts count; their encoding is decided when they are decoded.
 */
export function looksLikeText (bytes: Uint8Array): boolean {
  if (hasUtf16Bom(bytes)) {
    return true
  }
  const sample = bytes.subarray(0, sampleLength)
  let controls = 0
  for (const byte of sample) {
    if (byte === 0) {
      return false
    }
    // Tab, line feed, form feed, carriage return and escape are text.
    if (byte < 0x20 && ![0x09, 0x0A, 0x0C, 0x0D, 0x1B].includes(byte)) {
      controls++
    }
  }
  return controls <= sample.length / 100
}

function charsetOf (contentType: string): string | null {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)
  return match ? match[1]!.toLowerCase() : null
}

/**
 * Decodes text by its byte order mark, then the `charset` of its content
 * type, then as UTF-8 if it is valid UTF-8, else as windows-1252 (which
 * covers Latin-1). Servers may drop the `charset` (BaSyx Go does), so the
 * fallback is what most 8-bit files end up with.
 */
export function decodeText (bytes: Uint8Array, contentType = ''): DecodedText {
  const utf16 = hasUtf16Bom(bytes)
  if (utf16) {
    return { text: new TextDecoder(utf16).decode(bytes.subarray(2)), encoding: utf16 }
  }
  if (hasUtf8Bom(bytes)) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' }
  }
  const charset = charsetOf(contentType)
  if (charset && !['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) { // eslint-disable-line unicorn/text-encoding-identifier-case -- charset labels as content types write them
    // TextDecoder reads ISO-8859-1 as windows-1252, as browsers do.
    try {
      const decoder = new TextDecoder(charset)
      return { text: decoder.decode(bytes), encoding: decoder.encoding === 'windows-1252' ? 'windows-1252' : null }
    } catch {
      // An unknown charset: decided below.
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** windows-1252's characters at 0x80–0x9F; the rest of the range is Latin-1. */
const windows1252High = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'

/** A text the encoding of the file cannot hold. */
export class UnencodableTextError extends Error {
  constructor (readonly encoding: TextEncoding, readonly character: string) {
    super(`The text contains "${character}", which ${encoding} cannot hold.`)
    this.name = 'UnencodableTextError'
  }
}

/** The bytes of a text in an encoding, with the byte order mark it was read with. */
export function encodeText (text: string, encoding: TextEncoding): Uint8Array {
  switch (encoding) {
    case 'utf8': {
      return new TextEncoder().encode(text)
    }
    case 'utf8-bom': {
      const body = new TextEncoder().encode(text)
      const bytes = new Uint8Array(body.length + 3)
      bytes.set([0xEF, 0xBB, 0xBF])
      bytes.set(body, 3)
      return bytes
    }
    case 'utf-16le':
    case 'utf-16be': {
      const bytes = new Uint8Array(2 + text.length * 2)
      const view = new DataView(bytes.buffer)
      const little = encoding === 'utf-16le'
      view.setUint16(0, 0xFE_FF, little)
      for (let i = 0; i < text.length; i++) {
        // UTF-16 code units, surrogates as they are.
        // eslint-disable-next-line unicorn/prefer-code-point
        view.setUint16(2 + i * 2, text.charCodeAt(i), little)
      }
      return bytes
    }
    case 'windows-1252': {
      const bytes = new Uint8Array(text.length)
      let length = 0
      for (const character of text) {
        const code = character.codePointAt(0)!
        const high = windows1252High.indexOf(character)
        if (high !== -1) {
          bytes[length++] = 0x80 + high
        } else if (code < 0x80 || (code >= 0xA0 && code <= 0xFF)) {
          bytes[length++] = code
        } else {
          throw new UnencodableTextError(encoding, character)
        }
      }
      return bytes.subarray(0, length)
    }
  }
}
