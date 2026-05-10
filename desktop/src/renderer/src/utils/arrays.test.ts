import { describe, expect, it } from 'vitest'

import { arraysEqual } from './arrays'

describe('arraysEqual', () => {
  it('returns true for the same reference', () => {
    const a = ['x', 'y']
    expect(arraysEqual(a, a)).toBe(true)
  })

  it('returns true for equal-by-value arrays', () => {
    expect(arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true)
  })

  it('returns false on length mismatch', () => {
    expect(arraysEqual(['a'], ['a', 'b'])).toBe(false)
  })

  it('returns false on positional mismatch', () => {
    // Same elements, different order — positional, so unequal.
    expect(arraysEqual(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('returns true for two empty arrays', () => {
    expect(arraysEqual([], [])).toBe(true)
  })
})
