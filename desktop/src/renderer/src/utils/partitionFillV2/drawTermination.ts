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
 * RULING 8m (owner, 2026-07-17, design §8 8m — "restore it, just add a lithology check before
 * drawing"): the 8i same-litho onlap suppression is RESTORED in its correct FOLLOW-THE-TIE form.
 * Before drawing a corr-1 onlap flank, FOLLOW the actual tie to the MATCHED facing contact
 * (below-for-top-tie / above-for-bottom-tie), compare litho — SAME → skip the flank (the tie is
 * the boundary, the enclosing flood flows through, the 8j merge welds one body; the flank would be
 * an interior seam of the identical final body); DIFFERENT → draw the onlap. Supersedes 8j's blanket
 * "a corr-1 side ALWAYS onlaps": both forms produce IDENTICAL final bodies (merge-equivalence), so
 * restoring the literal check trades redundant interior seams + merge work for one rule-derived
 * litho comparison. Scope: corr-1 onlaps ONLY; lenses stay untouchable (8i(e)); different-litho
 * onlaps always draw. See ``matchedFacingSameLitho`` below.
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
 *   - corr === 1 → FOLLOW THE TIE (owner ruling 8m, 2026-07-17, RESTORING 8i's same-litho
 *     suppression in its correct follow-the-tie form; supersedes the interim 8j blanket
 *     "a corr-1 side ALWAYS onlaps"). FOLLOW the unit's tie to the MATCHED facing contact
 *     (below-for-top-tie / above-for-bottom-tie) and compare litho: SAME → SKIP the flank (the
 *     tie is the boundary, the enclosing flood flows through, and the 8j POST-FILL merge
 *     [``mergeTouchingBodies`` in ``computeSectionFillV2``] welds the two same-litho regions into
 *     ONE body — the flank would only be an interior seam of that identical final body, so both
 *     forms produce merge-equivalent output); DIFFERENT → ONLAP. The onlap is ONE extra line
 *     (ruling 8i(d)) — the closing flank from the free contact to the apex on the tie; the tie
 *     itself is existing line art bounding the other side. The 8e/8g(b) rulings survive both as
 *     the follow-the-tie SKIP criterion (same litho on the matched facing side) and as the
 *     post-fill MERGE criteria. See ``matchedFacingSameLitho``.
 *   - corr === 2 → nothing (the band contour is given line art from ``emitBands``).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { type GapBand } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { facingMatrixLabel } from './facingMatrix'
import { lensReachFraction } from './lensReach'
import { type LensLabel } from './emitLenses'
import { emitFloodWedge } from './emitFloodWedge'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Elevation offset (metres) used to sample the facing unit on the MATCHED side of a tie — just
 * BELOW the tie for a top tie, just ABOVE for a base tie (ruling 8m: below-for-top / above-for-
 * bottom). Small enough to land inside a real facing unit, well above the 1 mm snap grid.
 */
const MATCH_OFFSET = 1e-3

/**
 * Ruling 8m (owner, 2026-07-17): before drawing a corr-1 onlap flank, FOLLOW the actual tie to
 * the MATCHED facing contact (below-for-top-tie / above-for-bottom-tie) and compare litho. SAME
 * litho → the tie is the boundary, the fill flows through, and the 8j post-fill merge welds the
 * two same-litho regions into ONE body — the flank would only be an interior seam of that
 * identical final body, so it is SKIPPED. DIFFERENT litho → the unit genuinely onlaps its tie
 * (the flank is drawn). Scope: corr-1 onlaps ONLY (lenses stay untouchable, 8i(e)).
 *
 * The matched facing unit is the one on the SAME side of the tie line as OUR unit: a TOP-tied unit
 * sits BELOW its top contact → the matched facing unit is BELOW the facing tie contact; a
 * BASE-tied unit sits ABOVE its base contact → the matched facing unit is ABOVE it. We sample the
 * facing column a hair off the tie elevation on that side (``facingMatrixLabel``, the proven facing
 * sampler with its nearest-unit fallback at a TD/surface boundary) and compare formation ids.
 *
 * Returns ``true`` when the matched facing unit is the SAME formation as ``ownFormationId`` (→ skip
 * the flank, merge-equivalent), ``false`` otherwise (→ draw the onlap).
 *
 * Parameters
 * ----------
 * ownFormationId : string
 *     The terminating unit's own formation.
 * tieSide : 'top' | 'base'
 *     Which of the unit's own contacts carries the tie being followed.
 * tiedElev : number
 *     The unit's tied contact elevation (mTAW) — the near endpoint of the tie.
 * gapIndex : number
 *     The gap index (for the tie lookup).
 * side : 'left' | 'right'
 *     Which facing column the unit lives on for this gap.
 * activeTies : readonly ResolvedTie[]
 *     The gap's active ties (to locate the facing tie endpoint elevation).
 * facing : ColumnGeom
 *     The facing column whose matched-side litho is compared.
 */
export function matchedFacingSameLitho(
  ownFormationId: string,
  tieSide: 'top' | 'base',
  tiedElev: number,
  gapIndex: number,
  side: 'left' | 'right',
  activeTies: readonly ResolvedTie[],
  facing: ColumnGeom,
): boolean {
  const facingTiedElev = tieFacingElevAt(gapIndex, side, tiedElev, activeTies, facing)
  // Sample the facing unit on OUR side of the tie: below for a top tie, above for a base tie.
  const sampleElev = tieSide === 'top' ? facingTiedElev - MATCH_OFFSET : facingTiedElev + MATCH_OFFSET
  const matched = facingMatrixLabel(facing, sampleElev)
  return matched != null && matched.formationId === ownFormationId
}

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
 * ui : number
 *     The unit's index on its column (for the ``collectGapBands`` matched-pair membership test
 *     that suppresses an emergent-band member's flood wedge — ruling 8l).
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
  ui: number,
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
  if (corr === 2) return false // band member / first-unit band — given line art (bandc)
  const iu: IntervalUnit = { unit: u, topElev: u.topElev, baseElev: u.baseElev }
  if (corr === 0) {
    // RULING 8i: 0 correlations → draw the lens lines ALWAYS. No merge exemption; the only
    // suppressions are PHYSICAL (degenerate / sub-snap), applied inside ``emitLensClosing``.
    return emitLens(iu, colX, facingX, facing, u, lensLabels, nextId, nextFloodId, out)
  }
  // corr === 1: RULING 8m (owner, 2026-07-17 — "restore it, just add a lithology check before
  // drawing"). The same-litho onlap suppression is RESTORED in follow-the-tie form (below),
  // superseding 8j's blanket "a corr-1 side ALWAYS onlaps". We FOLLOW the unit's tie to the matched
  // facing contact and compare litho: SAME → skip (the tie bounds the space, the enclosing flood
  // flows, the 8j merge welds ONE body — the flank would be an interior seam of that identical
  // body); DIFFERENT → onlap. A different-litho onlap is a detour the flood closes around, exactly
  // like the unconditional 0-corr lens above (no +197/+457/+666-hole risk — that was on the
  // gated-off N-wedge/carve paths, not this sweep+enclosingFlood construction). The 8j POST-FILL
  // merge (``mergeTouchingBodies``) still runs and is what makes the skip merge-equivalent.
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
  // Ruling 8l: ``bands``/``ui`` are no longer read here — the EMERGENT-band suppression (a
  // matched-pair member is filled full-width by ``emitEnclosingFlood``'s bandFid face, so it takes
  // no sweep termination) lives in ``emitTerminationSweep`` BEFORE this call (like the corr-2
  // ``continue``), keeping the arithmetic literal-count everywhere else. A unit that reaches here is
  // a genuine lone/derived onlap into a DIFFERENT-formation facing → it needs its flank + wedge.
  void bands
  void ui
  const eff = { top: topTied, base: baseTied }
  const tieSide: 'top' | 'base' =
    eff.base && !eff.top ? 'base' : eff.top && !eff.base ? 'top' : tiedContactSide(directTop, directBase)
  const baseIsTied = tieSide === 'base'
  const tiedElev = baseIsTied ? u.baseElev : u.topElev
  // RULING 8m (owner, 2026-07-17): FOLLOW the tie to the matched facing contact (below-for-top /
  // above-for-bottom) and compare litho. SAME litho → SKIP the flank (the tie is the boundary, the
  // enclosing flood flows through, the 8j merge welds the two same-litho regions into ONE body — the
  // flank would only be an interior seam of that identical final body). This is an INTENTIONAL
  // absence, not a missing termination: the space is bound by the tie + fill + merge, not left open.
  if (matchedFacingSameLitho(u.formationId, tieSide, tiedElev, gapIndex, side, activeTies, facing)) return false
  const facingTiedElev = tieFacingElevAt(gapIndex, side, tiedElev, activeTies, facing)
  // DIFFERENT litho → onlap the tie (tip 0.5 riding the tie, never absent).
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
