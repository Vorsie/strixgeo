/**
 * partitionFillV2/terminationPlan.ts — THE TERMINATION PLAN (session 41, the plan-layer
 * rebuild; design partition-engine-v2.md §8 ruling 8p "only litho's ties no ties and filling
 * between lines, no extrapolating downward, upward leftward or rightward follow the lines").
 *
 * ONE provenance-carrying PLAN per (gap, side, unit), produced by a SINGLE planner from the
 * classifier (``effectiveCorr``), consumed by EVERYTHING downstream. No subsystem may re-derive
 * termination authority from formation overlap, stack walks, facing samples, face length, or
 * depth special-cases ever again — the plan IS the authority.
 *
 * WHAT THE PLAN CARRIES (per unit-side):
 *   - ``corr`` — the LITERAL 2/1/0 count (ruling 8l), verbatim from ``effectiveCorrForUnit``.
 *   - ``tieRef`` — the EXACT provenance of the tie a corr-1 onlap rides (S33 audit item 6):
 *     the resolved edge + own-contact, or the top-band implicit tie, or (sub-TD/bridge) the
 *     bridge tie resolved into a real ``TieRef`` — never "corr=1 with TieRef=null".
 *   - ``kind`` — ``lens`` (0) / ``onlap`` (1) / ``band-member`` (2), from ``corr``.
 *   - ``geometry`` — the GEOMETRY CONTEXT, from unit index + column extent + the facing TD
 *     ONLY (never a formationId): ``interior`` / ``surface`` (first unit) / ``td`` (last unit) /
 *     ``sub-td`` (entirely below the facing column's TD). This parameterises which FLOOD the
 *     termination carves into, never WHETHER it fires (ruling 8i(e) "everything must lens").
 *   - ``plannedApex`` — the 8b-rev fraction: 0.45 default for a lens, 0.5 for an onlap; the
 *     thickness/collision cap is applied by the EMITTER (a lens shortens only on collision with
 *     line art — ruling 8b-rev), so the plan carries the DEFAULT and the emitter narrows it. One
 *     value drives BOTH the flank line and the fill wedge (no line-vs-fill split — F2's root).
 *
 * WHAT THE PLAN DOES NOT DO. It emits no geometry, samples no facing column, walks no matrix,
 * and reads no face. It is the pure translation of the classifier + geometry context into a
 * declarative record. The EMITTER (``emitTerminationSweep`` / ``drawTermination`` in the S41.b
 * rewire) executes the plan; the 8o hole-fill (S41.d) fills the residue. Building the plan here,
 * consumed by nothing yet, keeps flag-OFF/flag-ON byte-identical this increment.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. Deterministic.
 */

import { effectiveCorrForSide, type EffectiveCorr, type TieRef } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { bridgeGapAnchorKey } from './emitSubstrate'
import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from '../sectionPartition'
import { type ColumnGeom, type SectionInput } from './sectionGeom'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * The GEOMETRY CONTEXT of a termination — which flood covers the vacated space past its apex,
 * chosen SOLELY from unit index + column extent + the facing TD (ruling 8i(e): geometry, never
 * a formationId, decides the shape; the litho decision is the 8o hole-fill's, downstream):
 *
 *   - ``surface`` — a multi-unit column's FIRST unit (its top contact IS the top-band polyline).
 *   - ``td``      — a multi-unit column's LAST unit (its base rides the shallow-TD floor).
 *   - ``sub-td``  — a unit entirely below the FACING column's TD (the deep-to-deep substrate is
 *                   the flood it carves into; the facing carries no matrix at its elevation).
 *   - ``interior``— any other unit (both own neighbours exist), OR a degenerate single-unit column.
 */
export type PlanGeometry = 'interior' | 'surface' | 'td' | 'sub-td'

/** The termination shape a plan names, from the literal 2/1/0 corr (ruling 8l). */
export type PlanKind = 'lens' | 'onlap' | 'band-member'

/**
 * ONE termination plan for one unit into one gap on one side. The provenance-carrying record the
 * whole downstream reads instead of re-deriving authority (ruling 8p).
 */
export interface TerminationPlan {
  /** The gap this plan looks into (left column index). */
  gapIndex: number
  /** Which facing column the unit lives on for this gap. */
  side: 'left' | 'right'
  /** The unit's index on its own column (columns are ground truth, ruling 8k). */
  unitIndex: number
  /** The literal 2/1/0 correlation count of this unit-side (ruling 8l). */
  corr: 0 | 1 | 2
  /** lens (0) / onlap (1) / band-member (2). */
  kind: PlanKind
  /** The geometry context (which flood the termination carves into). */
  geometry: PlanGeometry
  /**
   * The EXACT tie the corr-1 onlap rides (S33 TieRef). For a sub-TD/bridge onlap this is the
   * bridge tie RESOLVED into a real ``TieRef`` (never null at corr 1 — "corr=1 with TieRef=null
   * cannot satisfy follow-the-actual-tie"). Null for a lens (corr 0) or band member (corr 2).
   */
  tieRef: TieRef | null
  /**
   * The DEFAULT apex fraction (ruling 8b-rev): 0.45 for a lens, 0.5 for an onlap. The
   * thickness/collision cap is the EMITTER's job (a lens shortens only on collision with tie/band
   * line art), so the plan carries the un-capped default; the flank line and the fill wedge
   * consume this SAME value (no line-vs-fill split — F2's root).
   */
  plannedApex: number
  /**
   * The unit's own formation — the litho a lens/onlap wedge carries to its apex (ruling 8n "and
   * NOT ONE POINT PAST IT"). The space past the apex is the 8o hole-fill's decision, not carried
   * here; this is only the terminating unit's own identity.
   */
  formationId: string
  /** The unit's own body (the resolver's; never invented — design §3). */
  bodyId: string | null
}

/**
 * Resolve a corr-1 unit-side's tie into an EXACT ``TieRef`` (ruling 8p — "corr=1 with
 * TieRef=null cannot satisfy follow-the-actual-tie"). Three provenance sources, in priority:
 *
 *   1. the ``effectiveCorr`` top/base ``TieRef`` (a resolved edge on the unit's own contact, an
 *      8a shared-contact tie, or the top-band implicit tie) — the classifier already resolved it;
 *   2. a BRIDGE anchor (``bridgeGapAnchored``) — a jump tie anchored on this unit's contact but
 *      NOT an adjacent-column edge, so ``effectiveCorr`` left the ref null. Resolve it into the
 *      underlying jump-tie ``ResolvedTie`` when the section carries one whose near endpoint sits
 *      on this unit's anchored contact (F5: sub-TD corr-1 must follow the resolved bridge tie).
 *
 * Returns the resolved ``TieRef`` or ``null`` when the unit has no corr-1 tie (caller asserts a
 * corr-1 plan always resolves one — the plan invariant).
 */
function resolveCorr1TieRef(
  eff: EffectiveCorr,
  gapIndex: number,
  side: 'left' | 'right',
  unitIndex: number,
  jumpTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
): TieRef | null {
  // (1) The classifier's own ref (resolved edge / 8a shared / top-band). A corr-1 unit is tied on
  // exactly one contact; take that contact's ref (top preferred when both flags happen to be set
  // — an ambiguous derived edge — matching ``drawTermination``'s tie-side default of the base).
  if (eff.baseTied && eff.baseTie) return eff.baseTie
  if (eff.topTied && eff.topTie) return eff.topTie
  // (2) BRIDGE anchor with a null classifier ref (sub-TD / jump tie). Resolve the underlying jump
  // tie whose near endpoint on ``side`` sits on this unit's anchored contact, into a real TieRef.
  const anchoredTop = bridgeGapAnchored.has(bridgeGapAnchorKey(gapIndex, side, unitIndex, 'top'))
  const anchoredBase = bridgeGapAnchored.has(bridgeGapAnchorKey(gapIndex, side, unitIndex, 'base'))
  if (anchoredTop || anchoredBase) {
    const contact: 'top' | 'base' = anchoredBase && !anchoredTop ? 'base' : 'top'
    const jt = findBridgeTie(jumpTies, gapIndex, side, unitIndex, contact)
    if (jt) return { kind: 'resolved', tie: jt, ownContact: contact }
  }
  // Fallback: the classifier flagged a tie but produced no ref (a top-band-only edge case) — carry
  // the implicit top-band ref so the plan is never "corr=1 with null ref".
  if (eff.topTied) return { kind: 'top-band' }
  return null
}

/**
 * The jump tie (``ResolvedTie``) whose NEAR endpoint on ``side`` sits on ``unitIndex``'s
 * ``contact`` in ``gapIndex`` — the bridge tie a sub-TD/bridge onlap follows. Two provenance
 * sources, mirroring ``tieRefForContact`` (``effectiveCorr.ts``):
 *
 *   1. DIRECT — the jump tie's near endpoint sits literally on THIS unit's own ``contact``.
 *   2. DERIVED base (base only) — a jump tie's near TOP endpoint on the unit BELOW (``unitIndex+1``)
 *      SHARES this unit's BASE contact (the ``§4 increment-2`` derivation: a top anchor on unit k+1
 *      registers ``base`` of unit k in ``bridgeGapAnchored``, but the jump-tie endpoint lives on the
 *      neighbour's top, not this unit's base). The real CS1 gap22 col23 SILT is exactly this shape —
 *      its base is derived-anchored by the ZAND-top bridge below it, so a DIRECT match on
 *      ``(unitIndex, 'base')`` finds nothing and the plan carried a null ref (the F5 hole).
 *
 * ``null`` when no jump tie anchors that contact directly or by derivation (the caller falls back
 * to the top-band ref).
 */
function findBridgeTie(
  jumpTies: readonly ResolvedTie[],
  gapIndex: number,
  side: 'left' | 'right',
  unitIndex: number,
  contact: 'top' | 'base',
): ResolvedTie | null {
  const nearUnit = (t: ResolvedTie): number => (side === 'left' ? t.leftUnitIndex : t.rightUnitIndex)
  const nearSide = (t: ResolvedTie): 'top' | 'base' => (side === 'left' ? t.leftSide : t.rightSide)
  // (1) DIRECT: the jump tie's near endpoint sits on this unit's own ``contact``.
  for (const t of jumpTies) {
    if (t.gapIndex !== gapIndex) continue
    if (nearUnit(t) === unitIndex && nearSide(t) === contact) return t
  }
  // (2) DERIVED base: a TOP jump-tie on the unit BELOW (unitIndex+1) shares this unit's BASE.
  if (contact === 'base') {
    for (const t of jumpTies) {
      if (t.gapIndex !== gapIndex) continue
      if (nearUnit(t) === unitIndex + 1 && nearSide(t) === 'top') return t
    }
  }
  return null
}

/**
 * The GEOMETRY CONTEXT for a unit-side (ruling 8i(e): geometry, never a formationId). Sub-TD wins
 * (a unit entirely below the FACING TD carves into the deep-to-deep substrate, not the surface/TD
 * boundary polylines); otherwise first→surface, last→td, else interior. A single-unit column has
 * no boundary polyline, so it is interior.
 */
function planGeometry(
  unitIndex: number,
  nUnits: number,
  unitTopElev: number,
  facingTD: number,
): PlanGeometry {
  if (unitTopElev <= facingTD - ELEV_EPS) return 'sub-td'
  const isFirst = unitIndex === 0
  const isLast = unitIndex + 1 >= nUnits
  if (isFirst && !isLast) return 'surface'
  if (isLast && !isFirst) return 'td'
  return 'interior'
}

/**
 * Build the termination plans for ONE side of ONE gap. ``col`` is the near column whose units
 * terminate toward ``facing``; ``side`` names which facing column ``col`` is for this gap. Reads
 * the classifier (``effectiveCorrForSide``, bridge-fed) and the geometry context ONLY — no
 * facing sample, no matrix walk (ruling 8p).
 */
function planSide(
  gapIndex: number,
  side: 'left' | 'right',
  col: ColumnGeom,
  facing: ColumnGeom,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  jumpTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
): TerminationPlan[] {
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies, bridgeGapAnchored)
  let facingTD = Infinity
  for (const fu of facing.units) if (fu.baseElev < facingTD) facingTD = fu.baseElev
  const nUnits = col.units.length
  const out: TerminationPlan[] = []
  for (let ui = 0; ui < nUnits; ui++) {
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const, topTie: null, baseTie: null }
    const u = col.units[ui]
    const kind: PlanKind = eff.corr === 2 ? 'band-member' : eff.corr === 1 ? 'onlap' : 'lens'
    const geometry = planGeometry(ui, nUnits, u.topElev, facingTD)
    const tieRef =
      eff.corr === 1
        ? resolveCorr1TieRef(eff, gapIndex, side, ui, jumpTies, bridgeGapAnchored)
        : null
    const plannedApex = eff.corr === 1 ? INTERIOR_PINCH_FRACTION : LENS_PINCH_FRACTION
    out.push({
      gapIndex,
      side,
      unitIndex: ui,
      corr: eff.corr,
      kind,
      geometry,
      tieRef,
      plannedApex,
      formationId: u.formationId,
      bodyId: u.bodyId,
    })
  }
  return out
}

/**
 * THE PLANNER (ruling 8p). Produce one ``TerminationPlan`` per (gap, side, unit) for the whole
 * section — the single provenance-carrying authority the emission + hole-fill consume. Iterates
 * COLUMN-first (ruling 8k) so the plans mirror the sweep's own iteration frame; the gap is only
 * a look-direction. Every plan's authority is the classifier + geometry context — nothing else.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning — the adjacent-column edges (drive corr + the
 *     onlap TieRef).
 * jumpTies : readonly ResolvedTie[]
 *     The non-adjacent (bridge) correlation edges resolved to geometry — the sub-TD/bridge onlap
 *     follows one of these (F5: "corr=1 with TieRef=null cannot satisfy follow-the-actual-tie").
 * bridgeGapAnchored : ReadonlySet<string>
 *     Directional bridge-anchor set (``gapIndex|side|ui|contact``) — feeds the corr arithmetic so
 *     a bridge-anchored contact reads corr ≥ 1, and drives the sub-TD TieRef resolution.
 *
 * Returns
 * -------
 * TerminationPlan[]
 *     One plan per (gap, side, unit), column-first iteration order (deterministic).
 */
export function buildTerminationPlans(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  jumpTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
): TerminationPlan[] {
  const { columns } = section
  if (columns.length < 2) return []
  const out: TerminationPlan[] = []
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    // Look RIGHT into gap ci (this column is the gap's LEFT column, side 'left').
    if (ci + 1 < columns.length) {
      out.push(
        ...planSide(ci, 'left', col, columns[ci + 1], col, columns[ci + 1], activeTies, jumpTies, bridgeGapAnchored),
      )
    }
    // Look LEFT into gap ci-1 (this column is the gap's RIGHT column, side 'right').
    if (ci - 1 >= 0) {
      out.push(
        ...planSide(ci - 1, 'right', col, columns[ci - 1], columns[ci - 1], col, activeTies, jumpTies, bridgeGapAnchored),
      )
    }
  }
  return out
}
