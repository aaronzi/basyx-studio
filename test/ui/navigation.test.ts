import { describe, expect, it } from 'vitest'
import { sectionOf } from '~~/app/stores/navigation'
import { phoneNavLayout } from '~~/app/utils/navigation'

describe('navigation sections', () => {
  it('resumes the submodel view as a section of its own', () => {
    expect(sectionOf('/targets/t1/submodels')).toBe('submodels:t1')
    expect(sectionOf('/targets/t1/shells/abc')).toBe('shells:t1')
    expect(sectionOf('/targets/t1/concepts')).toBe('concepts:t1')
    expect(sectionOf('/targets/t1')).toBe('dashboard:t1')
  })
})

describe('the phones\' bottom bar', () => {
  const layout = (keys: string[], slots?: number) => {
    const result = phoneNavLayout(keys, key => key === 'shells', slots)
    return { start: result.start, centre: result.centre, end: result.end, more: result.more }
  }

  it('raises Shells in the middle of five equal slots', () => {
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts'])).toEqual({
      start: ['targets', 'dashboard'],
      centre: 'shells',
      end: ['submodels', 'concepts'],
      more: [],
    })
    // A missing item leaves its slot empty instead of widening another.
    expect(layout(['targets', 'dashboard', 'shells', 'submodels'])).toEqual({ start: ['targets', 'dashboard'], centre: 'shells', end: ['submodels', null], more: [] })
  })

  it('opens the items that do not fit from the last slot, which is one slot wide', () => {
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts', 'app'])).toEqual({
      start: ['targets', 'dashboard'],
      centre: 'shells',
      end: ['submodels'],
      more: ['concepts', 'app'],
    })
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts'], 3)).toEqual({ start: ['targets'], centre: 'shells', end: [], more: ['dashboard', 'submodels', 'concepts'] })
  })

  it('has no raised item outside a target', () => {
    expect(layout(['targets', 'global-app'])).toEqual({ start: ['targets', 'global-app'], centre: null, end: [], more: [] })
    expect(layout(['targets', 'a', 'b', 'c', 'd', 'e'])).toEqual({ start: ['targets', 'a', 'b', 'c'], centre: null, end: [], more: ['d', 'e'] })
  })
})
