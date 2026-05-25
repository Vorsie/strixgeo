import { describe, expect, it } from 'vitest'

import { formatNadClass } from './formatNadClass'

describe('formatNadClass', () => {
  it('returns "NAD n" when range is a singleton (lo === hi)', () => {
    expect(formatNadClass([5, 5], null)).toBe('NAD 5')
  })

  it('returns "NAD lo–hi" when range has distinct bounds', () => {
    expect(formatNadClass([1, 3], null)).toBe('NAD 1–3')
    expect(formatNadClass([3, 7], null)).toBe('NAD 3–7')
  })

  it('falls back to "NAD n" from scalar when range is null', () => {
    expect(formatNadClass(null, 6)).toBe('NAD 6')
  })

  it('falls back to scalar when range is undefined', () => {
    expect(formatNadClass(undefined, 6)).toBe('NAD 6')
  })

  it('returns null when both range and scalar are null', () => {
    expect(formatNadClass(null, null)).toBeNull()
  })

  it('returns null when both range and scalar are undefined', () => {
    expect(formatNadClass(undefined, undefined)).toBeNull()
  })

  it('range wins over non-null scalar when both are provided', () => {
    // range takes precedence — the scalar may be the weighted-mean
    // of the range, which is less informative than the range itself.
    expect(formatNadClass([3, 7], 5)).toBe('NAD 3–7')
  })
})
