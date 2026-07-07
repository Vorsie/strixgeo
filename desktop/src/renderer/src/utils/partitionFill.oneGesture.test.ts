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
})
