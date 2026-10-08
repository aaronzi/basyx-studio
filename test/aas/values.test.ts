import { describe, expect, it } from 'vitest'
import { withValue } from '~~/server/lib/aas/values'
import { contentHash, parseRevision, revisionOf } from '~~/server/lib/targets/revision'

const property = { idShort: 'Temperature', modelType: 'Property', valueType: 'xs:double', value: '21.5' }
const title = { idShort: 'Title', modelType: 'MultiLanguageProperty', value: [{ language: 'en', text: 'Title' }] }

describe('withValue', () => {
  it('sets and clears Property values', () => {
    expect(withValue(property, '22').json).toMatchObject({ value: '22' })
    expect(withValue(property, null).json).not.toHaveProperty('value')
  })

  it('validates a Property value against its value type', () => {
    expect(() => withValue(property, 'warm')).toThrow(expect.objectContaining({ code: 'validation_failed' }))
  })

  it('sets MultiLanguageProperty values and rejects invalid language tags', () => {
    expect(withValue(title, [{ language: 'de', text: 'Titel' }]).json).toMatchObject({ value: [{ language: 'de', text: 'Titel' }] })
    expect(() => withValue(title, [{ language: 'not a tag', text: 'x' }])).toThrow(expect.objectContaining({ code: 'validation_failed' }))
  })

  it('rejects mismatched value shapes and non-editable elements', () => {
    expect(() => withValue(property, [{ language: 'en', text: 'x' }])).toThrow(expect.objectContaining({ code: 'invalid_request' }))
    expect(() => withValue(title, 'x')).toThrow(expect.objectContaining({ code: 'invalid_request' }))
    expect(() => withValue({ modelType: 'Range', valueType: 'xs:int' }, '1')).toThrow(expect.objectContaining({ code: 'unsupported_operation' }))
  })
})

describe('revision tokens', () => {
  it('hashes content independently of key order', () => {
    expect(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })

  it('parses revisions, quoted or bare', () => {
    const revision = revisionOf({ value: 'x' })
    expect(parseRevision(`"${revision}"`)).toEqual({ hash: contentHash({ value: 'x' }) })
    expect(parseRevision(revision)).toEqual({ hash: contentHash({ value: 'x' }) })
  })

  it('requires a revision and rejects malformed ones', () => {
    expect(() => parseRevision(undefined)).toThrow(expect.objectContaining({ code: 'precondition_required' }))
    for (const value of ['h.short', 'w.1', 'x.1', 'h.', `${revisionOf(1)}.x`]) {
      expect(() => parseRevision(value)).toThrow(expect.objectContaining({ code: 'invalid_request' }))
    }
  })
})
