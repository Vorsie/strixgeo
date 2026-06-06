import { describe, expect, it } from 'vitest'

import { computeScrubBounds } from './scrubBounds'

// The section scrub-bar track must span the RENDERED extent of the
// columns, not their raw projected along-section positions. At low
// ``column_spacing`` the columns pack left (``nudgedX`` lands left of
// ``xToScreen(raw along)``); if the scrub bounds use the raw along, the
// handle lets the engineer scroll the viewport far past the packed
// columns into empty space (dogfeed 2026-06-06).
//
// ``computeScrubBounds`` therefore maps each column's RENDERED screen x
// (``nudgedX``) back through the viewport inverse (``screenXToAlong``) —
// the warp-effective along — and takes the extremes of THOSE.
describe('computeScrubBounds', () => {
  // A simple linear inverse standing in for SectionPanel's
  // ``screenXToAlong``: 2 screen-px per along-metre, no margin offset.
  const screenXToAlong = (screenX: number): number => screenX / 2

  it('falls back to the supplied range when there are no columns', () => {
    expect(computeScrubBounds([], screenXToAlong, { min: 0, max: 137 })).toEqual({
      min: 0,
      max: 137,
    })
  })

  it('bounds the track to the warp-effective along of the packed columns, not the raw along', () => {
    // Raw projected along of the rightmost column is 100 m, but at low
    // spacing it renders packed-left at nudgedX=120 → effective along 60 m.
    // The leftmost renders at nudgedX=20 → effective along 10 m. The scrub
    // MAX must be 60 (the rendered right edge), NOT 100 (raw). If it were
    // 100 the bar would scroll 40 m past the packed columns.
    const columns = [{ nudgedX: 120 }, { nudgedX: 20 }]
    expect(computeScrubBounds(columns, screenXToAlong, { min: 0, max: 999 })).toEqual({
      min: 10,
      max: 60,
    })
  })

  it('collapses to a point for a single column', () => {
    expect(
      computeScrubBounds([{ nudgedX: 84 }], screenXToAlong, { min: 0, max: 999 }),
    ).toEqual({ min: 42, max: 42 })
  })

  it('is insensitive to column order', () => {
    const ascending = [{ nudgedX: 10 }, { nudgedX: 50 }, { nudgedX: 90 }]
    const shuffled = [{ nudgedX: 90 }, { nudgedX: 10 }, { nudgedX: 50 }]
    expect(computeScrubBounds(ascending, screenXToAlong, { min: 0, max: 999 })).toEqual(
      computeScrubBounds(shuffled, screenXToAlong, { min: 0, max: 999 }),
    )
  })
})
