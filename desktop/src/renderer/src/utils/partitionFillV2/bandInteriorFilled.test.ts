/**
 * bandInteriorFilled.test.ts — the owner's 2026-09-06 15:06 screenshot, pinned.
 *
 * The scene (Cross-section 3, columns GEO-25/021-S40 left and GEO-25/021-S19 right):
 * the LEFT test reads sand over silt over sand; the RIGHT test reads one sand. The sand
 * tops correlate and the sand bases correlate (the base tie rides the shared sand/clay
 * contact), so BY THE OWNER'S RULE the neighbour sand has two ties = a BAND spanning both
 * left sands, and the enclosed silt has zero ties = a LENS inside that band.
 *
 * Owner, verbatim, on what must render: "the band between the two ties is filled with sand;
 * the silt inside it is a closed lens; no hole remains."
 *
 * The bug (2026-09-06): the enclosed-lens matrix band was flagged by ``detectFloodedUnits``
 * as a FOREIGN flood (its near-column interior samples fall inside the silt lens, which hugs
 * the column), so the safe-default repair forced the sand band to a lens and the band
 * interior rendered EMPTY. This gate reproduces the exact topology and asserts the interior
 * is filled with sand, the silt is a closed lens, and no hole remains.
 */

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

/** Ray-cast point-in-polygon in fraction×elevation space. */
function inPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation, xj = poly[j].fraction, yj = poly[j].elevation
    if (yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The formation whose QUAD or LENS covers (f, e), or null (a true hole). */
function coverAt(regs: readonly SectionRegion[], f: number, e: number): { formationId: string; kind: string } | null {
  for (const r of regs) if (inPoly(r.polygon, f, e)) return { formationId: r.formationId, kind: r.kind }
  return null
}

// The Cross-section 3 upper band, mirrored with clean synthetic elevations. Formation ids are the
// litho soil codes so the assertions read in the owner's vocabulary.
const SAND = 'SAND'
const SILT = 'SILT'
const CLAY = 'CLAY'

// Left test: sand [9.37..10.81] over silt [5.62..9.37] over sand [5.03..5.62] over clay [..5.03].
const LEFT: PartitionColumn = {
  investigationId: 'S40',
  surfaceElevM: 10.83,
  units: [
    { topDepthM: 0.02, baseDepthM: 1.46, formationId: SAND, bodyId: null, layerId: 'L_sand_top' },
    { topDepthM: 1.46, baseDepthM: 5.21, formationId: SILT, bodyId: null, layerId: 'L_silt' },
    { topDepthM: 5.21, baseDepthM: 5.8, formationId: SAND, bodyId: null, layerId: 'L_sand_thin' },
    { topDepthM: 5.8, baseDepthM: 12.38, formationId: CLAY, bodyId: null, layerId: 'L_clay' },
  ],
}
// Right test: one sand [6.37..7.71] over clay [..6.37].
const RIGHT: PartitionColumn = {
  investigationId: 'S19',
  surfaceElevM: 7.73,
  units: [
    { topDepthM: 0.02, baseDepthM: 1.36, formationId: SAND, bodyId: null, layerId: 'R_sand' },
    { topDepthM: 1.36, baseDepthM: 8.24, formationId: CLAY, bodyId: null, layerId: 'R_clay' },
  ],
}
// The sand tops correlate; the sand bases correlate through the shared sand/clay contact
// (the clay tops are tied, and a sand base == the clay top on its column).
const EDGES: CorrelationEdge[] = [
  { a: 'L_sand_top', b: 'R_sand', aSide: 'top', bSide: 'top' },
  { a: 'L_clay', b: 'R_clay', aSide: 'top', bSide: 'top' },
]
const ALONG = [13.17, 110.43]

function fillFlagOn(): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2([LEFT, RIGHT], EDGES, undefined, ALONG)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

describe('the sand band interior between two ties is filled (owner 2026-09-06)', () => {
  it('the silt inside the band is a closed lens', () => {
    const regs = fillFlagOn().filter((r) => r.gapIndex === 0)
    const siltLens = regs.filter((r) => r.formationId === SILT && r.kind === 'lens')
    expect(siltLens.length).toBeGreaterThan(0)
  })

  it('the band between the two ties is filled with sand — no hole remains', () => {
    const regs = fillFlagOn().filter((r) => r.gapIndex === 0)
    // The sand band spans between the sand-top tie (10.81 left -> 7.71 right) and the clay-top
    // tie (5.03 left -> 6.37 right). Sample the interior to the RIGHT of the silt lens (the lens
    // hugs the left column, apex ~0.45), where the fill MUST be sand.
    const interior: Array<[number, number]> = [
      [0.6, 7.5],
      [0.7, 7.2],
      [0.8, 7.0],
      [0.6, 6.8],
    ]
    for (const [f, e] of interior) {
      const cover = coverAt(regs, f, e)
      expect(cover, `interior point (${f}, ${e}) is a HOLE`).not.toBeNull()
      expect(cover?.formationId, `interior point (${f}, ${e}) is not sand`).toBe(SAND)
    }
  })

  it('a sand quad reaches well below the silt lens top (the band is not a flat slab)', () => {
    const regs = fillFlagOn().filter((r) => r.gapIndex === 0)
    // The silt lens top is 9.37. A flat-slab bug leaves sand only at [9.37..10.81]; the correct
    // band descends to the clay-top tie (5.03..6.37). Assert a sand quad exists whose lowest
    // vertex is well below the lens top.
    const sandQuads = regs.filter((r) => r.formationId === SAND && r.kind === 'quad')
    const lowest = Math.min(...sandQuads.flatMap((r) => r.polygon.map((p) => p.elevation)))
    expect(lowest).toBeLessThan(6.5)
  })
})
