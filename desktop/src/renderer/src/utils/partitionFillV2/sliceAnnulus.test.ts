/**
 * partitionFillV2/sliceAnnulus.test.ts — increment-12 gate for the ENCLOSED-LENS
 * annulus slicer (design partition-engine-v2.md §4 increment-12 row).
 *
 * A matrix ANNULUS face (a gap-spanning band with an enclosed lens as an interior
 * HOLE) must slice into DISJOINT, STRICTLY SIMPLE per-gap polygons — the v1-carve
 * pieces (left cap / right cap / above-strip / below-strip) — NOT a keyhole (removed
 * in increment 6 for self-touching rings). This file feeds ``sliceFaces`` a synthetic
 * annulus face directly and asserts, in the USER's terms:
 *
 *   - every emitted region ring is SIMPLE (no self-crossing, no repeated vertex);
 *   - the pieces TILE the matrix exactly — their areas sum to (outer − hole);
 *   - the hole (the lens) is NOT painted by any matrix piece.
 *
 * A synthetic face is used because the real 14-section data produces enclosed lenses
 * as NOTCHES (the lens rides its emitting column edge → an adjacent concave matrix,
 * no hole); the true interior-hole annulus is the increment-13 lone-multi-unit-stack
 * shape, and this gate pins the slicer against it ahead of that build.
 */

import { describe, expect, it } from 'vitest'

import { sliceFaces } from './slice'
import { type LabelledFace } from './labelFaces'
import { type ColumnGeom } from './sectionGeom'
import { type Face, type Point } from './types'
import { type PartitionPoint } from '../sectionPartition'

/** Two columns 100 m apart (real alongM), so one gap covers x ∈ [0, 100]. */
const COLUMNS: ColumnGeom[] = [
  { investigationId: 'L', x: 0, surfaceElevM: 10, units: [], enclosedLenses: [] },
  { investigationId: 'R', x: 100, surfaceElevM: 10, units: [], enclosedLenses: [] },
]

/** Shoelace area of a fraction×elevation ring. */
function fArea(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}

/** Whether a ring self-crosses or repeats a vertex (a NON-simple ring). */
function ringDefects(poly: readonly PartitionPoint[]): { crossings: number; repeats: number } {
  const orient = (a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): number => {
    const v =
      (b.fraction - a.fraction) * (c.elevation - a.elevation) -
      (b.elevation - a.elevation) * (c.fraction - a.fraction)
    return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0
  }
  const cross = (p1: PartitionPoint, p2: PartitionPoint, p3: PartitionPoint, p4: PartitionPoint): boolean => {
    const d1 = orient(p3, p4, p1)
    const d2 = orient(p3, p4, p2)
    const d3 = orient(p1, p2, p3)
    const d4 = orient(p1, p2, p4)
    return d1 * d2 < 0 && d3 * d4 < 0
  }
  const n = poly.length
  let crossings = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) crossings++
    }
  const seen = new Set<string>()
  let repeats = 0
  for (const p of poly) {
    const k = `${p.fraction.toFixed(9)}|${p.elevation.toFixed(6)}`
    if (seen.has(k)) repeats++
    seen.add(k)
  }
  return { crossings, repeats }
}

/** Point-in-fraction-ring test. */
function inRing(f: number, e: number, poly: readonly PartitionPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const fi = poly[i].fraction
    const ei = poly[i].elevation
    const fj = poly[j].fraction
    const ej = poly[j].elevation
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

/** Build a labelled ANNULUS face: an outer rectangle with one interior rectangular hole. */
function annulusFace(outer: Point[], hole: Point[]): LabelledFace {
  const face: Face = {
    polygon: outer,
    boundingCurveIds: ['col0:u0', 'col1:u0'],
    // Hole wound CW (opposite the CCW outer) as the tracer produces it.
    holes: [hole],
    area: 0,
  }
  return { face, formationId: 'clay', bodyId: 'bClay', klass: 'band', units: [{ ci: 0, ui: 0 }] }
}

describe('increment-12 — enclosed-lens annulus slices into simple v1-carve pieces', () => {
  // A 100 m × 8 m clay band (x 0..100, elev 2..10) with a 20 m × 2 m sand lens hole
  // centred at x 40..60, elev 5..7.
  const outer: Point[] = [
    { x: 0, y: 2 },
    { x: 100, y: 2 },
    { x: 100, y: 10 },
    { x: 0, y: 10 },
  ]
  const hole: Point[] = [
    { x: 40, y: 5 },
    { x: 40, y: 7 },
    { x: 60, y: 7 },
    { x: 60, y: 5 },
  ]

  it('the matrix band around a lens hole is emitted as simple pieces (no keyhole slit)', () => {
    const regions = sliceFaces([annulusFace(outer, hole)], COLUMNS)
    expect(regions.length).toBeGreaterThanOrEqual(3) // left cap + right cap + strips
    for (const r of regions) {
      const { crossings, repeats } = ringDefects(r.polygon)
      expect(crossings, `region ${r.polygon.map((p) => `(${p.fraction},${p.elevation})`).join(' ')}`).toBe(0)
      expect(repeats).toBe(0)
    }
  })

  it('the pieces tile the matrix exactly: their areas sum to (band − hole)', () => {
    const regions = sliceFaces([annulusFace(outer, hole)], COLUMNS)
    // In fraction×elevation the band is 1 × 8 = 8; the hole is 0.2 × 2 = 0.4. So the
    // matrix pieces must sum to 8 − 0.4 = 7.6.
    const sum = regions.reduce((s, r) => s + fArea(r.polygon), 0)
    expect(sum).toBeCloseTo(7.6, 4)
  })

  it('the lens hole is left UNPAINTED by every matrix piece (the lens is its own face)', () => {
    const regions = sliceFaces([annulusFace(outer, hole)], COLUMNS)
    // A point at the hole centre (fraction 0.5, elev 6) must be covered by NO matrix piece.
    let covers = 0
    for (const r of regions) if (inRing(0.5, 6, r.polygon)) covers++
    expect(covers).toBe(0)
    // A point just outside the hole (in the left cap, fraction 0.2, elev 6) IS covered.
    let leftCovers = 0
    for (const r of regions) if (inRing(0.2, 6, r.polygon)) leftCovers++
    expect(leftCovers).toBe(1)
  })

  it('a hole-free band still emits as ONE simple region (no split)', () => {
    const face: Face = { polygon: outer, boundingCurveIds: ['col0:u0', 'col1:u0'], holes: [], area: 0 }
    const lf: LabelledFace = { face, formationId: 'clay', bodyId: 'bClay', klass: 'band', units: [{ ci: 0, ui: 0 }] }
    const regions = sliceFaces([lf], COLUMNS)
    expect(regions.length).toBe(1)
    expect(fArea(regions[0].polygon)).toBeCloseTo(8, 4)
  })

  // ---------------------------------------------------------------------------
  // TRIANGULAR (lens) hole — the SLOPED-edge case (ruling-8e Milestone-2, 2026-07-15).
  // A real enclosed lens is a TRIANGLE pinching to a mid-gap apex, NOT a rectangle. The
  // box split dropped the matrix WEDGES beside the sloped edges (the CS1 g15 SILT 44 cm
  // coverage hole); the sloped-envelope clip must cover them, and the pieces must not
  // overlap the lens (the ZAND×ZAND / SILT×ZAND slivers from the crossChain endpoint-on-
  // chain bug). This is the behavioural gate for both fixes.
  // ---------------------------------------------------------------------------
  describe('triangular lens hole — sloped matrix follows the lens edge exactly', () => {
    // The lens triangle: base on the RIGHT column (x=100, elev 5..7), apex mid-gap at
    // (60, 6). Its area = ½ × base(2) × height(40) = 40 (metres²) → 0.4 in fraction·metre.
    const lensHole: Point[] = [
      { x: 100, y: 7 },
      { x: 60, y: 6 },
      { x: 100, y: 5 },
    ]

    it('the pieces + lens tile the band exactly: matrix = band − lens (no dropped wedge)', () => {
      const regions = sliceFaces([annulusFace(outer, lensHole)], COLUMNS)
      // Band 1 × 8 = 8; lens 0.4·(fraction 0.4 width × … ) — compute in fraction space: the
      // lens hole maps to fraction 0.6..1.0 with apex at 0.6; area = ½ × 0.4 × 2 = 0.4.
      const sum = regions.reduce((s, r) => s + fArea(r.polygon), 0)
      expect(sum).toBeCloseTo(8 - 0.4, 3)
    })

    it('every matrix piece is a SIMPLE ring', () => {
      const regions = sliceFaces([annulusFace(outer, lensHole)], COLUMNS)
      for (const r of regions) {
        const { crossings, repeats } = ringDefects(r.polygon)
        expect(crossings, r.polygon.map((p) => `(${p.fraction},${p.elevation})`).join(' ')).toBe(0)
        expect(repeats).toBe(0)
      }
    })

    it('no matrix piece OVERLAPS the lens triangle (the crossChain endpoint-on-chain sliver)', () => {
      const regions = sliceFaces([annulusFace(outer, lensHole)], COLUMNS)
      // A point strictly inside the lens (fraction 0.9, elev 6 — near the base) is painted
      // by NO matrix piece; a point in the wedge beside the lens (fraction 0.8, elev 6.9 —
      // above the sloped top edge) IS covered by exactly one matrix piece.
      let lensCovers = 0
      for (const r of regions) if (inRing(0.9, 6, r.polygon)) lensCovers++
      expect(lensCovers, 'lens interior must be unpainted').toBe(0)
      let wedgeCovers = 0
      for (const r of regions) if (inRing(0.8, 6.9, r.polygon)) wedgeCovers++
      expect(wedgeCovers, 'wedge beside the sloped lens edge must be covered exactly once').toBe(1)
    })
  })
})
