/**
 * BOTH PACKAGES CLOSED AT THE MIDDLE — WHO OWNS THE GROUND BETWEEN THEM?
 *
 * Owner, 2026-08-24, asked what owns the ground left between two closed loops when
 * the two facing packages both close at the middle — left half to the left column's
 * masses, right half to the right's? — *"yes in this case i'd rather have a vertical
 * line"*.
 *
 * The older law it rests on (``emitKernel``/``fillGap`` module docs, owner 2026-08-21):
 * *"the MD sand onlaps, that means it is a closed loop in that gap and cannot fill the
 * gap"*. A mass that closed its loop states nothing beyond its own pinch, so no single
 * class may flood the leftover — the leftover splits at the seam and each half continues
 * the masses of ITS OWN test.
 *
 * NOT changed here, and pinned elsewhere (``loopClosureScenes.diag.test.ts``,
 * ``geotechLawOracle.diag.test.ts``): when ONE side is OPEN — a band with two tied
 * contacts, which emits nothing — and the facing mass closed its loop, the open mass
 * FILLS THROUGH. Only the both-closed case draws the line.
 *
 * The scene is the owner's real Cross-section 2 gap 0 (GEO-23/125-S34 ↔ GEO-10/117-B1),
 * reduced to what reproduces it: two ties bracket a window; inside it every mass of both
 * columns terminates (0 or 1 correlation), and no class exists on both columns.
 */
import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

/** The left test's own classes — GEO-23/125-S34's sand/silt package. */
const LEFT_ONLY = ['zand6', 'silt15', 'zand7']
/** The right test's own classes — GEO-10/117-B1's loose/very-dense sand package. */
const RIGHT_ONLY = ['zand5', 'zand8', 'zand9']

/** Left column, surface +13.04 — clay, the sand/silt package, deep clay. */
const LEFT: PartitionColumn = {
  investigationId: 'L',
  surfaceElevM: 13.04,
  units: [
    { layerId: 'L0', topDepthM: 0, baseDepthM: 9.96, formationId: 'kleiTop', bodyId: null },
    { layerId: 'L1', topDepthM: 9.96, baseDepthM: 12.19, formationId: 'zand6', bodyId: null },
    { layerId: 'L2', topDepthM: 12.19, baseDepthM: 13.96, formationId: 'silt15', bodyId: null },
    { layerId: 'L3', topDepthM: 13.96, baseDepthM: 15.68, formationId: 'zand7', bodyId: null },
    { layerId: 'L4', topDepthM: 15.68, baseDepthM: 21.0, formationId: 'kleiDeep', bodyId: null },
  ],
}

/** Right column, surface +13.40 — the same brackets, its own three-mass package. */
const RIGHT: PartitionColumn = {
  investigationId: 'R',
  surfaceElevM: 13.4,
  units: [
    { layerId: 'R0', topDepthM: 0, baseDepthM: 9.0, formationId: 'kleiTop', bodyId: null },
    { layerId: 'R1', topDepthM: 9.0, baseDepthM: 11.26, formationId: 'zand5', bodyId: null },
    { layerId: 'R2', topDepthM: 11.26, baseDepthM: 12.61, formationId: 'zand8', bodyId: null },
    { layerId: 'R3', topDepthM: 12.61, baseDepthM: 16.25, formationId: 'zand9', bodyId: null },
    { layerId: 'R4', topDepthM: 16.25, baseDepthM: 20.0, formationId: 'kleiDeep', bodyId: null },
  ],
}

/**
 * The two brackets: the cross-class sand tie (L +3.08 ↔ R +4.40 — the owner's own
 * ZAND/n6 ↔ ZAND/n5 tie) and the deep-clay tie (L −2.64 ↔ R −2.85). Inside them
 * nothing is tied, so every mass of both columns closes.
 */
const EDGES: CorrelationEdge[] = [
  { a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' },
  { a: 'L1', b: 'R1', aSide: 'top', bSide: 'top' },
  { a: 'L4', b: 'R4', aSide: 'top', bSide: 'top' },
]

const ALONG_M = [8, 77]

/** Is the point inside the ring (even-odd)? */
function inRing(
  fraction: number,
  elevation: number,
  ring: readonly { fraction: number; elevation: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > elevation !== b.elevation > elevation &&
      fraction <
        a.fraction +
          ((elevation - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

/** The fill with the shipped flag-ON engine. */
function fill(): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2([LEFT, RIGHT], EDGES, undefined, ALONG_M)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

/** The window between the two ties at ``fraction`` — the ground the two packages share. */
function windowAt(fraction: number): { top: number; base: number } {
  return {
    top: 3.08 + fraction * (4.4 - 3.08),
    base: -2.64 + fraction * (-2.85 - -2.64),
  }
}

describe('both packages closed at the middle → a vertical line, not a flood', () => {
  it('gives the left half to the left test and the right half to the right test', () => {
    const regions = fill().filter((r) => r.gapIndex === 0)
    const wrong: string[] = []
    const uncovered: string[] = []
    for (let i = 1; i < 40; i++) {
      const fraction = i / 40
      // Skip the seam itself — the line has no side.
      if (Math.abs(fraction - 0.5) < 0.03) continue
      const { top, base } = windowAt(fraction)
      const own = fraction < 0.5 ? LEFT_ONLY : RIGHT_ONLY
      const foreign = fraction < 0.5 ? RIGHT_ONLY : LEFT_ONLY
      for (let j = 1; j < 20; j++) {
        const elevation = base + ((top - base) * j) / 20
        const hits = regions.filter((r) => inRing(fraction, elevation, r.polygon))
        if (hits.length === 0) {
          uncovered.push(`f=${fraction.toFixed(2)} e=${elevation.toFixed(2)}`)
          continue
        }
        for (const hit of hits) {
          // A test's own half may carry its own masses (and the bracketing clays it
          // shares); it may NEVER carry a mass only the facing test read.
          if (foreign.includes(hit.formationId) && !own.includes(hit.formationId)) {
            wrong.push(`f=${fraction.toFixed(2)} e=${elevation.toFixed(2)} → ${hit.formationId}`)
          }
        }
      }
    }
    expect({ wrong: wrong.slice(0, 8), n: wrong.length }).toEqual({ wrong: [], n: 0 })
    // The line moves paint; it may never open a hole.
    expect({ uncovered: uncovered.slice(0, 8), n: uncovered.length }).toEqual({
      uncovered: [],
      n: 0,
    })
  })

  it('lets no closed mass fill the whole gap — "it cannot fill the gap"', () => {
    const packageClasses = new Set([...LEFT_ONLY, ...RIGHT_ONLY])
    const fullWidth = fill()
      .filter((r) => r.gapIndex === 0 && packageClasses.has(r.formationId))
      .filter((r) => {
        let lo = Infinity
        let hi = -Infinity
        for (const p of r.polygon) {
          if (p.fraction < lo) lo = p.fraction
          if (p.fraction > hi) hi = p.fraction
        }
        return lo <= 0.001 && hi >= 0.999
      })
      .map((r) => r.formationId)
    expect(fullWidth).toEqual([])
  })
})
