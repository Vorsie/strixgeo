/**
 * partitionFillV2.coherentLoneStack.test.ts — TDD gate for the SESSION-6
 * single-coherent-flood / seam-with-notches primitive (REWRITE_STATE §9; design
 * partition-engine-v2.md §8f ruling, KEY session-6 lead).
 *
 * A LONE stack of MIXED terminations (each unit onlaps/lenses by its own corr) must tile
 * HOLE-FREE with the enclosing matrix descending as ONE continuous flood face bounded by
 * every unit's pinch — NOT N independent ``emitLonePinch`` wedges (session 5 proved +666
 * overlaps). The template is ``routeLoneStack.emitLoneStackBand`` (slab-seam decomposition,
 * hole-free); this primitive generalises it to a mixed enclosing that CHANGES lithology down
 * the stack and to onlaps that MEET at a mid seam.
 *
 * These cases are SYNTHETIC (clean geometry — a genuine differing enclosing the facing
 * carries) so the mechanism is proven in isolation before it meets the real-section blast
 * radius. Gated behind ``COHERENT_LONE_STACK_ENABLED`` (tileGap) — RED until the primitive
 * ships + the flag flips.
 *
 * Pure 2-column ``SectionInput`` cases (the ``loneSidePinch`` construction pattern).
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const KLEI = 'klei'
const SILT = 'silt'
const ZAND = 'zand'

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

/** Ray-cast point-in-polygon in fraction×elevation. */
function inPoly(f: number, e: number, poly: { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const fi = poly[i].fraction, ei = poly[i].elevation, fj = poly[j].fraction, ej = poly[j].elevation
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

function coverAt(regions: SectionRegion[], gap: number, f: number, e: number): string[] {
  const out: string[] = []
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    if (inPoly(f, e, r.polygon)) out.push(r.formationId)
  }
  return out
}

/** Assert no interior coverage hole and no different-litho overlap across a dense sweep. */
function assertPartition(regions: SectionRegion[], gap: number, elLo: number, elHi: number): void {
  for (let f = 0.03; f < 0.98; f += 0.03) {
    for (let e = elLo + 0.05; e < elHi; e += 0.1) {
      const cov = coverAt(regions, gap, f, e)
      const distinct = new Set(cov)
      expect(distinct.size, `coverage at f=${f.toFixed(2)} e=${e.toFixed(2)} = ${JSON.stringify(cov)}`).toBe(1)
    }
  }
}

describe('session-6 coherent lone-stack primitive', () => {
  it('a lone {SILT top-onlap, ZAND base-onlap} enclosed by KLEI tiles hole-free; each terminates, KLEI floods between', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left column: KLEI(surf..8=el4) / SILT(8..8.5=el3.5) / ZAND(8.5..14.5=el-2.5) /
      //   KLEI(14.5..18=el-6). Right column: KLEI(surf..8=el4) / SILT-band(8..9) / KLEI(9..18).
      // The interval between the top KLEI-base tie and the bottom KLEI-top tie holds the lone
      // SILT + ZAND on the left; the RIGHT carries KLEI across that whole span (the differing
      // enclosing the facing genuinely holds), with a thin SILT band tie so the brackets are
      // REAL anchors (not a converging facing). SILT top-tied → onlaps down; ZAND base-tied →
      // onlaps up; both meet a mid seam; the facing KLEI floods between as ONE face.
      const lKleiTop = layer(), lSilt = layer(), lZand = layer(), lKleiBot = layer()
      const rKleiTop = layer(), rKleiMid = layer(), rKleiBot = layer()
      const left = col('L', 12, [
        { top: 0, base: 8, f: KLEI, layerId: lKleiTop, body: 'bK' },
        { top: 8, base: 8.5, f: SILT, layerId: lSilt, body: 'bS' },
        { top: 8.5, base: 14.5, f: ZAND, layerId: lZand, body: 'bZ' },
        { top: 14.5, base: 18, f: KLEI, layerId: lKleiBot, body: 'bK2' },
      ])
      // Right column: KLEI in three contacts so the interval facing has REAL thickness (el 4 →
      // el -2.5, not a converging point): KLEI(surf..8=el4) / KLEI(8..14.5=el-2.5) / KLEI(rest).
      const right = col('R', 12, [
        { top: 0, base: 8, f: KLEI, layerId: rKleiTop, body: 'bK' },
        { top: 8, base: 14.5, f: KLEI, layerId: rKleiMid, body: 'bKm' },
        { top: 14.5, base: 18, f: KLEI, layerId: rKleiBot, body: 'bK2' },
      ])
      // Two ties bracket the interval on REAL facing thickness: the upper KLEI base-to-base (el 4)
      // and the lower KLEI base-to-base (el -2.5). The lone SILT top rides the upper KLEI band, the
      // lone ZAND base rides the lower KLEI band → both derived onlaps, both brackets REAL anchors,
      // and the facing carries KLEI across el 4 .. -2.5 (the differing enclosing).
      const edges: CorrelationEdge[] = [
        { a: lKleiTop, b: rKleiTop, aSide: 'top', bSide: 'top' },
        { a: lKleiTop, b: rKleiTop, aSide: 'base', bSide: 'base' },
        { a: lZand, b: rKleiMid, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // No hole, no overlap across the lone interval span (el ~ -2.5 .. 4 in mTAW: surface 12
      // minus depth). SILT is at depth 8-8.5 → el 3.5-4; ZAND 8.5-14.5 → el -2.5-3.5.
      assertPartition(regions, 0, -2.5, 4)

      // SILT terminates (does not reach the far column); ZAND terminates; KLEI reaches the far column.
      const siltMaxF = Math.max(...regions.filter((r) => r.gapIndex === 0 && r.formationId === SILT).flatMap((r) => r.polygon.map((p) => p.fraction)), -1)
      const zandMaxF = Math.max(...regions.filter((r) => r.gapIndex === 0 && r.formationId === ZAND).flatMap((r) => r.polygon.map((p) => p.fraction)), -1)
      expect(siltMaxF).toBeLessThan(0.75)
      expect(zandMaxF).toBeLessThan(0.75)
      // Near the far column at the ZAND / SILT elevations, the KLEI enclosing claims the width.
      expect(coverAt(regions, 0, 0.9, 3.7)).toContain(KLEI) // SILT elevation, far side
      expect(coverAt(regions, 0, 0.9, 0)).toContain(KLEI) // ZAND elevation, far side
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
