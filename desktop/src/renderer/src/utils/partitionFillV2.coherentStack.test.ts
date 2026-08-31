/**
 * partitionFillV2.coherentStack.test.ts — TDD gates for the SESSION-7 FLIP coherent
 * stack tiler (``tileCoherentStack``; design partition-engine-v2.md §8 ruling 8g).
 *
 * Ruling 8g's boundary-walk algorithm generalised: 0-corr lenses first, 1-corr onlaps
 * second, closed-shape fill last; a lens is a DETOUR in the enclosing band's contour,
 * never a wall; base-tied same-formation pairs are ONE band. These synthetic cases prove
 * the four canonical shapes hole-free BEFORE the flip meets the real-section blast radius:
 *
 *   (a) the owner's worked example (sand / silt lens / sand): the silt closes as a lens
 *       detour, ONE sand face around it, base tie closes the bottom;
 *   (b) mid-stack minority (session-5 interval A shape): notch filled coherently, no
 *       overlap, no hole;
 *   (c) base-tied same-formation pair → one band (ruling 8g(b));
 *   (d) both-sides-terminating stacks meeting at the shared seam.
 *
 * Gated behind ``twoSidedTerminationsEnabled`` (flag ON) — RED until the flip ships.
 * Pure 2-column ``SectionInput`` cases.
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
const VEEN = 'veen'

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

function maxFractionOf(regions: SectionRegion[], gap: number, fid: string): number {
  let m = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gap || r.formationId !== fid) continue
    for (const p of r.polygon) if (p.fraction > m) m = p.fraction
  }
  return m
}

/** Assert no interior coverage hole and no different-litho overlap across a dense sweep. */
function assertPartition(regions: SectionRegion[], gap: number, elLo: number, elHi: number): void {
  for (let f = 0.04; f < 0.97; f += 0.04) {
    for (let e = elLo + 0.06; e < elHi - 0.02; e += 0.12) {
      const cov = coverAt(regions, gap, f, e)
      const distinct = new Set(cov)
      expect(distinct.size, `coverage at f=${f.toFixed(2)} e=${e.toFixed(2)} = ${JSON.stringify(cov)}`).toBe(1)
    }
  }
}

describe('session-7 coherent stack tiler (ruling 8g)', () => {
  it('(a) owner example: sand / silt lens / sand — silt is a lens DETOUR, one sand face around it, base tie closes', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left: KLEI(surf..6=el6) / ZAND(6..9=el3) / SILT(9..9.6=el2.4) / ZAND(9.6..14=el-2) /
      //   KLEI(14..18). The SILT is enclosed by ZAND above+below (a same-formation lens →
      //   extracted at the COLUMN level, a hole in the ZAND band). Right: KLEI / ZAND / KLEI —
      //   the ZAND spans so the sands connect. Base-tie the two ZAND bases → ONE sand band.
      const lK = layer(), lZ1 = layer(), lS = layer(), lZ2 = layer(), lKb = layer()
      const rK = layer(), rZ = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: KLEI, layerId: lK, body: 'bK' },
        { top: 6, base: 9, f: ZAND, layerId: lZ1, body: 'bZ' },
        { top: 9, base: 9.6, f: SILT, layerId: lS, body: 'bS' },
        { top: 9.6, base: 14, f: ZAND, layerId: lZ2, body: 'bZ' },
        { top: 14, base: 18, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 6, f: KLEI, layerId: rK, body: 'bK' },
        { top: 6, base: 14, f: ZAND, layerId: rZ, body: 'bZr' },
        { top: 14, base: 18, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      // Top KLEI base-tie (el 6) + deep ZAND base-tie (el -2) bracket the sand; the sands are
      // one band by the base tie (8g(b)). The SILT stays a lens hole in the sand.
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lZ2, b: rZ, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      assertPartition(regions, 0, -2, 6)
      // ONE sand face around the silt (ruling 8g(b) — the base-tied sands connect): sand reaches
      // BOTH edges at the sand elevation below the lens AND above it.
      expect(coverAt(regions, 0, 0.05, 0)).toContain(ZAND)
      expect(coverAt(regions, 0, 0.95, 0)).toContain(ZAND)
      expect(coverAt(regions, 0, 0.05, 4.5)).toContain(ZAND)
      expect(coverAt(regions, 0, 0.95, 4.5)).toContain(ZAND)
      // The SILT lens is PRESENT (a detour in the sand): a SILT region exists, and the mid-gap at
      // the silt's own elevation is SAND (the enclosing detours around the silt — not a wall).
      expect(regions.some((r) => r.gapIndex === 0 && r.formationId === SILT)).toBe(true)
      expect(coverAt(regions, 0, 0.5, 2.7)).toContain(ZAND) // mid-gap at the silt elevation = sand
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(b) mid-stack minority: a lone [SILT, ZAND, VEEN] stack (mid ZAND minority, all different) meets a continuous KLEI enclosing, coherently, no hole/overlap', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left: KLEI(band) / SILT(el5..7) / ZAND(el3..5, the mid-stack minority) / VEEN(el1..3) /
      //   KLEI(band). ALL THREE differ (SILT/ZAND/VEEN) so NONE is a same-formation enclosed lens
      //   (no column extraction) — they reach the coherent stack tiler as a genuine multi-unit
      //   lone stack. Right: KLEI(band) / KLEI(el1..7, the continuous enclosing) / KLEI(band).
      // The interval el1..7 (between the two KLEI bands, HORIZONTAL ties) holds the lone left
      // stack; the right carries KLEI across it (real thickness). Each left unit terminates toward
      // the seam; KLEI floods the right half — the coherent stack multi-unit lone path.
      const lK = layer(), lS = layer(), lZ = layer(), lV = layer(), lKb = layer()
      const rK = layer(), rKm = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 5, f: KLEI, layerId: lK, body: 'bK' },
        { top: 5, base: 7, f: SILT, layerId: lS, body: 'bS' },
        { top: 7, base: 9, f: ZAND, layerId: lZ, body: 'bZ' },
        { top: 9, base: 11, f: VEEN, layerId: lV, body: 'bV' },
        { top: 11, base: 16, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 5, f: KLEI, layerId: rK, body: 'bK' },
        { top: 5, base: 11, f: KLEI, layerId: rKm, body: 'bKm' },
        { top: 11, base: 16, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      // KLEI matched bands above (el7, top+base tie) and below (el1, top+base tie) bracket the
      // interval on REAL facing thickness (el 7 → el 1). The left SILT/ZAND/VEEN stack is lone
      // and untied inside; the right carries KLEI (el1..7) continuously → the enclosing flood.
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lKb, b: rKb, aSide: 'top', bSide: 'top' },
        { a: lKb, b: rKb, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // The interval el 1..7: hole-free + no different-litho overlap.
      assertPartition(regions, 0, 1, 7)
      // The mid ZAND minority is PRESENT and terminates (does not reach the far column).
      const zandMax = maxFractionOf(regions, 0, ZAND)
      expect(zandMax).toBeGreaterThan(0)
      expect(zandMax).toBeLessThan(0.75)
      // KLEI (the enclosing) reaches the far (right) column across the interval.
      expect(coverAt(regions, 0, 0.95, 4)).toContain(KLEI)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(c) base-tied same-formation pair → ONE band (ruling 8g(b))', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left: KLEI(surf..6=el6) / ZAND(6..12=el0) / KLEI(12..16). Right: KLEI / ZAND / KLEI, with
      // the ZANDs joined by a BASE-BASE tie (el0) only (NO top tie). Ruling 8g(b): base-tied
      // same-formation → ONE band, full-width sand at the ZAND elevation.
      const lK = layer(), lZ = layer(), lKb = layer()
      const rK = layer(), rZ = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: KLEI, layerId: lK, body: 'bK' },
        { top: 6, base: 12, f: ZAND, layerId: lZ, body: 'bZ' },
        { top: 12, base: 16, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 6, f: KLEI, layerId: rK, body: 'bK' },
        { top: 6, base: 12, f: ZAND, layerId: rZ, body: 'bZr' },
        { top: 12, base: 16, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      // KLEI top band brackets above; the ZAND base-base tie makes the two sands one band.
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lZ, b: rZ, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      assertPartition(regions, 0, 0, 6)
      // ONE sand band: ZAND reaches BOTH edges at el 3 (mid-sand).
      expect(coverAt(regions, 0, 0.05, 3)).toContain(ZAND)
      expect(coverAt(regions, 0, 0.95, 3)).toContain(ZAND)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(d) both-sides-terminating stacks meet at the shared seam, hole-free', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left interval holds SILT (0-corr) over ZAND (0-corr); right holds ZAND (0-corr) over
      // SILT (0-corr) — mirrored, both untied inside the interval. They meet at the 0.5 seam;
      // each unit terminates as a lens; hole-free by construction. Brackets: a KLEI band above
      // (top tie) and a KLEI band below (base tie), both matched pairs, so the interval between
      // them is the two facing untied stacks.
      const lK = layer(), lS = layer(), lZ = layer(), lKb = layer()
      const rK = layer(), rZ = layer(), rS = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 5, f: KLEI, layerId: lK, body: 'bK' },
        { top: 5, base: 8, f: SILT, layerId: lS, body: 'bS' },
        { top: 8, base: 11, f: ZAND, layerId: lZ, body: 'bZ' },
        { top: 11, base: 16, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 5, f: KLEI, layerId: rK, body: 'bK' },
        { top: 5, base: 8, f: ZAND, layerId: rZ, body: 'bZr' },
        { top: 8, base: 11, f: SILT, layerId: rS, body: 'bSr' },
        { top: 11, base: 16, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      // KLEI matched bands above (el7 top-tie + base) and below (el1 top-tie + base) bracket the
      // interval; the SILT/ZAND stacks inside are all untied (0-corr) → terminate + meet at seam.
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lKb, b: rKb, aSide: 'top', bSide: 'top' },
        { a: lKb, b: rKb, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // The interval el 1..7 (between the two KLEI bands): hole-free, no different-litho overlap.
      assertPartition(regions, 0, 1, 7)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
