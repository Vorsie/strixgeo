import { describe, expect, it } from 'vitest'

import {
  clearBoreholesStale,
  getBoreholesStale,
  markBoreholesStale,
} from './boreholesStaleStore'

describe('boreholesStaleStore', () => {
  it('defaults to not stale, marks stale, and clears', () => {
    clearBoreholesStale() // ensure a known starting point (module-global)
    expect(getBoreholesStale()).toBe(false)
    markBoreholesStale()
    expect(getBoreholesStale()).toBe(true)
    // Idempotent mark.
    markBoreholesStale()
    expect(getBoreholesStale()).toBe(true)
    clearBoreholesStale()
    expect(getBoreholesStale()).toBe(false)
  })
})
