/**
 * partitionFillV2.crossingConflicts.test.ts — OWNER §8 Q4 (design
 * partition-engine-v2.md §8): crossing approved ties are a HARD CONFLICT —
 * NEITHER bands, both fall back to pinch/lens, and the conflict is reported.
 *
 * DEFECT A regression gate. The historical crossing check
 * (``emitCurves.pruneCrossingTies``) only saw ADJACENT per-gap ties, so a
 * JUMP-TIE (deep-to-deep substrate BRIDGE) crossing another bridge — or a bridge
 * crossing an adjacent tie in a gap it passes through — entered the arrangement
 * with ZERO conflict checking. This gate encodes the owner's Q4 ruling in his own
 * vocabulary for the bridge cases:
 *
 *   1. bridge × bridge crossing → both suspended, conflict reported (2 edges),
 *      NO band/substrate geometry off either bridge, both formations terminate;
 *   2. bridge × adjacent-tie crossing → both suspended, same assertions;
 *   3. non-crossing bridge + tie coexisting → NO conflict, geometry unchanged
 *      (guard against over-suppression).
 *
 * These use a 3-column section: two deep anchor columns bracketing a shallow
 * middle column, so a jump tie (columns 0↔2) is a substrate BRIDGE, not an
 * adjacent tie.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2WithConflicts } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const SAND = 'sand'
const CLAY = 'clay'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
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
      bodyId: null,
    })),
  }
}

/** Point-in-polygon (ray cast) in fraction×elevation space. */
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
/** Every drilled layer id any region in this gap is attributed to. */
function layersInGap(regions: SectionRegion[], gap: number): string[] {
  const out: string[] = []
  for (const r of regions) if (r.gapIndex === gap) out.push(...(r.layerIds ?? []))
  return out
}

describe('§8 Q4 — crossing approved ties are a hard conflict (bridges included)', () => {
  it('case 1: bridge × bridge crossing → both suspended, conflict reported, no substrate band off either', () => {
    // Three columns: deep L (0), shallow middle M (1), deep R (2). Two JUMP ties
    // both span L↔R (columns 0↔2) → both are substrate BRIDGES. They cross:
    //   bridge A: L SAND base (deep, low elev) ↔ R SAND top (shallow, high elev)  → ascends
    //   bridge B: L CLAY top (high elev)       ↔ R CLAY base (deep, low elev)     → descends
    // In along-metres the two straight bridge lines cross between the columns.
    const lSand = layer()
    const lClay = layer()
    const rSand = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 6, f: CLAY, layerId: lClay }, // el 10..4
      { top: 6, base: 14, f: SAND, layerId: lSand }, // el 4..-4 (deep)
    ])
    const mid = col('M', 10, [
      { top: 0, base: 3, f: SILT, layerId: layer() }, // shallow — TD at el 7
    ])
    const right = col('R', 10, [
      { top: 0, base: 6, f: SAND, layerId: rSand }, // el 10..4
      { top: 6, base: 14, f: CLAY, layerId: rClay }, // el 4..-4 (deep)
    ])
    // Bridge A: L SAND top (el 4) ↔ R SAND top (el 10) → ascends L→R.
    // Bridge B: L CLAY base (el 4) ↔ R CLAY base (el -4) → descends L→R.
    // At x=0 A=4 < B=4? equal — nudge by using base of SAND vs top of CLAY so the
    // two lines have opposite vertical order at the two ends:
    //   A (SAND base tie):  L el -4  ↔  R el 4    → ascends
    //   B (CLAY base tie):  L el 4   ↔  R el -4   → descends
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' }, // ascends (-4 → 4)
      { a: lClay, b: rClay, aSide: 'base', bSide: 'base' }, // descends (4 → -4)
    ]
    // Asymmetric spacing so the two straight bridge lines cross STRICTLY inside
    // gap 1 (right of the middle column), not exactly at the middle column (which
    // would be a shared endpoint in each gap and not count as a crossing).
    const alongM = [0, 10, 40]
    const { regions, conflicts } = computeSectionFillV2WithConflicts(
      [left, mid, right],
      edges,
      undefined,
      alongM,
    )

    // Both bridges suspended → a single reported conflict naming the two edges.
    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    expect(conflicts[0].tieIds.length).toBe(2)
    // NEITHER SUSPENDED BRIDGE CARRIED A UNIT ACROSS THE SHALLOW MIDDLE. A bridge is the only
    // thing that can put one column's deep unit into the gap on the FAR side of M, so that —
    // not "nothing spans a gap" — is what a suspended bridge must be judged on: L's deep SAND
    // never appears in gap 1, R's deep CLAY never in gap 0.
    //
    // Re-anchored 2026-08-21 (owner: *"it should be a continuous band starting from S7 but now
    // it is interrupted at S7A's column"*). M's log stops at el 7, so it read NOTHING at the
    // deep elevations, and each deep unit now continues full-width into ITS OWN gap
    // (``emitContinuation``). "No spanning quad / not SAND at (0.5, -2)" therefore no longer
    // separates a bridge band from a drilled unit's own lawful continuation — the LAYER does.
    // Re-anchored again 2026-08-21 (the RELOCATION refinement, owner: *"you made them
    // crossing but now it is inconsistent with the litho and some don't terminate in a
    // pinch"*). M read NOTHING at the deep elevations, so it is not a boundary at all: each
    // deep unit now crosses it and pinches against the far DEEP column — which puts L's sand
    // into gap 1 LAWFULLY, with no bridge involved. "Never in the far gap" therefore no
    // longer separates a suspended bridge from a drilled unit's own continuation, and that
    // pin is retired. What still separates them is REACH: a live bridge bands the pair
    // column-to-column, while two suspended bridges leave each unit closing in an open pinch
    // short of the other test — so beside each column only that column's own unit stands.
    // Positive control first, so the negatives cannot pass vacuously on an unattributed
    // partition: each deep unit IS attributed in its own gap.
    expect(layersInGap(regions, 0)).toContain(lSand)
    expect(layersInGap(regions, 1)).toContain(rClay)
    expect(coverAt(regions, 1, 0.98, -2)).toBe(CLAY) // beside R: L's sand never got there
    expect(coverAt(regions, 0, 0.02, -2)).toBe(SAND) // beside L: R's clay never got there
    // Each closes in an OPEN PINCH — present at its own apex level, gone below it...
    expect(coverAt(regions, 0, 0.5, -2)).toBe(SAND) // L's sand still thick at mid-gap 0
    expect(coverAt(regions, 1, 0.5, 0)).toBe(CLAY) // R's clay at its own apex level
    // ...and NOTHING spans. With both bridges suspended the deep middle of the far gap is
    // EMPTY (owner §8 Q3 — sub-TD ground stays empty unless a tie reaches it), which is the
    // sharpest statement of "no substrate band off either". The pre-relocation curtain
    // filled that ground full-width and hid exactly this.
    expect(coverAt(regions, 1, 0.5, -2)).toBeNull()
  })

  it('case 2: bridge × adjacent-tie crossing → both suspended, conflict reported', () => {
    // L (0) deep, M (1) deep enough to carry an adjacent tie, R (2) deep.
    //   bridge  : L SAND base (deep) ↔ R SAND base (deep), passing THROUGH gap 0 & 1.
    //   adj tie : L→M in gap 0 crossing that bridge's gap-0 segment.
    const lSand = layer()
    const lClay = layer()
    const mSand = layer()
    const mClay = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 6, f: CLAY, layerId: lClay }, // el 10..4
      { top: 6, base: 16, f: SAND, layerId: lSand }, // el 4..-6
    ])
    const mid = col('M', 10, [
      { top: 0, base: 6, f: SAND, layerId: mSand }, // el 10..4
      { top: 6, base: 16, f: CLAY, layerId: mClay }, // el 4..-6
    ])
    const right = col('R', 10, [
      { top: 0, base: 16, f: SAND, layerId: rSand }, // el 10..-6
    ])
    // Bridge spans L↔R (columns 0↔2): L SAND base (el -6) ↔ R SAND base (el -6) → flat at -6.
    // Adjacent tie in gap 0: L CLAY base (el 4) ↔ M CLAY top (el 4)... instead make it CROSS:
    //   adjacent tie: L SAND top (el 4) ↔ M CLAY base (el -6) → descends 4 → -6 across gap 0.
    // Bridge gap-0 segment: L el -6 ↔ (interp at M) el -6 → flat -6. These share the
    // right endpoint elevation (-6), so nudge the bridge to be non-flat:
    //   bridge: L SAND base (el -6) ↔ R SAND top (el 10) → ascends -6 → 10.
    //   gap-0 bridge segment: L el -6 ↔ interp@M (x=20 of 0..40) = 2.
    //   adjacent tie gap 0:   L el 4  ↔ M el -6.
    //   at left: bridge -6 < tie 4; at right(M): bridge 2 > tie -6 → OPPOSITE ORDER → cross.
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'base', bSide: 'top' }, // bridge L↔R, ascends
      { a: lSand, b: mClay, aSide: 'top', bSide: 'base' }, // adjacent tie L↔M gap 0, descends
    ]
    const alongM = [0, 20, 40]
    const { conflicts } = computeSectionFillV2WithConflicts([left, mid, right], edges, undefined, alongM)

    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    expect(conflicts[0].tieIds.length).toBe(2)
  })

  it('case 3: non-crossing bridge + adjacent tie coexist → NO conflict (no over-suppression)', () => {
    // Same 3-column layout, but the two edges do NOT cross: a deep flat bridge
    // well below a shallow adjacent tie near the surface.
    const lSand = layer()
    const lClay = layer()
    const mSand = layer()
    const rSand = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 4, f: CLAY, layerId: lClay }, // el 10..6
      { top: 4, base: 16, f: SAND, layerId: lSand }, // el 6..-6
    ])
    const mid = col('M', 10, [
      { top: 0, base: 4, f: CLAY, layerId: layer() }, // el 10..6
      { top: 4, base: 6, f: SAND, layerId: mSand }, // el 6..4 (shallow TD at 4)
    ])
    const right = col('R', 10, [
      { top: 0, base: 4, f: CLAY, layerId: rClay }, // el 10..6
      { top: 4, base: 16, f: SAND, layerId: rSand }, // el 6..-6
    ])
    // Bridge L↔R deep SAND base: L el -6 ↔ R el -6 (flat at -6, well below everything).
    // Adjacent tie gap 0: L CLAY base (el 6) ↔ M CLAY base (el 6) — flat at 6, high above.
    // No crossing: 6 (tie) is above -6 (bridge) at BOTH ends.
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' }, // deep flat bridge
      { a: lClay, b: mSand, aSide: 'base', bSide: 'top' }, // adjacent tie, high & flat (el 6)
    ]
    const alongM = [0, 20, 40]
    const { conflicts } = computeSectionFillV2WithConflicts([left, mid, right], edges, undefined, alongM)

    expect(conflicts.length).toBe(0)
  })
})
