/**
 * partitionFillV2.convergingStack.test.ts — SESSION-10 TDD gates for the two targets
 * (design partition-engine-v2.md §8 ruling 8h phases 1-2 — UNCONDITIONAL per-unit lenses).
 *
 * These gates encode the owner's session-10 acceptance in the RULE's vocabulary (NOT impl-shaped):
 *
 *   (a) TARGET 1 — a MULTI-UNIT 0-corr stack facing a CONVERGING side gets ONE per-unit lens PER
 *       unit-side (not a single combined flank, not absent), separated by their shared-contact
 *       boundaries, hole-free (the session-8 multi-unit-converging bail is retired). Owner: "0
 *       coming in on the right → this should be a lens by the 2/1/0 rule".
 *   (b) TARGET 1 — a mid-stack unit BANDED on one side + 0-corr (converging) on the other lenses on
 *       its 0-corr side (the CS1 col14 SILT: banded left, lens right).
 *   (c) TARGET 2 — a SUB-SNAP-WIDTH gap (< 1 mm after the along-metres → snap grid) emits NO
 *       degenerate curve (a flank whose snapped endpoints coincide) and leaves NO hole (the CS1
 *       col21/col22 gap21 0.17 m ``close72`` elev-8.92-to-8.92 class). The lens degenerates to
 *       nothing; the enclosing fill covers the slot.
 *
 * Gated behind ``twoSidedTerminationsEnabled`` (flag ON — the flip path) for (a)/(b); (c) is a
 * pure-geometry snap-grid gate that holds in BOTH flag states. Deterministic.
 *
 * NOTE (session 10): the multi-unit-converging coherent construction (``tileConvergingStack``) is
 * currently GATED OFF (``MULTI_UNIT_CONVERGING_ENABLED = false`` — measured negative on real data,
 * see REWRITE_STATE §13). On THESE simple synthetic shapes (a)/(b) pass via the existing fallback
 * paths (single-unit converging / meet-at-seam), so they stand as behavioural gates for the DESIRED
 * outcome (each interbed terminates, hole-free) regardless of which path produces it — and they will
 * gate the coherent construction once it is un-gated with the sloping-bracket / minority-span fix.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { renderedShape } from './partitionFillV2.conformance.classify'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'

let seq = 0
const layer = (): string => `L${seq++}`
const KLEI = 'klei'
const SILT = 'silt'
const VEEN = 'veen'
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

/** Assert exactly-one coverage (no hole, no different-litho overlap) across a dense sweep. */
function assertPartition(regions: SectionRegion[], gap: number, elLo: number, elHi: number): void {
  for (let f = 0.04; f < 0.97; f += 0.04) {
    for (let e = elLo + 0.06; e < elHi - 0.02; e += 0.1) {
      const cov = coverAt(regions, gap, f, e)
      expect(new Set(cov).size, `coverage at f=${f.toFixed(2)} e=${e.toFixed(2)} = ${JSON.stringify(cov)}`).toBe(1)
    }
  }
}

function inGap(regions: SectionRegion[], gap: number): SectionRegion[] {
  return regions.filter((r) => r.gapIndex === gap)
}

describe('session-10 TARGET 1 — multi-unit 0-corr stack facing a converging side lenses per unit', () => {
  it('(a) a 3-unit 0-corr interbed stack facing a converging bracket → three per-unit lenses, hole-free', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left: SILT band (el 12..6, base tied) / 3-unit interbed [A/B/C, el 6..4] / ZAND band
      // (el 4..-2, top tied). The interbed's enclosing is SILT above (el 6) and ZAND below (el 4)
      // — a MIXED bracket. Right: SILT down to el 5, ZAND from el 5 — the SILT base tie (left el6 →
      // right el5) and the ZAND top tie (left el4 → right el5) CONVERGE to el 5 on the right, so the
      // interbed [el 4..6] faces a bracket that pinches to a point. Each of A/B/C must lens toward
      // that convergence with its OWN notch, separated by the A/B and B/C contact seams — hole-free.
      const lS = layer(), lA = layer(), lB = layer(), lC = layer(), lZ = layer()
      const rS = layer(), rZ = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: SILT, layerId: lS, body: 'bS' },
        { top: 6, base: 6.7, f: KLEI, layerId: lA, body: 'bA' },
        { top: 6.7, base: 7.3, f: VEEN, layerId: lB, body: 'bB' },
        { top: 7.3, base: 8, f: KLEI, layerId: lC, body: 'bC' },
        { top: 8, base: 14, f: ZAND, layerId: lZ, body: 'bZ' },
      ])
      const right = col('R', 12, [
        { top: 0, base: 7, f: SILT, layerId: rS, body: 'bSr' },
        { top: 7, base: 14, f: ZAND, layerId: rZ, body: 'bZr' },
      ])
      // Left interbed depth 6..8 = el 6..4. SILT base tie (left el6 → right el5), ZAND top tie
      // (left el4 → right el5) → converge at el5.
      const edges: CorrelationEdge[] = [
        { a: lS, b: rS, aSide: 'base', bSide: 'base' },
        { a: lZ, b: rZ, aSide: 'top', bSide: 'top' },
      ]
      const regions = computeSectionFillV2([left, right], edges)

      // The interbed interval (el 4..6) is a hole-free partition.
      assertPartition(regions, 0, 4.1, 5.9)
      // The interbed sits at el 6..4 (depth 6..8): KLEI top slab el 6..5.3, VEEN el 5.3..4.7, KLEI
      // base slab el 4.7..4. Each DISTINCT formation is present as its own termination (not absent,
      // not a full-width band).
      const kleiRs = renderedShape(inGap(regions, 0), KLEI, 4, 6, 'left')
      const veenReal = renderedShape(inGap(regions, 0), VEEN, 4.7, 5.3, 'left')
      expect(kleiRs.shape === 'lens' || kleiRs.shape === 'onlap', 'KLEI interbed terminates (lens/onlap), not absent/band').toBe(true)
      expect(veenReal.shape === 'lens' || veenReal.shape === 'onlap', 'VEEN interbed terminates (lens/onlap), not absent/band').toBe(true)
      // Neither interbed formation reaches the far (converging) edge — they terminate short.
      let interbedMaxFrac = -Infinity
      for (const r of inGap(regions, 0)) {
        if (r.formationId !== KLEI && r.formationId !== VEEN) continue
        for (const p of r.polygon) if (p.elevation > 4 - 0.01 && p.elevation < 6 + 0.01 && p.fraction > interbedMaxFrac) interbedMaxFrac = p.fraction
      }
      expect(interbedMaxFrac, 'interbed lenses terminate short of the converging far edge').toBeLessThan(0.9)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(b) a mid-stack unit banded on one side lenses on its 0-corr (converging) side', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Three columns. The MID column has a 2-unit interbed [SILT, VEEN] (el 6..4) enclosed by a
      // ZAND band above/below. On the LEFT gap the interbed is tied (matched-pair — bands). On the
      // RIGHT gap the enclosing ZAND ties CONVERGE (the right column's ZAND is continuous), so the
      // interbed is 0-corr and must LENS right — each of SILT/VEEN its OWN lens (the CS1 col14/col18
      // "banded left, lens right" acceptance).
      const lZt = layer(), lS = layer(), lV = layer(), lZb = layer()
      const mZt = layer(), mS = layer(), mV = layer(), mZb = layer()
      const rZ = layer()
      const left = col('L', 12, [
        { top: 0, base: 6, f: ZAND, layerId: lZt, body: 'bZt' },
        { top: 6, base: 7, f: SILT, layerId: lS, body: 'bSl' },
        { top: 7, base: 8, f: VEEN, layerId: lV, body: 'bVl' },
        { top: 8, base: 16, f: ZAND, layerId: lZb, body: 'bZb' },
      ])
      const mid = col('M', 12, [
        { top: 0, base: 6, f: ZAND, layerId: mZt, body: 'bZt' },
        { top: 6, base: 7, f: SILT, layerId: mS, body: 'bSm' },
        { top: 7, base: 8, f: VEEN, layerId: mV, body: 'bVm' },
        { top: 8, base: 16, f: ZAND, layerId: mZb, body: 'bZb' },
      ])
      // Right: continuous ZAND (no interbed) — the enclosing ZAND converges over the interbed span.
      const right = col('R', 12, [{ top: 0, base: 16, f: ZAND, layerId: rZ, body: 'bZr' }])
      // Matched-pair SILT + VEEN bands on the LEFT gap only (left↔mid).
      const edges: CorrelationEdge[] = [
        { a: lS, b: mS, aSide: 'top', bSide: 'top' },
        { a: lS, b: mS, aSide: 'base', bSide: 'base' },
        { a: lV, b: mV, aSide: 'top', bSide: 'top' },
        { a: lV, b: mV, aSide: 'base', bSide: 'base' },
      ]
      const regions = computeSectionFillV2([left, mid, right], edges)

      // Gap1 (mid↔right) interbed interval el 6..4 is hole-free.
      assertPartition(regions, 1, 4.1, 5.9)
      // Both interbed formations terminate (lens/onlap) in gap1 — not absent, not a full-width band.
      const siltRs = renderedShape(inGap(regions, 1), SILT, 5, 6, 'left')
      const veenRs = renderedShape(inGap(regions, 1), VEEN, 4, 5, 'left')
      expect(siltRs.shape === 'lens' || siltRs.shape === 'onlap', 'SILT lenses right (gap1)').toBe(true)
      expect(veenRs.shape === 'lens' || veenRs.shape === 'onlap', 'VEEN lenses right (gap1)').toBe(true)
      // On the LEFT gap the interbed BANDS (matched pair).
      expect(renderedShape(inGap(regions, 0), SILT, 5, 6, 'left').shape).toBe('band')
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})

describe('session-10 TARGET 2 — a sub-snap-width gap emits no degenerate curve and no hole', () => {
  it('(c) an enclosed lens in a < 1 mm along-metres gap degenerates cleanly (no half-open loop, no hole)', () => {
    // Two columns 0.17 m apart in along-metres (the CS1 col21/col22 gap21 width). At the 1 mm snap
    // grid the lens apex fraction × 0.17 m collapses onto the column — a flank snaps to zero extent
    // in BOTH axes (the elev-8.92-to-8.92 ``close72`` class). The degenerate-flank guard must skip
    // BOTH flanks so the arrangement never sees a coincident-endpoint curve, and the enclosing ZAND
    // simply covers the interbed slot — a hole-free, overlap-free partition.
    const mk = (surf: number, units: [string, number, number][], tag: string): PartitionColumn['units'] =>
      units.map(([f, top, base], i) => ({
        layerId: `${tag}-${i}`, topDepthM: surf - top, baseDepthM: surf - base, formationId: f, bodyId: `B-${f}-${tag}`,
      }))
    // Middle column carries a thin SILT interbed enclosed by ZAND; outer columns carry the ZAND.
    const columns: PartitionColumn[] = [
      { investigationId: 'A', surfaceElevM: 12, units: mk(12, [['ZAND', 12, 2]], 'a') },
      { investigationId: 'B', surfaceElevM: 12, units: mk(12, [['ZAND', 12, 9.1], ['SILT', 9.1, 8.9], ['ZAND', 8.9, 2]], 'b') },
      { investigationId: 'C', surfaceElevM: 12, units: mk(12, [['ZAND', 12, 2]], 'c') },
    ]
    const edges: CorrelationEdge[] = []
    // Sub-snap gaps: 0.17 m and 0.17 m (the two along-metres spacings).
    const alongM = [0, 0.17, 0.34]
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)

    // The section still tiles as a hole-free, overlap-free partition (the degenerate lens dropped).
    assertPartition(regions, 0, 3, 8.8)
    assertPartition(regions, 1, 3, 8.8)
    // No emitted region polygon carries a zero-extent (degenerate) edge in the OUTPUT — every
    // consecutive vertex pair differs in at least one axis (a coincident-endpoint segment would be
    // a malformed face boundary that slipped past the guard).
    for (const r of regions) {
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i]
        const b = r.polygon[(i + 1) % r.polygon.length]
        const same = Math.abs(a.fraction - b.fraction) < 1e-9 && Math.abs(a.elevation - b.elevation) < 1e-9
        expect(same, `region ${r.formationId} gap${r.gapIndex} has a zero-extent edge at vertex ${i}`).toBe(false)
      }
    }
  })
})
