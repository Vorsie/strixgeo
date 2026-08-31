/**
 * partitionFillV2.bidirSweep.test.ts — TDD gates for the SESSION-8 ruling-8h
 * bidirectional six-phase sweep (design partition-engine-v2.md §8 ruling 8h).
 *
 * Ruling 8h supersedes the session-7 interval-level `tileCoherentStack` where they
 * conflict: emission is PER SIDE and UNCONDITIONAL — every 0-corr unit-side ALWAYS
 * gets its lens (phases 1/2 left/right), every 1-corr unit-side ALWAYS its onlap
 * (phases 3/4 left/right), the section-edge columns close every body's loop (phases
 * 5/6), and fill runs LITTLE TO BIG by containment (a face belongs to the SMALLEST
 * enclosing loop; an encompassing body's fill never overwrites an enclosed body's
 * face). These four synthetic gates prove the mission's four required properties
 * hole-free BEFORE the real-section blast radius:
 *
 *   (a) BIDIRECTIONAL closure — the same stack terminating on BOTH sides of a column
 *       gap gets BOTH lenses (the session-7 "you don't seem to be closing
 *       bidirectionally?" defect);
 *   (b) the CONVERGING-FACING shape session 7 BAILED on, now tiled by the sweep,
 *       hole-free (no bail concept);
 *   (c) NESTING / CONTAINMENT — an enclosed lens face survives inside its band's fill
 *       inside the substrate (little never overwritten by big);
 *   (d) SECTION-EDGE closure (phases 5-6 invariant) at the outermost columns.
 *
 * Gated behind `twoSidedTerminationsEnabled` (flag ON) — the sweep is the flip path.
 * Pure 2-/3-column `SectionInput` cases. Deterministic.
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
  for (let f = 0.04; f < 0.97; f += 0.04) {
    for (let e = elLo + 0.06; e < elHi - 0.02; e += 0.12) {
      const cov = coverAt(regions, gap, f, e)
      const distinct = new Set(cov)
      expect(distinct.size, `coverage at f=${f.toFixed(2)} e=${e.toFixed(2)} = ${JSON.stringify(cov)}`).toBe(1)
    }
  }
}

describe('session-8 ruling-8h bidirectional six-phase sweep', () => {
  it('(a) BIDIRECTIONAL closure: a stack terminating on BOTH sides of a column gets both lenses, hole-free', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Middle column S has a SILT lens (el 3..4) enclosed by ZAND above/below. On the LEFT gap
      // the facing carries ZAND across the silt elevation; on the RIGHT gap the facing also
      // carries ZAND. The silt must lens INTO BOTH gaps (bidirectional) — not just one side.
      // ZAND base-tied both gaps (one sand around the silt). Three columns → two gaps.
      const lK = layer(), lZ = layer(), lKb = layer()
      const mK = layer(), mZ1 = layer(), mS = layer(), mZ2 = layer(), mKb = layer()
      const rK = layer(), rZ = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: KLEI, layerId: lK, body: 'bK' },
        { top: 6, base: 12, f: ZAND, layerId: lZ, body: 'bZl' },
        { top: 12, base: 16, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const mid = col('M', 12, [
        { top: 0, base: 6, f: KLEI, layerId: mK, body: 'bK' },
        { top: 6, base: 8, f: ZAND, layerId: mZ1, body: 'bZm' },
        { top: 8, base: 9, f: SILT, layerId: mS, body: 'bS' },
        { top: 9, base: 12, f: ZAND, layerId: mZ2, body: 'bZm' },
        { top: 12, base: 16, f: KLEI, layerId: mKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 6, f: KLEI, layerId: rK, body: 'bK' },
        { top: 6, base: 12, f: ZAND, layerId: rZ, body: 'bZr' },
        { top: 12, base: 16, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      const edges: CorrelationEdge[] = [
        // KLEI top band both gaps.
        { a: lK, b: mK, aSide: 'top', bSide: 'top' },
        { a: lK, b: mK, aSide: 'base', bSide: 'base' },
        { a: mK, b: rK, aSide: 'top', bSide: 'top' },
        { a: mK, b: rK, aSide: 'base', bSide: 'base' },
        // ZAND base tie both gaps (one sand around the silt).
        { a: lZ, b: mZ2, aSide: 'base', bSide: 'base' },
        { a: mZ2, b: rZ, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, mid, right], edges)

      assertPartition(regions, 0, 0, 6)
      assertPartition(regions, 1, 0, 6)
      // The SILT lens must appear in BOTH gaps (bidirectional closure).
      expect(regions.some((r) => r.gapIndex === 0 && r.formationId === SILT), 'silt lens in gap 0').toBe(true)
      expect(regions.some((r) => r.gapIndex === 1 && r.formationId === SILT), 'silt lens in gap 1').toBe(true)
      // The enclosing sand detours around the silt on both sides (mid-gap at the silt level = sand).
      expect(coverAt(regions, 0, 0.5, 3.5)).toContain(ZAND)
      expect(coverAt(regions, 1, 0.5, 3.5)).toContain(ZAND)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(b) CONVERGING facing (session-7 bail): the present side terminates against a facing bracket that pinches to a point, hole-free', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left holds an interior KLEI minority (el 4..6) between a SILT band above (el6, tied) and a
      // ZAND band below (el4, tied). On the RIGHT the SILT band base and ZAND band top MEET at one
      // elevation (el5) — the facing bracket CONVERGES to a point. Session 7 bailed this; the sweep
      // must terminate the KLEI (onlap/lens toward conv) with the enclosing flooding the wedge.
      const lS = layer(), lK = layer(), lZ = layer()
      const rS = layer(), rZ = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: SILT, layerId: lS, body: 'bS' },
        { top: 6, base: 8, f: KLEI, layerId: lK, body: 'bK' },
        { top: 8, base: 14, f: ZAND, layerId: lZ, body: 'bZ' },
      ])
      // Right: SILT down to el5, ZAND from el5 — the SILT/ZAND contact is at el5, so the tied SILT
      // base (el6 left) and tied ZAND top (el8 left) converge to el5 on the right.
      const right = col('R', 12, [
        { top: 0, base: 7, f: SILT, layerId: rS, body: 'bSr' },
        { top: 7, base: 14, f: ZAND, layerId: rZ, body: 'bZr' },
      ])
      const edges: CorrelationEdge[] = [
        // SILT base tie: left el6 -> right el7 (real). ZAND top tie: left el8 -> right el7.
        { a: lS, b: rS, aSide: 'base', bSide: 'base' },
        { a: lZ, b: rZ, aSide: 'top', bSide: 'top' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // The interval el 6..8 (the KLEI minority against the converging SILT/ZAND facing): hole-free.
      assertPartition(regions, 0, 6.2, 7.8)
      // The KLEI minority is PRESENT (terminated, not swallowed to absent).
      expect(regions.some((r) => r.gapIndex === 0 && r.formationId === KLEI), 'klei minority present').toBe(true)
      // The KLEI does NOT reach the far (right) edge — it terminates (a lens/onlap, not full-width).
      let kMaxFrac = -Infinity
      for (const r of regions) {
        if (r.gapIndex !== 0 || r.formationId !== KLEI) continue
        for (const p of r.polygon) if (p.fraction > kMaxFrac) kMaxFrac = p.fraction
      }
      expect(kMaxFrac, 'klei terminates short of the far edge').toBeLessThan(0.9)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(c) NESTING / CONTAINMENT: an enclosed lens face survives inside its band fill (little never overwritten by big)', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // A SILT lens (el 8..9) enclosed by a ZAND band, itself sitting inside a KLEI-topped section.
      // Containment order: SILT lens (smallest) inside the ZAND band inside the section. The little
      // SILT face must survive — the big ZAND fill must not overwrite it.
      const lK = layer(), lZ1 = layer(), lS = layer(), lZ2 = layer(), lKb = layer()
      const rK = layer(), rZ = layer(), rKb = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: KLEI, layerId: lK, body: 'bK' },
        { top: 6, base: 8, f: ZAND, layerId: lZ1, body: 'bZ' },
        { top: 8, base: 9, f: SILT, layerId: lS, body: 'bS' },
        { top: 9, base: 13, f: ZAND, layerId: lZ2, body: 'bZ' },
        { top: 13, base: 17, f: KLEI, layerId: lKb, body: 'bK2' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 6, f: KLEI, layerId: rK, body: 'bK' },
        { top: 6, base: 13, f: ZAND, layerId: rZ, body: 'bZr' },
        { top: 13, base: 17, f: KLEI, layerId: rKb, body: 'bK2' },
      ])
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lZ2, b: rZ, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // Elevation = surface(12) − depth. First-litho top = el 6 (KLEI 0..6). ZAND el 6..-1;
      // the SILT lens is depth 8..9 = el 4..3 (mid el 3.5). The filled zone is el -4..6.
      assertPartition(regions, 0, -4, 5.5)
      // The SILT lens is present AND its own elevation near its column is SILT (not overwritten by
      // the enclosing ZAND fill) — the little face survives inside the big fill.
      expect(coverAt(regions, 0, 0.03, 3.5)).toContain(SILT)
      // And the enclosing ZAND is the SMALLEST enclosing loop's fill around it (mid-gap = ZAND).
      expect(coverAt(regions, 0, 0.5, 3.5)).toContain(ZAND)
      // No double-cover anywhere at the lens elevation band.
      expect(new Set(coverAt(regions, 0, 0.03, 3.5)).size).toBe(1)
      expect(new Set(coverAt(regions, 0, 0.5, 3.5)).size).toBe(1)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(d) SECTION-EDGE closure (phases 5-6): the outermost columns close every body loop at the section frame', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // A simple banded section: KLEI / ZAND / KLEI, all tied top+base across the one gap. Phases
      // 5-6 assert the outer column verticals close every band's loop at the frame — every band
      // reaches BOTH edges (frac 0 and frac 1) with no open (uncovered) strip at the columns.
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
      const edges: CorrelationEdge[] = [
        { a: lK, b: rK, aSide: 'top', bSide: 'top' },
        { a: lK, b: rK, aSide: 'base', bSide: 'base' },
        { a: lZ, b: rZ, aSide: 'top', bSide: 'top' },
        { a: lZ, b: rZ, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // Elevation = surface(12) − depth. Top KLEI depth 0..6 = el 12..6; ZAND depth 6..12 = el 6..0;
      // base KLEI depth 12..16 = el 0..-4. First-litho top = el 12 (the drilled surface). Filled el
      // -4..12. Sample WELL BELOW the top surface (el 11.5 down) to avoid the frame corner rounding.
      assertPartition(regions, 0, -3.5, 11.5)
      // Every band closes at BOTH section-edge columns (frac ~0 and frac ~1) — the ZAND band at its
      // own elevation reaches both frames; the KLEI bands likewise.
      expect(coverAt(regions, 0, 0.02, 3)).toContain(ZAND) // left frame, sand elevation (el 6..0)
      expect(coverAt(regions, 0, 0.98, 3)).toContain(ZAND) // right frame, sand elevation
      expect(coverAt(regions, 0, 0.02, 9)).toContain(KLEI) // left frame, top-clay elevation (el 12..6)
      expect(coverAt(regions, 0, 0.98, 9)).toContain(KLEI) // right frame, top-clay elevation
      expect(coverAt(regions, 0, 0.02, -2)).toContain(KLEI) // left frame, base-clay elevation (el 0..-4)
      expect(coverAt(regions, 0, 0.98, -2)).toContain(KLEI) // right frame, base-clay elevation
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
