import type { ModelFormat } from '@basyx/model-viewer'
import { detectModelFormat } from '@basyx/model-viewer'
import { looksLikeText } from './text.ts'

// What the viewer shows a file as, from its content type and name, and once
// its bytes are there from what they are. AAS content often declares
// `application/octet-stream` or a wrong type, so the extension and the bytes
// correct it.

export type ViewerKind = 'image' | 'pdf' | 'text' | 'model3d' | 'video' | 'audio' | 'none'

/** A Monaco language the text view highlights. */
export type TextLanguage
  = | 'plaintext' | 'json' | 'xml' | 'yaml' | 'markdown' | 'html' | 'css' | 'javascript' | 'typescript' | 'python'
    | 'cpp' | 'csharp' | 'java' | 'go' | 'rust' | 'shell' | 'powershell' | 'sql' | 'ini' | 'st' | 'dockerfile'

/** A second way to show a text: rendered Markdown, a CSV table, an SVG image. */
export type AlternateView = 'markdown' | 'csv' | 'svg'

export interface ViewerKindInfo {
  kind: ViewerKind
  /** The language of the text, also of an SVG's source. */
  language: TextLanguage
  alternate: AlternateView | null
  /** The 3D format of a `model3d` file. */
  modelFormat: ModelFormat | null
  /** The CSV delimiter a TSV file declares. */
  delimiter: string | null
}

const extensionLanguages: Record<string, TextLanguage> = {
  txt: 'plaintext',
  log: 'plaintext',
  text: 'plaintext',
  nc: 'plaintext',
  gcode: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
  json: 'json',
  jsonld: 'json',
  geojson: 'json',
  xml: 'xml',
  xsd: 'xml',
  aml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  toml: 'ini',
  properties: 'ini',
  env: 'ini',
  st: 'st',
  dockerfile: 'dockerfile',
}

const typeLanguages: Record<string, TextLanguage> = {
  'application/json': 'json',
  'application/ld+json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'application/typescript': 'typescript',
  'text/x-python': 'python',
  'application/x-sh': 'shell',
  'application/sql': 'sql',
  'application/toml': 'ini',
}

/** Text types that are neither `text/*` nor in `typeLanguages`. */
const otherTextTypes = new Set(['application/csv', 'application/graphql'])

/** `text/plain; charset=…` → `text/plain`. */
export function mediaType (contentType: string): string {
  return contentType.split(';', 1)[0]!.trim().toLowerCase()
}

/** The extension of a file name or path, lower case, or `''`; a name like `Dockerfile` is its own extension. */
export function extensionOf (fileName: string): string {
  const name = fileName.split(/[/\\]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    return name.slice(dot + 1).toLowerCase()
  }
  return name.toLowerCase() === 'dockerfile' ? 'dockerfile' : ''
}

function languageOf (type: string, extension: string): TextLanguage {
  if (type.endsWith('+json')) {
    return 'json'
  }
  if (type.endsWith('+xml')) {
    return 'xml'
  }
  return extensionLanguages[extension] ?? typeLanguages[type] ?? 'plaintext'
}

function alternateOf (type: string, extension: string, language: TextLanguage): AlternateView | null {
  if (language === 'markdown') {
    return 'markdown'
  }
  if (['text/csv', 'application/csv', 'text/tab-separated-values'].includes(type) || extension === 'csv' || extension === 'tsv') {
    return 'csv'
  }
  return null
}

function text (type: string, extension: string): ViewerKindInfo {
  const language = languageOf(type, extension)
  const tsv = type === 'text/tab-separated-values' || extension === 'tsv'
  return { kind: 'text', language, alternate: alternateOf(type, extension, language), modelFormat: null, delimiter: tsv ? '\t' : null }
}

function info (kind: ViewerKind, extra: Partial<ViewerKindInfo> = {}): ViewerKindInfo {
  return { kind, language: 'plaintext', alternate: null, modelFormat: null, delimiter: null, ...extra }
}

const svg = (): ViewerKindInfo => info('image', { language: 'xml', alternate: 'svg' })

/** What a file is shown as before its bytes are read, e.g. to offer the view or draw an icon. */
export function detectViewerKind (file: { contentType: string | null | undefined, fileName: string | null | undefined }): ViewerKindInfo {
  const type = mediaType(file.contentType ?? '')
  const fileName = file.fileName ?? ''
  const extension = extensionOf(fileName)
  const modelFormat = detectModelFormat({ contentType: type || null, fileName })
  if (modelFormat) {
    return info('model3d', { modelFormat })
  }
  if (type === 'image/svg+xml' || (extension === 'svg' && !type.startsWith('image/'))) {
    return svg()
  }
  if (type === 'application/pdf') {
    return info('pdf')
  }
  // TIFF is the image type browsers do not draw.
  if (type.startsWith('image/') && type !== 'image/tiff') {
    return info('image')
  }
  if (type.startsWith('video/')) {
    return info('video')
  }
  if (type.startsWith('audio/')) {
    return info('audio')
  }
  if (type.startsWith('text/') || type in typeLanguages || otherTextTypes.has(type) || type.endsWith('+json') || type.endsWith('+xml')) {
    return text(type, extension)
  }
  // A generic or unknown type: the extension decides.
  if (extension === 'pdf') {
    return info('pdf')
  }
  if (extension in extensionLanguages) {
    return text(type, extension)
  }
  return info('none')
}

/** The kind the bytes' signature shows, or `null` when they have none the viewer knows. */
function sniff (bytes: Uint8Array): 'pdf' | 'image' | 'svg' | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2D)) {
    return 'pdf'
  }
  // A BMP's info header is 12 to 124 bytes long; "BM" alone also starts texts.
  const bmp = starts(0x42, 0x4D) && [12, 40, 52, 56, 64, 108, 124].includes(bytes[14] ?? 0) && bytes[15] === 0 && bytes[16] === 0 && bytes[17] === 0
  if (starts(0x89, 0x50, 0x4E, 0x47) || starts(0xFF, 0xD8, 0xFF) || starts(0x47, 0x49, 0x46, 0x38) || bmp
    || (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) {
    return 'image'
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) ? 'svg' : null
}

/**
 * The kind once the bytes are there: an image or PDF whose bytes are none
 * but text shows as text, a declared text that is binary shows nothing, and
 * a file of an unknown type that is text shows as text.
 */
export function refineViewerKind (detected: ViewerKindInfo, bytes: Uint8Array, fileName: string | null | undefined): ViewerKindInfo {
  const extension = extensionOf(fileName ?? '')
  const signature = sniff(bytes)
  switch (detected.kind) {
    case 'image':
    case 'pdf': {
      if (detected.alternate === 'svg' || signature === detected.kind) {
        return detected
      }
      if (signature === 'svg') {
        return svg()
      }
      if (signature) {
        return info(signature)
      }
      return looksLikeText(bytes) ? text('', extension) : detected
    }
    case 'text': {
      return looksLikeText(bytes) ? detected : info('none')
    }
    case 'none': {
      if (signature === 'svg') {
        return svg()
      }
      if (signature) {
        return info(signature)
      }
      return bytes.length > 0 && looksLikeText(bytes) ? text('', extension) : detected
    }
    default: {
      return detected
    }
  }
}

/** The icon of a kind (Material Design Icons), as in the viewer's toolbar and thumbnails. */
export function viewerKindIcon (detected: ViewerKindInfo): string {
  switch (detected.kind) {
    case 'image': {
      return 'mdi-file-image-outline'
    }
    case 'pdf': {
      return 'mdi-file-pdf-box'
    }
    case 'model3d': {
      return 'mdi-cube-outline'
    }
    case 'video': {
      return 'mdi-file-video-outline'
    }
    case 'audio': {
      return 'mdi-file-music-outline'
    }
    case 'text': {
      if (detected.alternate === 'csv') {
        return 'mdi-file-table-outline'
      }
      if (detected.language === 'markdown') {
        return 'mdi-language-markdown-outline'
      }
      return detected.language === 'plaintext' ? 'mdi-file-document-outline' : 'mdi-file-code-outline'
    }
    default: {
      return 'mdi-file-outline'
    }
  }
}
