/**
 * partitionFillV2.loneSidePinch.test.ts — SHAPE-pinning gate for the finding-A
 * defect (owner dogfeed of Cross-section 1, 2026-07-14):
 *
 *   "lenses don't pinch out halfway but run all the way to the next test."
 *
 * An untied lithology unit with no counterpart on the facing column must PINCH:
 * its apex sits short of the far column (~0.45 of the gap for a lens, ~0.5 for an
 * onlap), and the FACING column's matrix claims the remaining width. In the
 * increment-4a engine a lone-side untied unit filled the WHOLE gap width (meet 1 /
 * 0), which is what the owner saw. This gate pins the v1 shape (the acceptance
 * target — v1 branches 2/3/4 in ``partitionFill/columnReduce.ts runIntervalExtraction``):
 *
 *   - a 0-tied lone untied unit lenses to a ~0.45 apex short of the far column;
 *   - a bracket-tied lone unit onlaps to a ~0.5 tip on that bracket;
 *   - the facing matrix claims the width past the apex (coverage stays complete);
 *   - the "clay between two sands" case lenses short of the far column, the sand
 *     matrix claims the rest.
 *
 * These SHAPE assertions go RED on the increment-4a full-width lone-side engine —
 * the coverage tests passed while the shapes ran to the far column. Cases are
 * built on 2-column SectionInput-shaped arrays with an approved tie or two to
 * bracket the interval (see ``partitionFillV2.bandAuthority.test.ts`` for the
 * input-construction pattern).
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** Ray-cast point-in-polygon in fraction×elevation. */
function inPoly(f: number, e: number, poly: { fraction: number; elevation: number }[]): boolean {
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

/** The single NON-lens formation covering (f, e) in a gap, or null. */
function matrixAt(regions: SectionRegion[], gap: number, f: number, e: number): string | null {
  for (const r of regions) {
    if (r.gapIndex !== gap || r.kind === 'lens') continue
    if (inPoly(f, e, r.polygon)) return r.formationId
  }
  return null
}

/** Max fraction any vertex of a region of formation ``fid`` reaches in a gap. */
function maxFractionOf(
  regions: SectionRegion[],
  gap: number,
  fid: string,
  kind?: SectionRegion['kind'],
): number {
  let m = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    if (kind && r.kind !== kind) continue
    for (const p of r.polygon) if (p.fraction > m) m = p.fraction
  }
  return m
}

describe('finding A — an untied lens pinches out short of the far column; the facing matrix claims the rest', () => {
  it('a 0-tied lone untied unit lenses to an apex short of the far column (NOT at the far edge)', () => {
    // Left: CLAY(0-2) over SAND(2-8). Right: SAND(0-8). The SAND bands top-to-top,
    // bracketing a surface interval that holds ONLY the left CLAY (lone side, no
    // counterpart). The CLAY is tied on NEITHER bracket -> it must LENS: pinch short
    // of the far column, and the SAND claims the vacated width past the apex.
    const lClay = layer()
    const lSand = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lClay },
      { top: 2, base: 8, f: SAND, layerId: lSand },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand }])
    const edges: CorrelationEdge[] = [{ a: lSand, b: rSand, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2([left, right], edges)

    // The CLAY lens must pinch out short of the far column — its apex is well left of
    // the far edge. On the full-width engine the CLAY reached fraction ~1.0.
    const clayMaxF = maxFractionOf(regions, 0, CLAY)
    expect(clayMaxF).toBeLessThan(0.6)
    // The facing SAND matrix claims the vacated width: at the CLAY's own elevation
    // (~9 mTAW), just short of the far column, the matrix is SAND.
    expect(matrixAt(regions, 0, 0.8, 9)).toBe(SAND)
    // And coverage stays complete at the CLAY's elevation near the far column.
    expect(matrixAt(regions, 0, 0.95, 9)).toBe(SAND)
  })

  it('a bracket-tied lone unit onlaps to a tip on the bracket (~0.5), not the far column', () => {
    // Left: SILT(0-3) over CLAY(3-8). Right: CLAY(0-8). The CLAY bands top-to-top; the
    // left SILT sits in the surface interval above the CLAY band and IS tied on its
    // BASE contact to the CLAY band top (a 1-tie unit) -> it ONLAPS the band, tip at
    // ~0.5 on the bracket, not running to the far column.
    const lSilt = layer()
    const lClay = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: SILT, layerId: lSilt },
      { top: 3, base: 8, f: CLAY, layerId: lClay },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay }])
    // CLAY top tie (the band). The SILT's BASE contact is the CLAY's top contact; the
    // CLAY top tie makes the SILT read base-tied (1-tie) -> onlap.
    const edges: CorrelationEdge[] = [{ a: lClay, b: rClay, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2([left, right], edges)

    // The SILT onlaps: its tip is well short of the far column (~0.5), and the CLAY
    // matrix claims the width past it.
    const siltMaxF = maxFractionOf(regions, 0, SILT)
    expect(siltMaxF).toBeLessThan(0.65)
    expect(matrixAt(regions, 0, 0.85, 8.5)).toBe(CLAY)
  })

  it('the facing matrix claims the whole remainder past the apex (coverage complete)', () => {
    // Same lone-CLAY-lens shape as case 1; assert the SAND matrix covers the WHOLE
    // remainder [~0.45..1] at the CLAY's elevation — no empty band past the apex.
    const lClay = layer()
    const lSand = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lClay },
      { top: 2, base: 8, f: SAND, layerId: lSand },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand }])
    const edges: CorrelationEdge[] = [{ a: lSand, b: rSand, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2([left, right], edges)
    for (const f of [0.5, 0.7, 0.9, 0.98]) {
      expect(matrixAt(regions, 0, f, 9)).toBe(SAND)
    }
  })

  it('"clay between two sands": the clay lenses short of the far column, the sand claims the rest', () => {
    // Left: SAND(0-3), CLAY(3-5), SAND(5-8). Right: SAND(0-8). The CLAY is enclosed by
    // sand above and below on the left, and the right is one continuous SAND. The CLAY
    // must lens (apex short of the far column ~0.45); the SAND matrix claims the rest.
    const lSandTop = layer()
    const lClay = layer()
    const lSandBot = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: SAND, layerId: lSandTop, body: 'bS' },
      { top: 3, base: 5, f: CLAY, layerId: lClay, body: 'bC' },
      { top: 5, base: 8, f: SAND, layerId: lSandBot, body: 'bS' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand, body: 'bS' }])
    const regions = computeSectionFillV2([left, right], [])

    // The CLAY lens pinches out short of the far column.
    const clayMaxF = maxFractionOf(regions, 0, CLAY)
    expect(clayMaxF).toBeLessThan(0.6)
    // At the CLAY's own elevation (~6 mTAW, the CLAY spans depth 3-5 -> elev 5-7),
    // near the far column the SAND matrix claims the space.
    expect(matrixAt(regions, 0, 0.8, 6)).toBe(SAND)
  })

  it('a MULTI-LENS interbedded stack: every enclosed lens pinches at ~0.45, the matrix bands across (CS1 gap0 class)', () => {
    // The real CS1 gap0 shape (GEO-22/115-S10 | GEO-10/170-S6): the left column carries a
    // CLAY matrix with THREE enclosed minorities INTERBEDDED in it (sand / sand / silt),
    // and the right column is one CONTINUOUS CLAY of the same matrix formation. The three
    // minorities must each LENS (pinch to a ~0.45 apex at their own elevation) while the
    // CLAY matrix bands ACROSS the gap. Increment 8's ``extractEnclosedLenses`` bailed on
    // this stack — after pulling the first minority the residual was still interleaved
    // (its single-pass scan saw a multi-formation matrix), so it tiled ALL of it as
    // full-width sub-seam slabs and NO minority pinched — the owner's "23/125-s6 clay
    // between the 2 sands isn't lensing" + "lenses run all the way to the next test".
    // Increment 9 ports v1's ITERATIVE interior-lens walk (``runIntervalExtraction``
    // branch 1): pull one, merge the enclosing neighbours into one matrix run, re-scan —
    // so the stack reduces to ONE clay matrix + three pinched minorities.
    const lClayTop = layer()
    const lSand1 = layer()
    const lClay2 = layer()
    const lSand2 = layer()
    const lClay3 = layer()
    const lSilt = layer()
    const lClay4 = layer()
    const rClay = layer()
    // Left: CLAY interbedded with sand / sand / silt (surface elev 12 → depth 0..6).
    const left = col('L', 12, [
      { top: 0, base: 1, f: CLAY, layerId: lClayTop },
      { top: 1, base: 2, f: SAND, layerId: lSand1 },
      { top: 2, base: 3, f: CLAY, layerId: lClay2 },
      { top: 3, base: 4, f: SAND, layerId: lSand2 },
      { top: 4, base: 4.5, f: CLAY, layerId: lClay3 },
      { top: 4.5, base: 5, f: SILT, layerId: lSilt },
      { top: 5, base: 6, f: CLAY, layerId: lClay4 },
    ])
    // Right: one continuous CLAY of the SAME matrix formation, surface aligned.
    const right = col('R', 12, [{ top: 0, base: 6, f: CLAY, layerId: rClay }])
    const regions = computeSectionFillV2([left, right], [])

    // Each enclosed minority (sand ~elev 10.5, sand ~8.5, silt ~7.25) pinches SHORT of
    // the far column — apex well left of the far edge.
    expect(maxFractionOf(regions, 0, SAND)).toBeLessThan(0.6)
    expect(maxFractionOf(regions, 0, SILT)).toBeLessThan(0.6)
    // The CLAY matrix bands across the gap: near the far column, at each minority's own
    // elevation, the matrix is CLAY (not empty, not the minority litho).
    expect(matrixAt(regions, 0, 0.9, 10.5)).toBe(CLAY) // past the upper sand lens
    expect(matrixAt(regions, 0, 0.9, 7.25)).toBe(CLAY) // past the silt lens
  })
})
