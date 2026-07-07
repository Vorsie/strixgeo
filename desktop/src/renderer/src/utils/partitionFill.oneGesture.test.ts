/**
 * Owner invariant (2026-07-07): ONE unit → ONE gesture per side.
 *
 * band > onlap > lens is driven by tie-count 2 > 1 > 0. A unit may NOT show two
 * gestures on the same side (e.g. onlap onto the unit above AND pinch as a lens)
 * — that was the S8 dogfeed bug: a thin uncorrelated silt beneath a sand had its
 * pinch apex interpolated to the INTERVAL top (rising into the sand) instead of
 * terminating at its OWN elevation.
 *
 * A 0-tie thin unit stacked with others in an interval must terminate as a
 * horizontal gesture at its own [top, base] elevation, never extending into a
 * neighbouring unit's elevation band.
 */
import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
} from './partitionFill'

const ZAND = 'f-zand'
const SILT = 'f-silt'
const KLEI = 'f-klei'

// Left column: all clay (like S11). Right column: thin sand over thin silt over
// clay (like S8). Only the deep clay is correlated across → the sand + silt on
// the right are uncorrelated to the left and must pinch toward it.
const columns: PartitionColumn[] = [
  {
    investigationId: 'LEFT',
    surfaceElevM: 10,
    units: [{ layerId: 'L-klei', formationId: KLEI, bodyId: null, topDepthM: 0, baseDepthM: 15 }],
  },
  {
    investigationId: 'RIGHT',
    surfaceElevM: 10,
    units: [
      { layerId: 'R-zand', formationId: ZAND, bodyId: null, topDepthM: 0, baseDepthM: 1.5 }, // elev 8.5..10
      { layerId: 'R-silt', formationId: SILT, bodyId: null, topDepthM: 1.5, baseDepthM: 2 }, // elev 8..8.5
      { layerId: 'R-klei', formationId: KLEI, bodyId: null, topDepthM: 2, baseDepthM: 15 }, // elev -5..8
    ],
  },
]
// Only the deep clay is tied across.
const edges: CorrelationEdge[] = [{ a: 'L-klei', b: 'R-klei' }]

function elevBounds(poly: readonly { elevation: number }[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const p of poly) {
    if (p.elevation < min) min = p.elevation
    if (p.elevation > max) max = p.elevation
  }
  return { min, max }
}

describe('one gesture per side (owner invariant)', () => {
  it('OG1 — a 0-tie thin silt terminates at its own elevation, not rising into the sand above', () => {
    const regions = computeSectionFill(columns, edges)
    // The right silt's OWN elevation band is [8.0, 8.5]. Its termination gesture
    // must stay within that band (± a small rasterisation tolerance), NOT climb
    // toward the sand (8.5..10) or the surface (10).
    const siltRegions = regions.filter((r) => r.formationId === SILT)
    expect(siltRegions.length).toBeGreaterThan(0)
    const TOL = 0.3
    for (const r of siltRegions) {
      const b = elevBounds(r.polygon)
      expect(
        b.max,
        `silt region top ${b.max.toFixed(2)} rose above its own top 8.5 (into the sand) — double gesture`,
      ).toBeLessThanOrEqual(8.5 + TOL)
    }
  })

  it('OG2 — top-tie + TD-tie = 2 ties → BAND: the matrix may not wedge between the tied silts', () => {
    // The B2↔S7A dogfeed case (2026-07-07). Left column carries clay/SILT/clay;
    // right column is a single shallow SILT (its base IS its TD). The engineer
    // ties the silts top↔top AND the right silt's BASE (TD) to the left lower
    // clay's TOP — the same physical contact as the left silt's base (a contact
    // is a shared boundary). That is 2 correlated contacts → the silt BANDS.
    // The clay above laps onto the band (1 tie via the shared top contact) and
    // must NOT wedge below the band's top line into the gap.
    const cols: PartitionColumn[] = [
      {
        investigationId: 'B2',
        surfaceElevM: 13,
        units: [
          { layerId: 'B2-klei-top', formationId: KLEI, bodyId: null, topDepthM: 0, baseDepthM: 3 }, // elev 10..13
          { layerId: 'B2-silt', formationId: SILT, bodyId: null, topDepthM: 3, baseDepthM: 5 }, // elev 8..10
          { layerId: 'B2-klei-low', formationId: KLEI, bodyId: null, topDepthM: 5, baseDepthM: 15 }, // elev -2..8
        ],
      },
      {
        investigationId: 'S7A',
        surfaceElevM: 13,
        units: [
          { layerId: 'S7A-silt', formationId: SILT, bodyId: null, topDepthM: 1.5, baseDepthM: 2.6 }, // elev 10.4..11.5
        ],
      },
    ]
    const tieEdges: CorrelationEdge[] = [
      // top↔top: the silts' top contacts.
      { a: 'B2-silt', b: 'S7A-silt', aSide: 'top', bSide: 'top' },
      // TD-tie in mixed form: S7A silt's BASE (its TD) ↔ the left lower clay's
      // TOP (which IS the left silt's base contact — shared boundary).
      { a: 'S7A-silt', b: 'B2-klei-low', aSide: 'base', bSide: 'top' },
    ]
    const regions = computeSectionFill(cols, tieEdges)

    // The band's TOP tie-line runs (frac 0, elev 10) → (frac 1, elev 11.5); its
    // BASE tie-line runs (frac 0, elev 8) → (frac 1, elev 10.4). Sample interior
    // points strictly between the two lines: every covering non-lens region must
    // be SILT — a KLEI region there is the wedge the owner circled.
    const offenders: string[] = []
    for (let k = 1; k <= 9; k++) {
      const f = k / 10
      const topLine = 10 + f * (11.5 - 10)
      const baseLine = 8 + f * (10.4 - 8)
      const mid = (topLine + baseLine) / 2
      for (const r of regions) {
        if (r.kind === 'lens') continue
        if (r.formationId === SILT) continue
        if (inPoly(f, mid, r.polygon)) {
          offenders.push(`${r.formationId} covers band interior at f=${f} elev=${mid.toFixed(2)}`)
        }
      }
    }
    expect(offenders, `matrix wedged inside the 2-tie silt band:\n${offenders.join('\n')}`).toEqual([])
  })

  it('OG3 — per-neighbour gestures: the same silt BANDS toward its tied side and LENSES toward the untied side', () => {
    // The S8 dogfeed case (2026-07-07). Middle column = shallow test with
    // ZAND over thin SILT (TD at the silt base). It is tied to the RIGHT
    // neighbour (top↔top on the silt + TD-tie in mixed form) and has ZERO
    // edges toward the LEFT neighbour (all clay there).
    //   → toward RIGHT: 2 ties → band.
    //   → toward LEFT: 0 ties → lens at its OWN elevation (and the sand too).
    const cols: PartitionColumn[] = [
      {
        investigationId: 'S11L',
        surfaceElevM: 13,
        units: [
          { layerId: 'L-klei', formationId: KLEI, bodyId: null, topDepthM: 0, baseDepthM: 20 }, // elev -7..13
        ],
      },
      {
        investigationId: 'S8M',
        surfaceElevM: 13,
        units: [
          { layerId: 'M-zand', formationId: ZAND, bodyId: null, topDepthM: 1.5, baseDepthM: 3 }, // elev 10..11.5
          { layerId: 'M-silt', formationId: SILT, bodyId: null, topDepthM: 3, baseDepthM: 3.6 }, // elev 9.4..10
        ],
      },
      {
        investigationId: 'S10R',
        surfaceElevM: 13,
        units: [
          { layerId: 'R-klei-top', formationId: KLEI, bodyId: null, topDepthM: 0, baseDepthM: 2 }, // elev 11..13
          { layerId: 'R-silt', formationId: SILT, bodyId: null, topDepthM: 2, baseDepthM: 3.5 }, // elev 9.5..11
          { layerId: 'R-klei-low', formationId: KLEI, bodyId: null, topDepthM: 3.5, baseDepthM: 18 }, // elev -5..9.5
        ],
      },
    ]
    const tieEdges: CorrelationEdge[] = [
      { a: 'M-silt', b: 'R-silt', aSide: 'top', bSide: 'top' },
      // Mixed TD-tie: middle silt's base (its TD) ↔ the right lower clay's top.
      { a: 'M-silt', b: 'R-klei-low', aSide: 'base', bSide: 'top' },
    ]
    const regions = computeSectionFill(cols, tieEdges)

    // LEFT gap (gapIndex 0): 0 ties → the silt (and sand) may not rise above
    // their own tops. The old bug: the global mixed-tie set (the tie lives on
    // the RIGHT gap) blocked extraction here → rising pinch to the surface.
    const TOL = 0.3
    for (const r of regions.filter((x) => x.gapIndex === 0)) {
      const b = elevBounds(r.polygon)
      if (r.formationId === SILT) {
        expect(
          b.max,
          `LEFT gap: silt rose to ${b.max.toFixed(2)} above its own top 10 — should lens at its own level`,
        ).toBeLessThanOrEqual(10 + TOL)
      }
      if (r.formationId === ZAND) {
        expect(
          b.max,
          `LEFT gap: sand rose to ${b.max.toFixed(2)} above its own top 11.5`,
        ).toBeLessThanOrEqual(11.5 + TOL)
      }
    }

    // RIGHT gap (gapIndex 1): 2 ties → band. No non-silt region may cover the
    // band interior (between the tied top line and the tied base/TD line).
    const offenders: string[] = []
    for (let k = 1; k <= 9; k++) {
      const f = k / 10
      const topLine = 10 + f * (11 - 10) // M-silt top 10 → R-silt top 11
      const baseLine = 9.4 + f * (9.5 - 9.4) // M-silt base 9.4 → R-klei-low top 9.5
      const mid = (topLine + baseLine) / 2
      for (const r of regions.filter((x) => x.gapIndex === 1)) {
        if (r.kind === 'lens') continue
        if (r.formationId === SILT) continue
        if (inPoly(f, mid, r.polygon)) {
          offenders.push(`${r.formationId} inside the 2-tie band at f=${f} elev=${mid.toFixed(2)}`)
        }
      }
    }
    expect(offenders, `RIGHT gap: matrix wedged into the banded silt:\n${offenders.join('\n')}`).toEqual([])
  })
})

/** Nonzero-winding point-in-polygon in (fraction, elevation) space. */
function inPoly(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft =
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}
