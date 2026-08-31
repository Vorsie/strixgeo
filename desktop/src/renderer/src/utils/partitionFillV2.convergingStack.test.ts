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
 * NOTE (session 11): the multi-unit-converging construction (``tileConvergingStack``) is now
 * REACH-HALVING (owner ruling 8b conflict-resolution — the seams never move, the LENS shrinks) and
 * gated ON (``MULTI_UNIT_CONVERGING_ENABLED = true``). Session-11 gates (d)/(e) exercise the halving
 * loop directly: a minority between steeply sloping brackets emits a lens at a HALVED reach entirely
 * inside the wedge (d), and a thick minority in a very steep wedge halves multiple times and still
 * emits (e) — both hole-free. (a)/(b) remain behavioural gates for the desired outcome (each interbed
 * terminates, hole-free) regardless of which path produces it; (c)/(f) gate TARGET 2 (sub-snap clean
 * degeneration) in both flag states.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { renderedShape } from './partitionFillV2.conformance.classify'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

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
      // RULING 8r (LINES BEFORE THE MERGE, owner 2026-07-19): ``extractEnclosedLenses`` extracts VEEN
      // as an enclosed lens and MERGES the two KLEI slabs (above + below VEEN) into ONE host. Under 8r
      // the termination sweep classifies on the RAW picked pieces, NOT the merged host: VEEN is the
      // true minority interbed and LENSES (its own 0.45 hole); the two KLEI slabs are the ENCLOSING
      // MATRIX (same formation, same body), which per ruling 8g DETOURS AROUND VEEN and reconnects —
      // one KLEI body with VEEN as a notch, filling the wedge between the converging SILT-base and
      // ZAND-top ties. (Pre-8r the un-split merged KLEI host emitted a single detour-onlap at 0.5; 8r
      // makes the raw KLEI slabs each inherit their own host contact's tie [8l(b)] and merge back into
      // the wrapping body via the 8j post-fill merge.) The behavioural intent stands: the true interbed
      // VEEN terminates, hole-free; the enclosing KLEI is one body wrapping it.
      const veenReal = renderedShape(inGap(regions, 0), VEEN, 4.7, 5.3, 'left')
      expect(veenReal.shape === 'lens' || veenReal.shape === 'onlap', 'VEEN interbed terminates (lens/onlap), not absent/band').toBe(true)
      // VEEN (the true minority) terminates short of the converging far edge — its own lens does not
      // reach the convergence (the KLEI matrix, not VEEN, fills the wedge to the convergence point).
      let veenMaxFrac = -Infinity
      for (const r of inGap(regions, 0)) {
        if (r.formationId !== VEEN) continue
        for (const p of r.polygon) if (p.elevation > 4 - 0.01 && p.elevation < 6 + 0.01 && p.fraction > veenMaxFrac) veenMaxFrac = p.fraction
      }
      expect(veenMaxFrac, 'VEEN lens terminates short of the converging far edge').toBeLessThan(0.9)
      // The enclosing KLEI is ONE body present on BOTH sides of the VEEN lens (the 8g wrap, welded by
      // the 8j post-fill merge) — never absent, never split into two different bodies.
      const kleiRegions = inGap(regions, 0).filter((r) => r.formationId === KLEI)
      expect(kleiRegions.length, 'KLEI enclosing matrix is present (wraps the VEEN lens)').toBeGreaterThan(0)
      const kleiBodies = new Set(kleiRegions.map((r) => r.bodyId))
      expect(kleiBodies.size, 'the KLEI wrap is ONE body (ruling 8g detour + 8j merge)').toBe(1)
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

describe('session-11 REACH-HALVING — a minority lens shrinks to fit inside the sloping wedge', () => {
  it('(d) a minority between steeply sloping brackets emits a lens at a HALVED reach, entirely inside the wedge, hole-free', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Left: ZAND band (el 12..7) / SILT minority (el 7..6) / ZAND band (el 6..-4). The enclosing is
      // ZAND above AND below (SAME formation) — the SILT interbed is a 0-corr minority. Right: the
      // enclosing ZAND ties CONVERGE (the right column is continuous ZAND), so over the interbed span
      // the top bracket (el7 → conv) and base bracket (el6 → conv) STEEPLY slope to one point. At the
      // full 0.45 reach the SILT apex (own mid el 6.5) would poke ABOVE the descending top bracket
      // near the apex x — so the reach must HALVE until the lens fits inside the wedge. The partition
      // must stay hole-free (the enclosing ZAND floods around the shrunk lens).
      const lZt = layer(), lS = layer(), lZb = layer(), rZ = layer()
      const left = col('L', 12, [
        { top: 0, base: 5, f: ZAND, layerId: lZt, body: 'bZt' },
        { top: 5, base: 6, f: SILT, layerId: lS, body: 'bSl' },
        { top: 6, base: 16, f: ZAND, layerId: lZb, body: 'bZb' },
      ])
      // Right: continuous ZAND — the enclosing converges over the interbed (el 7..6 on the left).
      const right = col('R', 12, [{ top: 0, base: 16, f: ZAND, layerId: rZ, body: 'bZr' }])
      // Tie the ZAND bands so the interbed is enclosed by a matched-pair band that converges right.
      const edges: CorrelationEdge[] = [
        { a: lZt, b: rZ, aSide: 'base', bSide: 'base' },
        { a: lZb, b: rZ, aSide: 'top', bSide: 'top' },
      ]
      const regions = computeSectionFillV2([left, right], edges)
      // The interbed interval (el 6..7) is a hole-free partition.
      assertPartition(regions, 0, 6.05, 6.95)
      // The SILT interbed terminates (lens/onlap) — not absent, not full-width.
      const siltRs = renderedShape(inGap(regions, 0), SILT, 6, 7, 'left')
      expect(siltRs.shape === 'lens' || siltRs.shape === 'onlap', 'SILT interbed terminates').toBe(true)
      // Its reach stays SHORT of the far edge (a halved lens hugs its own column).
      expect(siltRs.apex, 'halved SILT lens reach hugs its own column').toBeLessThan(0.45 + 1e-6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('(e) a minority in a VERY steep wedge halves multiple times and still emits (never absent)', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // A THICK minority (el 7..4, 3 m) enclosed by ZAND above/below, facing a converging ZAND. The
      // interbed is thick relative to the tiny facing convergence, so its mid-elevation apex conflicts
      // with the wedge at the 8b reach AND at each halving until a small reach fits — it must still
      // emit a (short) lens, not vanish. Hole-free.
      const lZt = layer(), lM = layer(), lZb = layer(), rZ = layer()
      const left = col('L', 12, [
        { top: 0, base: 5, f: ZAND, layerId: lZt, body: 'bZt' },
        { top: 5, base: 8, f: KLEI, layerId: lM, body: 'bKl' },
        { top: 8, base: 16, f: ZAND, layerId: lZb, body: 'bZb' },
      ])
      const right = col('R', 12, [{ top: 0, base: 16, f: ZAND, layerId: rZ, body: 'bZr' }])
      const edges: CorrelationEdge[] = [
        { a: lZt, b: rZ, aSide: 'base', bSide: 'base' },
        { a: lZb, b: rZ, aSide: 'top', bSide: 'top' },
      ]
      const regions = computeSectionFillV2([left, right], edges)
      assertPartition(regions, 0, 4.05, 6.95)
      const kleiRs = renderedShape(inGap(regions, 0), KLEI, 4, 7, 'left')
      expect(kleiRs.shape === 'lens' || kleiRs.shape === 'onlap', 'thick KLEI interbed still terminates after multiple halvings').toBe(true)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})

describe('session-12 TARGET A — an ALL-MINORITIES lone stack (own-column enclosed) facing a converging tie lenses per unit in the DEFAULT engine', () => {
  it('(g) KLEI/[SILT,VEEN]/KLEI on one column, facing a converging tied band: SILT+VEEN each hug their column (NOT full-width), hole-free — flag OFF', () => {
    // The CS1 col18 gap18 shape reduced: the LEFT column carries a run of TWO minorities SILT+VEEN
    // enclosed by KLEI ABOVE and KLEI BELOW (the enclosing lives ONLY in the own-column brackets —
    // neither SILT nor VEEN is KLEI, so ``extractLoneStackLenses`` cannot reduce the stack and the
    // old code bailed → the seam tiled them FULL-WIDTH). The RIGHT column carries a ZAND that is
    // TIED to the KLEI brackets so the facing bracket CONVERGES (zero interval thickness over the
    // minority span). By ruling 8h phases 1-2 each of SILT/VEEN must get its OWN 8b lens hugging the
    // left column; the enclosing KLEI floods around them. This runs in the DEFAULT engine (flag OFF)
    // — the fix lands in ``routeLoneStack`` (not behind the two-sided flag).
    const lKt = layer(), lSi = layer(), lVe = layer(), lKb = layer()
    const rK = layer(), rZ = layer()
    // Left: KLEI (el 12..6.5) / SILT (6.5..5.5) / VEEN (5.5..4.5) / KLEI (4.5..-4). Depths from surf 12.
    const left = col('L', 12, [
      { top: 0, base: 5.5, f: KLEI, layerId: lKt, body: 'bKt' },
      { top: 5.5, base: 6.5, f: SILT, layerId: lSi, body: 'bSi' },
      { top: 6.5, base: 7.5, f: VEEN, layerId: lVe, body: 'bVe' },
      { top: 7.5, base: 16, f: KLEI, layerId: lKb, body: 'bKb' },
    ])
    // Right: KLEI (el 12..7) then ZAND (7..-4). The left KLEI-top base tie (left el6.5 → right el7)
    // and the left KLEI-bottom top tie (left el4.5 → right el7) CONVERGE at el7 — the facing bracket
    // over the SILT/VEEN span (el 4.5..6.5) pinches to a point at el7. ZAND carries the facing side.
    const right = col('R', 12, [
      { top: 0, base: 5, f: KLEI, layerId: rK, body: 'bKr' },
      { top: 5, base: 16, f: ZAND, layerId: rZ, body: 'bZr' },
    ])
    // Tie the enclosing KLEI so the bracket over the minority run converges on the right.
    const edges: CorrelationEdge[] = [
      { a: lKt, b: rK, aSide: 'base', bSide: 'base' },
      { a: lKb, b: rK, aSide: 'top', bSide: 'base' },
    ]
    const prev = setTwoSidedTerminations(false) // DEFAULT engine
    try {
      const regions = computeSectionFillV2([left, right], edges)
      // Both minorities terminate as a hugging lens/onlap — NOT full-width band, NOT absent.
      const siltRs = renderedShape(inGap(regions, 0), SILT, 5.5, 6.5, 'left')
      const veenRs = renderedShape(inGap(regions, 0), VEEN, 4.5, 5.5, 'left')
      expect(siltRs.shape === 'lens' || siltRs.shape === 'onlap', `SILT terminates (was ${siltRs.shape})`).toBe(true)
      expect(veenRs.shape === 'lens' || veenRs.shape === 'onlap', `VEEN terminates (was ${veenRs.shape})`).toBe(true)
      // Each hugs the left column — reach short of the far edge (8b cap).
      expect(siltRs.apex, 'SILT lens hugs its column').toBeLessThan(0.9)
      expect(veenRs.apex, 'VEEN lens hugs its column').toBeLessThan(0.9)
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
