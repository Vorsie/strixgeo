/**
 * partitionFillV2.strict210.test.ts — STRICT 2/1/0 gate (owner ruling 8, design
 * partition-engine-v2.md §8, 2026-07-14 evening).
 *
 * The owner's words: "Uncorrelated units TERMINATE — always. Facing same-formation
 * units with no drawn tie render as opposing lenses/pinches; they band ONLY when a
 * correlation edge is drawn/accepted. v1's geometric same-formation auto-matching is
 * RETIRED in v2."
 *
 * These cases paraphrase that rule directly — they do NOT reference an internal
 * variable or branch. A unit with ZERO drawn ties toward the facing column must
 * pinch/lens SHORT of the far column; it must NEVER reach full width by geometric
 * auto-matching. A unit with a drawn tie keeps its band (the tie authorises it).
 *
 * The engine-level acceptance instrument is the model-wide shape audit
 * (``partitionFillV2.shapeaudit.diag.test.ts``, SHAPE_AUDIT=1): its 0-corr-full-width
 * counter must be 0. These synthetic cases are the fast red/green during the build.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'
const VEEN = 'veen'

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

/** Max fraction any vertex of a region of formation ``fid`` reaches in a gap. */
function maxFractionOf(regions: SectionRegion[], gap: number, fid: string): number {
  let m = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    for (const p of r.polygon) if (p.fraction > m) m = p.fraction
  }
  return m
}

/** Min fraction any vertex of a region of formation ``fid`` reaches in a gap. */
function minFractionOf(regions: SectionRegion[], gap: number, fid: string): number {
  let m = Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    for (const p of r.polygon) if (p.fraction < m) m = p.fraction
  }
  return m
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

/** ANY formation covering (f, e) in a gap, or null — a coverage probe. */
function coverAt(regions: SectionRegion[], gap: number, f: number, e: number): string | null {
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    if (inPoly(f, e, r.polygon)) return r.formationId
  }
  return null
}

describe('STRICT 2/1/0 — an uncorrelated unit ALWAYS terminates (ruling 8)', () => {
  it('a lone unit whose facing carries a MIXED bracket (different litho above vs below), no tie, still pinches short of the far column (Tie-6 VEEN class)', () => {
    // The Tie-section 6 VEEN shape: LEFT has VEEN enclosed by KLEI above and SILT below
    // (a MIXED facing bracket — the guard the old engine used to bail on into full-width).
    // The RIGHT column carries KLEI at VEEN's top and SILT at its base but NO VEEN. With
    // NO drawn tie, VEEN must LENS short of the far column — never run full width.
    const lKleiTop = layer()
    const lVeen = layer()
    const lSiltBot = layer()
    const rKlei = layer()
    const rSilt = layer()
    // Left surface 10: KLEI 0-2 (elev 10-8), VEEN 2-5 (elev 8-5), SILT 5-9 (elev 5-1).
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lKleiTop, body: 'bK' },
      { top: 2, base: 5, f: VEEN, layerId: lVeen, body: 'bV' },
      { top: 5, base: 9, f: SILT, layerId: lSiltBot, body: 'bSl' },
    ])
    // Right surface 10: KLEI 0-4 (elev 10-6), SILT 4-9 (elev 6-1). No VEEN → lone-left.
    const right = col('R', 10, [
      { top: 0, base: 4, f: CLAY, layerId: rKlei, body: 'bKr' },
      { top: 4, base: 9, f: SILT, layerId: rSilt, body: 'bSr' },
    ])
    const regions = computeSectionFillV2([left, right], [])
    // VEEN pinches short of the far column (a lens ~0.45), NOT full width.
    expect(maxFractionOf(regions, 0, VEEN)).toBeLessThan(0.6)
    // Coverage stays complete past the apex: at VEEN's own elevation (~6.5), near the far
    // column, the space is claimed by the facing matrix (KLEI above / SILT below), never empty.
    expect(coverAt(regions, 0, 0.9, 6.5)).not.toBeNull()
    expect(coverAt(regions, 0, 0.98, 6.5)).not.toBeNull()
  })

  it('a lone right-side unit, no tie, pinches from its OWN (right) column (CS2 gap10 SILT class)', () => {
    // RIGHT has a SILT enclosed by CLAY above and below; LEFT carries CLAY across. No tie.
    // SILT must lens toward the LEFT, its apex short of the left column (min fraction > 0.4).
    const lClay = layer()
    const rClayTop = layer()
    const rSilt = layer()
    const rClayBot = layer()
    const left = col('L', 10, [{ top: 0, base: 8, f: CLAY, layerId: lClay, body: 'bC' }])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rClayTop, body: 'bC2' },
      { top: 3, base: 5, f: SILT, layerId: rSilt, body: 'bS' },
      { top: 5, base: 8, f: CLAY, layerId: rClayBot, body: 'bC3' },
    ])
    const regions = computeSectionFillV2([left, right], [])
    // SILT pinches toward the left — its apex is well right of the left column.
    expect(minFractionOf(regions, 0, SILT)).toBeGreaterThan(0.4)
    // The CLAY matrix claims the vacated width near the LEFT column at SILT's elevation.
    expect(coverAt(regions, 0, 0.05, 6)).toBe(CLAY)
  })

  it('two FACING same-formation units with NO tie render as OPPOSING lenses, not one full-width band', () => {
    // LEFT SAND [elev 8..5] faces RIGHT SAND [elev 8..5], both enclosed in CLAY, NO tie.
    // Ruling 8: they do NOT auto-band full-width — each pinches toward the other (opposing
    // lenses), the CLAY matrix claims the middle.
    const lClayTop = layer()
    const lSand = layer()
    const lClayBot = layer()
    const rClayTop = layer()
    const rSand = layer()
    const rClayBot = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lClayTop, body: 'bCa' },
      { top: 2, base: 5, f: SAND, layerId: lSand, body: 'bSa' },
      { top: 5, base: 9, f: CLAY, layerId: lClayBot, body: 'bCb' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: CLAY, layerId: rClayTop, body: 'bCc' },
      { top: 2, base: 5, f: SAND, layerId: rSand, body: 'bSd' },
      { top: 5, base: 9, f: CLAY, layerId: rClayBot, body: 'bCe' },
    ])
    const regions = computeSectionFillV2([left, right], [])
    // Neither SAND region reaches full width: the left SAND stays left (max < 0.6), the
    // right SAND stays right (min > 0.4). No single SAND quad spans [0..1].
    const sandRegions = regions.filter((r) => r.gapIndex === 0 && r.formationId === SAND)
    for (const r of sandRegions) {
      const fs = r.polygon.map((p) => p.fraction)
      const lo = Math.min(...fs)
      const hi = Math.max(...fs)
      // No SAND region spans the whole gap (a full-width band would be lo~0 AND hi~1).
      expect(lo <= 0.02 && hi >= 0.98).toBe(false)
    }
    // The CLAY matrix claims the middle at SAND's elevation.
    expect(coverAt(regions, 0, 0.5, 6.5)).toBe(CLAY)
  })

  it('a minority whose base rides a tied band, sitting between two DIFFERENT tied bands that converge on the facing, ONLAPS (ruling 8a — S5A|S5 KLEI)', () => {
    // Owner's S5A|S5 trace (ruling 8a, 2026-07-15): a KLEI minority on the LEFT is enclosed
    // above by a SILT band and below by a ZAND band. Both bands are TIED, and on the facing
    // (RIGHT) column they CONVERGE to one contact (SILT base = ZAND top = elev 8). The KLEI's
    // BASE contact IS the tied ZAND band's top → a DERIVED tie: the KLEI must ONLAP that tie
    // (pinch tip riding it at ~0.5), NOT reach full width (the retired auto-match) and NOT
    // stay a full-width band by "converging = data void" (the pre-8a bail). The owner's own
    // closed-loop trace: the SILT face above closes AROUND the KLEI onlap notch by boundary
    // composition — one SILT region covering the loop, no hole, no overlap.
    const lSiltTop = layer()
    const lKlei = layer()
    const lZand = layer()
    const lSiltBot = layer()
    const rSiltTop = layer()
    const rZand = layer()
    const rSiltBot = layer()
    // LEFT surface 10: SILT[10..8] KLEI[8..7] ZAND[7..5] SILT[5..2].
    const left = col('S5A', 10, [
      { top: 0, base: 2, f: SILT, layerId: lSiltTop, body: 'lst' },
      { top: 2, base: 3, f: CLAY, layerId: lKlei, body: 'lk' },
      { top: 3, base: 5, f: SAND, layerId: lZand, body: 'lz' },
      { top: 5, base: 8, f: SILT, layerId: lSiltBot, body: 'lsb' },
    ])
    // RIGHT surface 10: SILT[10..8] ZAND[8..5] SILT[5..2] — no KLEI, the two bands share elev 8.
    const right = col('S5', 10, [
      { top: 0, base: 2, f: SILT, layerId: rSiltTop, body: 'rst' },
      { top: 2, base: 5, f: SAND, layerId: rZand, body: 'rz' },
      { top: 5, base: 8, f: SILT, layerId: rSiltBot, body: 'rsb' },
    ])
    // Ties: the SILT-top band (top-top + base-base) and the ZAND band (top-top + base-base).
    const edges: CorrelationEdge[] = [
      { a: lSiltTop, b: rSiltTop, aSide: 'top', bSide: 'top' },
      { a: lSiltTop, b: rSiltTop, aSide: 'base', bSide: 'base' },
      { a: lZand, b: rZand, aSide: 'top', bSide: 'top' },
      { a: lZand, b: rZand, aSide: 'base', bSide: 'base' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // The KLEI ONLAPS: anchored on its own (left) column, pinching short of the far column —
    // its far reach is an onlap tip near ~0.5, strictly NOT full width.
    expect(minFractionOf(regions, 0, CLAY)).toBeLessThan(0.02) // on its own left column
    expect(maxFractionOf(regions, 0, CLAY)).toBeLessThan(0.85) // pinches short (NOT full-width)
    expect(maxFractionOf(regions, 0, CLAY)).toBeGreaterThan(0.3) // an onlap tip (~0.5)
    // The SILT face above the ZAND-top tie closes AROUND the KLEI onlap notch (owner's trace:
    // sand tie -> up the clay onlap -> silt top -> back, a closed SILT face). Above the rising
    // ZAND-top tie line and below the SILT-base band, near the far column, the space is SILT.
    expect(coverAt(regions, 0, 0.7, 7.9)).toBe(SILT)
    expect(coverAt(regions, 0, 0.3, 7.7)).toBe(SILT)
    // Below the ZAND-top tie the ZAND band claims the width (full-width band, never empty).
    expect(coverAt(regions, 0, 0.9, 6)).toBe(SAND)
  })

  it('two facing same-formation units WITH a drawn tie DO band full-width (the tie authorises it)', () => {
    // Same shape as above but WITH a top-top + base-base tie on the SAND pair. The tie
    // authorises the band — SAND must reach full width (a quad spanning [0..1]).
    const lClayTop = layer()
    const lSand = layer()
    const lClayBot = layer()
    const rClayTop = layer()
    const rSand = layer()
    const rClayBot = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lClayTop, body: 'bCa' },
      { top: 2, base: 5, f: SAND, layerId: lSand, body: 'bS' },
      { top: 5, base: 9, f: CLAY, layerId: lClayBot, body: 'bCb' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: CLAY, layerId: rClayTop, body: 'bCc' },
      { top: 2, base: 5, f: SAND, layerId: rSand, body: 'bS' },
      { top: 5, base: 9, f: CLAY, layerId: rClayBot, body: 'bCe' },
    ])
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // The SAND band reaches full width (there IS a SAND region spanning [0..1]).
    const sandFull = regions.some((r) => {
      if (r.gapIndex !== 0 || r.formationId !== SAND) return false
      const fs = r.polygon.map((p) => p.fraction)
      return Math.min(...fs) <= 0.02 && Math.max(...fs) >= 0.98
    })
    expect(sandFull).toBe(true)
  })
})
