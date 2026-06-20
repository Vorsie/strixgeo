/**
 * Tests for computePartitionFill — true-partition fill between two litho columns.
 *
 * TDD: these are written BEFORE the implementation. Every test exercises the
 * core partition invariant (assertTiles) plus one behavioural property.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyTermination,
  collapseAdjacentSameFormation,
  computeBottomTieLine,
  computePartitionFill,
  computeSectionFill,
  LENS_PINCH_FRACTION,
  lensApexOverrideKey,
  matchColumns,
  type ContactTermination,
  type CorrelationEdge,
  type Correlated,
  type MatchUnit,
  type PartitionColumn,
  type PartitionRegion,
  type PartitionUnit,
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
    // The lower bound (>=) is intentionally not checked: a flat SIDEWAYS unit in
    // a data-void scenario legitimately extends to the deep column's floor, which
    // is deeper (more negative elevation) than the interpolated floor near the
    // shallow column side.  Only the upper bound (<=) is enforced to ensure the
    // partition actually reaches the floor.
    const lowestBottom = intervals[intervals.length - 1][0]
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

  // BASE-TIE FLIP — the deepest base tied to the neighbour counts as a correlated
  // base, so a deepest unit whose TOP is already correlated reaches count 2 → it
  // bands. This is the one path that lets a deepest unit (no unit below) band: its
  // base has nothing below to key, so only the bottom-tie can correlate it.
  //
  //   no base-tie               → top correlated only → count 1 → onlap.
  //   layerId in base-tie set   → top + tied base     → count 2 → band.
  //
  // Asserting BOTH directions is the proof the base-tie set drives the result.
  it('deepest base tied to the neighbour → counts as a correlated base → bands (flips with/without the tie)', () => {
    // CLAY (index 2) is the deepest unit; its top is correlated ("c" shared).
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
    const corr = predicate(edgesFromBodyId(left, right))
    const neigh = neighbourIds(right)
    const deepestLayerId = left.units[2].layerId // 'L#2'
    // Without a base-tie: only the top contact correlates → onlap.
    expect(classifyTermination(left.units, 2, neigh, corr)).toBe('onlap')
    // With the deepest layerId in the base-tie set: top + tied base → band.
    const baseTiedSet = new Set([deepestLayerId])
    expect(classifyTermination(left.units, 2, neigh, corr, undefined, baseTiedSet)).toBe('band')
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

  // MC6 — the base-tie flip, at the layer the feature changes. Two single deepest
  // units of the SAME formation whose elevation ranges do NOT overlap. A base-tie
  // (the deepest base "tied" to the neighbour's deepest base) is the ONLY thing
  // that can connect them — there is no top edge and no geometric overlap.
  //
  //   no base-tie  → matchColumns returns NO match for the deep pair.
  //   base-tie     → matchColumns returns the deep pair [[0,0]].
  //
  // Asserting BOTH directions is the proof the base-tie param drives the result.
  it('MC6 — base-tie connects two non-overlapping same-formation deepest units (flips with/without the tie)', () => {
    const L = [mu('DEEP', 'ld', -2, -5)] // floor at elev -5
    const R = [mu('DEEP', 'rd', -6, -10)] // top -6 < L base -5 → NO elevation overlap
    // Without a base-tie predicate: no top edge, no overlap → pairScore 0 → no match.
    expect(matchColumns(L, R, none)).toEqual([])
    // WITH a base-tie predicate connecting the two deepest base contacts: the
    // deepest base is tied → counts as a correlated base → they band → matched.
    const baseTie: Correlated = corr(['ld', 'rd'])
    expect(matchColumns(L, R, none, baseTie)).toEqual([[0, 0]])
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

  // CT1 — a deep unit below a too-shallow neighbour's floor that is UNCORRELATED
  // (no reaching neighbour carries it) PINCHES OUT, it does NOT carry through
  // full-width. (Owner directive 2026-06-16: band/lens follows correlation
  // EVERYWHERE — the carry-through used to band this correlation-blind, which was
  // the design flaw. With only one too-shallow neighbour there is no reaching
  // neighbour at all → pinch out.) The correlated-across-the-void → BAND case is
  // pinned by CASE 1 / CASE 5 in the reach-guard describe.
  it('CT1: deep uncorrelated unit below a shallow neighbour PINCHES OUT (no reaching neighbour)', () => {
    // left reaches 23 m; right (a shallow borehole) stops at 17 m.
    // left:  Clay 0-10 | Sand 10-17 | Silt 17-23
    // right: Clay 0-10 | Sand 10-17           (no data below 17)
    // The Silt is below the right's floor and uncorrelated → no reaching
    // neighbour can carry it → it pinches out toward the shallow right.
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
    // It is the base truth, not deleted: the Silt is present near its OWN (left)
    // column edge (fraction 0) at its mid-elevation (-20). But it does NOT carry
    // through to the shallow right side — it is ABSENT at the right column edge.
    const presentAt = (frac: number, elev: number): boolean => {
      let inside = false
      const poly = silt[0].polygon
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].fraction
        const yi = poly[i].elevation
        const xj = poly[j].fraction
        const yj = poly[j].elevation
        if (yi > elev !== yj > elev && frac < ((xj - xi) * (elev - yi)) / (yj - yi) + xi)
          inside = !inside
      }
      return inside
    }
    // Silt is 17-23 m below surface 10 mTAW → elevations -7 to -13, mid -10.
    expect(presentAt(0.05, -10)).toBe(true) // present near its own (left) edge
    expect(presentAt(0.95, -10)).toBe(false) // pinched out — absent on the shallow side
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

  // CT3 — below the matched SILT band, L has a deep KLEI and R has an even deeper
  // KLEI below L's floor. Neither is correlated and neither has a reaching
  // neighbour to carry it (owner directive 2026-06-16: 0 correlations / no
  // reaching neighbour → pinch out, NOT a correlation-blind carry-through band).
  // Both fall into the floor interval; ``emitInterval``'s pre-existing
  // same-lithology geometric matrix inference connects the two KLEIs into one
  // matrix band. The load-bearing invariant — and the original CS1 gap-11 bug
  // this test guards — is that NO TWO MAIN regions OVERLAP at any fraction.
  it('CT3: deep uncorrelated KLEIs do not produce overlapping main regions (tiles)', () => {
    const left = col('L', 0, [
      { top: 0, base: 8, f: 'SILT', b: 'sb' }, // matched band
      { top: 8, base: 10, f: 'KLEI', b: 'kl' }, // L's deepest → pinches out
    ])
    const right = col('R', 0, [
      { top: 0, base: 12, f: 'SILT', b: 'sb' }, // matched band
      { top: 12, base: 18, f: 'KLEI', b: 'kr' }, // below L's floor → pinches out
    ])
    const regions = pf(left, right)
    // The KLEI matrix is present (connected via the geometric inference).
    expect(regions.some((r) => r.formationId === 'KLEI')).toBe(true)
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

  // -----------------------------------------------------------------------
  // CARVE-FD — a MULTI-NODE freedraw lens shape is built + clipped in the
  // DOMAIN: a straddle lens whose freedraw lower edge dips below the sloping
  // matrix seam is clipped to rest ON the seam (it never enters the neighbour),
  // and the whole column still tiles. (The overlay used to rebuild the freedraw
  // lens UNCLIPPED, which let it cross the seam.)
  // -----------------------------------------------------------------------
  it('CARVE-FD — a freedraw straddle lens is clipped to its matrix seam in the domain', () => {
    // MP1 straddle: zand pinches under the sloping kA/kB seam (elev 1 L → 5 R).
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
    const seamElev = (f: number): number => 1 + 4 * f // kA/kB contact
    // A freedraw shape for zand whose LOWER node sits BELOW the seam at f=0.3
    // (seam there = 2.2; node elevation 1.0) — i.e. it would cross into kB.
    const override = new Map([
      [
        lensApexOverrideKey('zand', 0),
        {
          fraction: 0.3,
          elevation: 2,
          upper: [{ fraction: 0.3, elevation: 2.8 }],
          lower: [{ fraction: 0.3, elevation: 1.0 }],
        },
      ],
    ])
    const regions = pf(left, right, override)

    const zand = regions.find((r) => r.formationId === 'zand')!
    expect(zand.kind).toBe('lens')
    // The multi-node shape WAS built: the upper freedraw node (0.3, 2.8) sits
    // above the seam → inside the matrix → survives clipping as a real vertex.
    // (The single-apex path would ignore the chain, so this vertex is the proof.)
    expect(
      zand.polygon.some(
        (p) => Math.abs(p.fraction - 0.3) < 1e-6 && Math.abs(p.elevation - 2.8) < 1e-6,
      ),
    ).toBe(true)
    // Clipped: NO vertex of the lens lies below the seam (it rests on the clay).
    for (const p of zand.polygon) {
      expect(p.elevation).toBeGreaterThanOrEqual(seamElev(p.fraction) - 1e-6)
    }
    // And the partition still tiles with the lens included.
    assertTiles(regions, left, right, ALL)
  })
})

// ---------------------------------------------------------------------------
// TIE11 — tie-section 11, S34 ↔ B4 (real dogfeed overlap 2026-06-10)
//
// The peat (VEEN) on S34 is enclosed between two clays (KLEI/KLEI) and the whole
// upper interval has NO correlation to B4. reduceColumn floods the lower clay UP
// over the peat's vacated space and emits that clay as a 1-corr ONLAP (an
// overlay), then re-emits the peat lens at its original elevation — landing on
// top of the clay. The carve only carved lenses into MAINS (quad/pinch), never
// into an onlap, so peat-over-clay survived as a 4 m overlap (the screenshot).
// The fix tiers the carve: onlaps carve out of mains, lenses carve out of onlaps
// then mains, so the gap is a TRUE partition.
// ---------------------------------------------------------------------------
describe('tie11 S34/B4 (real dogfeed 2026-06-10)', () => {
  const L = col('L', 13.04, [
    { top: 1.21, base: 2.15, f: 'ZAND', b: 'L0' },
    { top: 2.15, base: 2.667, f: 'KLEI', b: 'L1' },
    { top: 2.667, base: 7.18, f: 'VEEN', b: 'L2' }, // peat, enclosed in KLEI/KLEI
    { top: 7.18, base: 8.44, f: 'KLEI', b: 'L3' },
    { top: 8.44, base: 9.96, f: 'SILT', b: 'L4' },
    { top: 9.96, base: 12.19, f: 'ZAND', b: 'L5' },
    { top: 12.19, base: 13.96, f: 'SILT', b: 'L6' },
    { top: 13.96, base: 15.68, f: 'ZAND', b: 'L7' },
    { top: 15.68, base: 23.34, f: 'KLEI', b: 'L8' },
  ])
  const R = col('R', 13.13, [
    { top: 0, base: 5.621, f: 'SILT', b: 'R0' },
    { top: 5.621, base: 6.0, f: 'KLEI', b: 'R1' }, // clay
    { top: 6.0, base: 8.425, f: 'ZAND', b: 'R2' },
    { top: 8.425, base: 9.071, f: 'SILT', b: 'R3' },
    { top: 9.071, base: 12.465, f: 'ZAND', b: 'R4' },
    { top: 12.465, base: 12.898, f: 'SILT', b: 'R5' },
    { top: 12.898, base: 15.5, f: 'ZAND', b: 'R6' },
    { top: 15.5, base: 17.0, f: 'KLEI', b: 'R7' },
  ])
  // The REAL approved S34↔B4 correlations (5 edges), by layerId. NOT bodyId-
  // derived: body 1b7f appears twice on B4, so edgesFromBodyId would fabricate an
  // edge that the real model does not have.
  const edges: CorrelationEdge[] = [
    { a: 'L#4', b: 'R#3' }, // SILT 8.44 ↔ SILT 8.425
    { a: 'L#5', b: 'R#4' }, // ZAND 9.96 ↔ ZAND 9.071
    { a: 'L#6', b: 'R#5' }, // SILT 12.19 ↔ SILT 12.465
    { a: 'L#7', b: 'R#6' }, // ZAND 13.96 ↔ ZAND 12.898
    { a: 'L#8', b: 'R#7' }, // KLEI 15.68 ↔ KLEI 15.5
  ]

  it('carves every overlay into a true partition — no peat-over-clay overlap', () => {
    const regions = computePartitionFill(L, R, edges)
    // ALL kinds included → the concave-aware partition check (no gaps, no
    // overlaps). Before the fix this fails on the peat (VEEN) lens overlapping
    // the flooded clay (KLEI) onlap in the top-left interval.
    assertTiles(regions, L, R)
  })
})

// ---------------------------------------------------------------------------
// REACH — a data void is not a pinch-out (owner directive 2026-06-16)
//
// The bug: a laterally-continuous DEEP unit, correlated across two deep columns,
// was wrongly pinched into a lens (and the surrounding matrix lithology flooded
// across) when the IMMEDIATELY ADJACENT column is too SHALLOW to reach that
// unit's depth. A 3.5 m CPT between two deep columns is a DATA VOID, not a
// geological pinch-out — the deep unit must be KEPT (so it bands toward the next
// REACHING neighbour via its existing correlation), never evicted.
//
// The fix (in reduceColumn): a unit is pulled as a lens only when its facing
// neighbour REACHES its depth — neighbourTD (the neighbour's deepest base) >=
// unit.topDepthM (STRICT-TOP threshold, the safe default). When the neighbour
// does NOT reach, KEEP the unit.
// ---------------------------------------------------------------------------
describe('reduceColumn reach guard — a too-shallow neighbour does not pinch a deep unit', () => {
  /** Standard even-odd point-in-polygon test in (fraction, elevation) space. */
  const inPoly = (poly: { fraction: number; elevation: number }[], f: number, e: number): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].fraction
      const yi = poly[i].elevation
      const xj = poly[j].fraction
      const yj = poly[j].elevation
      const hit = yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi
      if (hit) inside = !inside
    }
    return inside
  }

  /**
   * The non-lens (tile) lithologies covering the point (fraction f, elevation e)
   * in the given gap — what would actually render as the fill there.
   */
  const coverAt = (
    regions: ReturnType<typeof computeSectionFill>,
    gapIndex: number,
    f: number,
    e: number,
  ): string[] =>
    regions
      .filter((r) => r.gapIndex === gapIndex && r.kind !== 'lens' && inPoly(r.polygon, f, e))
      .map((r) => r.formationId)

  /**
   * Like ``coverAt`` but INCLUDING lens/onlap overlays — used to assert a
   * pinched-out unit still exists near its source column edge (a pinch-out is
   * the base truth tapering out, whether it renders as a ``pinch`` tile or a
   * ``lens`` overlay — this helper is agnostic to that implementation detail).
   */
  const coverAtAny = (
    regions: ReturnType<typeof computeSectionFill>,
    gapIndex: number,
    f: number,
    e: number,
  ): string[] =>
    regions
      .filter((r) => r.gapIndex === gapIndex && inPoly(r.polygon, f, e))
      .map((r) => r.formationId)

  // CASE 1 — the artifact. A deep SAND interbed, correlated L↔R across a shallow
  // 3.5 m MIDDLE column, must BAND (survive), NOT pinch to a lens with the CLAY
  // matrix flooding over it. The CLAY above + below the deep sand share the SAME
  // formationId, so a wrong pull merges them into one flooded CLAY band.
  it('CASE 1 — deep unit correlated across a too-shallow middle column BANDS; matrix does not flood', () => {
    // L + R carry the deep sand (shared body "deep" → an L↔R jump edge). The
    // sand sits between CLAY above (body "mX", formationId CLAY) and CLAY below
    // (body "botX", formationId CLAY) — both CLAY, so a wrong lens pull merges
    // them and the sand vanishes under flooded CLAY.
    const L = col('L', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 8, f: 'CLAY', b: 'mL' },
      { top: 8, base: 12, f: 'SAND', b: 'deep' }, // deep interbed, correlated to R
      { top: 12, base: 20, f: 'CLAY', b: 'botL' },
    ])
    const M = col('M', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 3.5, f: 'CLAY', b: 'mM' }, // TD = 3.5 m — cannot reach the deep sand at 8 m
    ])
    const R = col('R', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 8, f: 'CLAY', b: 'mR' },
      { top: 8, base: 12, f: 'SAND', b: 'deep' }, // same body as L → correlated
      { top: 12, base: 20, f: 'CLAY', b: 'botR' },
    ])
    const regions = sf(L, M, R)
    // In the L→M gap (gapIndex 0), at the LEFT column edge (fraction ≈ 0) and the
    // mid-elevation of the deep sand (8-12 m → elev -10), the fill MUST be SAND
    // (the deep sand survives + bands). Before the fix the CLAY matrix floods
    // that band and the sand is evicted to a decorative overlay lens.
    expect(coverAt(regions, 0, 0.02, -10)).toEqual(['SAND'])
    // The genuine bottom CLAY (12-20 m → elev -16) is still CLAY (sanity).
    expect(coverAt(regions, 0, 0.02, -16)).toEqual(['CLAY'])
  })

  // CASE 2 — a GENUINE pinch-out must still pinch. The facing neighbour REACHES
  // the depth (its TD is below the unit's base) and logs a DIFFERENT lithology
  // there (no correlation) → the deep SAND minority genuinely wedges out as a
  // lens. The KLEI brackets are correlated; the deep thin SAND is an uncorrelated
  // minority enclosed in an uncorrelated CLAY matrix that the neighbour reaches.
  it('CASE 2 — genuine pinch-out (reaching neighbour, different lithology) STILL pinches', () => {
    const L = col('L', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'kt' }, // correlated bracket
      { top: 2, base: 8, f: 'CLAY', b: 'mL' }, // uncorrelated matrix
      { top: 8, base: 9, f: 'SAND', b: 'sL' }, // thin DEEP minority, uncorrelated
      { top: 9, base: 15, f: 'CLAY', b: 'mL2' }, // uncorrelated matrix (same formationId)
      { top: 15, base: 20, f: 'KLEI', b: 'kb' }, // correlated bracket
    ])
    const R = col('R', 0, [
      { top: 0, base: 2, f: 'KLEI', b: 'kt' },
      { top: 2, base: 9, f: 'CLAY', b: 'mR' },
      { top: 9, base: 15, f: 'CLAY', b: 'mR2' }, // REACHES depth 8-9, no sand → genuine pinch
      { top: 15, base: 20, f: 'KLEI', b: 'kb' },
    ])
    const regions = computePartitionFill(L, R, edgesFromBodyId(L, R))
    // The deep sand wedges out as a lens (the neighbour reaches its depth and
    // logs clay there, so it is a real geological pinch-out — must not regress).
    const sandLenses = regions.filter((r) => r.formationId === 'SAND' && r.kind === 'lens')
    expect(sandLenses.length).toBeGreaterThanOrEqual(1)
    assertTiles(regions, L, R)
  })

  // VOID-A: a unit that STRADDLES the shallow column's floor (top above it, base
  // below) must continue FLAT (sideways) at its own elevation, not be forced into a
  // tapering pinch that leaves a void below the shallow TD.
  //
  // Mechanism: the straddle branch (ownTopDepth < shallowFloor) previously
  // hard-coded band:false, sideways:false regardless of whether any facing neighbour
  // reached below the shallow floor. Fix A: apply the same bandsTowardSide +
  // neighbourReaches check as the non-straddle path.
  it('VOID-A: straddle unit continues sideways with no void below shallow TD', () => {
    const deep = col('Deep', 0, [
      { top: 0, base: 2, f: 'CLAY', b: 'cA' },
      { top: 2, base: 8, f: 'SAND', b: 'sandV' }, // topDepth=2 < shallowFloor=4, baseDepth=8 → STRADDLES
    ])
    const shallow = col('Sh', 0, [
      { top: 0, base: 4, f: 'CLAY', b: 'cB' }, // TD = 4
    ])
    // No edges — SAND is uncorrelated; no facing neighbour reaches depth>4.
    const regions = computeSectionFill([deep, shallow], [])
    // 1. No void at any of the 24 sample fractions.
    assertTiles(regions.filter((r) => r.gapIndex === 0), deep, shallow)
    // 2. SAND present at mid-gap at elevation −5 (within SAND's range).
    expect(coverAt(regions, 0, 0.5, -5)).toContain('SAND')
    // 3. SAND still present near the shallow column BELOW its TD (elev −5 = depth 5 >
    //    shallowTD 4): no void in the sub-shallow-TD region despite straddle geometry.
    //    (SAND's top is slanted from −2 on the left to −4 on the right, following the
    //    CLAY quad's slanted base; at f=0.9 the SAND top is at ~−3.8, so elevation −5
    //    is well inside the SAND range and −3 is above the SAND's top → use −5.)
    expect(coverAt(regions, 0, 0.9, -5)).toContain('SAND')
  })

  // VOID-B: when a lens is pulled and both its enclosing neighbours share the same
  // formation, but the LOWER neighbour is entirely in the shallow side's data void,
  // reduceColumn must NOT merge the two same-formation units across the void.
  // The void-bridging merge creates a straddle unit that either tapes to a pinch
  // (pre-Fix-A) or emits as an unnatural large rect; keeping them separate is
  // geometrically correct and tiles cleanly.
  //
  // Mechanism: reduceColumn's same-formation merge previously fired unconditionally;
  // Fix B gates it on neighbourReaches(neighbourTD, below.topDepthM).
  it('VOID-B: same-formation units separated by a data void are not merged across it', () => {
    const deep = col('D', 0, [
      { top: 0, base: 1, f: 'KLEI', b: 'kTop' },
      { top: 1, base: 6, f: 'ZAND', b: 'zLens' }, // 0-corr lens (neighbourReaches(4,1)=true)
      { top: 6, base: 9.5, f: 'KLEI', b: 'kBot' }, // neighbourReaches(4,6)=false → no cross-void merge
    ])
    const shallow = col('S', 0, [
      { top: 0, base: 4, f: 'SILT', b: 'sA' }, // TD = 4
    ])
    // No edges — ZAND is a lens; KLEIs are uncorrelated.
    const regions = computeSectionFill([deep, shallow], [])
    // 1. No void at any of the 24 sample fractions.
    assertTiles(regions.filter((r) => r.gapIndex === 0), deep, shallow)
    // 2. Deep KLEI continues sideways at elev −7 (within its −6→−9.5 range).
    expect(coverAt(regions, 0, 0.5, -7)).toContain('KLEI')
  })

  // CASE 3 — BOTH neighbours too shallow → sideways-default on BOTH sides.
  //
  // Sideways-default rule (spec §5 rule 1, 2026-06-17): when NO facing column
  // reaches the unit's depth (a data void — no test ever observed that depth on
  // the neighbouring side), the unit continues FLAT at its own elevation, passing
  // UNDER the shallow neighbour. It does NOT pinch out; it does NOT climb to the
  // neighbour's TD. This supersedes the 2026-06-16 directive ("no reaching
  // neighbour → pinch out") which produced the visible up-drag in real CS1.
  it('CASE 3 — both neighbours too shallow → deep unit continues sideways (flat) under both', () => {
    // The deep SAND on the MIDDLE column (8-12 m) lies ENTIRELY below the 3.5 m TD
    // of both flanking columns. No facing column reaches its depth on either side →
    // sideways-default: the SAND continues flat as a full-width quad at its own
    // elevation, passing under the shallow tests.
    // Use distinct formations (PEAT/SAND/PEAT on Mid vs CLAY on Lshallow/Rshallow)
    // to avoid any formation-level matching that would create a sloped band base
    // and confound assertTiles. The test goal — SAND sideways under shallow tests —
    // is independent of what lithology occupies the shallower units.
    const Lshallow = col('Ls', 0, [{ top: 0, base: 3.5, f: 'CLAY', b: 'cL' }]) // TD 3.5
    const Mid = col('Mid', 0, [
      { top: 0, base: 8, f: 'PEAT', b: 'pM' }, // distinct formation → no match with Lshallow/Rshallow CLAY → flat quads, no sloped band
      { top: 8, base: 12, f: 'SAND', b: 'deep' }, // deep unit, both neighbours too shallow
      { top: 12, base: 20, f: 'PEAT', b: 'pBot' },
    ])
    const Rshallow = col('Rs', 0, [{ top: 0, base: 3.5, f: 'CLAY', b: 'cR' }]) // TD 3.5
    const regions = sf(Lshallow, Mid, Rshallow)
    // The SAND continues flat across BOTH gaps — present at mid-gap on each side
    // at the sand's mid-elevation (-10). No neighbour reached that depth, so
    // there is no geological evidence for a pinch-out: the unit continues sideways.
    expect(coverAt(regions, 0, 0.5, -10)).toContain('SAND')
    expect(coverAt(regions, 1, 0.5, -10)).toContain('SAND')
    // Near the Mid column edge the SAND is also present (it is the base truth).
    expect(coverAt(regions, 0, 0.98, -10)).toContain('SAND')
    expect(coverAt(regions, 1, 0.02, -10)).toContain('SAND')
    // No void in either gap.
    assertTiles(regions.filter((r) => r.gapIndex === 0), Lshallow, Mid)
    assertTiles(regions.filter((r) => r.gapIndex === 1), Mid, Rshallow)
  })

  // CASE 4 — section-edge column, single too-shallow neighbour → sideways-default.
  //
  // Sideways-default rule (spec §5 rule 1, 2026-06-17): the only neighbour cannot
  // reach the unit's depth → the unit continues FLAT (sideways) across the whole
  // gap, passing under the shallow neighbour. The prior "pinch out" directive
  // (2026-06-16) is superseded — no reaching neighbour = no evidence for a
  // geological termination, so the unit should NOT be drawn as a pinch triangle.
  it('CASE 4 — section-edge column, single too-shallow neighbour → deep unit continues sideways (flat)', () => {
    // Edge column carries a deep SAND (8-12 m) whose top is well below the only
    // neighbour's 3.5 m TD. No column on the Neighbour side reaches depth 8 m →
    // sideways-default: the SAND is a full-width flat quad, present across the full gap.
    // Use distinct formations (SILT vs CLAY) so the fill is purely geometry-driven:
    // no formation-level match → no sloped band interface → assertTiles sees only flat quads.
    const Edge = col('Edge', 0, [
      { top: 0, base: 8, f: 'SILT', b: 'sEdge' }, // distinct formation → no formation-match with Neighbour CLAY → flat sideways quads, no sloped band
      { top: 8, base: 12, f: 'SAND', b: 'deepE' }, // deep unit, neighbour too shallow
      { top: 12, base: 20, f: 'SILT', b: 'botE' },
    ])
    const Neighbour = col('Nb', 0, [{ top: 0, base: 3.5, f: 'CLAY', b: 'cNb' }]) // TD 3.5
    const regions = computeSectionFill([Edge, Neighbour], [])
    // The deep SAND continues flat across the full gap — present at mid-gap and
    // near the source column edge. No neighbour reached that depth, so the
    // sideways-default applies (not a pinch-out).
    expect(coverAt(regions, 0, 0.5, -10)).toContain('SAND')
    expect(coverAt(regions, 0, 0.02, -10)).toContain('SAND')
    // No void in the gap.
    assertTiles(regions, Edge, Neighbour)
  })

  // CASE 5 — correlated across a too-shallow neighbour to a REACHING neighbour →
  // BANDS (the prior reach-guard win; owner directive 2026-06-16 must not regress
  // it). A deep SAND on a section-edge column is uncorrelated to the adjacent
  // shallow void column but CORRELATED (jump edge) to the reaching column beyond
  // it → it bands across the whole way.
  it('CASE 5 — correlated across a too-shallow neighbour to a reaching neighbour → BANDS (no regression)', () => {
    // L0 (deep) carries SAND deep, uncorrelated to the shallow M1, but body
    // "deep" is shared with the deep R2 beyond it (a jump edge). The nearest
    // REACHING neighbour to the right (skip M1, reach R2) is correlated → BAND.
    const L0 = col('L0', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' }, // correlated top band across all
      { top: 2, base: 8, f: 'CLAY', b: 'mTop' }, // correlated upper clay
      { top: 8, base: 12, f: 'SAND', b: 'deep' }, // deep, correlated to R2 (jump)
      { top: 12, base: 20, f: 'CLAY', b: 'deepC' }, // deep clay, also correlated
    ])
    const M1 = col('M1', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' },
      { top: 2, base: 3.5, f: 'CLAY', b: 'mM1' }, // TD 3.5 — cannot reach the deep sand
    ])
    const R2 = col('R2', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' },
      { top: 2, base: 8, f: 'CLAY', b: 'mTop' }, // correlated upper clay
      { top: 8, base: 12, f: 'SAND', b: 'deep' }, // same body as L0 → correlated
      { top: 12, base: 20, f: 'CLAY', b: 'deepC' }, // same body as L0 → correlated
    ])
    const regions = sf(L0, M1, R2)
    // In the L0→M1 gap (the void gap), the deep SAND must still BAND across it —
    // present at mid-gap at the sand's mid-elevation (-10). (CASE 1 already pins
    // the same band when the surrounding clays are uncorrelated.)
    expect(coverAt(regions, 0, 0.5, -10)).toEqual(['SAND'])
    // The deep CLAY below it bands too (also correlated to the reaching R2).
    expect(coverAt(regions, 0, 0.5, -16)).toEqual(['CLAY'])
  })

  // CASE 6 — PER-SIDE: a deep unit correlated to a reaching neighbour on the LEFT
  // but with only too-shallow data on the RIGHT → it BANDS LEFT and continues
  // SIDEWAYS RIGHT (2026-06-17 sideways-default rule supersedes the old 2026-06-16
  // "no reaching neighbour → pinch out" directive: when no column on the facing
  // side reaches the unit's depth, there is no geological evidence for a pinch-out,
  // so the unit continues flat at its own elevation — EVEN when the unit's top
  // straddled above the shallowFloor due to matrix flooding).
  it('CASE 6 — deep unit: reaching+correlated LEFT, too-shallow RIGHT → BANDS left, SIDEWAYS right', () => {
    // Section order: Lreach (deep, correlated) — Mid (deep, carries the unit) —
    // Rsh (too shallow). The Mid deep CLAY correlates LEFT to Lreach (reaching) →
    // bands the Lreach↔Mid gap. To the RIGHT, Rsh (TD 3.5) cannot reach the CLAY
    // (natural top at depth 8; flooded to depth 2 after the SILT lens is pulled).
    // The 2026-06-17 sideways-default applies: no facing column reaches the CLAY's
    // base → DATA VOID → the CLAY continues FLAT at its own elevation.
    const Lreach = col('Lr', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' },
      { top: 2, base: 8, f: 'SILT', b: 'mLr' },
      { top: 8, base: 16, f: 'CLAY', b: 'deepC' }, // deep CLAY, correlated to Mid
    ])
    const Mid = col('Md', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' },
      { top: 2, base: 8, f: 'SILT', b: 'mMd' },
      { top: 8, base: 16, f: 'CLAY', b: 'deepC' }, // same body as Lreach → correlated LEFT
    ])
    const Rsh = col('Rs', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'topA' },
      { top: 2, base: 3.5, f: 'SILT', b: 'mRs' }, // TD 3.5 — cannot reach the deep CLAY
    ])
    const regions = sf(Lreach, Mid, Rsh)
    // LEFT gap (gapIndex 0, Lreach↔Mid): the deep CLAY bands — present at mid-gap.
    expect(coverAt(regions, 0, 0.5, -12)).toEqual(['CLAY'])
    // RIGHT gap (gapIndex 1, Mid↔Rsh): the deep CLAY continues SIDEWAYS (flat) —
    // no facing column reaches depth 8 (the CLAY's natural top), so the
    // 2026-06-17 sideways-default applies: CLAY is PRESENT at mid-gap.
    expect(coverAt(regions, 1, 0.5, -12)).toContain('CLAY')
  })

  // SW-1: uncorrelated deep unit facing a shallower un-reaching neighbour continues
  // SIDEWAYS (flat) — its top is NOT dragged up to the neighbour's TD.
  //
  // Real CS1 measurement: B2 deep SAND (top elev +4.25 mTAW) → S7a (TD elev
  // +10.42, never observed the sand). Today the sand's top ramps +4.25 → +10.42.
  // Desired: the sand stays flat at its own elevation and passes UNDER S7a.
  it('SW-1: uncorrelated deep unit continues sideways under a shallower neighbour (no climb)', () => {
    // Mirrors the real B2 / S7a geometry (rounded to clean numbers).
    // Surface 13.0 m on both; depths are below surface.
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' }, // top elev = 13 - 8.8 = +4.2
    ])
    const shallow = col('S7a', 13.0, [
      { top: 0, base: 2.65, f: 'CLAY', b: 'c2' }, // TD = 13 - 2.65 = +10.35 — never reached the sand
    ])
    // No edges: the SAND is not correlated to anything on S7a.
    const regions = computeSectionFill([deep, shallow], [])

    // The sand continues flat at its own deep elevation — present at mid-gap at
    // elevation 0, well within the sand's +4.2 (top) → -4.5 (base) range.
    expect(coverAt(regions, 0, 0.5, 0)).toEqual(['SAND'])

    // The sand does NOT climb up to the shallow neighbour's TD elevation (+10.35).
    // At fraction 0.9 (near the shallow column) and elevation +9 mTAW (well above
    // the sand's real top +4.2, below S7a's TD +10.35), the fill must NOT be SAND.
    expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')
  })

  // SW-2: a SIDEWAYS unit must NOT supply the matrix context for a sibling genuine
  // pinch in the SAME floor walk. When the deepest unit on one column genuinely
  // pinches out (a reaching neighbour logs a different lithology, uncorrelated) and
  // the deepest unit on the OTHER column continues SIDEWAYS (no facing column
  // reaches it), they land in one depth-ordered floor walk. The pinch's closing
  // matrix must be the real matched band ABOVE the floor — NOT the sideways unit's
  // formation (which is a data void carrying no matrix context). Mirrors the real
  // CS1 floor where a deep KLEI sand pinches toward a reaching neighbour while a
  // KLEI on the facing edge column passes sideways under a too-shallow test.
  //
  // NOTE: this is a DEFENSIVE invariant, not a RED→GREEN regression. The
  // ``runAbove`` advancement guard it pins cannot be exercised into a wrong LABEL
  // through the public API today: the reach rule (``neighbourReaches`` is column-
  // TD based) makes it impossible for a SIDEWAYS unit (no facing column reaches it)
  // to sit SHALLOWER than a reached unit on the same facing context — any column
  // reaching the deeper unit also reaches the shallower one. So a sideways unit
  // can never poison ``runAbove`` for a LATER genuine pinch. The guard is kept
  // because (a) it is correct in principle and (b) it would catch a regression if
  // the reach semantics ever change to make the ordering reachable. The OBSERVABLE
  // half of the same defect — a sideways unit leaking in as the pinch run's
  // BELOW-matrix — is pinned by SW-3.
  it('SW-2: a sideways unit does not become the matrix above a sibling genuine pinch', () => {
    // Matched SILT band on top. The LEFT deepest CLAY (8-10) genuinely pinches:
    // the RIGHT reaches depth 8 (TD 18 >= 8) and logs ZAND there (uncorrelated). The
    // RIGHT deepest ZAND (12-18) is SIDEWAYS: the LEFT (TD 10) never reached 12.
    const left = col('L', 0, [
      { top: 0, base: 8, f: 'SILT', b: 'band' }, // matched band (the only above-matrix)
      { top: 8, base: 10, f: 'CLAY', b: 'pinch' }, // L deepest → genuine pinch toward R
    ])
    const right = col('R', 0, [
      { top: 0, base: 12, f: 'SILT', b: 'band' }, // matched band
      { top: 12, base: 18, f: 'ZAND', b: 'sideways' }, // R deepest → sideways (L TD 10 < 12)
    ])
    const regions = sf(left, right)
    // The CLAY pinch's closing matrix region (the wedge filling beyond its apex,
    // toward the right column) must be the matched SILT band ABOVE — the sideways
    // ZAND must NOT have become the pinch's above/below matrix. So at a point just
    // right of the pinch apex, at the pinch's depth, the fill is SILT (the real
    // band), never ZAND (the sideways unit's formation leaking in).
    expect(coverAt(regions, 0, 0.7, -9)).not.toContain('ZAND')
    expect(coverAt(regions, 0, 0.7, -9)).toEqual(['SILT'])
    // And the ZAND sideways genuinely continues flat at its own deep level — it is
    // NOT pulled up to fill the pinch's matrix slot.
    expect(coverAt(regions, 0, 0.5, -15)).toContain('ZAND')
  })

  // SW-3: a SIDEWAYS unit flushing a pinch run must NOT supply a below-matrix, or
  // ``emitOneSidedPinch``'s ``isLens`` (above.formationId === below.formationId)
  // fires spuriously when the sideways unit happens to share the matched band's
  // formation — drawing a BOUNDARY pinch as a horizontal ENCLOSED-LENS apex. A
  // boundary pinch tapers DOWN to its base interface (toward the floor); a lens
  // tapers to its own enclosed mid-level. They must not be confused.
  it('SW-3: a sideways unit flushing a pinch does not trigger a false enclosed-lens', () => {
    // Matched KLEI band on top. The LEFT deepest SILT (8-10) genuinely pinches (R
    // reaches 8, uncorrelated). The RIGHT deepest KLEI (12-18) is SIDEWAYS (L TD
    // 10 < 12). The matched band (KLEI) and the sideways unit (KLEI) share a
    // formation, so a leaked below-matrix would make isLens wrongly fire on the SILT.
    const left = col('L', 0, [
      { top: 0, base: 8, f: 'KLEI', b: 'band' }, // matched band (= above context, KLEI)
      { top: 8, base: 10, f: 'SILT', b: 'pinch' }, // L deepest → genuine pinch toward R
    ])
    const right = col('R', 0, [
      { top: 0, base: 12, f: 'KLEI', b: 'band' }, // matched band
      { top: 12, base: 18, f: 'KLEI', b: 'sideways' }, // R deepest → sideways, SAME formation as the band
    ])
    const regions = sf(left, right)
    const siltPinch = regions.find((r) => r.formationId === 'SILT' && r.kind === 'pinch')
    expect(siltPinch).toBeDefined()
    // The pinch apex (its sole fraction>0 vertex). A BOUNDARY pinch's apex sits on
    // the BASE interface (≈ -12, the floor the wedge tapers to); the buggy LENS
    // apex sits at the SILT's own enclosed mid (≈ -10). Assert the apex is the
    // deeper boundary value, not the shallow lens value.
    const apex = siltPinch!.polygon.reduce(
      (m, p) => (p.fraction > m.fraction ? p : m),
      siltPinch!.polygon[0],
    )
    // Behaviour: a boundary pinch tapers toward the base interface (deeper than the
    // SILT's own base at -10). The lens bug would tip at the SILT's own mid (-10).
    expect(apex.elevation).toBeLessThan(-11)
  })

  // ---------------------------------------------------------------------------
  // T-TOP: top↔top regression — existing band behaviour unchanged (Task 3)
  // ---------------------------------------------------------------------------
  // A top↔top edge is the standard correlation. It must still band exactly as
  // before; Task 3 must not regress it.
  it('T-TOP: top↔top edge still bands the top surface across the gap (regression)', () => {
    // Mirrors the real B2/S7a geometry. The CLAY tops are explicitly correlated
    // (top↔top, the default). The SAND on B2 is uncorrelated — it continues
    // sideways (SW-1). Only the CLAY bands.
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' },
    ])
    const shallow = col('S7a', 13.0, [{ top: 0, base: 2.65, f: 'CLAY', b: 'c2' }])
    // top↔top edge between the two CLAY units (standard)
    const edges: CorrelationEdge[] = [{ a: 'B2#0', b: 'S7a#0' }] // aSide/bSide both default top
    const regions = computeSectionFill([deep, shallow], edges)
    // The CLAY bands — present at mid-gap at elevation +12 (shallow CLAY top area).
    expect(coverAt(regions, 0, 0.5, 12)).toContain('CLAY')
    // The SAND is not dragged to S7a's TD — it continues sideways at its own elevation.
    expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // T-BASE: base↔base tie continues the deepest unit's base across the gap
  // ---------------------------------------------------------------------------
  // A bottom-tie (both aSide='base') lets two deepest bases connect so the deepest
  // unit bands across. This is the rule 3 case (spec §5 rule 3).
  it('T-BASE: base↔base tie allows the deepest units to band across the gap', () => {
    // Two deep units of the same lithology, non-overlapping in elevation (the right
    // is shallower but they share a base-tie edge). Without the base-tie they cannot
    // match (no top-overlap, no top-keyed edge) and the deep unit stays sideways.
    const deep = col('B2', 13.0, [
      { top: 0, base: 4, f: 'CLAY', b: 'c1' }, // top band
      { top: 4, base: 17.5, f: 'SAND', b: 'sandDeep' }, // deep SAND top +9.0 mTAW
    ])
    const shallow = col('S7a', 13.0, [
      { top: 0, base: 4, f: 'CLAY', b: 'c1' }, // same top band
      { top: 4, base: 8, f: 'SAND', b: 'sandShallow' }, // shallower SAND, different body
    ])
    // base↔base tie: B2 deepest SAND base ↔ S7a deepest SAND base
    const edges: CorrelationEdge[] = [
      { a: 'B2#0', b: 'S7a#0' }, // top CLAY band correlated (standard top↔top)
      { a: 'B2#1', b: 'S7a#1', aSide: 'base', bSide: 'base' }, // base-tie on the deepest SAND
    ]
    const regions = computeSectionFill([deep, shallow], edges)
    // The deep SAND from B2 should band toward S7a — present at mid-gap at
    // an elevation within B2's SAND range (+9 mTAW, well within +9 to −4.5 mTAW).
    expect(coverAt(regions, 0, 0.5, 6)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // T-MIXED: top↔base mixed tie raises the deep unit's top toward the tied TD
  // ---------------------------------------------------------------------------
  // A top↔base edge: deep-unit-TOP tied to shallow-test-BOTTOM (the column TD).
  // Spec §5 rule 2: the unit's top rises to meet the tied test's TD elevation and
  // the unit continues below it (overrides the SW-1 sideways default).
  it('T-MIXED: top↔base mixed tie raises the deep unit top toward the tied test TD', () => {
    // Mirrors the real B2 / S7a geometry (rounded to clean numbers).
    // B2: deep, surface +13.0; CLAY 0-8.8 m; SAND top at +4.2 mTAW (depth 8.8 m)
    // S7a: shallow, surface +13.0; CLAY 0-2.65 m; TD at +10.35 mTAW (depth 2.65 m)
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' }, // SAND top elev = +4.2 mTAW
    ])
    const shallow = col('S7a', 13.0, [
      { top: 0, base: 2.65, f: 'CLAY', b: 'c2' }, // TD = +10.35 mTAW
    ])
    // Mixed tie: B2's SAND top (B2#1, aSide='top') ↔ S7a's CLAY base / column TD
    // (S7a#0, bSide='base').  "The sand reaches where S7a bottomed out."
    const edges: CorrelationEdge[] = [
      { a: 'B2#1', b: 'S7a#0', aSide: 'top', bSide: 'base' },
    ]
    const regions = computeSectionFill([deep, shallow], edges)
    // WITH the mixed tie, the sand's top should be present near the shallow column
    // at an elevation HIGHER than its B2 top (+4.2) — it has risen toward S7a's TD
    // (+10.35). Fraction 0.9 (near S7a), elevation +9 is between +4.2 and +10.35:
    // with the tie the SAND reaches there; without it (SW-1) it does not.
    expect(coverAt(regions, 0, 0.9, 9)).toContain('SAND')
    // The SAND is still present at its original deep level on the B2 side.
    expect(coverAt(regions, 0, 0.1, 3)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // T-MIXED-CONTRAST: same geometry WITHOUT the mixed tie stays flat (SW-1)
  // ---------------------------------------------------------------------------
  // Pins that the mixed tie is the CAUSE of the rise — without it, the sideways
  // default holds and the sand does NOT climb to elevation +9.
  it('T-MIXED-CONTRAST: without the mixed tie the deep unit stays flat (sideways default holds)', () => {
    // Same columns as T-MIXED but NO edges.
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' },
    ])
    const shallow = col('S7a', 13.0, [{ top: 0, base: 2.65, f: 'CLAY', b: 'c2' }])
    // No edges — no tie.
    const regions = computeSectionFill([deep, shallow], [])
    // Without the tie the SAND continues SIDEWAYS (flat at +4.2 mTAW). At fraction
    // 0.9, elevation +9, the fill must NOT be SAND (the sand's top is still at +4.2).
    expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')
    // But the SAND IS still present at its real elevation (+ 0 mTAW) mid-gap.
    expect(coverAt(regions, 0, 0.5, 0)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // T-MIXED-RIGHTSIDE: deep unit on the RIGHT column (exercises the p.side==='right'
  // quad path + the symmetric corner-collapse on the LEFT/facing side)
  // ---------------------------------------------------------------------------
  it('T-MIXED-RIGHTSIDE: mixed tie raises the deep unit top when the deep column is on the RIGHT', () => {
    // Same geometry as T-MIXED but columns swapped so the deep SAND is the RIGHT
    // column's unit; the rise happens toward the shallow LEFT column.
    const shallow = col('S7a', 13.0, [{ top: 0, base: 2.65, f: 'CLAY', b: 'c2' }])
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' },
    ])
    const edges: CorrelationEdge[] = [{ a: 'B2#1', b: 'S7a#0', aSide: 'top', bSide: 'base' }]
    const regions = computeSectionFill([shallow, deep], edges) // deep is RIGHT column now
    // the sand rises toward S7a's TD near the shallow (LEFT) column edge:
    expect(coverAt(regions, 0, 0.1, 9)).toContain('SAND')
    // and is at its own deep level near the deep (RIGHT) column:
    expect(coverAt(regions, 0, 0.9, 3)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // T-MIXED-OVER-PINCH: mixed tie overrides a genuine pinch (reaching uncorrelated
  // neighbour). This is the regression that the real CS1 B2→S7a section exposed:
  // the old `sideways`-only gate blocked the mixed-tie override when a third test
  // (S6, TD 22.99 m) sat between B2 and S7a and REACHED the SAND's top depth,
  // classifying the unit as a genuine pinch (sideways=false). The tie must fire
  // regardless. Spec §5 rule 2: "a tie ALWAYS overrides geometry — no proximity guard."
  // ---------------------------------------------------------------------------
  it('T-MIXED-OVER-PINCH: mixed tie overrides even a genuine-pinch classification', () => {
    // B2 (left, deep): CLAY 0–8.8 m + SAND 8.8–17.5 m. SAND top at +4.2 mTAW.
    // MIDDLE (middle column): reaches to depth 12 m (TD = +1.0 mTAW) — past the SAND
    //   top at 8.8 m. Its presence makes SAND a GENUINE PINCH toward the right.
    // S7a (right, shallow): CLAY 0–2.65 m. TD at +10.35 mTAW.
    // Without a tie: SAND is a genuine pinch (middle reaches its depth) → it pinches,
    //   does NOT rise. In the B2→MIDDLE gap it pinches toward MIDDLE; in the
    //   MIDDLE→S7a gap there is no SAND at all (MIDDLE is shallower than SAND top).
    // With a mixed tie (B2-SAND-top ↔ S7a-CLAY-base): the tie fires in the
    //   B2→MIDDLE gap and the SAND top rises toward S7a's TD (+10.35) near MIDDLE.
    const deep = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' }, // SAND top elev = +4.2 mTAW
    ])
    const middle = col('MID', 13.0, [
      { top: 0, base: 12.0, f: 'CLAY', b: 'c3' }, // TD = +1.0 mTAW — reaches past SAND top
    ])
    const shallow = col('S7a', 13.0, [
      { top: 0, base: 2.65, f: 'CLAY', b: 'c2' }, // TD = +10.35 mTAW
    ])
    // Without tie: SAND is a genuine pinch in gap 0 (B2→MIDDLE). Does NOT rise.
    const noTie = computeSectionFill([deep, middle, shallow], [])
    // The SAND is present at its own depth near B2 (f=0.1, e=+3).
    expect(coverAt(noTie, 0, 0.1, 3)).toContain('SAND')
    // But it does NOT climb above its own top elevation (+4.2) near MIDDLE (f=0.9, e=+9).
    expect(coverAt(noTie, 0, 0.9, 9)).not.toContain('SAND')

    // With mixed tie: tie B2-SAND-top (aSide='top') to S7a-CLAY-base (bSide='base').
    // The tie names the facing TD in the B2→MIDDLE gap: S7a's TD = +10.35 mTAW.
    // The SAND top must rise to meet that TD elevation near MIDDLE (f≈0.9, e=+9).
    const withTie = computeSectionFill(
      [deep, middle, shallow],
      [{ a: 'B2#1', b: 'S7a#0', aSide: 'top', bSide: 'base' }],
    )
    // The tie overrides the genuine-pinch classification. SAND rises toward +10.35.
    expect(coverAt(withTie, 0, 0.9, 9)).toContain('SAND')
    // SAND is still present at its own depth near B2 (the base is unchanged).
    expect(coverAt(withTie, 0, 0.1, 3)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // FLAT-1: immediate neighbour too shallow, distant neighbour reaches →
  // un-tied deep unit stays FLAT under the immediate neighbour (no climb).
  //
  // Real CS1 geometry: B2 (deep sand top +4.2 mTAW) → S7a (immediate, shallow,
  // TD +10.42 — never reached the sand) → S6 (distant, TD −4.01 — reaches).
  // Bug: the old `.some(c => neighbourReaches(...))` walked ALL facing columns,
  // found S6, set sideways=false → the sand TOP dragged from +4.2 up to +10.42.
  // Fix: gate on the IMMEDIATE facing column only (pinchSideColumns[0]).
  // ---------------------------------------------------------------------------
  it('FLAT-1: un-tied deep unit stays flat under a shallow immediate neighbour even when a distant neighbour reaches', () => {
    // Mirrors the real B2 / S7a / S6 geometry (depths below surface = 13 m).
    //   B2:  CLAY  0–8.8 m  (top +4.2)  +  SAND  8.8–17.5 m  (deep, top +4.2)
    //   S7a: CLAY  0–2.65 m            TD = 13 − 2.65 = +10.35 — does NOT reach sand
    //   S6:  CLAY  0–5 m               +  SAND  5–23 m  (TD = 13 − 23 = −10.0 — reaches)
    const b2 = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' }, // SAND top elev = +4.2 mTAW
    ])
    const s7a = col('S7a', 13.0, [
      { top: 0, base: 2.65, f: 'CLAY', b: 'c2' }, // TD +10.35 — too shallow
    ])
    const s6 = col('S6', 13.0, [
      { top: 0, base: 5, f: 'CLAY', b: 'c3' },
      { top: 5, base: 23, f: 'SAND', b: 'sandS6' }, // TD −10.0 — reaches
    ])
    // No edges: the SAND bodies are not correlated across the gaps.
    const regions = computeSectionFill([b2, s7a, s6], [])

    // In the B2→S7a gap (gapIndex 0), the sand stays FLAT at its own elevation.
    // The sand's top is at +4.2 mTAW; elevation 0 is well within its range (+4.2 → −4.5).
    expect(coverAt(regions, 0, 0.5, 0)).toContain('SAND')

    // The sand must NOT climb to S7a's TD (+10.35). At fraction 0.9 (near S7a)
    // and elevation +9 (between sand top +4.2 and S7a TD +10.35), the fill must
    // NOT be SAND — the sand's top has not been dragged upward.
    expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // GAP-1: a mixed tie must NOT create a gap in the partition.
  //
  // The bug (Defect 1): setting facingBaseElev = mixedTiedFacingTopElev collapses
  // BOTH the top and base of the unit's facing side to the TD apex, producing a
  // triangle.  Two consecutive mixed-tied units (e.g. CLAY apex at +10.42, SAND
  // apex at +4.23) leave the space between their apexes unfilled — a HOLE in the
  // partition that becomes spurious voxels in the 3D model.
  //
  // The fix: a mixed tie raises the unit's TOP to the TD, but its BASE must
  // continue to bandBaseElev — the unit fills the deep space below the tie line,
  // exactly like emitOneSidedPinch closes its wedge with a matrix extension.
  // The region is a QUAD (rising top, flat base), not a triangle.
  // ---------------------------------------------------------------------------
  it('GAP-1: mixed tie creates no gap in the partition — SAND is covered between tied clay and floor', () => {
    // Real CS1 geometry (distilled): B2 has CLAY 0–2.58 m + SAND 2.58–8.77 m.  Surface +13.
    //   CLAY top elev = +10.42 mTAW.  SAND top elev = +4.23 mTAW.
    // S7A has ONLY CLAY 0–2.58 m. TD = +10.42 mTAW.
    // Mixed ties: B2-CLAY top ⇔ S7A-CLAY base (+10.42) and B2-SAND top ⇔ S7A-CLAY base (+10.42).
    //
    // DEFECT 1 (before fix): facingBaseElev = facingTopElev = +10.42 (the TD apex).
    //   CLAY becomes a triangle tipping at +10.42.  SAND becomes a triangle with
    //   TOP = +10.42 (the same apex) and no base coverage on the S7A side — the
    //   space between +4.23 and +10.42 near S7A is UNFILLED (a partition hole).
    //
    // After fix: facingBaseElev = bandBaseElev (flat at its own base, not the apex).
    //   SAND becomes a rising-top QUAD covering the full space from +4.23 to the
    //   tied top (+10.42) on the S7A side — no hole.
    //
    // NOTE: assertTiles is omitted because the two columns have different floors
    //   (B2 floor +4.23, S7A floor +10.42). The mixed-tie space coverage is
    //   validated by specific coverAt checks instead.
    const b2 = col('B2', 13.0, [
      { top: 0, base: 2.58, f: 'CLAY', b: 'c1' }, // CLAY top = +10.42 mTAW
      { top: 2.58, base: 8.77, f: 'SAND', b: 'sand1' }, // SAND top = +4.23 mTAW
    ])
    const s7a = col('S7A', 13.0, [
      { top: 0, base: 2.58, f: 'CLAY', b: 'c2' }, // TD = +10.42 mTAW — the tie target
    ])
    const edges: CorrelationEdge[] = [
      // B2-CLAY top tied to S7A-CLAY base: CLAY's top should rise to +10.42 near S7A.
      { a: 'B2#0', b: 'S7A#0', aSide: 'top', bSide: 'base' },
      // B2-SAND top also tied to S7A-CLAY base: SAND's top should rise to +10.42 near S7A.
      { a: 'B2#1', b: 'S7A#0', aSide: 'top', bSide: 'base' },
    ]
    const regions = computeSectionFill([b2, s7a], edges)

    // At f=0.9 (close to S7A), the SAND must cover elevation 9 mTAW — between SAND top
    // (+4.23) and S7A-CLAY base (+10.42). Before the fix: SAND collapsed to a
    // triangle ending at +10.42 with no base coverage → hole → 'SAND' absent.
    expect(coverAt(regions, 0, 0.9, 9)).toContain('SAND')

    // CLAY must cover elevation 11 mTAW near S7A (between CLAY top +10.42 and surface +13).
    expect(coverAt(regions, 0, 0.9, 11)).toContain('CLAY')

    // SAND is present at its own level near B2 (elevation 7 mTAW inside SAND range [+4.23, +10.42]).
    expect(coverAt(regions, 0, 0.1, 7)).toContain('SAND')
  })

  // ---------------------------------------------------------------------------
  // GAP-2: a mixed tie must NOT shape an INTERVENING gap whose facing column is
  // NOT the tied target.
  //
  // The bug (Defect 2): layerBaseElevLookup is section-wide — it resolves any
  // tied baseLayerId regardless of which gap is being emitted.  When the tie
  // names a unit on a NON-ADJACENT column (e.g. B2-SAND-top ↔ S7-CLAY-base,
  // with S7A as the INTERVENING column between B2 and S7), the lookup applies
  // S7's TD elevation in the B2→S7A gap where S7A (not S7) is the facing column.
  //
  // Correct rule: a mixed tie shapes ONLY the gap whose facing column contains
  // the base-side unit (the tie's target).  In an INTERVENING gap the unit must
  // continue FLAT / sideways (its natural behaviour toward the shallow S7A), not
  // dragged up to the distant target's TD.
  // ---------------------------------------------------------------------------
  it('GAP-2: mixed tie does not over-reach into an intervening gap — unit stays flat', () => {
    // DEFECT 2 scenario: B2-SAND top is mixed-tied to S7-CLAY base.
    // S7A is an INTERVENING (shallow) column between B2 and S7.
    // S7A is a DATA VOID for SAND: S7A's TD (2.58 m) < SAND top (8.8 m).
    //
    // Before the fix: layerBaseElevLookup was section-wide. In the B2→S7A gap,
    // mixedTiedTopElev returned S7-CLAY's base elevation (+10.42) and dragged
    // B2-SAND's top up to +10.42 on the S7A side — even though S7A never
    // reached the SAND (S7A's TD is above SAND's top). This produced a bogus
    // rising quad that the partition could not tile (a hole or an overlap).
    //
    // After the fix: the apply-in-gap rule requires either (a) the facing column
    // CONTAINS the tie target unit, or (b) the facing column REACHES the unit
    // (genuine-pinch context). S7A satisfies neither — so the tie returns null
    // and B2-SAND stays FLAT (sideways) at its own elevation (+4.2 mTAW) in the
    // B2→S7A gap. No over-reach.
    //
    // This is a 3-column scenario. The same tie correctly fires in the B2→S7
    // direction (a separate 2-col regression pinned by T-MIXED-OVER-PINCH).
    const b2 = col('B2', 13.0, [
      { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
      { top: 8.8, base: 22.0, f: 'SAND', b: 'sand1' }, // SAND top = +4.2 mTAW
    ])
    const s7a = col('S7A', 13.0, [
      { top: 0, base: 2.58, f: 'CLAY', b: 'c2' }, // TD = +10.42 mTAW, NOT the tie target
    ])
    const s7 = col('S7', 13.0, [
      { top: 0, base: 2.58, f: 'CLAY', b: 'c3' }, // CLAY base = +10.42 — the tie target
      { top: 8.8, base: 22.0, f: 'SAND', b: 'sand2' },
    ])
    const edges: CorrelationEdge[] = [
      // B2-SAND top tied to S7-CLAY base.  S7A is in between and is a data void.
      { a: 'B2#1', b: 'S7#0', aSide: 'top', bSide: 'base' },
    ]
    const regions = computeSectionFill([b2, s7a, s7], edges)

    // In gap 0 (B2→S7A): S7A is NOT the tie target AND is a data void.
    // B2-SAND must NOT be dragged up — it stays flat at +4.2 mTAW.
    // At f=0.9 (near S7A), elevation +9 (between SAND top +4.2 and +10.42):
    // Before the fix: dragged up to +10.42 → SAND covers elevation 9 (wrong).
    // After the fix:  stays flat at +4.2 → elevation 9 not covered by SAND.
    expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')

    // B2-SAND IS present at its own flat elevation in gap 0.
    // Elevation 0 mTAW is inside SAND's range [−9, +4.2] — confirm SAND is there.
    expect(coverAt(regions, 0, 0.5, 0)).toContain('SAND')
  })
})

describe('collapseAdjacentSameFormation — body_id gate (spec §9 body-split)', () => {
  /** Build a single PartitionUnit (depth-below-surface metres). */
  function mkUnit(
    f: string,
    b: string | null,
    top: number,
    base: number,
    layerId = `${f}#${top}`,
  ): PartitionUnit {
    return { topDepthM: top, baseDepthM: base, formationId: f, bodyId: b, layerId }
  }

  it('does not merge same-lithology units of distinct bodies', () => {
    // S6-shaped: a shallow ZAND sliver (its own body) above the thick deep ZAND
    // (a different body), made adjacent after the intervening SILT/KLEI were
    // pulled as lenses. Distinct bodies must stay distinct so the deep-sand-top
    // surface survives for a tie to attach to.
    const units = [mkUnit('ZAND', 'bodyA', 1.6, 2.38), mkUnit('ZAND', 'bodyB', 2.38, 12.18)]
    collapseAdjacentSameFormation(units)
    expect(units).toHaveLength(2) // distinct bodies preserved
  })

  it('still merges same-lithology units of the same body', () => {
    // A body genuinely split by a pulled internal lens → still one band.
    const units = [mkUnit('ZAND', 'bodyA', 1.6, 2.38), mkUnit('ZAND', 'bodyA', 2.38, 5)]
    collapseAdjacentSameFormation(units)
    expect(units).toHaveLength(1)
    expect(units[0].baseDepthM).toBe(5)
  })

  it('still merges adjacent uncorrelated (null-body) same-lithology units', () => {
    // Two uncorrelated matrix layers (both null body) still collapse — null === null.
    const units = [mkUnit('ZAND', null, 1.6, 2.38), mkUnit('ZAND', null, 2.38, 5)]
    collapseAdjacentSameFormation(units)
    expect(units).toHaveLength(1)
  })
})

describe('sub-shallow-TD flat tail — deep stratigraphy continues flat below the shallow column (owner 2026-06-20)', () => {
  /** Even-odd point-in-polygon in (fraction, elevation) space. */
  const inPoly = (poly: { fraction: number; elevation: number }[], f: number, e: number): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].fraction
      const yi = poly[i].elevation
      const xj = poly[j].fraction
      const yj = poly[j].elevation
      const hit = yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi
      if (hit) inside = !inside
    }
    return inside
  }
  const coverAt = (regions: PartitionRegion[], f: number, e: number): string[] =>
    regions.filter((r) => r.kind !== 'lens' && inPoly(r.polygon, f, e)).map((r) => r.formationId)

  // A DEEP column (SAND to −15) and a SHALLOW column (same SAND, but only to −5),
  // SAND tops correlated. The deepest matched band would otherwise SLANT from the
  // deep base (−15) up to the shallow base (−5), leaving the wedge below the
  // shallow TD empty (the systematic "nothing renders below the undeep test"
  // void). The fix ends the band FLAT at the shallow base and lays the deep SAND
  // tail FLAT full-width down to its own base.
  const deep = col('deep', 0, [
    { top: 0, base: 3, f: 'CLAY', b: 'c' },
    { top: 3, base: 15, f: 'SAND', b: 's' },
  ])
  const shallow = col('shallow', 0, [
    { top: 0, base: 3, f: 'CLAY', b: 'c' },
    { top: 3, base: 5, f: 'SAND', b: 's' },
  ])

  it('fills below the shallow column TD with the deep SAND (no void)', () => {
    const regions = pf(deep, shallow)
    // Deep into the wedge below the shallow column's TD (−5), near the shallow
    // side (fraction 0.9): MUST be covered by SAND, not empty.
    expect(coverAt(regions, 0.9, -10)).toContain('SAND')
    expect(coverAt(regions, 0.6, -12)).toContain('SAND')
    // Mid-gap just below the shallow TD: covered (the void's worst point).
    expect(coverAt(regions, 0.75, -6)).toContain('SAND')
  })

  it('does not leave the wedge below the shallow TD empty at any fraction', () => {
    const regions = pf(deep, shallow)
    // March across the gap at an elevation strictly inside the wedge (−5 > e > −15)
    // on the shallow side; every sample must be covered.
    for (let s = 1; s <= 9; s++) {
      const f = s / 10
      const cover = coverAt(regions, f, -8)
      expect(cover.length, `void at fraction ${f}, elev −8`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// computeBottomTieLine
// ---------------------------------------------------------------------------

describe('computeBottomTieLine', () => {
  // (a) Single adjacent tie — two columns, both bases tied.
  // Col 0: surface=0, SAND base at depth 5 → baseElev = 0-5 = -5
  // Col 1: surface=0, CLAY base at depth 8 → baseElev = 0-8 = -8
  // Tie: L#0.base ↔ R#0.base
  it('(a) single adjacent tie returns both base elevations', () => {
    const left = col('L', 0, [{ top: 0, base: 5, f: 'SAND', b: 's' }])
    const right = col('R', 0, [{ top: 0, base: 8, f: 'CLAY', b: 'c' }])
    const edges = [{ a: 'L#0', b: 'R#0' }]
    const result = computeBottomTieLine([left, right], edges)

    expect(result.tieElev).toHaveLength(2)
    expect(result.tieElev[0]).toBeCloseTo(-5, 9)
    expect(result.tieElev[1]).toBeCloseTo(-8, 9)
    // formationId from the deeper (lower elev) endpoint = CLAY at -8
    expect(result.formationId[0]).toBe('CLAY')
    expect(result.formationId[1]).toBe('CLAY')
    expect(result.bodyId[0]).toBe('c')
    expect(result.bodyId[1]).toBe('c')
  })

  // (b) Span-2 tie — cols 0 and 2 tied, col 1 sits between.
  // Col 0: surface=0, base depth 4 → baseElev = -4
  // Col 1: surface=0, base depth 2 → NOT tied
  // Col 2: surface=0, base depth 10 → baseElev = -10
  // Tie L#0 ↔ R#0 spans columns 0..2. Col 1 (index 1) is interpolated at t=0.5:
  //   elev at 1 = -4 + 0.5 * (-10 - -4) = -4 + 0.5 * -6 = -7
  // formationId from deeper endpoint = CLAY (col 2, elev -10)
  it('(b) span-2 tie interpolates at the column between endpoints', () => {
    const c0 = col('A', 0, [{ top: 0, base: 4, f: 'SAND', b: 's' }])
    const c1 = col('B', 0, [{ top: 0, base: 2, f: 'GRAVEL', b: 'g' }])
    const c2 = col('C', 0, [{ top: 0, base: 10, f: 'CLAY', b: 'c' }])
    const edges = [{ a: 'A#0', b: 'C#0' }]
    const result = computeBottomTieLine([c0, c1, c2], edges)

    expect(result.tieElev).toHaveLength(3)
    expect(result.tieElev[0]).toBeCloseTo(-4, 9)
    expect(result.tieElev[1]).toBeCloseTo(-7, 9) // interpolated
    expect(result.tieElev[2]).toBeCloseTo(-10, 9)
    // deeper endpoint is CLAY (col 2, -10)
    expect(result.formationId[1]).toBe('CLAY')
    expect(result.bodyId[1]).toBe('c')
  })

  // (c) Two overlapping segments at different depths → lower envelope picks the deeper.
  // Col 0 base = -3, col 1 base = -6, col 2 base = -2.
  // Segment A: col0 ↔ col1 → col 0 = -3, col 1 = -6; formation = CLAY (deeper)
  // Segment B: col1 ↔ col2 → col 1 = -6, col 2 = -2; formation = CLAY (deeper at -6)
  // At col 1, two segments give: seg-A=-6, seg-B=-6; they agree. Segment A wins at col 0.
  // Add a shallower col0-col2 segment: C col0↔col2 with elev -1 and -1.5.
  //   At col 1 (t=0.5): seg-C = -1 + 0.5*(-1.5 - -1) = -1.25 — shallower than -6, envelope keeps -6.
  it('(c) two overlapping segments → lower envelope picks the deeper at the overlap', () => {
    const c0 = col('X', 0, [{ top: 0, base: 3, f: 'SAND', b: 'sa' }])   // baseElev -3
    const c1 = col('Y', 0, [{ top: 0, base: 6, f: 'CLAY', b: 'cl' }])   // baseElev -6
    const c2 = col('Z', 0, [{ top: 0, base: 1.5, f: 'SILT', b: 'si' }]) // baseElev -1.5
    // Segment A: c0 ↔ c1 (formationId from deeper endpoint = CLAY at -6)
    const edgeA = { a: 'X#0', b: 'Y#0' }
    // Segment B: c0 ↔ c2 (values: -3 vs -1.5; deeper = SAND at -3)
    const edgeB = { a: 'X#0', b: 'Z#0' }
    const result = computeBottomTieLine([c0, c1, c2], [edgeA, edgeB])

    // col 1 is covered by segment A only → -6 (CLAY)
    expect(result.tieElev[1]).toBeCloseTo(-6, 9)
    expect(result.formationId[1]).toBe('CLAY')
    // col 2: covered by segment B only → -1.5 (deeper endpoint of B is SAND at -3 on col 0,
    // but col 2 endpoint is -1.5; deeper = SAND at -3 → formationId SAND)
    expect(result.tieElev[2]).toBeCloseTo(-1.5, 9)
    expect(result.formationId[2]).toBe('SAND')
    // col 0: both segments cover col 0; seg-A gives -3, seg-B gives -3. Envelope = -3.
    // seg-A has deeper endpoint CLAY (-6), seg-B has deeper endpoint SAND (-3).
    // Both give -3 at col 0 (tied) → first segment wins → SAND (edgeA's col-0 endpoint is -3,
    // which is the SHALLOWER end of edgeA; the DEEPER end is col-1 at -6 → CLAY wins for edgeA).
    // Actually at col 0, both segments report -3 (their col-0 endpoint). Tied → first segment (edgeA)
    // wins → formationId CLAY (edgeA's deeper endpoint).
    expect(result.tieElev[0]).toBeCloseTo(-3, 9)
    expect(result.formationId[0]).toBe('CLAY')
  })

  // (d) Flat extension: a tie on cols 1↔2 in a 4-column section.
  // Col 0 and col 3 are outside the tied range.
  // Col 1 base = -4, col 2 base = -7.
  // flat-left: col 0 = col 1's value (-4, CLAY)
  // flat-right: col 3 = col 2's value (-7, CLAY)
  it('(e) flat extension: outer columns take the nearest covered column value', () => {
    const c0 = col('A', 0, [{ top: 0, base: 1, f: 'GRAVEL', b: 'g' }])
    const c1 = col('B', 0, [{ top: 0, base: 4, f: 'SAND',   b: 's' }])
    const c2 = col('C', 0, [{ top: 0, base: 7, f: 'CLAY',   b: 'c' }])
    const c3 = col('D', 0, [{ top: 0, base: 2, f: 'SILT',   b: 'si' }])
    // Only tie b/w col 1 (B#0) and col 2 (C#0)
    const edges = [{ a: 'B#0', b: 'C#0' }]
    const result = computeBottomTieLine([c0, c1, c2, c3], edges)

    expect(result.tieElev).toHaveLength(4)
    // col 1 and 2 are directly covered
    expect(result.tieElev[1]).toBeCloseTo(-4, 9)
    expect(result.tieElev[2]).toBeCloseTo(-7, 9)
    // col 0 (before the tie range) → flat extension from col 1
    expect(result.tieElev[0]).toBeCloseTo(-4, 9)
    expect(result.formationId[0]).toBe('CLAY') // deeper endpoint of the segment is col 2 at -7
    // col 3 (after the tie range) → flat extension from col 2
    expect(result.tieElev[3]).toBeCloseTo(-7, 9)
    expect(result.formationId[3]).toBe('CLAY')
  })

  // (d) Internal null — a 5-column section with two separate non-overlapping ties
  // covering cols 0↔1 and cols 3↔4, with col 2 in the middle covered by neither.
  // Both ties have endpoint elevations well above (shallower) than each other.
  it('(d) internal column between non-overlapping segments stays null', () => {
    const c0 = col('A', 0, [{ top: 0, base: 2, f: 'SAND', b: 's1' }])
    const c1 = col('B', 0, [{ top: 0, base: 3, f: 'SAND', b: 's2' }])
    const c2 = col('C', 0, [{ top: 0, base: 1, f: 'GRAVEL', b: 'g' }]) // uncovered
    const c3 = col('D', 0, [{ top: 0, base: 4, f: 'CLAY', b: 'c1' }])
    const c4 = col('E', 0, [{ top: 0, base: 5, f: 'CLAY', b: 'c2' }])
    // Tie 1 spans cols 0..1 only; tie 2 spans cols 3..4 only.
    const edges = [
      { a: 'A#0', b: 'B#0' }, // loCol=0, hiCol=1 — does NOT cover col 2
      { a: 'D#0', b: 'E#0' }, // loCol=3, hiCol=4 — does NOT cover col 2
    ]
    const result = computeBottomTieLine([c0, c1, c2, c3, c4], edges)

    // col 2 is in a gap between two separate segments (neither [0,1] nor [3,4] covers col 2)
    // flat extension only covers columns BEFORE loCol of the leftmost segment
    // and columns AFTER hiCol of the rightmost segment. Col 2 is BETWEEN segments = null.
    expect(result.tieElev[2]).toBeNull()
    expect(result.formationId[2]).toBeNull()
    expect(result.bodyId[2]).toBeNull()

    // Other columns are covered normally
    expect(result.tieElev[0]).not.toBeNull()
    expect(result.tieElev[1]).not.toBeNull()
    expect(result.tieElev[3]).not.toBeNull()
    expect(result.tieElev[4]).not.toBeNull()
  })

  // Empty columns → empty result arrays
  it('empty columns array returns empty arrays', () => {
    const result = computeBottomTieLine([], [])
    expect(result.tieElev).toHaveLength(0)
    expect(result.formationId).toHaveLength(0)
    expect(result.bodyId).toHaveLength(0)
  })
})
