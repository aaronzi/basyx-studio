// A glTF may reference buffers and images in files next to it. A File
// element holds one file only, so those cannot be loaded; these helpers find
// them before the model is parsed.

export interface ExternalResources {
  /** Geometry the model cannot be shown without. */
  buffers: string[]
  /** Textures; the model is shown without them. */
  images: string[]
}

const glbMagic = 0x46_54_6C_67 // "glTF", little-endian
const jsonChunk = 0x4E_4F_53_4A // "JSON", little-endian

/** The JSON of a `.gltf` file or of the first chunk of a `.glb`, or `null`. */
export function gltfJson (bytes: Uint8Array): Record<string, unknown> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let text: string
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === glbMagic) {
    const length = view.getUint32(12, true)
    if (view.getUint32(16, true) !== jsonChunk || 20 + length > bytes.byteLength) {
      return null
    }
    text = new TextDecoder().decode(bytes.subarray(20, 20 + length))
  } else {
    text = new TextDecoder().decode(bytes)
  }
  try {
    const json: unknown = JSON.parse(text)
    return json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null
  } catch {
    return null
  }
}

function uris (items: unknown): string[] {
  if (!Array.isArray(items)) {
    return []
  }
  return items
    .map(item => (item && typeof item === 'object' ? (item as { uri?: unknown }).uri : undefined))
    .filter((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'))
}

/** Buffers and images the glTF references by URI instead of embedding them. */
export function externalResources (bytes: Uint8Array): ExternalResources {
  const json = gltfJson(bytes)
  return { buffers: uris(json?.buffers), images: uris(json?.images) }
}
