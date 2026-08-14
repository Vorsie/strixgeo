// Behaviour tests for the lab-sample extent marker geometry.
//
// Owner's words: "a vertical capsule/bar spanning depth_top_m→depth_base_m at
// the exact depths (spot samples where top==base get a minimum visual height
// ~8px)".
//
//   SE1  the marker's two ends sit at the sample's OWN top and base depths —
//        not at its mid-depth.
//   SE2  a spot sample (top == base) still draws, at the minimum height,
//        centred on the depth it was taken at.
//   SE3  a sample too thin to see at the current zoom is opened up to the
//        minimum height, still centred on its own interval.
//   SE4  the marker sits on the column, through the spacing-aware transform.
//   SE5  a borehole with no surface elevation has no vertical position, so it
//        draws no marker.

import { describe, expect, it } from 'vitest'

import { sampleExtentScreenSpan } from './sampleExtentSpan'

/**
 * Screen transform matching the real section: deeper elevation → larger y.
 * 10 px per metre, so a 2 m sample is comfortably taller than the 8 px floor.
 */
const levelToScreenDown = (level: number): number => (100 - level) * 10
/** Column X transform stand-in for warpedXToScreen. */
const warpedX = (along: number): number => along * 2

const column = { along: 10, elevationM: 5 }

describe('sampleExtentScreenSpan — the marker spans the sample, not its midpoint', () => {
  it('SE1: the ends land on the sample top and base depths', () => {
    // Surface at 5 m; sample from 1 m to 3 m below it → elevations 4 and 2.
    const span = sampleExtentScreenSpan(
      { depth_top_m: 1, depth_base_m: 3 },
      column,
      warpedX,
      levelToScreenDown,
      8,
    )!
    expect(span.yTop).toBeCloseTo(960, 6) // elevation 4
    expect(span.yBase).toBeCloseTo(980, 6) // elevation 2
    expect(span.height).toBeCloseTo(20, 6)
    // Emphatically NOT the mid-depth dot the marker replaces (elevation 3 → 970).
    expect(span.yTop).not.toBeCloseTo(970, 6)
  })

  it('SE2: a spot sample still draws, at the minimum height, centred on its depth', () => {
    // Top == base: a spot/disturbed sample taken at one depth.
    const span = sampleExtentScreenSpan(
      { depth_top_m: 2, depth_base_m: 2 },
      column,
      warpedX,
      levelToScreenDown,
      8,
    )!
    expect(span.height).toBeCloseTo(8, 6)
    // Centred on elevation 3 → y 970.
    expect((span.yTop + span.yBase) / 2).toBeCloseTo(970, 6)
  })

  it('SE3: a sample too thin to see is opened to the minimum height about its own interval', () => {
    // 4 cm interval → 0.4 px tall at this scale, far below the 8 px floor.
    const span = sampleExtentScreenSpan(
      { depth_top_m: 1.98, depth_base_m: 2.02 },
      column,
      warpedX,
      levelToScreenDown,
      8,
    )!
    expect(span.height).toBeCloseTo(8, 6)
    expect((span.yTop + span.yBase) / 2).toBeCloseTo(970, 6)
  })

  it('SE4: the marker sits on its column, through the spacing-aware transform', () => {
    const span = sampleExtentScreenSpan(
      { depth_top_m: 1, depth_base_m: 3 },
      column,
      warpedX,
      levelToScreenDown,
      8,
    )!
    // warpedX(10) — the nudged column X, never the raw along-metres.
    expect(span.x).toBe(20)
  })

  it('SE5: no surface elevation → no marker', () => {
    const span = sampleExtentScreenSpan(
      { depth_top_m: 1, depth_base_m: 3 },
      { along: 10, elevationM: null },
      warpedX,
      levelToScreenDown,
      8,
    )
    expect(span).toBeNull()
  })

  it('SE6: an axis drawn the other way up still yields top-above-base', () => {
    // Some callers (and the older unit tests) map elevation straight to y,
    // which runs the axis the other way up; the marker must still report its
    // shallow end as yTop.
    const levelToScreenUp = (level: number): number => level * 10
    const span = sampleExtentScreenSpan(
      { depth_top_m: 1, depth_base_m: 3 },
      column,
      warpedX,
      levelToScreenUp,
      8,
    )!
    expect(span.yTop).toBeLessThan(span.yBase)
    expect(span.height).toBeCloseTo(20, 6)
  })
})
