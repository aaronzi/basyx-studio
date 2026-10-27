import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { detectViewerKind, refineViewerKind } from '../../packages/file-viewer/src/kinds'
import { decodeText, encodeText } from '../../packages/file-viewer/src/text'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// The file viewer's content as a live target serves it (ADR 0052), on
// `FilePreviewsDemo` (test-setup/fixtures/open/studio-file-previews.aasx):
// what files are shown as once read, files at other addresses, missing
// files, and saving a Blob's text with its revision.

const formats = 'urn:studio:test:sm:file-previews:file-formats'
/** A submodel only this file writes to (BaSyx Go shares one ETag per submodel). */
const writes = 'urn:studio:test:sm:file-viewer-writes'
const encode = (id: string) => Buffer.from(id).toString('base64url')

describe.runIf(testenvAvailable)('File viewer content from a live target', () => {
  const target = () => new LiveAasTarget({
    record: record(openTargetUrl, { mode: 'unsecured' }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl, { maxResponseBytes: 50_000_000 }),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })

  /** What the viewer shows a File element of the fixture as, with its bytes. */
  async function shown (path: string) {
    const live = target()
    const { value } = await live.element(formats, path)
    const file = await live.attachment(formats, path)
    const detected = detectViewerKind({ contentType: String(value.contentType), fileName: String(value.value) })
    return { file, info: refineViewerKind(detected, file.bytes, String(value.value)), contentType: String(value.contentType) }
  }

  beforeAll(async () => {
    await fetch(`${openTargetUrl}/submodels/${encode(writes)}`, { method: 'DELETE' })
    const created = await fetch(`${openTargetUrl}/submodels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelType: 'Submodel',
        id: writes,
        idShort: 'FileViewerWrites',
        submodelElements: [{ modelType: 'Blob', idShort: 'Notes', contentType: 'text/markdown', value: Buffer.from('# Notes\n').toString('base64') }],
      }),
    })
    expect(created.status).toBe(201)
  })

  afterAll(async () => {
    await fetch(`${openTargetUrl}/submodels/${encode(writes)}`, { method: 'DELETE' })
  })

  it('shows texts by their type, extension and bytes', async () => {
    expect((await shown('Text.Markdown')).info).toMatchObject({ kind: 'text', alternate: 'markdown' })
    expect((await shown('Text.CsvSemicolon')).info).toMatchObject({ kind: 'text', alternate: 'csv' })
    expect((await shown('Detection.MarkdownAsOctetStream')).info).toMatchObject({ kind: 'text', alternate: 'markdown' })
    expect((await shown('Detection.TextAsPng')).info.kind).toBe('text')
    expect((await shown('Detection.BinaryAsText')).info.kind).toBe('none')
    expect((await shown('Documents.PdfMultiPage')).info.kind).toBe('pdf')
    expect((await shown('Images.Svg')).info).toMatchObject({ kind: 'image', alternate: 'svg' })
  })

  it('decodes Latin-1 whose charset the server dropped, and UTF-16 by its byte order mark', async () => {
    const latin1 = await shown('Detection.Latin1')
    // BaSyx Go keeps `text/plain` without `; charset=ISO-8859-1`.
    expect(latin1.contentType).toBe('text/plain')
    expect(decodeText(latin1.file.bytes, latin1.contentType)).toMatchObject({ encoding: 'windows-1252', text: expect.stringContaining('Größe') })
    expect(decodeText((await shown('Detection.Utf16')).file.bytes)).toMatchObject({ encoding: 'utf-16le', text: expect.stringContaining('Grüße') })
  })

  it('refuses the attachment of a File at another address, which the viewer reads as an external file', async () => {
    await expect(target().attachment(formats, 'External.TextNoCors')).rejects.toMatchObject({ code: 'unsupported_operation' })
  })

  it('reports Files without content as missing', async () => {
    await expect(target().attachment(formats, 'Missing.EmptyValue')).rejects.toMatchObject({ code: 'target_resource_not_found' })
    await expect(target().attachment(formats, 'Missing.NotOnServer')).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })

  it('reads Blobs with their value, a 3D model among them', async () => {
    const { value } = await target().element(formats, 'Blobs.StlBlob')
    const bytes = new Uint8Array(Buffer.from(String(value.value), 'base64'))
    expect(refineViewerKind(detectViewerKind({ contentType: String(value.contentType), fileName: 'StlBlob.stl' }), bytes, 'StlBlob.stl')).toMatchObject({ kind: 'model3d', modelFormat: 'stl' })
  })

  it('saves a Blob\'s text with its revision and refuses a stale one', async () => {
    const live = target()
    const before = await live.element(writes, 'Notes')
    const text = `${decodeText(new Uint8Array(Buffer.from(String(before.value.value), 'base64'))).text}Edited in the viewer.\n`
    const element = { ...before.value, value: Buffer.from(encodeText(text, 'utf8')).toString('base64') }
    await live.replaceElement(writes, 'Notes', element, before.revision)
    const after = await live.element(writes, 'Notes')
    expect(Buffer.from(String(after.value.value), 'base64').toString('utf8')).toBe('# Notes\nEdited in the viewer.\n')
    await expect(live.replaceElement(writes, 'Notes', element, before.revision)).rejects.toMatchObject({ code: 'revision_conflict' })
  })
})
