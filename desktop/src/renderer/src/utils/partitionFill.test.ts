/**
 * Tests for computePartitionFill — true-partition fill between two litho columns.
 *
 * TDD: these are written BEFORE the implementation. Every test exercises the
 * core partition invariant (assertTiles) plus one behavioural property.
 */

import { describe, expect, it } from 'vitest'

import {
  computePartitionFill,
  LENS_PINCH_FRACTION,
  type PartitionColumn,
  type PartitionRegion,
} from './partitionFill'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: build a PartitionColumn. */
function col(
  id: string,
  surfaceElevM: number,
  units: { top: number; base: number; f: string; b: string | null }[],
): PartitionColumn {
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
 * Accepts an optional ``excludeKinds`` set — regions whose ``kind`` is in that
 * set are filtered out before the tiling check.  Use this to exclude lens
 * regions (``kind: 'lens'``) which deliberately overlay their matrix quad and
 * are therefore NOT part of the tile partition.
 *
 * At 25 evenly-spaced fractions across [0, 1], verifies that the regions'
 * vertical intervals at that fraction:
 *   (a) cover the FULL column height (no gap at the top or bottom), and
 *   (b) are CONTIGUOUS (no internal gap, no overlap).
 *
 * The column height at fraction f is linearly interpolated between the left
 * surface+floor and the right surface+floor.
 */
function assertTiles(
  regions: PartitionRegion[],
  left: PartitionColumn,
  right: PartitionColumn,
  excludeKinds: Set<PartitionRegion['kind']> = new Set(['lens']),
): void {
  const tilingRegions = regions.filter((r) => !excludeKinds.has(r.kind))
  if (tilingRegions.length === 0) return

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
    for (const region of tilingRegions) {
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

  // HP1 — a lone interior pinch tapers to an apex at fraction 0.5 (NOT to the
  // neighbour at fraction 1), with the enclosing matrix closing beyond it.
  it('HP1: lone interior pinch tips at 50%, matrix closes, tiles', () => {
    // left:  Clay-A 0-5 | Sand 5-9 (lone) | Clay-B 9-14
    // right: Clay-A 0-5 | Clay-B 5-14   (Sand absent → interfaces converge right)
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 9, f: 'sand', b: 'sand' },
      { top: 9, base: 14, f: 'clayB', b: 'cB' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 14, f: 'clayB', b: 'cB' },
    ])
    const regions = computePartitionFill(left, right)

    const sand = regions.filter((r) => r.formationId === 'sand')
    expect(sand).toHaveLength(1)
    expect(sand[0].kind).toBe('pinch')
    // Apex is the deepest-into-the-gap vertex; it must sit at ~0.5, never 1.
    const maxFraction = Math.max(...sand[0].polygon.map((p) => p.fraction))
    expect(maxFraction).toBeCloseTo(0.5, 6)
    // The enclosing matrix extends INTO the interval: clayA and clayB each
    // appear in MORE THAN ONE region (the quad + the extension triangle).
    expect(regions.filter((r) => r.formationId === 'clayA').length).toBeGreaterThanOrEqual(2)
    expect(regions.filter((r) => r.formationId === 'clayB').length).toBeGreaterThanOrEqual(2)
    // Still a true partition.
    assertTiles(regions, left, right)
  })

  // CT1 — a unit below a too-shallow neighbour's floor carries THROUGH at full
  // width (fraction 0→1), not a pinch to the neighbour.
  it('CT1: deep unit below a shallow neighbour carries through full-width', () => {
    // left reaches 23 m; right (a shallow borehole) stops at 17 m.
    // left:  Clay 0-10 | Sand 10-17 | Silt 17-23
    // right: Clay 0-10 | Sand 10-17           (no data below 17)
    const left = col('L', 10, [
      { top: 0, base: 10, f: 'clay', b: 'clay' },
      { top: 10, base: 17, f: 'sand', b: 'sand' },
      { top: 17, base: 23, f: 'silt', b: 'silt' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 10, f: 'clay', b: 'clay' },
      { top: 10, base: 17, f: 'sand', b: 'sand' },
    ])
    const regions = computePartitionFill(left, right)

    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    // A full-width flat BAND reaches the unit's full depth on BOTH sides — i.e.
    // it has all four corners, crucially (1, −13). A pinch to the shallow
    // neighbour only reaches (1, −7) (it tapers), so the bottom-RIGHT corner is
    // the discriminating fact: present for a carry-through, absent for a pinch.
    const hasCorner = (frac: number, elev: number): boolean =>
      silt[0].polygon.some(
        (p) => Math.abs(p.fraction - frac) < 1e-6 && Math.abs(p.elevation - elev) < 1e-6,
      )
    expect(hasCorner(0, -7)).toBe(true)
    expect(hasCorner(1, -7)).toBe(true)
    expect(hasCorner(1, -13)).toBe(true) // ← fails for a pinch triangle
    expect(hasCorner(0, -13)).toBe(true)
  })

  // CT2 — a same-depth extra bed (NOT below the neighbour's floor) still pinches
  // (a genuine thinning-out, not a data gap).
  it('CT2: an unmatched bed within both columns depth still pinches', () => {
    const left = col('L', 10, [
      { top: 0, base: 9, f: 'clay', b: 'clay' },
      { top: 9, base: 14, f: 'silt', b: 'silt' },
    ])
    const right = col('R', 10, [{ top: 0, base: 14, f: 'clay', b: 'clay' }])
    const regions = computePartitionFill(left, right)
    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('pinch')
    // It is a tapering triangle, NOT a flat full-width band.
    const elevs = silt[0].polygon.map((p) => p.elevation)
    const isFlat = Math.abs(Math.max(...elevs) - Math.min(...elevs)) < 1e-6
    expect(isFlat).toBe(false)
  })

  // SP1 — a SURFACE-interval pinch (top unit absent on the neighbour) tips at
  // 50% with its apex ON the surface, the below-matrix closing up beyond it.
  it('SP1: surface pinch tips at 50% on the surface line', () => {
    // left:  Veen 0-3 (surface, lone) | Klei 3-10
    // right: Klei 0-10                 (Veen absent → surface pinch)
    const left = col('L', 10, [
      { top: 0, base: 3, f: 'veen', b: 'veen' },
      { top: 3, base: 10, f: 'klei', b: 'klei' },
    ])
    const right = col('R', 10, [{ top: 0, base: 10, f: 'klei', b: 'klei' }])
    const regions = computePartitionFill(left, right)
    const veen = regions.filter((r) => r.formationId === 'veen')
    expect(veen).toHaveLength(1)
    expect(veen[0].kind).toBe('pinch')
    // Tips at 50%, not the neighbour.
    expect(Math.max(...veen[0].polygon.map((p) => p.fraction))).toBeCloseTo(0.5, 6)
    // Apex sits ON the surface (elevation 10), not mid-elevation.
    const apex = veen[0].polygon.find((p) => Math.abs(p.fraction - 0.5) < 1e-6)!
    expect(apex.elevation).toBeCloseTo(10, 6)
    // The below-matrix (klei) closes beyond the apex → klei appears twice.
    expect(regions.filter((r) => r.formationId === 'klei').length).toBeGreaterThanOrEqual(2)
    assertTiles(regions, left, right)
  })

  // MP1 — TWO stacked interior pinches both tip at 50% (the SILT+ZAND case from
  // the real Section-2 data).
  it('MP1: two stacked interior pinches both tip at 50%', () => {
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'kA', b: 'kA' },
      { top: 5, base: 7, f: 'silt', b: 'silt' },
      { top: 7, base: 9, f: 'zand', b: 'zand' },
      { top: 9, base: 14, f: 'kB', b: 'kB' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'kA', b: 'kA' },
      { top: 5, base: 14, f: 'kB', b: 'kB' },
    ])
    const regions = computePartitionFill(left, right)
    for (const fid of ['silt', 'zand']) {
      const r = regions.filter((x) => x.formationId === fid)
      expect(r).toHaveLength(1)
      expect(r[0].kind).toBe('pinch')
      expect(Math.max(...r[0].polygon.map((p) => p.fraction))).toBeCloseTo(0.5, 6)
    }
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
  // PF6 — (formerly PF-REAL): Real CS3 S2→S6 data tiles with no gap or overlap
  // -----------------------------------------------------------------------
  it('PF6 — real CS3 S2→S6 data tiles with no gap or overlap', () => {
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
    // The two silt lenses inside the sand on S2 (0a6dee, 2044d2) must be
    // extracted as lens pinch-outs, so the sand (dc5b80) must appear as a
    // CONTINUOUS quad (no spurious dc5b80 pinch).
    const dcRegions = regions.filter((r) => r.bodyId === 'dc5b80')
    expect(
      dcRegions.every((r) => r.kind === 'quad'),
      'dc5b80 (sand) must be continuous quads only — no spurious pinch after lens extraction',
    ).toBe(true)
    // The silt lenses must be emitted as lens kind, not pinch.
    expect(regions.some((r) => r.bodyId === '0a6dee' && r.kind === 'lens')).toBe(true)
    expect(regions.some((r) => r.bodyId === '2044d2' && r.kind === 'lens')).toBe(true)
    // Core invariant: no gap, no overlap in the main (non-lens) regions.
    assertTiles(regions, s2, s6)
  })

  // -----------------------------------------------------------------------
  // PF7 — Synthetic enclosed lens: sand/silt/sand on L, sand on R
  //
  // The silt is enclosed by the same sand body on both sides on L, and sand
  // is present on R.  The silt MUST be extracted as a horizontal lens pinch-out
  // (kind:'lens'), NOT a partition 'pinch'.  The sand MUST be a single continuous
  // quad.  The lens apex fraction must equal LENS_PINCH_FRACTION (≈ 0.45), NOT
  // 0 or 1.  The apex elevation must be the silt's OWN mid-elevation.
  // -----------------------------------------------------------------------
  it('PF7 — enclosed silt lens inside sand: continuous sand quad + horizontal lens pinch-out', () => {
    // L: sand 0-4, silt 4-5, sand 5-10  (silt enclosed by same sand body)
    // R: sand 0-10
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 5, f: 'fSilt', b: 'silt' },
      { top: 5, base: 10, f: 'fSand', b: 'sand' },
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const regions = computePartitionFill(left, right)

    // Sand must appear as exactly ONE quad (no pinch — the pre-pass merged it).
    const sandRegions = regions.filter((r) => r.bodyId === 'sand')
    expect(sandRegions).toHaveLength(1)
    expect(sandRegions[0].kind).toBe('quad')

    // Silt must appear as exactly ONE lens region.
    const siltRegions = regions.filter((r) => r.bodyId === 'silt')
    expect(siltRegions).toHaveLength(1)
    expect(siltRegions[0].kind).toBe('lens')

    // The lens polygon is a left-side triangle:
    //   [{f:0, e:topElev}, {f:LENS_PINCH_FRACTION, e:midElev}, {f:0, e:baseElev}]
    // topElev = leftSurface - 4 = 0 - 4 = -4
    // baseElev = leftSurface - 5 = 0 - 5 = -5
    // midElev = (-4 + -5) / 2 = -4.5
    const poly = siltRegions[0].polygon
    expect(poly).toHaveLength(3)

    // Base edge at fraction 0 (left column).
    const baseEdgePts = poly.filter((p) => p.fraction === 0)
    expect(baseEdgePts).toHaveLength(2)
    const baseEdgeElevs = baseEdgePts.map((p) => p.elevation).sort((a, b) => b - a)
    expect(baseEdgeElevs[0]).toBeCloseTo(-4, 9) // topElev
    expect(baseEdgeElevs[1]).toBeCloseTo(-5, 9) // baseElev

    // Apex at LENS_PINCH_FRACTION (not 0 and not 1).
    const apexPts = poly.filter((p) => p.fraction > 0)
    expect(apexPts).toHaveLength(1)
    expect(apexPts[0].fraction).toBeCloseTo(LENS_PINCH_FRACTION, 9)
    // Apex elevation is the silt's OWN mid-elevation (horizontal, not interpolated).
    expect(apexPts[0].elevation).toBeCloseTo(-4.5, 9)

    // Main-region tiling invariant (lens excluded by default).
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF-REAL-S1 — Real S2→S1 data (the originally-broken case)
  //
  // dc5b80 (sand) is a continuous body on S2 broken by three one-test lenses
  // (a89669, 9d4278, 67cd19) on S1.  After lens extraction the sand must be
  // a continuous quad.  Each lens must render at its OWN elevation, NOT sharing
  // an interval with another lens.
  // -----------------------------------------------------------------------
  it('PF-REAL-S1 — S2→S1: dc5b80 sand continuous, lenses at own elevations, no shared interval', () => {
    // S2: surface 12.95
    const s2 = col('S2', 12.95, [
      { top: 0.05, base: 2.10, f: 'fZ', b: '966cf2' },
      { top: 2.10, base: 2.40, f: 'fSi', b: '540679' },
      { top: 2.40, base: 3.81, f: 'fK', b: 'a6a877' },
      { top: 3.81, base: 4.25, f: 'fK', b: '62a923' },
      { top: 4.25, base: 7.50, f: 'fSi', b: '2ad749' },
      { top: 7.50, base: 12.04, f: 'fZ', b: 'dc5b80' },
      { top: 12.04, base: 12.39, f: 'fSi', b: 'a89669' },
      { top: 12.39, base: 16.97, f: 'fZ', b: 'dc5b80' },
      { top: 16.97, base: 29.42, f: 'fK', b: '0ca539' },
    ])
    // S1: surface 13.13
    const s1 = col('S1', 13.13, [
      { top: 0.05, base: 1.73, f: 'fZ', b: 'c3bb1b' },
      { top: 1.73, base: 2.36, f: 'fZ', b: '966cf2' },
      { top: 2.36, base: 2.80, f: 'fSi', b: '540679' },
      { top: 2.80, base: 3.88, f: 'fK', b: 'a6a877' },
      { top: 3.88, base: 4.95, f: 'fK', b: '62a923' },
      { top: 4.95, base: 5.50, f: 'fSi', b: '2ad749' },
      { top: 5.50, base: 12.78, f: 'fZ', b: 'dc5b80' },
      { top: 12.78, base: 14.47, f: 'fK', b: '9d4278' },
      { top: 14.47, base: 14.98, f: 'fZ', b: 'dc5b80' },
      { top: 14.98, base: 15.54, f: 'fK', b: '67cd19' },
      { top: 15.54, base: 18.37, f: 'fZ', b: 'dc5b80' },
      { top: 18.37, base: 23.81, f: 'fK', b: '0ca539' },
    ])
    const regions = computePartitionFill(s2, s1)
    expect(regions.length).toBeGreaterThan(0)

    // --- dc5b80 (continuous sand) must appear ONLY as quads (no pinch) ---
    const sandRegions = regions.filter((r) => r.bodyId === 'dc5b80')
    expect(
      sandRegions.every((r) => r.kind === 'quad'),
      'dc5b80 sand must render as continuous quads only, no spurious pinch',
    ).toBe(true)

    // --- a89669 is on S2 (left), enclosed in dc5b80: must be a LEFT lens ---
    const a89669Regions = regions.filter((r) => r.bodyId === 'a89669')
    expect(a89669Regions).toHaveLength(1)
    expect(a89669Regions[0].kind).toBe('lens')
    // Left lens: base edge at fraction 0, apex at fraction = LENS_PINCH_FRACTION.
    const a89669Poly = a89669Regions[0].polygon
    expect(a89669Poly).toHaveLength(3)
    const a89669Apex = a89669Poly.find((p) => p.fraction > 0)!
    expect(a89669Apex.fraction).toBeCloseTo(LENS_PINCH_FRACTION, 9)
    // Apex elevation = mid of lens on S2: surface=12.95, top=12.04, base=12.39
    // topElev = 12.95 - 12.04 = 0.91, baseElev = 12.95 - 12.39 = 0.56, mid = 0.735
    expect(a89669Apex.elevation).toBeCloseTo((12.95 - 12.04 + (12.95 - 12.39)) / 2, 6)

    // --- 9d4278 is on S1 (right), enclosed in dc5b80: must be a RIGHT lens ---
    const nd4278Regions = regions.filter((r) => r.bodyId === '9d4278')
    expect(nd4278Regions).toHaveLength(1)
    expect(nd4278Regions[0].kind).toBe('lens')
    // Right lens: base edge at fraction 1, apex at fraction = 1 - LENS_PINCH_FRACTION.
    const nd4278Poly = nd4278Regions[0].polygon
    expect(nd4278Poly).toHaveLength(3)
    const nd4278Apex = nd4278Poly.find((p) => p.fraction < 1)!
    expect(nd4278Apex.fraction).toBeCloseTo(1 - LENS_PINCH_FRACTION, 9)
    // Apex elevation = mid of lens on S1: surface=13.13, top=12.78, base=14.47
    // topElev = 13.13 - 12.78 = 0.35, baseElev = 13.13 - 14.47 = -1.34, mid = -0.495
    expect(nd4278Apex.elevation).toBeCloseTo((13.13 - 12.78 + (13.13 - 14.47)) / 2, 6)

    // --- 67cd19 is on S1 (right), enclosed in dc5b80: must be a RIGHT lens ---
    const c67Regions = regions.filter((r) => r.bodyId === '67cd19')
    expect(c67Regions).toHaveLength(1)
    expect(c67Regions[0].kind).toBe('lens')
    const c67Poly = c67Regions[0].polygon
    expect(c67Poly).toHaveLength(3)
    const c67Apex = c67Poly.find((p) => p.fraction < 1)!
    expect(c67Apex.fraction).toBeCloseTo(1 - LENS_PINCH_FRACTION, 9)
    // Apex elevation = mid of lens on S1: surface=13.13, top=14.98, base=15.54
    // topElev = 13.13 - 14.98 = -1.85, baseElev = 13.13 - 15.54 = -2.41, mid = -2.13
    expect(c67Apex.elevation).toBeCloseTo((13.13 - 14.98 + (13.13 - 15.54)) / 2, 6)

    // --- 9d4278 and 67cd19 must NOT share an interval:
    //     their apex elevations must be distinct (one near 0.35 mTAW, the other near -1.85 mTAW).
    const nd4278MidElev = nd4278Apex.elevation
    const c67MidElev = c67Apex.elevation
    expect(Math.abs(nd4278MidElev - c67MidElev)).toBeGreaterThan(1.0)

    // --- Main-region tiling invariant (lenses excluded) ---
    assertTiles(regions, s2, s1)
  })
})
