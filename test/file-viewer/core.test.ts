import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from '../../packages/file-viewer/src/csv'
import { detectViewerKind, refineViewerKind } from '../../packages/file-viewer/src/kinds'
import { markdownToHtml } from '../../packages/file-viewer/src/markdown'
import { decodeText, encodeText, looksLikeText, UnencodableTextError } from '../../packages/file-viewer/src/text'

// The file viewer's core (packages/file-viewer, ADR 0052): what a file is
// shown as, its text, CSV tables and Markdown.

const bytes = (text: string) => new TextEncoder().encode(text)

describe('detectViewerKind', () => {
  it('reads the kind from the content type', () => {
    expect(detectViewerKind({ contentType: 'application/pdf', fileName: 'manual.pdf' }).kind).toBe('pdf')
    expect(detectViewerKind({ contentType: 'image/png', fileName: 'a.png' }).kind).toBe('image')
    expect(detectViewerKind({ contentType: 'image/tiff', fileName: 'a.tif' }).kind).toBe('none')
    expect(detectViewerKind({ contentType: 'audio/wav', fileName: 'tone.wav' }).kind).toBe('audio')
    expect(detectViewerKind({ contentType: 'model/stl', fileName: 'part.stl' })).toMatchObject({ kind: 'model3d', modelFormat: 'stl' })
  })

  it('gives texts their language and second view, by type or extension', () => {
    expect(detectViewerKind({ contentType: 'application/json', fileName: 'a.json' })).toMatchObject({ kind: 'text', language: 'json', alternate: null })
    expect(detectViewerKind({ contentType: 'application/ld+json', fileName: 'x' })).toMatchObject({ kind: 'text', language: 'json' })
    expect(detectViewerKind({ contentType: 'text/markdown', fileName: 'notes.md' })).toMatchObject({ language: 'markdown', alternate: 'markdown' })
    expect(detectViewerKind({ contentType: 'text/csv', fileName: 'm.csv' })).toMatchObject({ alternate: 'csv', delimiter: null })
    expect(detectViewerKind({ contentType: 'text/tab-separated-values', fileName: 'p.tsv' })).toMatchObject({ alternate: 'csv', delimiter: '\t' })
    expect(detectViewerKind({ contentType: 'text/plain', fileName: 'controller.ini' })).toMatchObject({ kind: 'text', language: 'ini' })
    expect(detectViewerKind({ contentType: 'text/plain; charset=ISO-8859-1', fileName: 'a.txt' })).toMatchObject({ kind: 'text', language: 'plaintext' })
    // A generic type: the extension decides.
    expect(detectViewerKind({ contentType: 'application/octet-stream', fileName: 'README.md' })).toMatchObject({ kind: 'text', alternate: 'markdown' })
    expect(detectViewerKind({ contentType: 'application/octet-stream', fileName: 'firmware.bin' }).kind).toBe('none')
  })

  it('shows an SVG as an image with its source', () => {
    expect(detectViewerKind({ contentType: 'image/svg+xml', fileName: 'd.svg' })).toMatchObject({ kind: 'image', alternate: 'svg', language: 'xml' })
  })
})

describe('refineViewerKind', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  it('trusts matching bytes', () => {
    expect(refineViewerKind(detectViewerKind({ contentType: 'image/png', fileName: 'a.png' }), png, 'a.png').kind).toBe('image')
  })

  it('shows text declared as an image as text', () => {
    const declared = detectViewerKind({ contentType: 'image/png', fileName: 'mislabelled.txt' })
    expect(refineViewerKind(declared, bytes('Just text.\n'), 'mislabelled.txt')).toMatchObject({ kind: 'text', language: 'plaintext' })
  })

  it('shows no text for binary declared as text', () => {
    const binary = new Uint8Array([1, 2, 0, 3, 250, 251])
    expect(refineViewerKind(detectViewerKind({ contentType: 'text/plain', fileName: 'firmware.bin' }), binary, 'firmware.bin').kind).toBe('none')
  })

  it('finds text, PDFs and SVGs in files of unknown type', () => {
    const unknown = detectViewerKind({ contentType: 'application/octet-stream', fileName: 'LICENSE' })
    expect(refineViewerKind(unknown, bytes('Permission is granted.\n'), 'LICENSE').kind).toBe('text')
    expect(refineViewerKind(unknown, bytes('%PDF-1.4\n'), 'LICENSE').kind).toBe('pdf')
    expect(refineViewerKind(unknown, bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x')).toMatchObject({ kind: 'image', alternate: 'svg' })
    // "BM" alone is no BMP.
    expect(refineViewerKind(unknown, bytes('BMW drive train\n'), 'x').kind).toBe('text')
  })
})

describe('text', () => {
  it('tells text from binary', () => {
    expect(looksLikeText(bytes('a\tb\r\nc'))).toBe(true)
    expect(looksLikeText(new Uint8Array([0x47, 0x00, 0x41]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0xFF, 0xFE, 0x41, 0x00]))).toBe(true)
  })

  it('decodes by byte order mark, charset, UTF-8, else windows-1252', () => {
    expect(decodeText(bytes('Grüße'))).toEqual({ text: 'Grüße', encoding: 'utf8' })
    expect(decodeText(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41]))).toEqual({ text: 'A', encoding: 'utf8-bom' })
    expect(decodeText(new Uint8Array([0xFF, 0xFE, 0x41, 0x00, 0xFC, 0x00]))).toEqual({ text: 'Aü', encoding: 'utf-16le' })
    // Latin-1 without a charset, as BaSyx Go serves it.
    expect(decodeText(new Uint8Array([0x47, 0x72, 0xF6, 0xDF, 0x65]))).toEqual({ text: 'Größe', encoding: 'windows-1252' })
    expect(decodeText(new Uint8Array([0x80]), 'text/plain; charset=ISO-8859-1')).toEqual({ text: '€', encoding: 'windows-1252' })
    // Readable, but not written back.
    expect(decodeText(new Uint8Array([0x82, 0xA0]), 'text/plain; charset=shift_jis').encoding).toBeNull()
  })

  it('encodes back into the same bytes', () => {
    for (const [text, encoding] of [['Grüße €', 'utf8'], ['A', 'utf8-bom'], ['Aü日', 'utf-16le'], ['Aü日', 'utf-16be'], ['Größe €', 'windows-1252']] as const) {
      expect(decodeText(encodeText(text, encoding))).toEqual({ text, encoding })
    }
  })

  it('refuses characters the encoding cannot hold', () => {
    expect(() => encodeText('日本', 'windows-1252')).toThrow(UnencodableTextError)
  })
})

describe('CSV', () => {
  it('guesses the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',')
    expect(detectDelimiter('a;b;c\n"1,5";2;3\n')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t')
  })

  it('parses quoted fields with delimiters, quotes and line breaks', () => {
    const table = parseCsv('Artikel;Bezeichnung;Preis\r\n4711;"Winkel; verzinkt";2,49\n4712;"Winkel ""Edelstahl""";"zwei\nZeilen"\n')
    expect(table.delimiter).toBe(';')
    expect(table.rows).toEqual([
      ['Artikel', 'Bezeichnung', 'Preis'],
      ['4711', 'Winkel; verzinkt', '2,49'],
      ['4712', 'Winkel "Edelstahl"', 'zwei\nZeilen'],
    ])
    expect(table.truncated).toBe(false)
  })

  it('takes a declared delimiter and stops after the row limit', () => {
    expect(parseCsv('a,b\t1', '\t').rows).toEqual([['a,b', '1']])
    const long = parseCsv(`h\n${'1\n'.repeat(10_005)}`)
    expect(long.rows).toHaveLength(10_001)
    expect(long.truncated).toBe(true)
  })
})

describe('Markdown', () => {
  it('renders with Vuetify classes and Vuetify table markup', () => {
    const html = markdownToHtml('# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(html).toContain('<h1 class="text-headline-medium')
    expect(html).toContain('<div class="v-table')
  })

  it('shows raw HTML as text and keeps only http(s) and mailto links', () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://example.com) [z](relative/path)')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<a href="https://example.com" class="text-primary" target="_blank" rel="noopener noreferrer">y</a>')
    expect(html).not.toContain('href="relative/path"')
  })

  it('loads no images from other hosts', () => {
    const html = markdownToHtml('![logo](https://example.com/logo.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://example.com/logo.png"')
  })
})
