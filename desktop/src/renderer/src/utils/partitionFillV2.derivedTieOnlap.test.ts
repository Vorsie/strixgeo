/**
 * partitionFillV2.derivedTieOnlap.test.ts — DERIVED-TIE ONLAP gate (owner insight
 * 2026-07-15, design partition-engine-v2.md §4 increment-2 "derived base-tie" row).
 *
 * Owner's words (on the real S5A|S5 render): "that clay has a bottom correlation, it
 * should onlap on the zand tie." A unit's contact that is SHARED with a directly-
 * adjacent TIED band (the band's top contact IS this unit's base contact, in a gap-
 * free column) is a DERIVED TIE: the unit is 1-corr and must ONLAP the band — its
 * pinch tip rides the tie line (apex fraction ~0.5), NOT reach full width (the retired
 * geometric auto-match, ruling 8) and NOT terminate as a 0-corr own-elevation lens
 * (0.45). The band beneath supplies the flood that claims the vacated width.
 *
 * These cases paraphrase the owner's rule directly (no internal-variable language).
 * They are the fast red/green for the build; the model-wide acceptance instrument is
 * the shape audit's 0-corr-full-width counter (its derived-tie-onlap rows -> 0).
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'

interface U { top: number; base: number; f: string; layerId: string; body?: string | null }
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

/** Fraction extent [lo,hi] of the widest region of ``fid`` in a gap. */
function fracSpanOf(regions: SectionRegion[], gap: number, fid: string): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    for (const p of r.polygon) {
      if (p.fraction < lo) lo = p.fraction
      if (p.fraction > hi) hi = p.fraction
    }
  }
  return [lo, hi]
}

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
function coverAt(regions: SectionRegion[], gap: number, f: number, e: number): string | null {
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    if (inPoly(f, e, r.polygon)) return r.formationId
  }
  return null
}

describe('DERIVED-TIE ONLAP — a unit sharing a contact with an adjacent tied band onlaps it', () => {
  it('a lone-left CLAY whose BASE is a tied SAND band top onlaps the tie (not full-width, not a 0.45 lens)', () => {
    // LEFT: SILT[10..8] CLAY[8..5] SAND[5..1]. RIGHT: SILT[10..8] SAND[5..1] (no CLAY).
    // The SAND pair is tied top-top + base-base → a full-width band. The CLAY (lone-left)
    // has its BASE contact at elev 5 = the SAND band's TOP contact → a DERIVED base-tie.
    // Owner: the CLAY must ONLAP the SAND band — pinch tip riding the tie at ~0.5, the SAND
    // band flooding below. It must NOT reach full width, and NOT lens at 0.45 own-elevation.
    const lSiltTop = layer()
    const lClay = layer()
    const lSand = layer()
    const rSiltTop = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: SILT, layerId: lSiltTop, body: 'bSiL' },
      { top: 2, base: 5, f: CLAY, layerId: lClay, body: 'bCL' },
      { top: 5, base: 9, f: SAND, layerId: lSand, body: 'bZ' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: SILT, layerId: rSiltTop, body: 'bSiR' },
      // A gap 2..5 (elev 8..5) is closed by closeColumnGaps to SILT — but to make the SAND
      // the direct neighbour we give RIGHT SILT down to 5 then SAND.
      { top: 2, base: 5, f: SILT, layerId: layer(), body: 'bSiR' },
      { top: 5, base: 9, f: SAND, layerId: rSand, body: 'bZ' },
    ])
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // The SAND band is full-width (its tie authorises it).
    const [sLo, sHi] = fracSpanOf(regions, 0, SAND)
    expect(sLo <= 0.02 && sHi >= 0.98).toBe(true)
    // The CLAY ONLAPS: it starts at the left column (lo ~0) and pinches SHORT of the far
    // column — its far reach is an onlap tip near ~0.5, strictly NOT full width.
    const [cLo, cHi] = fracSpanOf(regions, 0, CLAY)
    expect(cLo).toBeLessThan(0.02) // anchored on its own (left) column
    expect(cHi).toBeLessThan(0.98) // pinches short of the far column (NOT full-width)
    expect(cHi).toBeGreaterThan(0.35) // an onlap tip (~0.5), not a truncated 0.45 lens far short
    // Coverage complete past the CLAY tip: SILT (the facing matrix above the tie) claims the
    // space at the CLAY's own elevation near the far column — no hole, no CLAY spill.
    expect(coverAt(regions, 0, 0.9, 6.5)).toBe(SILT)
    // Below the SAND-top tie, the SAND band claims the space (full-width).
    expect(coverAt(regions, 0, 0.9, 3)).toBe(SAND)
  })
})
