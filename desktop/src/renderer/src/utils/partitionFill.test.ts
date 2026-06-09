/**
 * Tests for computePartitionFill — true-partition fill between two litho columns.
 *
 * TDD: these are written BEFORE the implementation. Every test exercises the
 * core partition invariant (assertTiles) plus one behavioural property.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyTermination,
  computePartitionFill,
  computeSectionFill,
  LENS_PINCH_FRACTION,
  matchColumns,
  type ContactTermination,
  type CorrelationEdge,
  type Correlated,
  type MatchUnit,
  type PartitionColumn,
  type PartitionRegion,
} from './partitionFill'

/** Build the edge-lookup predicate the production code uses (order-independent). */
function predicate(edges: CorrelationEdge[]): Correlated {
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const set = new Set(edges.map((e) => key(e.a, e.b)))
  return (a, b) => set.has(key(a, b))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: build a PartitionColumn. layerId is auto-assigned ``id#index``. */
function col(
  id: string,
  surfaceElevM: number,
  units: { top: number; base: number; f: string; b: string | null }[],
): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM,
    units: units.map((u, i) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      bodyId: u.b,
      layerId: `${id}#${i}`,
    })),
  }
}

/**
 * Derive correlation edges from the test fixtures' shared ``bodyId`` — two
 * cross-column units with the same bodyId are treated as explicitly correlated
 * (an edge between their layerIds). This is the test convention for "these
 * band": the fixtures express correlation via bodyId, and the edge model
 * consumes it the same way the real overlay consumes drawn edges. A unit with a
 * UNIQUE bodyId is uncorrelated.
 */
function edgesFromBodyId(...columns: PartitionColumn[]): CorrelationEdge[] {
  const edges: CorrelationEdge[] = []
  for (let ci = 0; ci < columns.length; ci += 1) {
    for (let cj = ci + 1; cj < columns.length; cj += 1) {
      for (const u of columns[ci].units) {
        for (const v of columns[cj].units) {
          if (u.bodyId && u.bodyId === v.bodyId) edges.push({ a: u.layerId, b: v.layerId })
        }
      }
    }
  }
  return edges
}

/** computePartitionFill with edges auto-derived from the fixtures' bodyId. */
function pf(
  left: PartitionColumn,
  right: PartitionColumn,
  lensApexOverrides?: Parameters<typeof computePartitionFill>[3],
): PartitionRegion[] {
  return computePartitionFill(left, right, edgesFromBodyId(left, right), lensApexOverrides)
}

/** computeSectionFill with edges auto-derived from the fixtures' bodyId. */
function sf(...columns: PartitionColumn[]): ReturnType<typeof computeSectionFill> {
  return computeSectionFill(columns, edgesFromBodyId(...columns))
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
  excludeKinds: Set<PartitionRegion['kind']> = new Set(),
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

  // EVEN count so the midpoint fraction 0.5 is never sampled exactly. A
  // mismatched-matrix facies seam (and onlap tips) land on 0.5; at that exact
  // line the two half-trapezoids each report the full interval height (they
  // share the seam line — a true partition with measure-zero contact), which a
  // sample landing on 0.5 would mis-read as an overlap. Sampling between 0.479
  // and 0.521 checks coverage just as densely without the seam-line artifact.
  const SAMPLE_COUNT = 24
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
      // Pair crossings into solid spans (even-odd scanline). A CONVEX region
      // crosses x=f exactly twice → one span [min,max] (identical to the old
      // behaviour). A CONCAVE region (a matrix with a carved lens notch) crosses
      // 4 times → two spans straddling the notch; min/max would wrongly fill the
      // notch hole and read as a lens-over-matrix overlap. Odd counts (x=f grazes
      // a vertex) fall back to the [min,max] span.
      ys.sort((a, b) => a - b)
      if (ys.length === 2 || ys.length % 2 === 1) {
        const lo = ys[0]
        const hi = ys[ys.length - 1]
        if (hi - lo >= EPS) intervals.push([lo, hi])
      } else {
        for (let k = 0; k + 1 < ys.length; k += 2) {
          const lo = ys[k]
          const hi = ys[k + 1]
          if (hi - lo >= EPS) intervals.push([lo, hi])
        }
      }
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
// classifyTermination — per-side contact-correlation count → band/onlap/lens
// ---------------------------------------------------------------------------
//
// Owner's model (2026-06-09): a unit's shape toward a neighbour is decided by how
// many of its TWO bounding contacts are correlated to that neighbour:
//   2 → band   1 → onlap   0 → lens.
// top contact correlated  = an approved edge on THIS unit's layerId;
// base contact correlated = an approved edge on the layerId of the unit BELOW.
describe('classifyTermination', () => {
  // L and R columns; bodyId shared ⇒ an edge between those layers (the test
  // convention from `edgesFromBodyId`). Each unit's contact correlations to R
  // are read from edges on its own / the below layer.
  const neighbourIds = (c: PartitionColumn): ReadonlySet<string> =>
    new Set(c.units.map((u) => u.layerId))

  function classifyAt(
    left: PartitionColumn,
    right: PartitionColumn,
    index: number,
  ): ContactTermination {
    const corr = predicate(edgesFromBodyId(left, right))
    return classifyTermination(left.units, index, neighbourIds(right), corr)
  }

  it('BAND — both bounding contacts correlated to the neighbour', () => {
    // SILT (index 1): its top (shared body "b") and its base = below CLAY's top
    // (shared body "c") both correlate to R → 2 → band.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c' },
    ])
    expect(classifyAt(left, right, 1)).toBe('band')
  })

  it('ONLAP — exactly one bounding contact correlated', () => {
    // SILT top correlated ("b" shared), but the CLAY below is uncorrelated
    // (unique body) so SILT's base contact is not correlated → 1 → onlap.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c-left' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c-right' },
    ])
    expect(classifyAt(left, right, 1)).toBe('onlap')
  })

  it('LENS — neither bounding contact correlated', () => {
    // SILT and the CLAY below are both uncorrelated (unique bodies) → 0 → lens.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b-left' },
      { top: 8, base: 12, f: 'CLAY', b: 'c-left' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b-right' },
      { top: 8, base: 12, f: 'CLAY', b: 'c-right' },
    ])
    expect(classifyAt(left, right, 1)).toBe('lens')
  })

  it('deepest unit — base contact (no unit below) counts as uncorrelated', () => {
    // CLAY (index 2) has no unit below, so only its top can correlate → at most
    // onlap. Here its top is correlated ("c" shared) → 1 → onlap.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'a' },
      { top: 4, base: 8, f: 'SILT', b: 'b' },
      { top: 8, base: 12, f: 'CLAY', b: 'c' },
    ])
    expect(classifyAt(left, right, 2)).toBe('onlap')
  })
})

// ---------------------------------------------------------------------------
// matchColumns — section-wide lithology-aware cross-column matcher
// ---------------------------------------------------------------------------

describe('matchColumns', () => {
  const mu = (formationId: string, layerId: string, topElev: number, baseElev: number): MatchUnit => ({
    formationId,
    layerId,
    topElev,
    baseElev,
  })
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const corr = (...pairs: [string, string][]): Correlated => {
    const s = new Set(pairs.map(([a, b]) => key(a, b)))
    return (a, b) => s.has(key(a, b))
  }
  const none: Correlated = () => false

  it('MC1 — edge-correlated pairs band, in order', () => {
    const L = [mu('SAND', 'la', 0, -5), mu('CLAY', 'lb', -5, -10)]
    const R = [mu('SAND', 'ra', 0, -5), mu('CLAY', 'rb', -5, -10)]
    expect(matchColumns(L, R, corr(['la', 'ra'], ['lb', 'rb']))).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('MC2 — same-lithology OVERLAPPING units connect by geometry even with NO edge (matrix fill)', () => {
    const L = [mu('ZAND', 'la', 0, -7)]
    const R = [mu('ZAND', 'ra', -1, -8)] // overlap, no edge → geometric fallback
    expect(matchColumns(L, R, none)).toEqual([[0, 0]])
  })

  it('MC3 — same-lithology NON-overlapping units with NO edge do NOT connect', () => {
    const L = [mu('KLEI', 'la', 10, 8)]
    const R = [mu('KLEI', 'ra', 2, 0)]
    expect(matchColumns(L, R, none)).toEqual([])
  })

  it('MC4 — never matches across lithology even WITH an edge', () => {
    const L = [mu('ZAND', 'la', 0, -5)]
    const R = [mu('KLEI', 'ra', 0, -5)]
    expect(matchColumns(L, R, corr(['la', 'ra']))).toEqual([])
  })

  it('MC5 — an edge connects a DIPPING correlated bed with NO elevation overlap (the peat)', () => {
    const L = [mu('VEEN', 'lv', 9.47, 8.68)]
    const R = [mu('VEEN', 'rv', 8.27, 6.67)] // 0.41 m gap — no overlap, but correlated
    expect(matchColumns(L, R, corr(['lv', 'rv']))).toEqual([[0, 0]])
    expect(matchColumns(L, R, none)).toEqual([]) // without the edge: no overlap → no connect
  })
})

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
    const regions = pf(left, right)
    expect(regions.every((r) => r.kind === 'quad')).toBe(true)
    expect(regions).toHaveLength(2)
    assertTiles(regions, left, right)
  })

  // HP1 — a lone uncorrelated thin bed between two different clay bands pinches
  // out as a LENS at its own elevation (NOT a tip-at-50% boundary pinch); the
  // thicker neighbouring band closes over it.
  it('HP1: lone interior thin bed pinches as a lens at its own level, tiles', () => {
    // left:  Clay-A 0-5 | Sand 5-9 (lone, thin, uncorrelated) | Clay-B 9-14
    // right: Clay-A 0-5 | Clay-B 5-14   (Sand absent)
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 9, f: 'sand', b: 'sand' },
      { top: 9, base: 14, f: 'clayB', b: 'cB-L' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 14, f: 'clayB', b: 'cB-R' },
    ])
    const regions = pf(left, right)

    const sand = regions.filter((r) => r.formationId === 'sand')
    expect(sand).toHaveLength(1)
    expect(sand[0].kind).toBe('lens')
    // Apex at the lens fraction, at the sand's OWN mid-elevation (depth 7 → 3).
    const apex = sand[0].polygon.find((p) => p.fraction > 0 && p.fraction < 1)!
    expect(apex.fraction).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    expect(apex.elevation).toBeCloseTo(3, 6)
    // The clay bands connect across (the lens overlays them); partition holds.
    expect(regions.some((r) => r.formationId === 'clayA' && r.kind === 'quad')).toBe(true)
    expect(regions.some((r) => r.formationId === 'clayB' && r.kind === 'quad')).toBe(true)
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
    const regions = pf(left, right)

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
    const regions = pf(left, right)
    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('pinch')
    // It is a tapering triangle, NOT a flat full-width band.
    const elevs = silt[0].polygon.map((p) => p.elevation)
    const isFlat = Math.abs(Math.max(...elevs) - Math.min(...elevs)) < 1e-6
    expect(isFlat).toBe(false)
  })

  // CT3 — a rest-pinch ABOVE a too-shallow carry-through band must not overlap
  // it (the real CS1 gap-11 bug, traced 2026-06-09). R is deeper than L; below
  // the matched SILT band, L has a KLEI that stays a pinch while R's deeper KLEI
  // carries through as a full-width band. The rest-pinch's interval base was the
  // DEEPEST floor, so it filled down INTO the carried band's space → two KLEI
  // regions overlapping. The fix clamps the rest's base to the carried band top.
  it('CT3: a rest-pinch above a carry-through band does not overlap it (tiles)', () => {
    const left = col('L', 0, [
      { top: 0, base: 8, f: 'SILT', b: 'sb' }, // matched band
      { top: 8, base: 10, f: 'KLEI', b: 'kl' }, // L's deepest → a rest-pinch
    ])
    const right = col('R', 0, [
      { top: 0, base: 12, f: 'SILT', b: 'sb' }, // matched band
      { top: 12, base: 18, f: 'KLEI', b: 'kr' }, // below L's floor → carries through
    ])
    const regions = pf(left, right)
    // Both KLEI regions present (the rest-pinch + the carry band).
    expect(regions.filter((r) => r.formationId === 'KLEI').length).toBeGreaterThanOrEqual(2)
    // No two MAIN (non-lens) regions overlap vertically at any fraction. (Not
    // assertTiles: a carry-through fills full-width to the DEEP floor, so the
    // interpolated-floor model assertTiles uses doesn't apply here — the bug we
    // guard against is the rest-pinch dipping INTO the carried band, an overlap.)
    const spanAt = (poly: { fraction: number; elevation: number }[], f: number): [number, number] | null => {
      const es: number[] = []
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const c = poly[(i + 1) % poly.length]
        const lo = Math.min(a.fraction, c.fraction)
        const hi = Math.max(a.fraction, c.fraction)
        if (f < lo - 1e-9 || f > hi + 1e-9) continue
        if (Math.abs(c.fraction - a.fraction) < 1e-12) {
          es.push(a.elevation, c.elevation)
          continue
        }
        const t = (f - a.fraction) / (c.fraction - a.fraction)
        es.push(a.elevation + t * (c.elevation - a.elevation))
      }
      return es.length < 2 ? null : [Math.min(...es), Math.max(...es)]
    }
    const main = regions.filter((r) => r.kind !== 'lens')
    for (let fi = 1; fi < 20; fi++) {
      const f = fi / 20
      const spans = main.map((r) => spanAt(r.polygon, f)).filter((s): s is [number, number] => s !== null)
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const overlap = Math.min(spans[i][1], spans[j][1]) - Math.max(spans[i][0], spans[j][0])
          expect(overlap, `main regions overlap ${overlap.toFixed(2)}m at f=${f}`).toBeLessThan(0.01)
        }
      }
    }
  })

  // LL1 — two STACKED minority lenses on one column keep their OWN depths (the
  // real CS1 lens×lens bug, traced 2026-06-09). When the upper SILT is pulled,
  // the thicker ZAND below floods UP into its space (below.topDepthM = u.topDepthM);
  // if ZAND is then pulled too, its lens must use its ORIGINAL top, else the two
  // lens triangles overlap (a point in two minority bodies — bad for volumetric
  // extraction).
  it('LL1: stacked minority lenses keep their own depths (flood does not corrupt the lower lens)', () => {
    const left = col('L', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'st' }, // matched band
      { top: 2, base: 4, f: 'SILT', b: 'si' }, // upper lens
      { top: 4, base: 8, f: 'ZAND', b: 'z' }, // lower lens — thicker, floods up when SILT is pulled
      { top: 8, base: 10, f: 'SAND', b: 'sb' }, // matrix below (uncorrelated → fuses)
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'SAND', b: 'st' }])
    const regions = pf(left, right)
    const silt = regions.find((r) => r.formationId === 'SILT' && r.kind === 'lens')
    const zand = regions.find((r) => r.formationId === 'ZAND' && r.kind === 'lens')
    expect(silt).toBeDefined()
    expect(zand).toBeDefined()
    // ZAND lens keeps its OWN top (elev −4), NOT the SILT's top (−2) it flooded into.
    const zandTop = Math.max(...zand!.polygon.map((p) => p.elevation))
    expect(zandTop).toBeCloseTo(-4, 6)
    // The two lenses do NOT overlap — SILT [−4,−2], ZAND [−8,−4] share only the edge.
    const siltBottom = Math.min(...silt!.polygon.map((p) => p.elevation))
    expect(zandTop).toBeLessThanOrEqual(siltBottom + 1e-6)
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
    const regions = pf(left, right)
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

  // MP1 — the SILT+ZAND straddle case from the real Section-2 data.
  //
  // Both beds pinch out as 0-corr lenses; kA floods DOWN over them, so the kA/kB
  // contact slopes (elev 1 on the left → 5 on the right). The silt is genuinely
  // enclosed in sand (it stays above that seam) → it keeps its horizontal
  // pinch-out at its own elevation. The zand abuts the clay kB across the sloping
  // seam: drawn flat it would dip BELOW the seam into kB. Owner's Solution 2 —
  // the bed RESTS ON the clay: its base follows the seam, so no part of zand lies
  // below it and the whole column is a true partition (lens included, no overlap).
  it('MP1: enclosed silt keeps its horizontal apex; straddle zand rests on the kA/kB seam', () => {
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'kA', b: 'kA' },
      { top: 5, base: 7, f: 'silt', b: 'silt' },
      { top: 7, base: 9, f: 'zand', b: 'zand' },
      { top: 9, base: 14, f: 'kB', b: 'kB-L' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'kA', b: 'kA' },
      { top: 5, base: 14, f: 'kB', b: 'kB-R' },
    ])
    const regions = pf(left, right)

    // silt is enclosed in sand (its apex sits above the seam) → unchanged
    // horizontal pinch-out at its own mid-elevation (depth 6 → elev 4).
    const silt = regions.filter((x) => x.formationId === 'silt')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('lens')
    const siltApex = silt[0].polygon.find((p) => p.fraction > 0 && p.fraction < 1)!
    expect(siltApex.fraction).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    expect(siltApex.elevation).toBeCloseTo(4, 6)

    // zand rests on the kA/kB seam: NO vertex dips below it (it never enters kB).
    const seamElev = (f: number): number => 1 + 4 * f // kA/kB contact: (0,1)→(1,5)
    const zand = regions.filter((x) => x.formationId === 'zand')
    expect(zand).toHaveLength(1)
    expect(zand[0].kind).toBe('lens')
    for (const p of zand[0].polygon) {
      expect(p.elevation).toBeGreaterThanOrEqual(seamElev(p.fraction) - 1e-6)
    }

    // TRUE partition including lenses: zand fills its notch, kB stays whole.
    assertTiles(regions, left, right)
  })

  // GAP1 — a column whose accepted layers carry a DEPTH GAP must still tile
  // with no hole: the gap is closed (unit base snapped to the next unit's top)
  // before tiling, matching the litho-band rendering (dogfeed 2026-06-08, S13).
  it('GAP1: a column with a depth gap is closed → no hole in the fill', () => {
    // left has a GAP: silt ends at 7 but clay starts at 9 (a missing 7–9 m).
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'sand', b: 'sand' },
      { top: 5, base: 7, f: 'silt', b: 'silt' },
      { top: 9, base: 14, f: 'clay', b: 'clay' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'sand', b: 'sand' },
      { top: 5, base: 14, f: 'clay', b: 'clay' },
    ])
    const regions = pf(left, right)
    // No hole: the regions cover the column contiguously (the 7–9 m gap is
    // absorbed by the silt extending down to the clay top).
    assertTiles(regions, left, right)
  })

  // LENS1 — a silt enclosed in the SAME clay formation above AND below pinches
  // at its OWN elevation (a lens), not drooping to the lower clay's base
  // (dogfeed 2026-06-08, S10: clay/silt/clay where both clays are formation bb43).
  it('LENS1: silt enclosed in one clay formation pinches at its own level', () => {
    // left:  clay(cA) 0-5 | silt 5-7 | clay(cB) 7-14   (cA, cB both formation 'clay')
    // right: clay(cA) 0-6 | clay(cB) 6-14              (silt absent)
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'clay', b: 'cA' },
      { top: 5, base: 7, f: 'silt', b: 'silt' },
      { top: 7, base: 14, f: 'clay', b: 'cB-L' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 6, f: 'clay', b: 'cA' },
      { top: 6, base: 14, f: 'clay', b: 'cB-R' },
    ])
    const regions = pf(left, right)
    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    // Whole-section model: an enclosed minority absent on the neighbour is a
    // LENS (own-elevation apex), and the clay it was embedded in connects as ONE
    // band across the gap (the silt lens overlays it).
    expect(silt[0].kind).toBe('lens')
    const apex = silt[0].polygon.find((p) => p.fraction > 0 && p.fraction < 1)!
    // own mid-elevation: depth (5+7)/2 = 6 → elev 10-6 = 4.
    expect(apex.elevation).toBeCloseTo(4, 6)
    expect(regions.some((r) => r.formationId === 'clay' && r.kind === 'quad')).toBe(true)
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
      { top: 5, base: 10, f: 'fSand', b: 'sand2L' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 10, f: 'fSand', b: 'sand2R' },
    ])
    const regions = pf(left, right)
    // The left-only silt is enclosed by the sand on both sides → a LENS; the
    // sand connects across as a band (whole-section model).
    const silt = regions.filter((r) => r.bodyId === 'silt')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('lens')
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
    const regions = pf(left, right)
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
    const regions = pf(left, right)

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
  // MX1 — UNCORRELATED same-lithology matrix connects by formationId.
  //
  // The live-dogfeed gap (2026-06-08): a sand matrix bracketed by two
  // correlated clay bands, but the sand itself is NOT correlated across (it
  // carries a different bodyId per column). The bodyId pre-pass + LCS can't see
  // it's one body, so today it tiles as opposing pinches at a meeting seam (the
  // "droop"). It must instead connect as ONE quad band spanning fraction 0→1
  // (geometric connectivity by formationId — distinct from PF-REAL-S1 where the
  // sand shares a bodyId).
  // -----------------------------------------------------------------------
  it('MX1: uncorrelated same-formation matrix connects as one band (not a droop seam)', () => {
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' }, // correlated bracket
      { top: 5, base: 12, f: 'ZAND', b: 'zL' }, // matrix sand — uncorrelated (zL)
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' }, // correlated bracket
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' },
      { top: 5, base: 12, f: 'ZAND', b: 'zR' }, // matrix sand — uncorrelated (zR), SAME formation
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' },
    ])
    const regions = pf(left, right)
    const sand = regions.filter((r) => r.formationId === 'ZAND')
    // One connected band, not two opposing pinches.
    expect(sand).toHaveLength(1)
    expect(sand[0].kind).toBe('quad')
    // It spans the whole gap (reaches both columns).
    const fr = sand[0].polygon.map((p) => p.fraction)
    expect(Math.min(...fr)).toBeLessThan(0.01)
    expect(Math.max(...fr)).toBeGreaterThan(0.99)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // MX2 — A minority lens INSIDE an uncorrelated same-lithology matrix.
  //
  // The interval-scoped case the global bodyId pre-pass cannot reach: the sand
  // matrix is uncorrelated (different bodyId per column) AND its two pieces on
  // the left carry DIFFERENT bodyIds (zL ≠ zL2 — uncorrelated sand split by the
  // lens never gets one body), so the silt is NOT "enclosed by the same body"
  // and the bodyId pre-pass leaves it. The naive formationId pre-pass got this
  // WRONG the other way — it extracted the SAND itself as a "lens" because the
  // sand sits between two KLEI brackets (same formation above+below).
  //
  // Correct: extraction must be INTERVAL-SCOPED. Within the clay-bracketed
  // interval, the SILT is enclosed by SAND (the matrix, present on the other
  // column's interval stack) → extract it as a lens. The sand is NOT enclosed by
  // a matrix present in the other column's interval (its brackets are KLEI, which
  // lives only in the matched bands, not the interval) → it stays as the matrix
  // and connects across as ONE band (MX1's connect).
  // -----------------------------------------------------------------------
  it('MX2: a minority silt lens inside an uncorrelated sand matrix → matrix bands, silt pinches', () => {
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' }, // correlated bracket
      { top: 5, base: 8, f: 'ZAND', b: 'zand' }, // matrix sand — OUTER contact correlated (bands)
      { top: 8, base: 9, f: 'SILT', b: 's-lens' }, // minority lens inside the sand
      { top: 9, base: 12, f: 'ZAND', b: 'zL2-uniq' }, // matrix sand — uncorrelated, lower piece (≠ zL)
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' }, // correlated bracket
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' },
      { top: 5, base: 12, f: 'ZAND', b: 'zand' }, // matrix sand — correlated partner of zL
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' },
    ])
    const regions = pf(left, right)

    // The sand matrix connects as ONE band quad spanning the whole gap.
    const sand = regions.filter((r) => r.formationId === 'ZAND')
    expect(sand).toHaveLength(1)
    expect(sand[0].kind).toBe('quad')
    const fr = sand[0].polygon.map((p) => p.fraction)
    expect(Math.min(...fr)).toBeLessThan(0.01)
    expect(Math.max(...fr)).toBeGreaterThan(0.99)

    // The silt is a pinch-out lens floating in the sand, not a quad.
    const silt = regions.filter((r) => r.formationId === 'SILT')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('lens')

    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // ONLAP-TOP — a minority whose TOP touches the bracket tie-line laps UP.
  //
  // A SILT on the left sits just below the correlated SAND-top band (its top IS
  // the top tie-line); its base floats inside the uncorrelated SAND matrix. With
  // exactly ONE correlated bounding contact it is an ONLAP: anchored flat on the
  // top bracket, base laps up to a tip mid-gap ON THE TOP INTERFACE — distinct
  // from a lens (tip at the unit's OWN mid-elevation). The sand matrix connects
  // across as a band underneath.
  // -----------------------------------------------------------------------
  it('ONLAP-TOP: minority touching the top bracket laps up to a tip on the top interface', () => {
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' }, // correlated top bracket
      { top: 4, base: 6, f: 'SILT', b: 'l-silt' }, // onlap — top on the bracket, base floats
      { top: 6, base: 10, f: 'SAND', b: 'l-sand' }, // uncorrelated matrix (l-sand)
      { top: 10, base: 14, f: 'CLAY', b: 'b-clay' }, // correlated base bracket
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' },
      { top: 4, base: 10, f: 'SAND', b: 'r-sand' }, // matrix, uncorrelated (r-sand)
      { top: 10, base: 14, f: 'CLAY', b: 'b-clay' },
    ])
    const regions = pf(left, right)
    // The sand matrix connects as a band spanning the interval (fraction 0 → 1).
    const sandSpans = regions.some(
      (r) =>
        r.formationId === 'SAND' &&
        r.kind === 'quad' &&
        Math.min(...r.polygon.map((p) => p.fraction)) < 0.01 &&
        Math.max(...r.polygon.map((p) => p.fraction)) > 0.99,
    )
    expect(sandSpans).toBe(true)
    // SILT onlap: tip at INTERIOR_PINCH_FRACTION, ON the top bracket (elev −4),
    // NOT the silt's own mid-elevation (−5).
    const silt = regions.filter((r) => r.formationId === 'SILT')
    expect(silt).toHaveLength(1)
    // Whole-section model: in a 2-column gap the silt connects to neither side →
    // a LENS at its own mid-elevation (−5). A true onlap (lapping against a
    // bracket from a connected far neighbour) is exercised by the multi-column
    // section-3 regression. The sand connects across underneath.
    expect(silt[0].kind).toBe('lens')
    const tip = silt[0].polygon.reduce((a, b) => (a.fraction > b.fraction ? a : b))
    expect(tip.elevation).toBeCloseTo(-5, 6)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // LENS-DEEP — a thin UNcorrelated silt sitting in the sand just above the CLAY
  // band (between two DIFFERENT bands) pinches out as a LENS at its own
  // elevation; the sand matrix bands and the clay bands.
  // -----------------------------------------------------------------------
  it('LENS-DEEP: a thin uncorrelated bed between different bands pinches as a lens', () => {
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' }, // correlated band
      { top: 4, base: 8, f: 'SAND', b: 'l-sand' }, // matrix (collapses into the sand band)
      { top: 8, base: 10, f: 'SILT', b: 'l-silt' }, // thin uncorrelated minority
      { top: 10, base: 14, f: 'CLAY', b: 'b-clay-L' }, // bands by overlap (internal contact uncorrelated)
    ])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' },
      { top: 4, base: 10, f: 'SAND', b: 'r-sand' },
      { top: 10, base: 14, f: 'CLAY', b: 'b-clay-R' },
    ])
    const regions = pf(left, right)
    const sandSpans = regions.some(
      (r) =>
        r.formationId === 'SAND' &&
        r.kind === 'quad' &&
        Math.min(...r.polygon.map((p) => p.fraction)) < 0.01 &&
        Math.max(...r.polygon.map((p) => p.fraction)) > 0.99,
    )
    expect(sandSpans).toBe(true)
    const silt = regions.filter((r) => r.formationId === 'SILT')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('lens')
    const apex = silt[0].polygon.find((p) => p.fraction > 0 && p.fraction < 1)!
    expect(apex.elevation).toBeCloseTo(-9, 6) // own mid-elevation (depth (8+10)/2 = 9)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // MISMATCH — no shared matrix: sand-left vs clay-right.
  //
  // The interval background is a DIFFERENT lithology on each column (no matrix
  // connects). Honest representation: a vertical MIDPOINT seam (50/50 — the
  // transition position is unknown) with a STRAIGHT contact. The owner's model
  // (2026-06-09) has NO auto-facies wriggle — a facies/disturbed contact is the
  // engineer's call, not a geometric inference. The two halves TILE (partition).
  // -----------------------------------------------------------------------
  it('MISMATCH: sand-left vs clay-right splits at a midpoint seam (no auto-facies)', () => {
    // Brackets are a DIFFERENT lithology (KLEI / VEEN) than the mismatched
    // matrix (SAND-left vs CLAY-right) so the matrix can't be merged away — a
    // genuine facies transition with no shared background lithology.
    const left = col('L', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'top' }, // correlated top bracket
      { top: 2, base: 10, f: 'SAND', b: 'l-sand' }, // left background
      { top: 10, base: 12, f: 'VEEN', b: 'bot' }, // correlated base bracket
    ])
    const right = col('R', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'top' },
      { top: 2, base: 10, f: 'CLAY', b: 'r-clay' }, // right background (mismatch)
      { top: 10, base: 12, f: 'VEEN', b: 'bot' },
    ])
    const regions = pf(left, right)
    // The interval splits SAND (left half, has a 0.5 vertex but no fraction-1
    // vertex) | CLAY (right half, has both a 0.5 and a fraction-1 vertex).
    const sand = regions.find(
      (r) => r.formationId === 'SAND' && r.polygon.some((p) => p.fraction > 0.4 && p.fraction < 0.6),
    )
    const clay = regions.find(
      (r) =>
        r.formationId === 'CLAY' &&
        r.polygon.some((p) => p.fraction > 0.4 && p.fraction < 0.6) &&
        r.polygon.some((p) => p.fraction > 0.99),
    )
    expect(sand).toBeDefined()
    expect(clay).toBeDefined()
    // Both meet at fraction 0.5 (midpoint) with a STRAIGHT contact — the owner's
    // model has no auto-facies wriggle (the seamKind field was removed).
    expect(sand!.polygon.some((p) => Math.abs(p.fraction - 0.5) < 1e-6)).toBe(true)
    expect(clay!.polygon.some((p) => Math.abs(p.fraction - 0.5) < 1e-6)).toBe(true)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // NONOVERLAP — two same-lithology minorities at DIFFERENT depths stay as two
  // separate lenses (NOT merged into one band). Each silt is enclosed by the
  // sand matrix on its OWN column at its OWN level; they do not align, so they
  // pinch out independently while the sand connects across as the band.
  // -----------------------------------------------------------------------
  it('NONOVERLAP: same-lithology minorities at different depths stay separate lenses', () => {
    const left = col('L', 0, [
      { top: 0, base: 2, f: 'SAND', b: 't' }, // correlated bracket
      { top: 2, base: 4, f: 'SAND', b: 'lsa' }, // matrix
      { top: 4, base: 5, f: 'SILT', b: 'l-silt' }, // enclosed lens (shallow)
      { top: 5, base: 10, f: 'SAND', b: 'lsb' }, // matrix
      { top: 10, base: 12, f: 'CLAY', b: 'b' }, // correlated bracket
    ])
    const right = col('R', 0, [
      { top: 0, base: 2, f: 'SAND', b: 't' },
      { top: 2, base: 7, f: 'SAND', b: 'rsa' },
      { top: 7, base: 8, f: 'SILT', b: 'r-silt' }, // enclosed lens (deeper)
      { top: 8, base: 10, f: 'SAND', b: 'rsb' },
      { top: 10, base: 12, f: 'CLAY', b: 'b' },
    ])
    const regions = pf(left, right)
    // Two separate silt lenses, not one spanning band.
    const silts = regions.filter((r) => r.formationId === 'SILT')
    expect(silts).toHaveLength(2)
    expect(silts.every((r) => r.kind === 'lens')).toBe(true)
    // Their apexes sit at distinct (own) elevations (−4.5 vs −7.5), so neither spans.
    const apexElevs = silts.map((r) => r.polygon.find((p) => p.fraction > 0 && p.fraction < 1)!.elevation)
    expect(Math.abs(apexElevs[0] - apexElevs[1])).toBeGreaterThan(1)
    // The sand matrix connects across as a band.
    const sandSpans = regions.some(
      (r) =>
        r.formationId === 'SAND' &&
        r.kind === 'quad' &&
        Math.min(...r.polygon.map((p) => p.fraction)) < 0.01 &&
        Math.max(...r.polygon.map((p) => p.fraction)) > 0.99,
    )
    expect(sandSpans).toBe(true)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // SEC3 — the dogfeed regression: test.strix cross-section 3 (S2·S1·B4·S4·S3).
  //
  // The deep ``857`` package lumps a heterogeneous, varying-count stack per
  // column (S1 has 5 units, B4 has 1). body_id-only matching left the deep sand
  // unmatched → it drooped. With lithology matching (reduceMinorities +
  // matchColumns) every deep ZAND that has a same-lithology neighbour at
  // overlapping depth must CONNECT as a band, not tip to a point mid-gap.
  // (formationId == lithology in this litho model — one formation per soil code.)
  // -----------------------------------------------------------------------
  it('SEC3: the dogfeed S1→B4 deep package connects (no sand drooping to a point)', () => {
    const S2 = col('S2', 12.95, [
      { top: 0.05, base: 2.1, f: 'KLEI', b: '170' },
      { top: 2.1, base: 2.4, f: 'SILT', b: '3e1' },
      { top: 2.4, base: 3.81, f: 'VEEN', b: '170' },
      { top: 3.81, base: 4.25, f: 'KLEI', b: '857' },
      { top: 4.25, base: 7.5, f: 'SILT', b: '42e' },
      { top: 7.5, base: 12.04, f: 'ZAND', b: '42e' },
      { top: 12.04, base: 12.39, f: 'SILT', b: '857' },
      { top: 12.39, base: 16.97, f: 'ZAND', b: '857' },
      { top: 16.97, base: 29.42, f: 'KLEI', b: '857' },
    ])
    const S1 = col('S1', 13.13, [
      { top: 0.05, base: 1.73, f: 'ZAND', b: '170' },
      { top: 1.73, base: 2.36, f: 'KLEI', b: '170' },
      { top: 2.36, base: 2.8, f: 'SILT', b: '3e1' },
      { top: 2.8, base: 3.88, f: 'VEEN', b: '170' },
      { top: 3.88, base: 4.95, f: 'KLEI', b: '857' },
      { top: 4.95, base: 5.5, f: 'SILT', b: '42e' },
      { top: 5.5, base: 12.78, f: 'ZAND', b: '42e' },
      { top: 12.78, base: 14.47, f: 'KLEI', b: '857' },
      { top: 14.47, base: 14.98, f: 'ZAND', b: '857' },
      { top: 14.98, base: 15.54, f: 'SILT', b: '857' },
      { top: 15.54, base: 18.37, f: 'ZAND', b: '857' },
      { top: 18.37, base: 23.81, f: 'KLEI', b: '857' },
    ])
    const B4 = col('B4', 11.7, [
      { top: 0, base: 0.48, f: 'ZAND', b: '170' },
      { top: 0.48, base: 1.53, f: 'KLEI', b: '170' },
      { top: 1.53, base: 1.87, f: 'SILT', b: '3e1' },
      { top: 1.87, base: 3.75, f: 'VEEN', b: '170' },
      { top: 3.75, base: 4.0, f: 'KLEI', b: '857' },
      { top: 4.0, base: 7.0, f: 'SILT', b: '42e' },
      { top: 7.0, base: 18.35, f: 'ZAND', b: '42e' },
      { top: 18.35, base: 23.0, f: 'KLEI', b: '857' },
    ])
    // NO edges: the deep package is UNCORRELATED (the shared 857 body_id is the
    // resolver's over-lump, not a real correlation) — so the matrix must connect
    // by GEOMETRY alone, and the clay/silt interbeds pinch as lenses.
    const regions = computePartitionFill(S1, B4, [])
    // Every ZAND region in the S1→B4 gap is a connected band (quad) — none tips
    // to a point mid-gap. (The deep ZAND package is the bug the user circled.)
    const zandDroops = regions.filter(
      (r) =>
        r.formationId === 'ZAND' &&
        r.kind === 'pinch' &&
        r.polygon.some((p) => p.fraction > 0.02 && p.fraction < 0.98),
    )
    expect(zandDroops).toHaveLength(0)
    assertTiles(regions, S1, B4)
    // The two upstream gaps also tile cleanly (the matrix connects, lenses overlay).
    assertTiles(computePartitionFill(S2, S1, []), S2, S1)
  })

  // -----------------------------------------------------------------------
  // SEC-PEAT — the dogfeed continuity bug: a dipping CORRELATED peat must stay
  // one band THROUGH a shared column, not break into per-gap lenses.
  //
  // S5·S2·S6: the VEEN (peat, body ea1) dips, so its elevations on S2 do NOT
  // overlap S5/S6 — but it is correlated. The whole-section resolve reduces S2
  // ONCE (so it is identical in both its gaps) and the body-aware present-check
  // keeps the correlated-but-dipping peat → it bands continuously through S2.
  // -----------------------------------------------------------------------
  it('SEC-PEAT: a dipping correlated peat stays one continuous band through a shared column', () => {
    const S5 = col('S5', 12.47, [
      { top: 0.05, base: 0.85, f: 'KLEI', b: 'ea1' },
      { top: 0.85, base: 1.69, f: 'SILT', b: 'ea1' },
      { top: 1.69, base: 4.2, f: 'KLEI', b: 'ea4' },
      { top: 4.2, base: 5.8, f: 'VEEN', b: 'ea1' },
      { top: 5.8, base: 6.23, f: 'KLEI', b: 'ea8' },
      { top: 6.23, base: 7.06, f: 'SILT', b: 'ea4' },
      { top: 7.06, base: 18.81, f: 'ZAND', b: 'ea4' },
      { top: 18.81, base: 24.9, f: 'KLEI', b: 'ea8' },
    ])
    const S2 = col('S2', 13.04, [
      { top: 0.05, base: 1.85, f: 'ZAND', b: 'ea3' },
      { top: 1.85, base: 2.84, f: 'SILT', b: 'ea1' },
      { top: 2.84, base: 3.57, f: 'KLEI', b: 'ea4' },
      { top: 3.57, base: 4.36, f: 'VEEN', b: 'ea1' },
      { top: 4.36, base: 4.73, f: 'KLEI', b: 'ea8' },
      { top: 4.73, base: 6.55, f: 'SILT', b: 'ea4' },
      { top: 6.55, base: 9.49, f: 'ZAND', b: 'ea4' },
      { top: 9.49, base: 10.89, f: 'SILT', b: 'ea8' },
      { top: 10.89, base: 16.42, f: 'ZAND', b: 'ea8' },
      { top: 16.42, base: 16.98, f: 'SILT', b: 'ea8' },
      { top: 16.98, base: 19.37, f: 'ZAND', b: 'ea8' },
      { top: 19.37, base: 24.83, f: 'KLEI', b: 'ea8' },
    ])
    const S6 = col('S6', 12.68, [
      { top: 0.05, base: 2.6, f: 'KLEI', b: 'ea3' },
      { top: 2.6, base: 3.0, f: 'SILT', b: 'ea1' },
      { top: 3.0, base: 5.03, f: 'KLEI', b: 'ea4' },
      { top: 5.03, base: 7.1, f: 'VEEN', b: 'ea1' },
      { top: 7.1, base: 8.0, f: 'KLEI', b: 'ea8' },
      { top: 8.0, base: 8.94, f: 'SILT', b: 'ea4' },
      { top: 8.94, base: 18.01, f: 'ZAND', b: 'ea4' },
      { top: 18.01, base: 18.66, f: 'SILT', b: 'ea8' },
      { top: 18.66, base: 23.17, f: 'KLEI', b: 'ea8' },
    ])
    const regions = sf(S5, S2, S6)
    // VEEN is a connected band (quad) in BOTH gaps, never a lens.
    for (const g of [0, 1]) {
      const veen = regions.filter((r) => r.gapIndex === g && r.formationId === 'VEEN')
      expect(veen.length).toBeGreaterThanOrEqual(1)
      expect(veen.every((v) => v.kind === 'quad')).toBe(true)
    }
    // Continuity: the VEEN's S2 edge is identical across the two gaps (S2 is the
    // RIGHT column of gap 0 and the LEFT column of gap 1).
    const s2Edge = (g: number, frac: number): number[] =>
      regions
        .filter((r) => r.gapIndex === g && r.formationId === 'VEEN')
        .flatMap((v) => v.polygon.filter((p) => Math.abs(p.fraction - frac) < 0.01).map((p) => p.elevation))
        .sort((a, b) => a - b)
    expect(s2Edge(0, 1)).toEqual(s2Edge(1, 0))
  })

  // -----------------------------------------------------------------------
  // MINORITY — geometry fills only the MATRIX; a thin UNcorrelated interbed
  // pinches out even when it overlaps a same-lithology bed on the neighbour.
  //
  // The KLEI/CLAY brackets are correlated (→ band). The SILT is thin + has NO
  // edge (unique body) and overlaps the neighbour's silt — under "geometry only
  // fills the matrix" it must PINCH (lens), not band. The thick ZAND matrix has
  // no edge either but is the background → connects by geometry.
  // -----------------------------------------------------------------------
  it('MINORITY: a thin uncorrelated interbed pinches (lens) though it overlaps; the matrix bands', () => {
    const left = col('L', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'ktop' }, // correlated band
      { top: 2, base: 2.5, f: 'SILT', b: 'lsilt' }, // thin, uncorrelated minority
      { top: 2.5, base: 9, f: 'ZAND', b: 'lsand' }, // thick uncorrelated matrix
      { top: 9, base: 12, f: 'CLAY', b: 'kbot' }, // correlated band
    ])
    const right = col('R', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'ktop' },
      { top: 2, base: 2.6, f: 'SILT', b: 'rsilt' }, // overlaps L's silt, no edge
      { top: 2.6, base: 9, f: 'ZAND', b: 'rsand' }, // thick matrix
      { top: 9, base: 12, f: 'CLAY', b: 'kbot' },
    ])
    const regions = pf(left, right)
    // The silt is two separate lenses (one per column), NOT one band.
    const silt = regions.filter((r) => r.formationId === 'SILT')
    expect(silt).toHaveLength(2)
    expect(silt.every((r) => r.kind === 'lens')).toBe(true)
    // The sand matrix connects across as a band (geometry fallback).
    expect(
      regions.some(
        (r) =>
          r.formationId === 'ZAND' &&
          r.kind === 'quad' &&
          Math.min(...r.polygon.map((p) => p.fraction)) < 0.01 &&
          Math.max(...r.polygon.map((p) => p.fraction)) > 0.99,
      ),
    ).toBe(true)
    assertTiles(regions, left, right)
  })

  // -----------------------------------------------------------------------
  // PF5 — Empty left column
  // -----------------------------------------------------------------------
  it('PF5 — empty left column returns []', () => {
    const left = col('L', 0, [])
    const right = col('R', 0, [{ top: 0, base: 5, f: 'fSand', b: 'sand' }])
    const regions = pf(left, right)
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
      { top: 10.89, base: 16.42, f: 'fZ', b: 'dc5b80-2' },
      { top: 16.42, base: 16.98, f: 'fSi', b: '2044d2' },
      { top: 16.98, base: 19.37, f: 'fZ', b: 'dc5b80-3' },
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
    const regions = pf(s2, s6)
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
      { top: 5, base: 10, f: 'fSand', b: 'sand-lo' },
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const regions = pf(left, right)

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
      { top: 12.39, base: 16.97, f: 'fZ', b: 'dc5b80-s2b' },
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
      { top: 14.47, base: 14.98, f: 'fZ', b: 'dc5b80-s1b' },
      { top: 14.98, base: 15.54, f: 'fK', b: '67cd19' },
      { top: 15.54, base: 18.37, f: 'fZ', b: 'dc5b80-s1c' },
      { top: 18.37, base: 23.81, f: 'fK', b: '0ca539' },
    ])
    const regions = pf(s2, s1)
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

// ---------------------------------------------------------------------------
// carveOverlays — a lens/onlap overlay is SUBTRACTED from the matrix it sits in,
// so the fill becomes a TRUE volumetric partition: every point belongs to
// exactly one region (no point is inside both a lens and its matrix).
//
// These assert with assertTiles called with NO kind exclusions — lenses are now
// genuine tiles (the matrix carries a notch the lens fills).
// ---------------------------------------------------------------------------
describe('carveOverlays — lens carved out of matrix → true partition', () => {
  const ALL: Set<PartitionRegion['kind']> = new Set()

  // -----------------------------------------------------------------------
  // CARVE1 — one left lens inside a sand quad. The sand matrix must carry a
  // NOTCH (a vertex at the lens apex, fraction ≈ 0.45) so the lens triangle and
  // the notched matrix tile cleanly with NO overlap.
  // -----------------------------------------------------------------------
  it('CARVE1 — left lens notches its sand quad; matrix+lens tile with no exclusions', () => {
    // L: sand 0-4, silt 4-5, sand 5-10  → sand merges to one band, silt is a lens.
    // R: sand 0-10.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 5, f: 'fSilt', b: 'silt' },
      { top: 5, base: 10, f: 'fSand', b: 'sand-lo' },
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const regions = pf(left, right)

    // The silt lens is unchanged (still a kind:'lens' triangle).
    const silt = regions.find((r) => r.bodyId === 'silt')!
    expect(silt.kind).toBe('lens')

    // The sand matrix now carries the notch: a vertex AT the lens apex
    // (fraction ≈ LENS_PINCH_FRACTION, elevation = silt mid = -4.5).
    const sand = regions.find((r) => r.bodyId === 'sand' && r.kind === 'quad')!
    const notchApex = sand.polygon.find(
      (p) => Math.abs(p.fraction - LENS_PINCH_FRACTION) < 1e-6,
    )
    expect(notchApex, 'sand quad must carry the lens apex as a notch vertex').toBeDefined()
    expect(notchApex!.elevation).toBeCloseTo(-4.5, 9)

    // TRUE partition: matrix-with-notch + lens tile cleanly, INCLUDING lenses.
    assertTiles(regions, left, right, ALL)
  })

  // -----------------------------------------------------------------------
  // CARVE2 — two enclosed lenses STACKED in one sand quad. Both notches must be
  // cut (both apexes present), ordered, no overlap.
  // -----------------------------------------------------------------------
  it('CARVE2 — two stacked enclosed lenses cut two notches into one quad; tiles', () => {
    const left = col('L', 0, [
      { top: 0, base: 3, f: 'fSand', b: 'sand' },
      { top: 3, base: 4, f: 'fSiltA', b: 'siltA' },
      { top: 4, base: 6, f: 'fSand', b: 'sand-m' },
      { top: 6, base: 7, f: 'fSiltB', b: 'siltB' },
      { top: 7, base: 10, f: 'fSand', b: 'sand-lo' },
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const regions = pf(left, right)

    expect(regions.filter((r) => r.kind === 'lens')).toHaveLength(2)
    const sand = regions.find((r) => r.bodyId === 'sand' && r.kind === 'quad')!
    // Both lens apexes appear as notch vertices on the sand quad (mid-elevs −3.5, −6.5).
    const apexElevs = sand.polygon
      .filter((p) => Math.abs(p.fraction - LENS_PINCH_FRACTION) < 1e-6)
      .map((p) => p.elevation)
      .sort((a, b) => a - b)
    expect(apexElevs).toHaveLength(2)
    expect(apexElevs[0]).toBeCloseTo(-6.5, 9)
    expect(apexElevs[1]).toBeCloseTo(-3.5, 9)
    assertTiles(regions, left, right, ALL)
  })

  // -----------------------------------------------------------------------
  // CARVE3 — one lens on EACH column edge of the same sand quad. Both edges
  // notched, true partition.
  // -----------------------------------------------------------------------
  it('CARVE3 — lenses on both column edges of one quad; both edges notched, tiles', () => {
    // Left has an enclosed silt; right has an enclosed clay — both inside the
    // single continuous sand band.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 5, f: 'fSilt', b: 'silt' },
      { top: 5, base: 10, f: 'fSand', b: 'sand-l' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 6, f: 'fSand', b: 'sand' },
      { top: 6, base: 7, f: 'fClay', b: 'clay' },
      { top: 7, base: 10, f: 'fSand', b: 'sand-r' },
    ])
    const regions = pf(left, right)

    expect(regions.some((r) => r.formationId === 'fSilt' && r.kind === 'lens')).toBe(true)
    expect(regions.some((r) => r.formationId === 'fClay' && r.kind === 'lens')).toBe(true)
    const sand = regions.find((r) => r.bodyId === 'sand' && r.kind === 'quad')!
    // The quad carries a notch vertex on BOTH the left (f≈0.45) and right
    // (f≈0.55) interior fractions.
    expect(sand.polygon.some((p) => Math.abs(p.fraction - LENS_PINCH_FRACTION) < 1e-6)).toBe(true)
    expect(sand.polygon.some((p) => Math.abs(p.fraction - (1 - LENS_PINCH_FRACTION)) < 1e-6)).toBe(
      true,
    )
    assertTiles(regions, left, right, ALL)
  })
})
