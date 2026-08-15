// The rule that decides WHICH fills read as "correlate me" on the geotech axis.
//
// Owner ruling 2026-08-14, verbatim: "sure read as correlate me on the extra
// ruling is fine" — an area the packing model has no bands for must stop
// impersonating a second shade of the same soil and instead read as unfinished
// ground. Both truths stay on screen: the classified band keeps its class, the
// un-banded area keeps its lithology hue and gains the progress texture.
//
// Pinned claims:
//   UG1  On the geotech axis only the UN-BANDED fills are marked; a fill the
//        packing model does cover is never marked.
//   UG2  Off the geotech axis nothing is marked — the litho axis is untouched.
//   UG3  When the geotech partition is not framed by the litho model — the
//        "Show litho fill" view, where the litho model IS the fill — nothing is
//        marked: that view is a deliberate lithology view.
//   UG4  Order and identity of the caller's own objects survive the rule.

import { describe, expect, it } from 'vitest'

import {
  UNBANDED_HATCH_INK,
  UNBANDED_HATCH_LABEL,
  UNBANDED_HATCH_PATTERN_ID,
  UNBANDED_HATCH_SPACING_PX,
  UNBANDED_HATCH_STROKE_OPACITY,
  UNBANDED_HATCH_STROKE_WIDTH,
  selectUnbandedHatchFills,
  type HatchCandidateFill,
} from './unbandedGeotechHatch'

const CANDIDATES: HatchCandidateFill[] = [
  { key: 'pf-group-0', d: 'M 0,0 L 10,0 L 10,10 Z', kind: 'packed' },
  { key: 'lf-0', d: 'M 0,10 L 10,10 L 10,20 Z', kind: 'unbanded' },
  { key: 'pf-group-1', d: 'M 20,0 L 30,0 L 30,10 Z', kind: 'packed' },
  { key: 'lf-1', d: 'M 20,10 L 30,10 L 30,20 Z', kind: 'unbanded' },
]

describe('selectUnbandedHatchFills — "read as correlate me"', () => {
  it('UG1 — marks the un-banded fills and only those', () => {
    const out = selectUnbandedHatchFills({
      axisMode: 'geotechnical',
      geotechPartitionFramed: true,
      candidates: CANDIDATES,
    })
    expect(out.map((f) => f.key)).toEqual(['lf-0', 'lf-1'])
  })

  it('UG2 — the litho axis gets nothing', () => {
    for (const axisMode of ['lithostratigraphic', 'geological', undefined] as const) {
      expect(
        selectUnbandedHatchFills({
          axisMode,
          geotechPartitionFramed: true,
          candidates: CANDIDATES,
        }),
      ).toEqual([])
    }
  })

  it('UG3 — an un-framed geotech partition ("Show litho fill") gets nothing', () => {
    expect(
      selectUnbandedHatchFills({
        axisMode: 'geotechnical',
        geotechPartitionFramed: false,
        candidates: CANDIDATES,
      }),
    ).toEqual([])
  })

  it('UG4 — the caller keeps its own geometry, key and order', () => {
    const out = selectUnbandedHatchFills({
      axisMode: 'geotechnical',
      geotechPartitionFramed: true,
      candidates: [CANDIDATES[3], CANDIDATES[1]],
    })
    expect(out).toEqual([
      { key: 'lf-1', d: 'M 20,10 L 30,10 L 30,20 Z' },
      { key: 'lf-0', d: 'M 0,10 L 10,10 L 10,20 Z' },
    ])
  })

  it('— the texture is quiet, and unmistakable against the "not committed yet" ghosts', () => {
    // The section canvas already spends the 45° black hatch twice: the litho
    // pending ghosts and the geotech borehole-preview ghosts (6 px / 3 px, black,
    // stroke 1.4, opacity 0.28-0.38), and the DOV clay pattern is a 45° hatch too.
    // This one runs the OTHER way, wider and lighter, so it can never be read as
    // "not committed yet" or as clay.
    expect(UNBANDED_HATCH_PATTERN_ID).toBe('partition-unbanded-hatch')
    expect(UNBANDED_HATCH_SPACING_PX).toBeGreaterThan(6)
    expect(UNBANDED_HATCH_STROKE_WIDTH).toBeLessThan(1.4)
    expect(UNBANDED_HATCH_STROKE_OPACITY).toBeLessThan(0.28)
    expect(UNBANDED_HATCH_INK).not.toBe('#000000')
  })

  it('— the label says what is TRUE, and never says "fallback"', () => {
    expect(UNBANDED_HATCH_LABEL.toLowerCase()).not.toContain('fallback')
    expect(UNBANDED_HATCH_LABEL.toLowerCase()).toContain('not correlated yet')
  })
})
