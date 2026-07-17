/**
 * partitionFillV2/drawTermination.ts — the DRAW half of owner ruling 8i (design
 * partition-engine-v2.md §8, 8i — "the three-function spec", 2026-07-17 night).
 *
 * RULING 8i (verbatim): "Write a function that checks if there are correlation bands left
 * and if there are correlation bands on the right: call a function called leftside that
 * checks the left side — if that has 0 bands classify as lens, if it has 1 classify as
 * onlap, 2 classify as band. Same one for right side. Then write a function that actually
 * draws: 0 correlation bands — easy, draw the lens lines on the left or/and right side. If
 * it has 1 correlation band, FOLLOW that band: if it is the same litho (below for a top
 * tie, above for a bottom tie) do nothing; if it is a different litho make it onlap the tie."
 *
 * THIS MODULE IS THE DRAW HALF. The CLASSIFY half (``leftSide`` / ``rightSide`` in 8i's
 * vocabulary) is ``effectiveCorrForSide`` (``effectiveCorr.ts``) — the SINGLE source of the
 * 2/1/0 per-unit-per-gap-per-side band count, already shared with the conformance gate. The
 * sweep (``emitTerminationSweep.ts``) iterates every gap/side/unit, calls the classify half,
 * and dispatches to ``drawTermination`` here.
 *
 * ``drawTermination`` implements 8i's draw rules LITERALLY, replacing every remaining
 * run-existence / band-existence heuristic in the old sweep:
 *   - corr === 0 → LENS ALWAYS. The ONLY suppressions are PHYSICAL: ``fitLensReach`` /
 *     ``segmentDegenerate`` (sub-snap collapse) — geometry, never policy. (The
 *     minority-vs-dominant fill gate stays in the sweep: a boundary/dominant matrix unit
 *     FLOODS rather than lenses — owner 8f. That gate decides WHO holds the void, not
 *     whether a genuine minority terminates.)
 *   - corr === 1 → ONLAP ALWAYS (owner ruling 8j "MERGE AFTER FILL", 2026-07-17, supersedes 8i's
 *     "follow the tie → same litho → do nothing"). NO termination is suppressed by a predicted
 *     merge: a corr-1 side ALWAYS onlaps its tie regardless of the facing litho. The onlap is ONE
 *     extra line (ruling 8i(d)) — the closing flank from the free contact to the apex on the tie;
 *     the tie itself is existing line art bounding the other side. Same-litho regions that TOUCH
 *     after the fill merge into one body as a POST-FILL step (``mergeTouchingBodies`` in
 *     ``computeSectionFillV2``) — the 8e/8g(b) rulings survive as the MERGE criteria, not emission
 *     guards. This DELETES the ``mergesSameFormationBand`` pre-emption.
 *   - corr === 2 → nothing (the band contour is given line art from ``emitBands``).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { type GapBand } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { lensReachFraction } from './lensReach'
import { type LensLabel } from './emitLenses'
import { emitFloodWedge } from './emitFloodWedge'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * The tied contact side of a corr-1 unit. A corr-1 unit has exactly one effective tie; when both
 * / neither flag is set (a derived-band edge case) default to the base (the common
 * onlap-riding-the-band-below case).
 */
export function tiedContactSide(topTied: boolean, baseTied: boolean): 'top' | 'base' {
  return baseTied && !topTied ? 'base' : topTied && !baseTied ? 'top' : 'base'
}

/**
 * The tie's FACING endpoint elevation for the tie that anchors this unit's tied contact — the
 * tie-line geometry the onlap apex rides. Searches ``activeTies`` for the tie in this gap whose
 * endpoint on ``side`` matches ``tiedElev``. When none matches (a DERIVED tie whose curve lives
 * on a neighbouring unit, or a top-band implicit tie), falls back to the facing unit spanning the
 * elevation.
 */
export function tieFacingElevAt(
  gapIndex: number,
  side: 'left' | 'right',
  tiedElev: number,
  activeTies: readonly ResolvedTie[],
  facing: ColumnGeom,
): number {
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const nearPt = side === 'left' ? t.left : t.right
    const farPt = side === 'left' ? t.right : t.left
    // Match on the shared-contact ELEVATION, not the tie's labelled side: a DERIVED base-tie
    // (from the unit below carrying a top-tie) shares this contact via that neighbour, whose tie
    // endpoint sits at the SAME elevation. The first match at that elevation is the shared anchor.
    if (Math.abs(nearPt.y - tiedElev) > ELEV_EPS + 1e-3) continue
    return farPt.y
  }
  return facingElevAt(facing, tiedElev)
}

/**
 * Draw ONE unit's termination into ONE gap on ONE side, per ruling 8i's draw half. Returns
 * ``true`` when a termination (lens or onlap) was emitted, ``false`` when the unit legitimately
 * takes NO termination (a 1-corr same-litho merge, a corr-2 band member, or a physically
 * degenerate lens). Never leaves a unit absent by policy — only by the ruled merge or physics.
 *
 * Parameters
 * ----------
 * u : UnitGeom
 *     The unit terminating into the gap.
 * corr : 0 | 1 | 2
 *     The effective 2/1/0 band count on this side (from ``effectiveCorrForSide`` — the
 *     classify half, 8i's ``leftSide``/``rightSide``).
 * topTied, baseTied : boolean
 *     The unit's EFFECTIVE tie flags (direct + derived-base + ruling-8a derived band) — drive the
 *     merge decision.
 * directTop, directBase : boolean
 *     The unit's DIRECT + derived-base tie flags (``tiedFlags``, WITHOUT the ruling-8a derived
 *     band) — drive the onlap SIDE (which contact the tip rides / which way the flood floods) so a
 *     lone-stack unit floods away from its neighbour.
 * side : 'left' | 'right'
 *     Which facing column the unit lives on for this gap.
 * colX, facingX : number
 *     The unit's column x and the facing column x (metres — REAL alongM).
 * gapIndex : number
 *     The gap index (for the tie lookup).
 * facing : ColumnGeom
 *     The facing column (its enclosing formation floods the vacated wedge; its matched-side
 *     litho drives the tie-follow).
 * activeTies : readonly ResolvedTie[]
 *     The gap's active ties (for the tie's facing endpoint).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — every emitted closing carries the unit's own litho.
 * nextId, nextFloodId : () => string
 *     Curve-id allocators (``term`` / ``floodsw``).
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function drawTermination(
  u: UnitGeom,
  corr: 0 | 1 | 2,
  topTied: boolean,
  baseTied: boolean,
  directTop: boolean,
  directBase: boolean,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  gapIndex: number,
  facing: ColumnGeom,
  bands: readonly GapBand[],
  activeTies: readonly ResolvedTie[],
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): boolean {
  // Ruling 8j: the merge is POST-FILL, so ``bands`` no longer drives a pre-emptive same-formation
  // merge here (the deleted ``mergesSameFormationBand``). ``topTied``/``baseTied`` (effective flags)
  // still drive the onlap's TIED-side selection below (ruling 8i(d) one-line onlap).
  void bands
  if (corr === 2) return false // band member / first-unit band — given line art (bandc)
  const iu: IntervalUnit = { unit: u, topElev: u.topElev, baseElev: u.baseElev }
  if (corr === 0) {
    // RULING 8i: 0 correlations → draw the lens lines ALWAYS. No merge exemption; the only
    // suppressions are PHYSICAL (degenerate / sub-snap), applied inside ``emitLensClosing``.
    return emitLens(iu, colX, facingX, facing, u, lensLabels, nextId, nextFloodId, out)
  }
  // corr === 1: RULING 8j "MERGE AFTER FILL" (owner, 2026-07-17 — "you merge after everything is
  // fucking filled!"). Supersedes 8i's pre-emptive "same litho → do nothing". NO termination is
  // suppressed by a predicted merge: a corr-1 side ALWAYS ONLAPS its tie regardless of the facing
  // litho. Same-litho regions that TOUCH after the fill merge into one body as a POST-FILL step
  // (``mergeTouchingBodies`` in ``computeSectionFillV2``), so a sub-piece of a carved unit lenses
  // in the carve's shadow and reconnects to its encompassing body around the tips automatically.
  // The ``mergesSameFormationBand`` pre-emption is DELETED (the +197/+457/+666-hole risk is on the
  // gated-off N-wedge/carve paths, NOT this sweep+enclosingFlood construction — the onlap is a
  // detour the flood closes around, exactly like the unconditional 0-corr lens above).
  //
  // ONLAP SIDE — which contact is the TIED one (bounded by given line art) vs the FREE one (the
  // single ``oflank`` closing flank rides the FREE contact to the apex). Under ruling 8i(d) the
  // one-line onlap is safe ONLY when the tied side is genuinely bounded by a tie/band contour —
  // so the tied side MUST be the EFFECTIVE tied contact (direct edge OR ruling-8a DERIVED BAND),
  // not the geometric direct-flag default. A derived-band-tied unit (SILT top-tied by the enclosing
  // KLEI band's base contour — coherentLoneStack) has its top bounded by that ``bandc`` contour;
  // picking BASE (the old direct default) would draw the free flank on the top and leave the truly
  // free BASE unbounded → the onlap floods full-width (the measured coherentLoneStack regression).
  // When BOTH / NEITHER effective flag is set (an ambiguous derived edge) fall back to the direct
  // default (BASE), which the flood then floods away from correctly.
  const eff = { top: topTied, base: baseTied }
  const tieSide =
    eff.base && !eff.top ? 'base' : eff.top && !eff.base ? 'top' : tiedContactSide(directTop, directBase)
  const baseIsTied = tieSide === 'base'
  const tiedElev = baseIsTied ? u.baseElev : u.topElev
  const facingTiedElev = tieFacingElevAt(gapIndex, side, tiedElev, activeTies, facing)
  // DIFFERENT litho / no same-formation band → onlap the tie (tip 0.5 riding the tie, never absent).
  return emitOnlap(iu, baseIsTied, facingTiedElev, tiedElev, colX, facingX, facing, u, lensLabels, nextId, nextFloodId, out)
}

/**
 * Emit a 0-corr LENS: the ``emitLensClosing`` pair (top→apex→base) at the unit's own
 * mid-elevation, apex 8b-capped + degenerate-guarded. Own-litho label so the traced hole
 * reads the unit. The FACING enclosing formation floods the vacated wedge PAST the apex
 * (``emitFloodWedge``) so the space between the apex and the facing column traces hole-free.
 * Returns ``true`` when the lens (and its flood wedge) were emitted, ``false`` on a physical
 * degenerate no-op.
 */
function emitLens(
  iu: IntervalUnit,
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): boolean {
  // The 8b-capped apex fraction — the SAME value ``emitLensClosing`` uses internally, so the
  // flood wedge shares the exact apex point the lens closing emits (no seam gap between them).
  const apexFrac = Math.min(INTERIOR_PINCH_FRACTION, lensReachFraction(u.topElev - u.baseElev, facingX - colX))
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = (u.topElev + u.baseElev) / 2
  const before = out.length
  emitLensClosing(iu, colX, facingX, INTERIOR_PINCH_FRACTION, nextId, out)
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const emitted = out.length > before // ``emitLensClosing`` may no-op (degenerate) — skip the wedge too
  for (let ci = before; ci < out.length; ci++) lensLabels.set(out[ci].id, label)
  if (!emitted) return false
  // 0-corr LENS: both sides enclosing → both flood wedges (skipSide null). The flood rides the
  // sloping bracket contour (Front 2) when the facing enclosing dips across the wedge.
  emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, null, nextFloodId, lensLabels, out)
  return true
}

/**
 * Emit a 1-corr ONLAP: **ONE extra line** (owner ruling 8i(d), 2026-07-17 — "an onlap on the
 * left just needs one extra line — the correlation band is already there"). The pinch tapers
 * from the unit's own free (UNTIED) contact to a tip at ``INTERIOR_PINCH_FRACTION`` (0.5) on the
 * tied contact's interpolated line. The engine draws ONLY that one closing flank; the OTHER side
 * of the region is bounded BY CONSTRUCTION by the existing tie line art — the tie curve runs
 * col→facing at the tied elevation, and after the arrangement splits it at the apex vertex, its
 * col→apex sub-segment (a ``tie``-prefixed curve → ``labelFaces`` nTie) bounds the onlap face's
 * tied side. A SECOND flank riding the tie would DUPLICATE that given line art (the recorded
 * source of the onlap-rendered-as-lens confusion, §20) and is FORBIDDEN.
 *
 * The single closing flank carries an ``oflank``-prefixed id: ``labelFaces`` has NO branch for
 * it (labelling-neutral — identical to the pre-8i(d) untied ``term`` flank it replaces, which was
 * also invisible to ``labelFaces``), and the walkthrough diag's ``phaseOf`` maps ``oflank`` to
 * PHASE 2 (an onlap flank), curing the §20 mislabel where the untied ``term`` flank rendered as a
 * phase-1 lens. The unit's own column vertical + the tie sub-segment + this one flank close the
 * loop. The enclosing flood fills the vacated width past the tip. Returns ``true`` when emitted,
 * ``false`` on a physical degenerate no-op.
 */
function emitOnlap(
  iu: IntervalUnit,
  baseTied: boolean,
  facingTiedElev: number,
  tiedElev: number,
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): boolean {
  void iu
  const apexFrac = INTERIOR_PINCH_FRACTION
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = tiedElev + apexFrac * (facingTiedElev - tiedElev)
  const apex: Point = { x: apexX, y: apexElev }
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  // The ONE closing flank (ruling 8i(d)): from the unit's FREE contact to the apex on the tie.
  // ``oflank`` prefix = labelFaces-ignored (labelling-neutral vs the removed untied ``term`` flank,
  // which was ALSO label-carrying + labelFaces-invisible) + phaseOf → phase 2. Carries the unit's
  // own litho label (parity with the pre-8i(d) untied flank) so the onlap triangle reads it where
  // the column vertical is out-weighted; on the arrangement's normal path the column vertical wins.
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const pushOflank = (points: Point[]): void => {
    const id = `oflank${nextId()}`
    lensLabels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  // Degenerate guard: a sub-snap onlap (apex on the column) drops the flank (the enclosing flood
  // covers the slot — the ``emitLensClosing`` no-op parity). Guarding BOTH sub-segments keeps the
  // no-op condition byte-identical to the pre-8i(d) two-flank guard (no fill/hole perturbation).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return false
  if (baseTied) {
    // Base rides the tied band below (given line art) — draw ONLY the free TOP flank to the apex.
    pushOflank([topPt, apex])
  } else {
    // Top rides the tied band above (given line art) — draw ONLY the free BASE flank to the apex.
    pushOflank([apex, basePt])
  }
  // FLOOD the vacated width past the onlap tip with the facing enclosing formation. The TIED
  // side is closed by its own tie line, so its wedge is SKIPPED — for a base-tied onlap the
  // UNTIED side is the TOP (skip 'base'); for a top-tied onlap the untied side is the BASE
  // (skip 'top'). The wedge anchors on the tie/apex, NOT on the removed flank, so removing the
  // duplicate tied flank leaves the flood geometry unchanged. Rides the sloping bracket (Front 2).
  const skip: 'top' | 'base' = baseTied ? 'base' : 'top'
  emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, skip, nextFloodId, lensLabels, out, facingX)
  return true
}

/** Facing-column elevation of the unit spanning ``e`` (nearest fallback) — the tie anchor. */
function facingElevAt(facing: ColumnGeom, e: number): number {
  let best = e
  let bestDist = Infinity
  for (const fu of facing.units) {
    if (fu.topElev >= e - ELEV_EPS && e >= fu.baseElev - ELEV_EPS) return e
    const dist = e > fu.topElev ? e - fu.topElev : fu.baseElev - e
    if (dist < bestDist) {
      bestDist = dist
      best = e > fu.topElev ? fu.topElev : fu.baseElev
    }
  }
  return best
}

/** Whether both endpoints snap to the same 1 mm grid cell (inline to avoid a snap cycle). */
function segmentDeg(a: Point, b: Point): boolean {
  const SNAP = 0.001
  return (
    Math.round(a.x / SNAP) === Math.round(b.x / SNAP) && Math.round(a.y / SNAP) === Math.round(b.y / SNAP)
  )
}
