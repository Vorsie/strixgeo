// Tests for the section warp inverse (zoom-to-cursor "spacing" fix).
//
//   W1  no anchors → returns the linear fallback unchanged (spacing=1 path).
//   W2  identity warp (effX == linear screen X) → inverse recovers the linear
//       along-distance, i.e. zoom-to-cursor is unchanged when nothing is packed.
//   W3  packed warp (effX detached from along) → the along under the cursor is
//       the PACKED column's along, not the linear guess (the actual bug).
//   W4  round-trips the forward map at several interior pixels.
//   W5  extrapolates left/right of the column range at true scale.

import { describe, expect, it } from 'vitest'
import { warpedScreenXToAlong, type WarpAnchor } from './sectionWarp'

describe('warpedScreenXToAlong — zoom-to-cursor spacing inverse', () => {
  it('W1 — no anchors returns the linear fallback', () => {
    expect(warpedScreenXToAlong(123, [], 10, 42)).toBe(42)
  })

  it('W2 — identity warp recovers the linear along-distance', () => {
    // Columns drawn exactly where the linear map puts them: effX = origin +
    // (along - xMin) * scaleH. Pick origin=0, xMin=0, scaleH=2 px/m.
    const scaleH = 2
    const anchors: WarpAnchor[] = [
      { along: 0, effX: 0 },
      { along: 50, effX: 100 },
      { along: 100, effX: 200 },
    ]
    // px=150 → linear along = 150/2 = 75. Inverse must agree.
    expect(warpedScreenXToAlong(150, anchors, scaleH, -999)).toBeCloseTo(75, 6)
  })

  it('W3 — packed warp anchors on the column actually drawn under the cursor', () => {
    // Spacing<1: three columns at true along 0, 50, 100 but PACKED edge-to-edge
    // at screen X 300, 320, 340 (20 px apart). The cursor at px=320 is over the
    // MIDDLE column, whose true along is 50 — NOT the linear guess (which, with
    // scaleH=2 and xMin=0, would read 320/2 = 160, way off the section).
    const anchors: WarpAnchor[] = [
      { along: 0, effX: 300 },
      { along: 50, effX: 320 },
      { along: 100, effX: 340 },
    ]
    expect(warpedScreenXToAlong(320, anchors, 2, 160)).toBeCloseTo(50, 6)
    // Halfway between the first two packed columns (px=310) → along 25.
    expect(warpedScreenXToAlong(310, anchors, 2, 999)).toBeCloseTo(25, 6)
  })

  it('W4 — round-trips the forward warp at interior pixels', () => {
    const anchors: WarpAnchor[] = [
      { along: 10, effX: 100 },
      { along: 30, effX: 140 }, // 2 px/m here
      { along: 80, effX: 160 }, // 0.4 px/m here (heavily packed segment)
    ]
    // Forward map for an interior along (mirror of warpedXToScreen).
    const fwd = (along: number): number => {
      let i = 0
      while (i < anchors.length - 1 && anchors[i + 1].along < along) i += 1
      const a = anchors[i]
      const b = anchors[i + 1]
      const frac = (along - a.along) / (b.along - a.along)
      return a.effX + frac * (b.effX - a.effX)
    }
    for (const along of [12, 30, 55, 79]) {
      expect(warpedScreenXToAlong(fwd(along), anchors, 5, -1)).toBeCloseTo(along, 6)
    }
  })

  it('W5 — extrapolates beyond the column range at true scale', () => {
    const anchors: WarpAnchor[] = [
      { along: 20, effX: 200 },
      { along: 40, effX: 240 },
    ]
    const scaleH = 4 // px per metre outside the range
    // 40 px left of the first column → 10 m left of along=20 → along=10.
    expect(warpedScreenXToAlong(160, anchors, scaleH, 0)).toBeCloseTo(10, 6)
    // 80 px right of the last column → 20 m right of along=40 → along=60.
    expect(warpedScreenXToAlong(320, anchors, scaleH, 0)).toBeCloseTo(60, 6)
  })
})
