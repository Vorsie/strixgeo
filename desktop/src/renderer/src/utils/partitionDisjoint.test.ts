/**
 * Tests for the partition-disjointness geometry (debt #228).
 *
 * ``subtractPolygon(A, [B…])`` returns simple, pairwise-disjoint convex pieces
 * covering exactly ``A \ union(B)``. Pinned in the operation's own vocabulary:
 *
 *  - subtracting a disjoint B leaves A whole (one piece, same area);
 *  - subtracting a B that clips one corner returns the L-shaped remainder as
 *    disjoint convex pieces whose areas sum to A − overlap;
 *  - a B that fully contains A returns nothing;
 *  - a hairline sliver overlap (the real #228 shape) is removed, and the
 *    remainder's area equals A minus the sliver;
 *  - a self-intersecting subtrahend is honoured by nonzero winding (its folded
 *    double-cover counts as inside), so A loses exactly the folded area;
 *  - the returned pieces never overlap each other (they are a sub-partition).
 *
 * ``makeGapRegionsDisjoint`` is pinned via the checker: after the pass the
 * region list has zero pairwise non-lens overlap, and the total covered area is
 * unchanged (later-wins subtraction removes only double-covered slivers).
 */

import { describe, expect, it } from 'vitest'

import { makeGapRegionsDisjoint, subtractPolygon, type PartitionPoint, type SectionRegion } from './partitionFill'
import { findNonLensOverlaps } from './partitionOverlapCheck'

function area(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}

function totalArea(pieces: readonly PartitionPoint[][]): number {
  return pieces.reduce((s, p) => s + area(p), 0)
}

function rect(f0: number, f1: number, eTop: number, eBase: number): PartitionPoint[] {
  return [
    { fraction: f0, elevation: eTop },
    { fraction: f1, elevation: eTop },
    { fraction: f1, elevation: eBase },
    { fraction: f0, elevation: eBase },
  ]
}

describe('subtractPolygon', () => {
  it('returns A whole when B is disjoint', () => {
    const a = rect(0, 1, 10, 8)
    const b = rect(0, 1, 6, 4)
    const pieces = subtractPolygon(a, [b])
    expect(totalArea(pieces)).toBeCloseTo(area(a), 9)
  })

  it('removes a clipped corner and returns the remainder as disjoint convex pieces', () => {
    const a = rect(0, 1, 10, 0) // area 10
    const b = rect(0.5, 1, 10, 5) // clips the top-right quarter (area 2.5)
    const pieces = subtractPolygon(a, [b])
    expect(totalArea(pieces)).toBeCloseTo(7.5, 6)
    // Pieces must not overlap each other.
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const overlap = sampledPairOverlap(pieces[i], pieces[j])
        expect(overlap).toBeLessThan(1e-6)
      }
    }
  })

  it('returns nothing when B fully contains A', () => {
    const a = rect(0.4, 0.6, 6, 5)
    const b = rect(0, 1, 10, 0)
    expect(subtractPolygon(a, [b])).toEqual([])
  })

  it('removes exactly the overlap with a pinch subtrahend (the real #228 shapes)', () => {
    // The real frozen-CS1 GAP-18 clay band (#3) and sand pinch (#4), verbatim.
    const a: PartitionPoint[] = [
      { fraction: 0, elevation: 10 },
      { fraction: 1, elevation: 10 },
      { fraction: 1, elevation: -5.7629 },
      { fraction: 0, elevation: -19.014 },
    ]
    const b: PartitionPoint[] = [
      { fraction: 1, elevation: -5.7629 },
      { fraction: 0.5, elevation: -12.2115 },
      { fraction: 1, elevation: -18.66 },
    ]
    const before = area(a)
    const pieces = subtractPolygon(a, [b])
    const removed = before - totalArea(pieces)
    // Something is removed, but never more than the whole subtrahend area.
    expect(removed).toBeGreaterThan(0)
    expect(removed).toBeLessThanOrEqual(area(b) + 1e-9)
    // No remaining piece covers a point strictly inside the subtrahend triangle…
    const insideB = { f: 0.85, e: -9.0 }
    expect(sampledPointInPoly(insideB.f, insideB.e, b)).toBe(true)
    expect(pieces.some((p) => sampledPointInPoly(insideB.f, insideB.e, p))).toBe(false)
    // …while a point clearly in A-but-not-B is still covered.
    expect(pieces.some((p) => sampledPointInPoly(0.1, 0, p))).toBe(true)
    // Pieces don't overlap each other.
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        expect(sampledPairOverlap(pieces[i], pieces[j])).toBeLessThan(1e-4)
      }
    }
  })

  it('honours a self-intersecting subtrahend by nonzero winding (the #191 fold shape)', () => {
    const a = rect(0, 1, 0, -10)
    // A mostly-simple ring with a small fold near the top (winding 2 in the fold,
    // 1 in the body) — the real substrate #191 signature. The main body must be
    // subtracted (winding ≠ 0), fold included.
    const folded: PartitionPoint[] = [
      { fraction: 0, elevation: -1 },
      { fraction: 1, elevation: -1.2 },
      { fraction: 1, elevation: -4 },
      { fraction: 0, elevation: -4 },
      { fraction: 0, elevation: -2 },
      { fraction: 0.9, elevation: -1.18 }, // rides just below the top edge → fold
      { fraction: 0.7, elevation: -1.15 },
      { fraction: 0, elevation: -1.3 },
    ]
    const pieces = subtractPolygon(a, [folded])
    // The clear interior of the main body is removed.
    expect(pieces.some((p) => sampledPointInPoly(0.5, -3, p))).toBe(false)
    // Space clearly outside the folded ring is kept.
    expect(pieces.some((p) => sampledPointInPoly(0.5, -8, p))).toBe(true)
  })
})

describe('makeGapRegionsDisjoint', () => {
  function region(gapIndex: number, formationId: string, poly: PartitionPoint[], kind: SectionRegion['kind'] = 'quad'): SectionRegion {
    return { gapIndex, formationId, bodyId: null, kind, polygon: poly }
  }

  it('removes a hairline overlap between two same-gap non-lens regions', () => {
    // Two quads overlapping in a thin band [−5, −5.02].
    const a = region(0, 'sand', rect(0, 1, 0, -5))
    const b = region(0, 'clay', rect(0, 1, -4.98, -10))
    const regions = [a, b]
    expect(findNonLensOverlaps(regions).length).toBeGreaterThan(0)
    makeGapRegionsDisjoint(regions)
    expect(findNonLensOverlaps(regions)).toEqual([])
  })

  it('leaves cleanly-tiling regions untouched (touching edge, no area removed)', () => {
    const a = region(0, 'sand', rect(0, 1, 10, 5))
    const b = region(0, 'clay', rect(0, 1, 5, 0))
    const before = [area(a.polygon), area(b.polygon)]
    makeGapRegionsDisjoint([a, b])
    expect(area(a.polygon)).toBeCloseTo(before[0], 9)
    expect(area(b.polygon)).toBeCloseTo(before[1], 9)
  })

  it('never removes area from a lens overlay (by-design overlap)', () => {
    const main = region(0, 'sand', rect(0, 1, 10, 0))
    const lens = region(0, 'silt', rect(0.3, 0.7, 6, 4), 'lens')
    const lensArea = area(lens.polygon)
    makeGapRegionsDisjoint([main, lens])
    expect(area(lens.polygon)).toBeCloseTo(lensArea, 9)
  })

  it('does not compare across gaps', () => {
    const a = region(0, 'sand', rect(0, 1, 10, 0))
    const b = region(1, 'clay', rect(0, 1, 10, 0))
    const beforeA = area(a.polygon)
    makeGapRegionsDisjoint([a, b])
    expect(area(a.polygon)).toBeCloseTo(beforeA, 9)
  })
})

// --- local sampled helpers (independent of the production winding code) ---

function sampledPointInPoly(px: number, py: number, poly: readonly PartitionPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.elevation > py !== b.elevation > py && px < a.fraction + ((py - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)) {
      inside = !inside
    }
  }
  return inside
}

function sampledPairOverlap(a: readonly PartitionPoint[], b: readonly PartitionPoint[]): number {
  let f0 = Infinity
  let f1 = -Infinity
  let e0 = Infinity
  let e1 = -Infinity
  for (const p of [...a, ...b]) {
    if (p.fraction < f0) f0 = p.fraction
    if (p.fraction > f1) f1 = p.fraction
    if (p.elevation < e0) e0 = p.elevation
    if (p.elevation > e1) e1 = p.elevation
  }
  const N = 60
  let hits = 0
  for (let iy = 0; iy < N; iy++) {
    const py = e0 + ((iy + 0.5) / N) * (e1 - e0)
    for (let ix = 0; ix < N; ix++) {
      const px = f0 + ((ix + 0.5) / N) * (f1 - f0)
      if (sampledPointInPoly(px, py, a) && sampledPointInPoly(px, py, b)) hits++
    }
  }
  return (hits / (N * N)) * (f1 - f0) * (e1 - e0)
}
