/**
 * Tests for computePartitionFill — true-partition fill between two litho columns.
 *
 * TDD: these are written BEFORE the implementation. Every test exercises the
 * core partition invariant (assertTiles) plus one behavioural property.
 */

import { describe, expect, it } from 'vitest'

import { computePartitionFill, type MorphColumn, type PartitionRegion } from './partitionFill'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: build a MorphColumn. */
function col(
  id: string,
  surfaceElevM: number,
  units: { top: number; base: number; f: string; b: string | null }[],
): MorphColumn {
  return {
    investigationId: id,
    surfaceElevM,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      bodyId: u.b,
    })),
  }
}

/**
 * Core partition invariant checker.
 *
 * At 25 evenly-spaced fractions across [0, 1], verifies that the regions'
 * vertical intervals at that fraction:
 *   (a) cover the FULL column height (no gap at the top or bottom), and
 *   (b) are CONTIGUOUS (no internal gap, no overlap).
 *
 * The column height at fraction f is linearly interpolated between the left
 * surface+floor and the right surface+floor.
 */
function assertTiles(regions: PartitionRegion[], left: MorphColumn, right: MorphColumn): void {
  if (regions.length === 0) return

  // The covered region starts at the top of the first unit (may be depth>0 when
  // logs begin slightly below the surface) and ends at the floor.
  const leftTopDepth = left.units.length > 0 ? left.units[0].topDepthM : 0
  const rightTopDepth = right.units.length > 0 ? right.units[0].topDepthM : 0
  const leftFloor =
    left.units.length > 0 ? left.units[left.units.length - 1].baseDepthM : 0
  const rightFloor =
    right.units.length > 0 ? right.units[right.units.length - 1].baseDepthM : 0
  // Covered-region surface (mTAW) = surfaceElevM − topDepth.
  const leftSurface = left.surfaceElevM - leftTopDepth
  const rightSurface = right.surfaceElevM - rightTopDepth

  const SAMPLE_COUNT = 25
  const EPS = 1e-6

  for (let s = 0; s < SAMPLE_COUNT; s++) {
    // Use interior fractions (avoid exact 0 and 1 where column edges are
    // degenerate lines, not intervals).
    const f = (s + 0.5) / SAMPLE_COUNT

    const colSurface = leftSurface + f * (rightSurface - leftSurface)
    // Floor depth relative to the covered-region surface (leftFloor − leftTopDepth).
    const colFloorDepth =
      (leftFloor - leftTopDepth) + f * ((rightFloor - rightTopDepth) - (leftFloor - leftTopDepth))
    const colFloorElev = colSurface - colFloorDepth

    // Collect every region's [lo, hi] elevation interval at fraction f.
    const intervals: Array<[number, number]> = []
    for (const region of regions) {
      const poly = region.polygon
      // Intersect polygon with vertical line x = f.
      // Walk edges; collect y-values where the edge crosses or touches x = f.
      const ys: number[] = []
      const n = poly.length
      for (let i = 0; i < n; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % n]
        const xMin = Math.min(a.fraction, b.fraction)
        const xMax = Math.max(a.fraction, b.fraction)
        if (f < xMin - EPS || f > xMax + EPS) continue
        if (Math.abs(xMax - xMin) < EPS) {
          // Vertical edge — contributes both endpoints.
          ys.push(a.elevation, b.elevation)
        } else {
          const t = (f - a.fraction) / (b.fraction - a.fraction)
          ys.push(a.elevation + t * (b.elevation - a.elevation))
        }
      }
      if (ys.length < 2) continue
      const lo = Math.min(...ys)
      const hi = Math.max(...ys)
      if (hi - lo < EPS) continue // degenerate sliver at this fraction — skip
      intervals.push([lo, hi])
    }

    if (intervals.length === 0) continue

    // Sort by lower bound (descending elevation = upward-first for surface at top).
    // Actually sort ascending by lower bound so we step top→bottom by elevation.
    intervals.sort((a, b) => b[0] - a[0]) // highest elevation first

    // Verify top touches the column surface.
    expect(intervals[0][1]).toBeGreaterThanOrEqual(colSurface - EPS)
    expect(intervals[0][1]).toBeLessThanOrEqual(colSurface + EPS)

    // Verify contiguity: each interval's bottom == next interval's top.
    for (let i = 0; i + 1 < intervals.length; i++) {
      const bottomOfCurrent = intervals[i][0]
      const topOfNext = intervals[i + 1][1]
      const gap = Math.abs(bottomOfCurrent - topOfNext)
      expect(gap, `Gap or overlap at f=${f.toFixed(3)}: interval ${i} ends at ${bottomOfCurrent.toFixed(6)}, interval ${i + 1} starts at ${topOfNext.toFixed(6)}`).toBeLessThanOrEqual(EPS * 10)
    }

    // Verify bottom touches the column floor elevation.
    const lowestBottom = intervals[intervals.length - 1][0]
    expect(lowestBottom).toBeGreaterThanOrEqual(colFloorElev - EPS)
    expect(lowestBottom).toBeLessThanOrEqual(colFloorElev + EPS)
  }
}

// ---------------------------------------------------------------------------
// Tests — written BEFORE implementation (TDD: watch them fail, then pass)
// ---------------------------------------------------------------------------

describe('computePartitionFill', () => {
  // -----------------------------------------------------------------------
  // PF1 — Identical stacks → all quads, perfect tiling
  // -----------------------------------------------------------------------
  it('PF1 — two identical unit stacks → all quads, no pinches, tiles', () => {
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'fSand', b: 'sand' },
      { top: 5, base: 10, f: 'fClay', b: 'clay' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'fSand', b: 'sand' },
      { top: 5, base: 10, f: 'fClay', b: 'clay' },
    ])
    const regions = computePartitionFill(left, right)
    expect(regions.every((r) => r.kind === 'quad')).toBe(true)
    expect(regions).toHaveLength(2)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF2 — A left-only body (lens) tiles with its surrounding quads
  // -----------------------------------------------------------------------
  it('PF2 — left-only lens pinches out; surrounding quads expand; tiles hold', () => {
    // Left: sand / silt-LENS / sand (same body = three members of one sand body
    // — but use two distinct sand body ids to isolate the lens scenario).
    // Actually: two different sand bodies on left, the middle one absent on right.
    const left = col('L', 0, [
      { top: 0, base: 3, f: 'fSand', b: 'sand' },
      { top: 3, base: 5, f: 'fSilt', b: 'silt' }, // left-only lens
      { top: 5, base: 10, f: 'fSand', b: 'sand2' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 10, f: 'fSand', b: 'sand2' },
    ])
    const regions = computePartitionFill(left, right)
    const pinches = regions.filter((r) => r.kind === 'pinch')
    expect(pinches).toHaveLength(1)
    expect(pinches[0].bodyId).toBe('silt')
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF3 — Opposite pinches in the same interval meet at a shared fraction
  // -----------------------------------------------------------------------
  it('PF3 — opposite pinches in same interval meet at a shared fraction; tiles hold', () => {
    // Between a matched sand below, left has thin Z (1 m), right has thick K (3 m),
    // both absent on the other side. They must meet inside the gap, not overlap.
    const left = col('L', 0, [
      { top: 0, base: 1, f: 'fZ', b: 'Ztop' }, // left-only, 1 m thick
      { top: 1, base: 10, f: 'fSand', b: 'sand' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 3, f: 'fK', b: 'Ktop' }, // right-only, 3 m thick
      { top: 3, base: 10, f: 'fSand', b: 'sand' },
    ])
    const regions = computePartitionFill(left, right)
    const pinches = regions.filter((r) => r.kind === 'pinch')
    expect(pinches).toHaveLength(2)

    const leftPinch = pinches.find((p) => p.bodyId === 'Ztop')!
    const rightPinch = pinches.find((p) => p.bodyId === 'Ktop')!
    expect(leftPinch).toBeDefined()
    expect(rightPinch).toBeDefined()

    // Both must be inside (0, 1) and share the same meeting fraction.
    const fL = leftPinch.polygon.reduce((mx, p) => Math.max(mx, p.fraction), 0)
    const fR = rightPinch.polygon.reduce((mn, p) => Math.min(mn, p.fraction), 1)
    expect(fL).toBeGreaterThan(0)
    expect(fL).toBeLessThan(1)
    expect(fR).toBeGreaterThan(0)
    expect(fR).toBeLessThan(1)
    expect(Math.abs(fL - fR)).toBeLessThan(1e-6)

    // Thicker K (3 m) wins more of the gap than thin Z (1 m):
    // meeting fraction = 1/(1+3) = 0.25 from the left.
    expect(fL).toBeCloseTo(0.25, 5)

    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF4 — ACCEPTANCE: interrupted body as two pieces (not one swept band)
  // -----------------------------------------------------------------------
  it('PF4 — same-bodyId clay appears as two pieces: one quad + one pinch (NOT one swept band)', () => {
    // Left column (top→bottom): Z2, Si, K, V
    // Right column (top→bottom): K (surface), Si, K, V  (same bodyIds for Si, K, V)
    //
    // The monotonic alignment can match Si–K–V in order. The surface K on the
    // right column appears BEFORE Si in that column, so it CANNOT be matched to
    // the left K (which appears AFTER Si) without crossing the Si match → the
    // right surface K stays UNMATCHED → it is a right-only pinch.
    // The lower K on the left (after Si) is matched to the lower K on the right → quad.
    // This is the "interrupted body as two pieces" acceptance test.
    const left = col('L', 10, [
      { top: 0, base: 2, f: 'fZ', b: 'Z2' },
      { top: 2, base: 4, f: 'fSi', b: 'Si' },
      { top: 4, base: 6, f: 'fK', b: 'K' }, // matched K (below Si)
      { top: 6, base: 10, f: 'fV', b: 'V' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 3, f: 'fK', b: 'K' }, // surface K — BEFORE Si, cannot match the post-Si K
      { top: 3, base: 5, f: 'fSi', b: 'Si' },
      { top: 5, base: 8, f: 'fK', b: 'K' }, // K below Si — matches left K
      { top: 8, base: 10, f: 'fV', b: 'V' },
    ])
    const regions = computePartitionFill(left, right)

    // K must appear as EXACTLY two regions: one quad (matched) and one pinch.
    const kRegions = regions.filter((r) => r.bodyId === 'K')
    expect(kRegions).toHaveLength(2)
    const kQuads = kRegions.filter((r) => r.kind === 'quad')
    const kPinches = kRegions.filter((r) => r.kind === 'pinch')
    expect(kQuads).toHaveLength(1)
    expect(kPinches).toHaveLength(1)

    // The Si (matched) must be a quad between the two K pieces.
    const siRegions = regions.filter((r) => r.bodyId === 'Si')
    expect(siRegions).toHaveLength(1)
    expect(siRegions[0].kind).toBe('quad')

    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF5 — Empty left column
  // -----------------------------------------------------------------------
  it('PF5 — empty left column returns []', () => {
    const left = col('L', 0, [])
    const right = col('R', 0, [{ top: 0, base: 5, f: 'fSand', b: 'sand' }])
    const regions = computePartitionFill(left, right)
    expect(regions).toEqual([])
  })

  // -----------------------------------------------------------------------
  // PF-REAL — Real CS3 S2→S6 data (dogfeed 2026-06-05 clay-over-silt overlap)
  // -----------------------------------------------------------------------
  it('PF-REAL — real CS3 S2→S6 data tiles with no gap or overlap', () => {
    // Surface elevations: S2 = 13.04, S6 = 12.68.
    // Unit sequences (depthTop, depthBase, bodyId) top-down as provided.
    // The bodyId short codes: Z=sand, Si=silt, K=clay, V=peat.
    const s2 = col('S2', 13.04, [
      { top: 0.05, base: 1.85, f: 'fZ', b: '0d7e2d' },
      { top: 1.85, base: 2.84, f: 'fSi', b: '540679' },
      { top: 2.84, base: 3.57, f: 'fK', b: '62a923' },
      { top: 3.57, base: 4.36, f: 'fV', b: 'a6a877' },
      { top: 4.36, base: 4.73, f: 'fK', b: '62a923' },
      { top: 4.73, base: 6.55, f: 'fSi', b: '2ad749' },
      { top: 6.55, base: 9.49, f: 'fZ', b: 'dc5b80' },
      { top: 9.49, base: 10.89, f: 'fSi', b: '0a6dee' },
      { top: 10.89, base: 16.42, f: 'fZ', b: 'dc5b80' },
      { top: 16.42, base: 16.98, f: 'fSi', b: '2044d2' },
      { top: 16.98, base: 19.37, f: 'fZ', b: 'dc5b80' },
      { top: 19.37, base: 24.83, f: 'fK', b: '0ca539' },
    ])
    const s6 = col('S6', 12.68, [
      { top: 0.05, base: 2.6, f: 'fK', b: '62a923' },
      { top: 2.6, base: 3.0, f: 'fSi', b: '540679' },
      { top: 3.0, base: 5.03, f: 'fK', b: '62a923' },
      { top: 5.03, base: 7.1, f: 'fV', b: 'a6a877' },
      { top: 7.1, base: 8.0, f: 'fK', b: '62a923' },
      { top: 8.0, base: 8.94, f: 'fSi', b: '2ad749' },
      { top: 8.94, base: 18.01, f: 'fZ', b: 'dc5b80' },
      { top: 18.01, base: 18.66, f: 'fSi', b: '54492a' },
      { top: 18.66, base: 23.17, f: 'fK', b: '0ca539' },
    ])
    const regions = computePartitionFill(s2, s6)
    // Must produce at least one region.
    expect(regions.length).toBeGreaterThan(0)
    // Core invariant: no gap, no overlap.
    assertTiles(regions, s2, s6)
  })
})
