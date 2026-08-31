/**
 * partitionFillV2.terminationPlan.test.ts — the PLAN-LAYER gate (session 41, ruling 8p —
 * "only litho's ties no ties and filling between lines, no extrapolating downward, upward
 * leftward or rightward follow the lines"; design partition-engine-v2.md §8 8p / 8l / 8b-rev /
 * 8k / 8i(e)).
 *
 * These cases encode the PLAN INVARIANTS in the owner's own vocabulary — they check the plan
 * declares the right termination, NOT the pixels it eventually paints (that is the emission +
 * hole-fill gates). The plan is the single provenance-carrying authority the whole downstream
 * consumes; if a plan is wrong, every fill built on it is wrong.
 *
 * Invariants under test:
 *   1. LITERAL COUNT (8l): kind maps from corr verbatim — 0 → lens, 1 → onlap, 2 → band-member.
 *      "the top clay has a top tie → 1corr; the middle clay has no ties → 0corr; the bottom clay
 *      has a bottom tie → 1corr again" (the 646.74 three-clay column).
 *   2. FOLLOW THE ACTUAL TIE (8p): a corr-1 plan ALWAYS carries a non-null tieRef — "corr=1 with
 *      TieRef=null cannot satisfy follow-the-actual-tie". A sub-TD/bridge onlap resolves the
 *      bridge tie into a real ref, never null.
 *   3. LENS REACH IS 0.45 (8b-rev): the planned apex default is 0.45 for a lens, 0.5 for an onlap
 *      — the plan carries the default; the thickness/collision cap is the emitter's, on collision.
 *   4. GEOMETRY, NEVER LITHO (8i(e)): the geometry context (interior/surface/td/sub-td) is chosen
 *      from unit index + column extent + the facing TD only — a unit entirely below the facing TD
 *      is sub-td regardless of formation.
 *   5. COLUMNS ARE GROUND TRUTH (8k): one plan per picked unit per adjacent gap-side, iterated
 *      column-first — never a gap-frame reinterpretation of the stack.
 *
 * Pure vitest — no engine flag leak, no Date.now / Math.random. The planner reads the classifier
 * (``effectiveCorr``) + the geometry context ONLY; it emits no geometry, samples no facing column,
 * walks no matrix.
 */

import { describe, expect, it } from 'vitest'

import { type ResolvedTie } from './partitionFillV2/emitCurves'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { bridgeGapAnchorKey } from './partitionFillV2/emitSubstrate'
import { buildTerminationPlans, type TerminationPlan } from './partitionFillV2/terminationPlan'
import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from './sectionPartition'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

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

/** A resolved ADJACENT-gap tie between (leftUnitIndex, leftSide) and (rightUnitIndex, rightSide). */
function tie(
  gapIndex: number,
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
  leftUnitIndex: number,
  rightUnitIndex: number,
  leftSide: 'top' | 'base',
  rightSide: 'top' | 'base',
  id: string,
): ResolvedTie {
  return {
    gapIndex,
    left: { x: leftX, y: leftY },
    right: { x: rightX, y: rightY },
    leftSide,
    rightSide,
    leftUnitIndex,
    rightUnitIndex,
    id,
  }
}

/** The plan for (gap, side, unit), or undefined. */
function planFor(
  plans: readonly TerminationPlan[],
  gapIndex: number,
  side: 'left' | 'right',
  unitIndex: number,
): TerminationPlan | undefined {
  return plans.find((p) => p.gapIndex === gapIndex && p.side === side && p.unitIndex === unitIndex)
}

describe('plan layer — literal 2/1/0 → kind (ruling 8l)', () => {
  it('the three-clay column: top tie → onlap, middle no tie → lens, bottom tie → onlap', () => {
    seq = 0
    // The owner's 646.74 example. L is a three-CLAY stack (top/middle/bottom CLAY, each its own
    // unit); R is one big CLAY spanning them. A tie joins L's TOP clay top ↔ R clay top (top-top),
    // and another joins L's BOTTOM clay base ↔ R clay base (base-base). The MIDDLE clay has NO tie.
    // Owner: "top a 1corr litho, the middle a 0 corr litho and the bottom a 1 corr litho again!".
    const t = layer()
    const m = layer()
    const b = layer()
    const r = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 2, f: CLAY, layerId: t, body: 'top' },
        { top: 2, base: 4, f: CLAY, layerId: m, body: 'mid' },
        { top: 4, base: 6, f: CLAY, layerId: b, body: 'bot' },
      ]),
      col('R', 10, [{ top: 0, base: 6, f: CLAY, layerId: r, body: 'r' }]),
    ]
    const edges: CorrelationEdge[] = []
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    // Ties: L top-clay TOP (elev 10) ↔ R TOP (elev 10); L bottom-clay BASE (elev 4) ↔ R BASE (elev 4).
    const ties: ResolvedTie[] = [
      tie(0, 0, 10, 40, 10, 0, 0, 'top', 'top', 'tieTop'),
      tie(0, 0, 4, 40, 4, 2, 0, 'base', 'base', 'tieBot'),
    ]
    const plans = buildTerminationPlans(section, ties, [], new Set())
    // The MIDDLE clay (uindex 1) has no own-contact tie → 0-corr → LENS (owner's "0 corr litho").
    expect(planFor(plans, 0, 'left', 1)?.corr).toBe(0)
    expect(planFor(plans, 0, 'left', 1)?.kind).toBe('lens')
    // The BOTTOM clay (uindex 2) is base-tied → 1-corr → ONLAP (owner's "1 corr litho again").
    expect(planFor(plans, 0, 'left', 2)?.corr).toBe(1)
    expect(planFor(plans, 0, 'left', 2)?.kind).toBe('onlap')
  })
})

describe('plan layer — follow the actual tie (ruling 8p: no corr-1 with null tieRef)', () => {
  it('every corr-1 plan on the real-shaped fixtures carries a non-null tieRef', () => {
    seq = 0
    // A base-tied SILT onlapping a SAND band below: L SAND over SILT; R SAND over SILT, base-tied.
    const lSand = layer()
    const lSilt = layer()
    const rSand = layer()
    const rSilt = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand },
        { top: 3, base: 6, f: SILT, layerId: lSilt },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSand },
        { top: 3, base: 6, f: SILT, layerId: rSilt },
      ]),
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, [], undefined, alongM)
    // A base-base tie on the SILT (elev 4 on both) makes both SILTs a matched pair → the members
    // are corr-2 (band). To get a genuine corr-1 onlap, tie only ONE unit's base to a DIFFERENT
    // facing contact: L SILT base (elev 4) ↔ R SAND base (elev 7) — a mixed tie, L SILT is corr-1.
    const ties: ResolvedTie[] = [tie(0, 0, 4, 40, 7, 1, 0, 'base', 'base', 'tieMix')]
    const plans = buildTerminationPlans(section, ties, [], new Set())
    for (const p of plans) {
      if (p.corr === 1) {
        expect(p.tieRef, `corr-1 plan at gap${p.gapIndex} ${p.side} u${p.unitIndex} must carry a tieRef`).not.toBeNull()
      }
    }
    // And specifically the onlapping SILT resolves a ref.
    const siltPlan = planFor(plans, 0, 'left', 1)
    expect(siltPlan?.corr).toBe(1)
    expect(siltPlan?.tieRef).not.toBeNull()
  })

  it('a sub-TD bridge-anchored corr-1 resolves the BRIDGE tie into a real tieRef (F5)', () => {
    seq = 0
    // A deep unit anchored by a jump-tie bridge reads corr 1 via ``bridgeGapAnchored``. The plan
    // must resolve the bridge tie into a ResolvedTie ref — "corr=1 with TieRef=null cannot satisfy
    // follow-the-actual-tie". L is shallow (one SAND); R is deep (SAND over a deep ZAND) with the
    // deep ZAND anchored by a bridge spanning toward the gap.
    const lSand = layer()
    const rSand = layer()
    const rZand = layer()
    // L is SHALLOW (SAND to depth 3 = elev 7, its TD). R is DEEP: SAND to depth 4 (elev 6), then a
    // deep ZAND [4..12]. R's deep ZAND top (elev 6) sits BELOW L's TD (elev 7) → sub-td.
    const columns: PartitionColumn[] = [
      col('L', 10, [{ top: 0, base: 3, f: SAND, layerId: lSand }]),
      col('R', 10, [
        { top: 0, base: 4, f: SAND, layerId: rSand },
        { top: 4, base: 12, f: 'zand', layerId: rZand },
      ]),
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, [], undefined, alongM)
    // The bridge tie's per-gap geometry: R's deep ZAND top (elev 6) looking LEFT into gap 0 (side
    // 'right'), its far endpoint on L's SAND base (elev 7). A jump tie carrying that anchored top.
    const jumpTies: ResolvedTie[] = [tie(0, 0, 7, 40, 6, 0, 1, 'base', 'top', 'bridge0')]
    const bridgeGapAnchored = new Set<string>([bridgeGapAnchorKey(0, 'right', 1, 'top')])
    const plans = buildTerminationPlans(section, [], jumpTies, bridgeGapAnchored)
    const deep = planFor(plans, 0, 'right', 1)
    expect(deep?.corr, 'a bridge-anchored deep unit reads corr ≥ 1').toBe(1)
    expect(deep?.tieRef, 'a sub-TD/bridge corr-1 must resolve the bridge tie, never null').not.toBeNull()
    expect(deep?.tieRef?.kind).toBe('resolved')
    expect(deep?.geometry, 'a unit entirely below the facing TD is sub-td geometry').toBe('sub-td')
  })

  it('a DERIVED-base sub-TD corr-1 resolves the bridge tie on the unit BELOW (F5 real shape)', () => {
    seq = 0
    // The real CS1 gap22 col23 shape: a deep unit's BASE is bridge-anchored ONLY through the
    // DERIVED-base rule — the jump tie's near endpoint sits on the TOP of the unit BELOW it, and a
    // top-anchor on unit k+1 shares (derives) unit k's BASE contact (effectiveCorr § increment-2).
    // So ``bridgeGapAnchored`` carries ``gap|right|k|base`` but the jump tie's endpoint is on
    // ``(k+1, top)``. The plan MUST resolve the bridge tie via that derivation — else the corr-1
    // plan carries a null tieRef (the measured F5 hole: col23 SILT reads corr 1, tieRef null).
    // L is SHALLOW (SAND to depth 3 = elev 7, its TD). R is DEEP: SAND, then a deep SILT [4..6]
    // (elev 6..4, sub-TD) over a deep ZAND [6..12]. R's deep ZAND is the bridge anchor (its TOP,
    // elev 4, jump-tied); that top ANCHOR derives the SILT's BASE (the shared contact at elev 4).
    const lSand = layer()
    const rSand = layer()
    const rSilt = layer()
    const rZand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [{ top: 0, base: 3, f: SAND, layerId: lSand }]),
      col('R', 10, [
        { top: 0, base: 4, f: SAND, layerId: rSand },
        { top: 4, base: 6, f: SILT, layerId: rSilt },
        { top: 6, base: 12, f: 'zand', layerId: rZand },
      ]),
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, [], undefined, alongM)
    // The jump tie's near endpoint is on R's deep ZAND TOP (uindex 2, elev 4), looking LEFT into
    // gap 0 (side 'right'); far endpoint on L's SAND base (elev 7). A top-anchor on uindex 2.
    const jumpTies: ResolvedTie[] = [tie(0, 0, 7, 40, 4, 0, 2, 'base', 'top', 'bridgeDeriv')]
    // The directional bridge-anchor set: the ZAND top anchors ``gap|right|2|top`` AND derives the
    // SILT's base ``gap|right|1|base`` (a top-anchor on unit k registers base of unit k-1).
    const bridgeGapAnchored = new Set<string>([
      bridgeGapAnchorKey(0, 'right', 2, 'top'),
      bridgeGapAnchorKey(0, 'right', 1, 'base'),
    ])
    const plans = buildTerminationPlans(section, [], jumpTies, bridgeGapAnchored)
    // The SILT (uindex 1) is derived-base corr-1, sub-TD, and MUST resolve the bridge tie.
    const silt = planFor(plans, 0, 'right', 1)
    expect(silt?.corr, 'the derived-base SILT reads corr 1').toBe(1)
    expect(silt?.geometry, 'the deep SILT below the facing TD is sub-td').toBe('sub-td')
    expect(silt?.tieRef, 'a derived-base sub-TD corr-1 must resolve the bridge tie, never null').not.toBeNull()
    expect(silt?.tieRef?.kind).toBe('resolved')
  })
})

describe('plan layer — lens reach is 0.45 (ruling 8b-rev) + apex defaults', () => {
  it('a lens plans apex 0.45; an onlap plans apex 0.5', () => {
    seq = 0
    const lSand = layer()
    const lSilt = layer()
    const rSand = layer()
    const rSilt = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand },
        { top: 3, base: 6, f: SILT, layerId: lSilt },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSand },
        { top: 3, base: 6, f: SILT, layerId: rSilt },
      ]),
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, [], undefined, alongM)
    // Mixed tie → L SILT corr-1 onlap; the un-tied units lens.
    const ties: ResolvedTie[] = [tie(0, 0, 4, 40, 7, 1, 0, 'base', 'base', 'tieMix')]
    const plans = buildTerminationPlans(section, ties, [], new Set())
    for (const p of plans) {
      if (p.kind === 'lens') expect(p.plannedApex, 'a lens plans the 0.45 default').toBeCloseTo(LENS_PINCH_FRACTION, 6)
      if (p.kind === 'onlap') expect(p.plannedApex, 'an onlap plans the 0.5 tip').toBeCloseTo(INTERIOR_PINCH_FRACTION, 6)
    }
  })
})

describe('plan layer — geometry, never litho (ruling 8i(e)) + one plan per unit per gap-side (8k)', () => {
  it('first unit → surface, last unit → td, one plan per picked unit per adjacent gap', () => {
    seq = 0
    const a = layer()
    const b = layer()
    const c = layer()
    const ra = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 2, f: SAND, layerId: a },
        { top: 2, base: 4, f: SILT, layerId: b },
        { top: 4, base: 6, f: CLAY, layerId: c },
      ]),
      col('R', 10, [{ top: 0, base: 6, f: SAND, layerId: ra }]),
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, [], undefined, alongM)
    const plans = buildTerminationPlans(section, [], [], new Set())
    // L (3 units) looks RIGHT into gap 0 (side 'left'): exactly 3 plans, one per picked unit (8k).
    const lPlans = plans.filter((p) => p.gapIndex === 0 && p.side === 'left')
    expect(lPlans.length).toBe(3)
    // First → surface; last → td; middle → interior. Chosen from position, not the SAND/SILT/CLAY
    // litho (SAND first, CLAY last would be identical geometry if all three were SAND).
    expect(planFor(plans, 0, 'left', 0)?.geometry).toBe('surface')
    expect(planFor(plans, 0, 'left', 1)?.geometry).toBe('interior')
    expect(planFor(plans, 0, 'left', 2)?.geometry).toBe('td')
  })
})
