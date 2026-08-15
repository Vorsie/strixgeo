import { describe, expect, it } from 'vitest'

import { getGeotechFillVisible, toggleGeotechFill } from './geotechFillStore'

describe('geotechFillStore', () => {
  it('defaults to HIDDEN — the NAD fill is never turned on by a pipeline press', () => {
    // RE-PINNED 2026-08-15. The old pin encoded "defaults to visible (NAD bands
    // shown)". Owner, on auto-correlate: "when clicking auto correlate, the
    // fill should start as standard off too" — step 2 creates the first
    // accepted ties, and with a default-on toggle that alone made the packing
    // fill appear by itself. Showing the fill is the engineer's press, always.
    expect(getGeotechFillVisible()).toBe(false)
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(true)
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(false)
  })
})
