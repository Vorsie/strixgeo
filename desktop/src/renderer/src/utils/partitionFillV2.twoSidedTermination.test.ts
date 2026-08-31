/**
 * partitionFillV2.twoSidedTermination.test.ts — OWNER RULING 8e (design
 * partition-engine-v2.md §8): SAME-FORMATION ENCLOSURE CONFORMS, with the mandatory
 * condition that enclosed DIFFERENT-formation minorities render as their ruling-8b
 * lenses (never absorbed/absent — "don't forget the silt lens ;)").
 *
 * HISTORY: this file previously held a describe.skip RED gate asserting the Tie-4 g0
 * full-width ZAND was a ``1corr-not-onlap`` LEAK to close by restructuring the
 * two-sided tiler. Owner ruling 8e (2026-07-15, on the real TS4 visual with his own
 * traced loop) RE-JUDGED that shape: the ZAND boundary unit merging into the ZAND
 * matched-pair band above is ONE sand face by construction ("it should be one sand" —
 * zand-top tie → down the right column around the silt lens → across the basal clay
 * tie → up the left column → back closes ONE loop). It is NOT a violation; the full-
 * width render is CORRECT. The RED gate is therefore rewritten as a GREEN 8e case in
 * the owner's traced-loop vocabulary:
 *   1. the ZAND face at the boundary unit's own elevation DOES reach full width (one
 *      sand — the 8e conforming render, the exact opposite of the old RED assertion);
 *   2. the enclosed DIFFERENT-formation minority (the SILT lens between the two ZAND
 *      runs) is PRESENT — a real SILT region at its own elevation, not absorbed into
 *      the sand (ruling 8e's condition — the line network must carry it);
 *   3. hole-free: the boundary unit's own elevation is covered.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

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
function maxFractionOf(regions: SectionRegion[], gap: number, fid: string): number {
  let m = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    for (const p of r.polygon) if (p.fraction > m) m = p.fraction
  }
  return m
}

describe('ruling 8e — same-formation enclosure conforms; the enclosed silt lens is present', () => {
  it('Tie-4 g0: the ZAND boundary unit merges into the ZAND band above (ONE sand), and the SILT lens between them survives', () => {
    // Real Tie-section 4 columns (GEO-23/125-S21 | GEO-05/040-S2). The RIGHT column stacks
    // ZAND u5 (el 0.91..5.45, a matched-pair band via the top-top SAND tie) — SILT u6
    // (el 0.56..0.91) — ZAND u7 (el −4.02..0.56, base-tied through the deep CLAY band). The
    // owner's traced loop closes ONE sand face around the silt lens: zand-top tie → down the
    // right column around the SILT lens → across the basal CLAY tie → up the left column →
    // back. So the full-width ZAND at u7's own elevation is the CORRECT 8e render, and the
    // SILT lens between the two ZAND runs must still be drawn (ruling 8e's condition).
    const lids: string[] = Array.from({ length: 5 }, () => layer())
    const rids: string[] = Array.from({ length: 9 }, () => layer())
    const left = col('L', 12.96, [
      { top: 0.01, base: 5.34, f: CLAY, layerId: lids[0] },
      { top: 5.34, base: 7.57, f: VEEN, layerId: lids[1] },
      { top: 7.57, base: 8.46, f: CLAY, layerId: lids[2] },
      { top: 8.46, base: 15.8, f: SAND, layerId: lids[3] },
      { top: 15.8, base: 23.27, f: CLAY, layerId: lids[4] },
    ])
    const right = col('R', 12.95, [
      { top: 0.05, base: 2.1, f: CLAY, layerId: rids[0] },
      { top: 2.1, base: 2.4, f: SILT, layerId: rids[1] },
      { top: 2.4, base: 3.81, f: VEEN, layerId: rids[2] },
      { top: 3.81, base: 4.25, f: CLAY, layerId: rids[3] },
      { top: 4.25, base: 7.5, f: SILT, layerId: rids[4] },
      { top: 7.5, base: 12.04, f: SAND, layerId: rids[5] },
      { top: 12.04, base: 12.39, f: SILT, layerId: rids[6] }, // the SILT lens (el 0.56..0.91)
      { top: 12.39, base: 16.97, f: SAND, layerId: rids[7] }, // the base-tied ZAND boundary unit
      { top: 16.97, base: 29.42, f: CLAY, layerId: rids[8] },
    ])
    // Ties (from the extractor): every L↔R top tie + the deepest CLAY base tie.
    const edges: CorrelationEdge[] = [
      { a: lids[1], b: rids[2], aSide: 'top', bSide: 'top' }, // VEEN
      { a: lids[2], b: rids[3], aSide: 'top', bSide: 'top' }, // CLAY
      { a: lids[3], b: rids[5], aSide: 'top', bSide: 'top' }, // SAND (ZAND matched-pair band)
      { a: lids[0], b: rids[0], aSide: 'top', bSide: 'top' }, // CLAY top
      { a: lids[4], b: rids[8], aSide: 'top', bSide: 'top' }, // deep CLAY top
      { a: lids[4], b: rids[8], aSide: 'base', bSide: 'base' }, // deep CLAY base
    ]
    const alongM = [0, 35.83]
    const regions = computeSectionFillV2([left, right], edges, undefined, alongM)

    // (1) 8e CONFORMS: the ZAND face at u7's own elevation (el ≈ −2) reaches full width —
    // ONE sand, enclosed by its own formation's tied face (the exact OPPOSITE of the old RED
    // assertion, per ruling 8e). Sample both edges at u7's own band.
    expect(coverAt(regions, 0, 0.05, -2)).toBe(SAND)
    expect(coverAt(regions, 0, 0.95, -2)).toBe(SAND)
    // The u5 ZAND matched-pair band (el 0.91..5.45) also bands full-width (it is 2-corr).
    expect(coverAt(regions, 0, 0.05, 3)).toBe(SAND)
    expect(coverAt(regions, 0, 0.95, 3)).toBe(SAND)

    // (2) DON'T FORGET THE SILT LENS: the enclosed different-formation minority between the
    // two ZAND runs (el 0.56..0.91, on the RIGHT column) is PRESENT — a SILT region at its
    // own elevation, near the right edge. Ruling 8e's mandatory condition: the line network
    // must carry it (never absorbed into the sand).
    const siltMax = maxFractionOf(regions, 0, SILT)
    expect(siltMax).toBeGreaterThan(0.5) // a SILT region exists in the gap and reaches toward the right
    // Ruling 8b (design partition-engine-v2.md §8) intended diff: the SILT lens is a THIN
    // unit (0.35 m thick) in a wide gap (35.83 m), so its 0-corr auto reach caps at
    // min(0.45, 2×0.35/35.83) ≈ 0.02 of the gap — a HUGGING HALO against the right column,
    // not the old flat-0.45 tongue. Previously this sampled (0.97, 0.73) and expected SILT;
    // under 8b the halo apex sits at fraction ≈ 0.98, so a sample 2% in from the right column
    // (fraction 0.99) is inside the halo, while 0.97 now falls in the enclosing sand. The
    // lens is NOT absorbed (siltMax above ≈ 1.0, the 8e condition holds) — only shortened.
    expect(coverAt(regions, 0, 0.99, 0.73)).toBe(SILT)
  })
})
