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

import { INTERIOR_PINCH_FRACTION, type LensApexOverride } from '../sectionPartition'
import { terminationApexOverride } from './apexOverride'
import { type Corr0Diamond, detourBandContourAroundLenses } from './detourBandContour'
import { type ResolvedTie } from './emitCurves'
import { type TieRef } from './effectiveCorr'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { emitOverriddenLensClosing, sweepLensOverrideApex } from './emitLensOverride'
import { facingMatrixLabel } from './facingMatrix'
import { isForcedOnlap } from './forceOnlapUnits'
import { detourFlankAroundEnclosedLenses } from './detourEnclosedLens'
import { interiorLensReachToTies } from './lensReach'
import { type LensLabel } from './emitLenses'
import { emitFloodWedge } from './emitFloodWedge'
import { lensEnclosingMatrix } from './lensEnclosure'
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
 * The FACING endpoint elevation of a resolved tie for the look ``side`` (audit item 6 — TieRef).
 * The near endpoint is on OUR column (left endpoint for a left look, right for a right look), so
 * the FAR endpoint is the other one: ``side === 'left' ? tie.right.y : tie.left.y``. This is the
 * EXACT geometry of the unit's OWN edge — no elevation guessing.
 */
export function tieRefFarElev(tie: ResolvedTie, side: 'left' | 'right'): number {
  return side === 'left' ? tie.right.y : tie.left.y
}

/**
 * The elevation (y) at the along-section METRE position ``targetX`` along a polyline ordered by x
 * (session 109 — the onlap rides its host tie's BENT segment). Interpolates the segment that spans
 * ``targetX``, so a 3-point ``[left, apex, right]`` bend yields the BENT elevation at that x (NOT the
 * straight endpoint→endpoint chord). Working in absolute metres (not a gap fraction) keeps it look-
 * side-agnostic: the onlap's apex-x is already the real metre position, and the bent tie polyline is
 * in the same metres×elevation space, so left/right orientation of the look never matters. A
 * ``targetX`` at/past an endpoint clamps to that endpoint's y; a degenerate poly → the first point's y.
 *
 * Parameters
 * ----------
 * poly : readonly Point[]
 *     The host tie's bent polyline (≥ 1 point), in metres×elevation.
 * targetX : number
 *     The along-section metre position to sample (the onlap apex's real x).
 */
export function elevAtXAlong(poly: readonly Point[], targetX: number): number {
  if (poly.length === 0) return 0
  if (poly.length === 1) return poly[0].y
  // The polyline may be stored left→right OR right→left depending on the tie's column order; sample
  // by absolute x regardless. Clamp to the min/max x endpoints.
  const first = poly[0]
  const last = poly[poly.length - 1]
  const loX = Math.min(first.x, last.x)
  const hiX = Math.max(first.x, last.x)
  if (targetX <= loX + ELEV_EPS) return first.x <= last.x ? first.y : last.y
  if (targetX >= hiX - ELEV_EPS) return first.x <= last.x ? last.y : first.y
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    if (targetX >= Math.min(a.x, b.x) - ELEV_EPS && targetX <= Math.max(a.x, b.x) + ELEV_EPS) {
      const dx = b.x - a.x
      if (Math.abs(dx) < ELEV_EPS) return a.y
      const t = (targetX - a.x) / dx
      return a.y + t * (b.y - a.y)
    }
  }
  return last.y
}

/**
 * The FACING endpoint's CONTACT SIDE (top / base) of a resolved tie for the look ``side`` (ruling
 * 8m follow-the-tie correctness). The far endpoint is the FACING column's; a LEFT look faces RIGHT,
 * a RIGHT look faces LEFT. The tie's own ``leftSide`` / ``rightSide`` name which of that facing
 * unit's contacts the tie meets — which decides which facing unit CONTINUES the correlation (the
 * matched unit): a facing ``top`` contact → the matched unit is the one BELOW it (whose top is the
 * contact); a facing ``base`` contact → the unit ABOVE it. For a symmetric top↔top / base↔base tie
 * this equals the unit's own tied side, so the historical fixed-side sampling was correct; for a
 * MIXED base↔top (or top↔base) tie — e.g. CS1 col18 u6 KLEI-base ↔ S6 u3 ZAND-top (tie83) — the
 * facing side DIFFERS from the unit's own side, and only this facing side lands the correct matched
 * unit (ZAND below the 7.03 top contact, not the KLEI above it).
 */
export function tieRefFarSide(tie: ResolvedTie, side: 'left' | 'right'): 'top' | 'base' {
  return side === 'left' ? tie.rightSide : tie.leftSide
}

/**
 * Ruling 8m (owner, 2026-07-17): before drawing a corr-1 onlap flank, FOLLOW the unit's ACTUAL tie
 * to the MATCHED facing contact (below-for-top-tie / above-for-bottom-tie) and compare litho. SAME
 * litho → the tie is the boundary, the fill flows through, and the 8j post-fill merge welds the
 * two same-litho regions into ONE body — the flank would only be an interior seam of that
 * identical final body, so it is SKIPPED. DIFFERENT litho → the unit genuinely onlaps its tie
 * (the flank is drawn). Scope: corr-1 onlaps ONLY (lenses stay untouchable, 8i(e)).
 *
 * AUDIT ITEM 6 (TieRef): the facing endpoint is now the EXACT far endpoint of the unit's OWN
 * resolved tie (``tieRefFarElev``), NOT the first tie found at the shared near elevation (the old
 * ``tieFacingElevAt`` guess, which followed a DIFFERENT unit's tie when two ties shared a contact
 * elevation — the ``oneCorrActualTie (a)`` bug). The matched facing unit is the one on OUR side of
 * the tie: a TOP-tied unit sits BELOW its top contact → the matched facing unit is BELOW the facing
 * tie contact; a BASE-tied unit sits ABOVE its base contact → ABOVE it. We sample the facing column
 * a hair off the FAR endpoint on that side (``facingMatrixLabel``, the proven facing sampler with
 * its nearest-unit fallback) and compare formation ids.
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
 * facingTiedElev : number
 *     The FAR (facing) endpoint elevation of the unit's OWN tie (from ``tieRefFarElev``).
 * facing : ColumnGeom
 *     The facing column whose matched-side litho is compared.
 */
export function matchedFacingSameLitho(
  ownFormationId: string,
  tieSide: 'top' | 'base',
  facingTiedElev: number,
  facing: ColumnGeom,
): boolean {
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
 *     The unit's index on its column. Vestigial as of S34 (audit item 2): the emergent-band
 *     ``isBandMember`` suppression it fed was deleted from the sweep; kept for call-site parity.
 * corr : 0 | 1 | 2
 *     The effective 2/1/0 band count on this side (from ``effectiveCorrForSide`` — the
 *     classify half, 8i's ``leftSide``/``rightSide``).
 * topTied, baseTied : boolean
 *     The unit's EFFECTIVE tie flags (direct + derived-base + ruling-8a derived band) — drive the
 *     merge decision.
 * topTie, baseTie : TieRef | null
 *     EXACT provenance of the unit's top/base tie (audit item 6). The corr-1 path follows the
 *     TIED side's ``TieRef`` to its resolved tie's far endpoint — the unit's OWN edge, not the
 *     first tie at the shared near elevation (the ``oneCorrActualTie (a)`` wrong-tie bug).
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
 * col : ColumnGeom
 *     The unit's OWN (terminating) column — its picked stack is ground truth (ruling 8k). Used by
 *     the corr-0 LENS path to read the enclosing matrix that wraps the pinch (ruling 8n(b)).
 * facing : ColumnGeom
 *     The facing column (its enclosing formation floods the vacated ONLAP wedge; its matched-side
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
  topTie: TieRef | null,
  baseTie: TieRef | null,
  directTop: boolean,
  directBase: boolean,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  gapIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  diamonds?: Corr0Diamond[],
  overrides?: ReadonlyMap<string, LensApexOverride>,
  detourDiamonds?: readonly Corr0Diamond[],
): boolean {
  if (corr === 2) return false // band member / first-unit band — given line art (bandc)
  const iu: IntervalUnit = { unit: u, topElev: u.topElev, baseElev: u.baseElev }
  if (corr === 0) {
    // RULING 8i: 0 correlations → draw the lens lines ALWAYS. No merge exemption; the only
    // suppressions are PHYSICAL (degenerate / sub-snap), applied inside ``emitLensClosing``.
    // ``diamonds`` (ruling 8s STAGE B) collects the emitted interior-lens diamond so a crossing
    // ``bandc`` band contour can detour around it in ``emitEnclosingFlood``.
    return emitLens(iu, ui, colX, facingX, gapIndex, col, facing, activeTies, u, lensLabels, nextId, nextFloodId, out, diamonds, overrides)
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
  // Ruling 8l (audit item 2, S34): ``ui`` is no longer read here — the emergent-band ``isBandMember``
  // suppression it served is DELETED from the sweep (the ``bands`` param went with it). A matched-pair
  // member is a literal corr-1 side whose flank 8m's ``matchedFacingSameLitho`` suppresses (same
  // formation both facing columns); its band forms from the enclosing flood's full-width ``bandFids``
  // face + the 8j merge, with no extra onlap. A unit that reaches this corr-1 draw is a genuine
  // lone/derived onlap into a DIFFERENT-formation facing → it needs its flank + wedge.
  void ui
  void activeTies
  const eff = { top: topTied, base: baseTied }
  const tieSide: 'top' | 'base' =
    eff.base && !eff.top ? 'base' : eff.top && !eff.base ? 'top' : tiedContactSide(directTop, directBase)
  const baseIsTied = tieSide === 'base'
  const tiedElev = baseIsTied ? u.baseElev : u.topElev
  // AUDIT ITEM 6 (TieRef): the FACING endpoint elevation is the EXACT far endpoint of the unit's
  // OWN resolved tie on the tied side — NOT the first tie found at the shared near elevation (the
  // deleted ``tieFacingElevAt`` guess that followed a DIFFERENT unit's tie, the ``oneCorrActualTie
  // (a)`` bug). A ``top-band`` ref or a missing/bridge-only ref (null) falls back to the facing
  // unit spanning the tied elevation (``facingElevAt`` — the historical fallback for a derived/
  // implicit tie whose curve does not live on this unit's own contact).
  const tiedRef = baseIsTied ? baseTie : topTie
  const facingTiedElev =
    tiedRef?.kind === 'resolved' ? tieRefFarElev(tiedRef.tie, side) : facingElevAt(facing, tiedElev)
  // SESSION 109 — the BENT host polyline of the unit's own tie, when a matched-contact free-draw
  // override bent it (``emitCurves`` attached ``bentPoints`` only when the tie actually bent). The
  // onlap's apex ELEVATION rides THIS bent line at its own fraction (segment-confined ride,
  // ``freedraw-onlap-lens-edit-model.md`` → "Onlap rides along") instead of the straight chord.
  // UNDEFINED on the no-override path → ``emitOnlap`` keeps its byte-identical straight interpolation.
  const bentTiePoints = tiedRef?.kind === 'resolved' ? tiedRef.tie.bentPoints : undefined
  // RULING 8m (owner, 2026-07-17): FOLLOW the tie to the matched facing contact (below-for-top /
  // above-for-bottom) and compare litho. SAME litho → SKIP the flank (the tie is the boundary, the
  // enclosing flood flows through, the 8j merge welds the two same-litho regions into ONE body — the
  // flank would only be an interior seam of that identical final body). This is an INTENTIONAL
  // absence, not a missing termination: the space is bound by the tie + fill + merge, not left open.
  // NOTE (S58 ASK-FIRST): the matched side here is the UNIT's OWN tied side (base tie → sample above),
  // NOT the facing endpoint's contact side. For a MIXED base↔top tie (CS1 col18 u6 KLEI-base ↔ S6
  // ZAND-top, tie83) these diverge — the own-side rule samples the KLEI ABOVE the 7.03 top contact
  // and SUPPRESSES the u6 onlap the S58 premise mandates (facing = ZAND below). Switching to the
  // facing-side rule fixes col18 but INVERTS the followTieOnlap / oneCorrActualTie regression locks
  // (owner-locked own-side semantics on the identical mixed-tie shape). Left UNCHANGED pending the
  // owner ruling — see REWRITE_STATE §64.
  // SAME-LITHO MERGE SKIP (ruling 8m): a corr-1 onlap whose matched facing is the SAME litho is
  // suppressed (the tie bounds the space, the 8j merge welds ONE body — the flank would be an
  // interior seam). This stays UNCONDITIONAL: drawing the flank for a same-litho pair pinches a body
  // that the enclosing flood does not re-cover behind (it is one continuous same-litho band), opening
  // a hole — measured on real CS1 (gap-0 019ea170 dragged to 0.3 → 1.98 m hole). The user's handle on
  // such a tip is a FLOOD-convergence vertex of a continuous band, not a real lateral termination;
  // reshaping it is an APP-suppression concern (S76 un-routable cleanup), NOT a safe engine reshape.
  // SAFE-DEFAULT REPAIR (owner 2026-07-26): the 8m same-litho skip is BYPASSED for a unit the
  // post-pass flagged as flooded — its onlap was "deleted" by 8m but the enclosing flood then
  // painted the DRILLED unit a foreign litho (TS7-g0 clay → silt). Re-emitting the onlap bounds the
  // unit's own face so its litho survives. Only flooded units are forced (the clean same-litho merges
  // never lose data → never flagged → this stays false → byte-identical default). See forceOnlapUnits.
  if (
    matchedFacingSameLitho(u.formationId, tieSide, facingTiedElev, facing) &&
    !isForcedOnlap(u.layerId, gapIndex, side)
  ) {
    return false
  }
  // DIFFERENT litho → onlap the tie (tip 0.5 riding the exact far endpoint, never absent). A
  // free-draw override (``overrides``) moves that tip to the drawn apex; the arrangement re-closes.
  // ``bentTiePoints`` (session 109) rides the onlap apex onto the BENT host tie when a matched-contact
  // bend deformed it; undefined otherwise (straight-chord, byte-identical).
  return emitOnlap(iu, baseIsTied, facingTiedElev, tiedElev, colX, facingX, side, gapIndex, col, facing, activeTies, u, lensLabels, nextId, nextFloodId, out, diamonds, overrides, bentTiePoints, detourDiamonds)
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
  ui: number,
  colX: number,
  facingX: number,
  gapIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  diamonds?: Corr0Diamond[],
  overrides?: ReadonlyMap<string, LensApexOverride>,
): boolean {
  // FREE-DRAW APEX OVERRIDE (owner 2026-07-22, THIRD engine grant — "make every handle reshape"):
  // a persisted per-body node moves the SWEEP's corr-0 lens apex to the drawn (fraction, elevation),
  // exactly the way ``emitLenses``' enclosed-lens path already does. A lens apex takes BOTH the
  // fraction (reach) AND the elevation (a lens is a free 2D shape, unlike an onlap tip whose
  // elevation rides its tie). The moved apex feeds BOTH the lens closing flanks AND the flood wedge
  // (they share it), so the partition re-closes gap/overlap-free by construction. The override is
  // clamped to the strictly-interior envelope (never ON/PAST the far column) and passes UN-capped by
  // the 8b reach cap (design §8 line 795). NO override → the default 8b-capped apex, byte-identical.
  const lensOv = terminationApexOverride(overrides, u.bodyId, gapIndex)
  // RULING 8b-rev (owner, 2026-07-19): the DEFAULT interior-lens reach is 0.45; the ~2× thickness
  // cap applies ONLY on COLLISION with a gap tie ("shorten lenses that collide with a sloping
  // correlation"). ``interiorLensReachToTies`` returns 0.45 when no tie brackets the unit, else
  // the largest reach whose apex stays strictly inside the nearest bracketing ties (fitLensReach:
  // 0.45 → 2× thickness → halve). ONE PLANNED APEX: this single value drives BOTH the lens closing
  // flanks (passed to ``emitLensClosing``, overriding its internal 0.45 default) AND the flood
  // wedge apex-x below (no line-vs-fill split). The flood wedge's OWN tie clamp (``clampConvToTies``
  // in ``emitFloodWedge``) still rides the wrap inside the ties past the apex — clamp (stay inside
  // the lines) is preferred over shorten for the WRAP, shorten for the DIAMOND that would cross.
  const lensMid = (u.topElev + u.baseElev) / 2
  // RULING 8s (owner, 2026-07-19, "0.45 stands, matrix detours"): the facing-sample cap is DELETED.
  // A corr-0 lens whose 0.45 wedge crosses NO correlation line art keeps the full 0.45 even when the
  // facing carries a THIRD lithology — the surrounding litho detours AROUND the wedge (the wedge
  // lines split the surrounding region → fill-between-the-lines makes overlap impossible by
  // construction). The SOLE reach shortener is a gap TIE crossing the diamond (the "sloping
  // correlation" collision), which ``interiorLensReachToTies`` applies. An overlap that survives is a
  // region-construction defect (the enclosing contour must clip the wedge — a later build), never a
  // reason to re-cap. The wrap PAST the apex is still handled by the flood wedge's own tie clamp.
  //
  // RULING 8s STAGE B (owner, 2026-07-19/session 54 mandate, "release the B4-u5 lens crush"): band
  // contours LEAVE the lens reach-collision set. S50 added the gap's matched-pair band contours to
  // the brackets so a corr-0 lens diamond shortened to fit strictly BELOW the descending ZAND
  // band-base contour — but that CRUSHES the lens (B4-u5-SILT at CS1 gap3: the ZAND band-base
  // ``bandc37`` sloping from the SILT's own top corner (0.608) crushed the 0.45 lens to a 0.7 m
  // stub, apex x≈102.3 instead of the 0.45 reach x≈142.2 — and the same class crushed the CS2-g13
  // KLEI interbed via ``bandc139``). Ruling 8s: "0.45 stands, the MATRIX detours" — a corr-0 lens
  // keeps its full 0.45 reach even where a matched-pair band's base contour descends past it; the
  // BAND CONTOUR detours AROUND the lens diamond (``detourBandContourAroundLenses`` in
  // ``emitEnclosingFlood``, generalising S51's ``detourFlankAroundEnclosedLenses`` from onlap
  // flanks to ``bandc`` curves), so the band wraps the lens as a hole and overlap is impossible BY
  // CONSTRUCTION. The SOLE reach shortener is a genuine wedge-vs-DRAWN-tie collision, which
  // ``interiorLensReachToTies`` applies (gap ties only — no band contours).
  const gapTiesForReach = activeTies.filter((t) => t.gapIndex === gapIndex)
  const defaultFrac = Math.min(
    INTERIOR_PINCH_FRACTION,
    interiorLensReachToTies(
      u.topElev - u.baseElev,
      colX,
      facingX,
      lensMid,
      u.topElev,
      u.baseElev,
      gapTiesForReach,
    ),
  )
  // FREE-DRAW OVERRIDE (owner 2026-07-22): a per-body node moves the apex (fraction + elevation),
  // bypassing the 8b cap. ``sweepLensOverrideApex`` resolves the moved apex (and its gap-local
  // fraction); ``emitOverriddenLensClosing`` emits the flanks directly at it (no 8b re-cap). NO
  // override → the default 8b-capped path (``emitLensClosing``), byte-identical.
  const ovApex = sweepLensOverrideApex(overrides, u, gapIndex, colX, facingX)
  const apexFrac = ovApex ? ovApex.fracFromCol : defaultFrac
  const apexX = ovApex ? ovApex.apexX : colX + apexFrac * (facingX - colX)
  const apexElev = ovApex ? ovApex.apexElev : lensMid
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  let emitted: boolean
  if (ovApex) {
    emitted = emitOverriddenLensClosing(iu, colX, { x: apexX, y: apexElev }, label, nextId, out, lensLabels)
  } else {
    const before = out.length
    emitLensClosing(iu, colX, facingX, apexFrac, nextId, out)
    emitted = out.length > before // ``emitLensClosing`` may no-op (degenerate) — skip the wedge too
    for (let ci = before; ci < out.length; ci++) lensLabels.set(out[ci].id, label)
  }
  if (!emitted) return false
  // RULING 8s STAGE B: record the EXACT emitted diamond so ``emitEnclosingFlood`` can detour a
  // crossing ``bandc`` band contour around it (collinear with the flanks just emitted). Only the
  // interior corr-0 lens (this path) can be crossed by a descending band base contour; boundary/
  // sub-TD lenses ride a boundary polyline, never a band contour.
  diamonds?.push({
    gapIndex,
    topPt: { x: colX, y: u.topElev },
    apex: { x: apexX, y: apexElev },
    basePt: { x: colX, y: u.baseElev },
  })
  // 0-corr LENS: both sides enclosing → both flood wedges (skipSide null). RULING 8n(b) (owner,
  // 2026-07-18, x=646.74): the wrap past the apex is the ENCLOSING MATRIX read from the lens's OWN
  // column (``lensEnclosingMatrix`` — the litho that wraps the pinch, walking past sibling
  // minorities), NOT the far facing column at the lens mid-elevation. At col18 the thin SILT/VEEN
  // lenses wrap in KLEI; the old facing sample read col19's ZAND 78 m away → a phantom sand lens.
  // ``null`` = the up/down enclosure walk found no common litho (an ASK-FIRST rule gap) → the flood
  // keeps its s30 facing fallback (non-inventing). The flood still rides the sloping bracket
  // contour (Front 2) when the facing enclosing dips across the wedge.
  const lensMatrix = lensEnclosingMatrix(col, ui)
  // RULING 8n ("stay inside the lines"): the wrap wedge may not descend BELOW / rise ABOVE a
  // given TIE line in the gap that bounds the enclosing matrix. At CS1 gap18 the KLEI wrap of the
  // VEEN lens rode past its base corner toward the gap midpoint, crossing BELOW the ZAND-top tie
  // (col18 KLEI-base 4.23 ↔ col19 ZAND-top 7.027, rising left→right) — the space below that tie is
  // ZAND, so the KLEI wrap and the ZAND fill double-covered the sliver. The gap's ties (given line
  // art) clamp each flank so the wrap stops AT the tie (the tie splits the arrangement there and
  // the ZAND face owns below it). See ``clampFloodFlankToTie`` in emitFloodWedge.
  const gapTies = activeTies.filter((t) => t.gapIndex === gapIndex)
  emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, null, nextFloodId, lensLabels, out, undefined, lensMatrix, gapTies, undefined, col)
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
  side: 'left' | 'right',
  gapIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  diamonds?: Corr0Diamond[],
  overrides?: ReadonlyMap<string, LensApexOverride>,
  bentTiePoints?: readonly Point[],
  detourDiamonds?: readonly Corr0Diamond[],
): boolean {
  void iu
  // FREE-DRAW APEX OVERRIDE (owner 2026-07-21): a persisted per-body node moves the onlap TIP to
  // the drawn (fraction, elevation); the arrangement then re-traces BOTH this onlap face AND its
  // flood wedge around the moved apex (they share it), so the partition stays gap/overlap-free by
  // construction. NO override → the byte-identical default apex (INTERIOR_PINCH_FRACTION on the tie
  // line). ``terminationApexOverride`` clamps the fraction strictly interior so an extreme drag past
  // the far column clips to the envelope, never overlapping. The override fraction is gap-local
  // (0 = left column, 1 = right column); convert to the own-column apex-x the same way ``emitLenses``
  // does — a left look uses ``f`` directly, a right look mirrors it (``1 − f``).
  const ov = terminationApexOverride(overrides, u.bodyId, gapIndex)
  const apexFrac = ov ? (side === 'left' ? ov.fraction : 1 - ov.fraction) : INTERIOR_PINCH_FRACTION
  const apexX = colX + apexFrac * (facingX - colX)
  // The apex elevation ALWAYS rides the TIE line interpolated at the apex fraction — an onlap laps
  // its tie BY DEFINITION (the tied side of the onlap face is bounded by that exact tie line art).
  // A free-draw override moves only the REACH (fraction: how far the tip laps into the gap); the
  // elevation is pinned to the tie so the flank meets the tie at the apex and the face closes
  // cleanly against it. Letting the drawn elevation float OFF the tie would separate the flank from
  // the tie sub-segment that bounds the tied side → a gap/overlap against the facing fill (the
  // "never overlap" envelope). This mirrors the default tip, which also sits on the tie line.
  //
  // SESSION 109 — RIDE THE BENT HOST TIE. When a matched-contact free-draw override BENT the host
  // tie (``bentTiePoints`` populated by ``emitCurves``), the onlap laps a BENT line, not a straight
  // chord: the sand onlap's top contact IS the bent clay-base contact, the SAME polyline, so the
  // onlap's apex must sit ON the bend at its own apex-x (owner 2026-07-24, "it needs to reshape
  // together with the dragged boundary"). Sample the bent polyline at the real ``apexX`` (side-
  // agnostic, absolute metres) so the onlap thickens/thins WITH the bend and never leaves the tie.
  // No override / straight tie → the byte-identical straight ``tiedElev → facingTiedElev`` chord.
  const apexElev = bentTiePoints
    ? elevAtXAlong(bentTiePoints, apexX)
    : tiedElev + apexFrac * (facingTiedElev - tiedElev)
  const apex: Point = { x: apexX, y: apexElev }
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  // The ONE closing flank (ruling 8i(d)): from the unit's FREE contact to the apex on the tie.
  // ``oflank`` prefix = labelFaces-ignored (labelling-neutral vs the removed untied ``term`` flank,
  // which was ALSO label-carrying + labelFaces-invisible) + phaseOf → phase 2. Carries the unit's
  // own litho label (parity with the pre-8i(d) untied flank) so the onlap triangle reads it where
  // the column vertical is out-weighted; on the arrangement's normal path the column vertical wins.
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const pushOflank = (points: readonly Point[]): void => {
    const id = `oflank${nextId()}`
    lensLabels.set(id, label)
    out.push({ id, kind: 'closing', points: [...points] })
  }
  // Degenerate guard: a sub-snap onlap (apex on the column) drops the flank (the enclosing flood
  // covers the slot — the ``emitLensClosing`` no-op parity). Guarding BOTH sub-segments keeps the
  // no-op condition byte-identical to the pre-8i(d) two-flank guard (no fill/hole perturbation).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return false
  // RULING 8g — the ENCLOSING MINORITY's own onlap flank DETOURS around an enclosed lens it would
  // cross (owner-resolved via 8g, S51). ``u`` is the enclosing matrix of one or more enclosed
  // lenses on its OWN column (``extractEnclosedLenses`` merged ``u`` around them). If this onlap
  // flank would slice such a lens's 0.45 diamond, the flank RIDES AROUND the diamond's apex (the
  // lens is line art the matrix flows around — ruling 8g's "a lens is a DETOUR in the enclosing
  // band's contour"), never crossing it. Without the detour the flank's straight segment cuts the
  // lens diamond in two → the lens never traces as its own face and is mis-painted the matrix
  // (convergingStack (a): the KLEI onlap flank slicing the VEEN 0.45 diamond).
  const flankPts = baseTied ? [topPt, apex] : [apex, basePt]
  const enclosedDetour = detourFlankAroundEnclosedLenses(flankPts, u, colX, side, gapIndex, col, facing, activeTies)
  // RULING 8t (owner, 2026-07-20): "Onlap flanks crossing a lens diamond do not shorten the lens
  // either — the flank detours around the diamond (the S51 mechanism)." A SIBLING corr-0 lens (not an
  // enclosed lens of ``u`` — a separate interior minority above/below, e.g. CS1 col18 u5 VEEN sitting
  // on u6 KLEI's top) that this onlap flank would cut through is rerouted crossIn→apex→crossOut around
  // its emitted diamond, RIDING collinear with the lens's own flanks so the lens closes as a hole and
  // the onlap face wraps it — never shortening the lens, never overlapping it. This reuses the SAME
  // ``detourBandContourAroundLenses`` generaliser the band contours use (ruling 8s Stage B), applied
  // to the onlap flank; the ``diamonds`` collection carries the exact emitted corr-0 apexes.
  // RULING 8t, ORDER-INDEPENDENT (owner round 3): detour against the sweep's COMPLETE planned
  // diamond set when the caller supplies one. The live ``diamonds`` collection only holds the
  // lenses emitted BEFORE this onlap, so a lens on a deeper unit of the same column was invisible
  // here and the flank crossed it — see the plan pass in ``emitTerminationSweep``.
  const detourSet = detourDiamonds ?? diamonds
  const detoured = detourSet ? detourBandContourAroundLenses(enclosedDetour, gapIndex, detourSet) : enclosedDetour
  pushOflank(detoured)
  // FLOOD the vacated width past the onlap tip with the facing enclosing formation. The TIED
  // side is closed by its own tie line, so its wedge is SKIPPED — for a base-tied onlap the
  // UNTIED side is the TOP (skip 'base'); for a top-tied onlap the untied side is the BASE
  // (skip 'top'). The wedge anchors on the tie/apex, NOT on the removed flank, so removing the
  // duplicate tied flank leaves the flood geometry unchanged. Rides the sloping bracket (Front 2).
  const skip: 'top' | 'base' = baseTied ? 'base' : 'top'
  // The SILT flood boundary rides the SAME ruling-8g detour as the onlap flank (they are the same
  // undirected segment — matrix on one side, flood on the other), so the enclosed lens closes as a
  // hole in BOTH. A straight flood flank would re-cut the diamond the onlap flank detoured around.
  // The override only kicks in when the flank actually detoured (else it is the plain corner→apex).
  const floodFlankOverride = detoured.length > 2 ? detoured : undefined
  // RULING 8n APPLIED TO THE LABEL (owner, 2026-08-18). The gap's ties are passed so the wedge
  // reads its class INSIDE the tie-bounded channel instead of horizontally across the lines (see
  // ``floodLabelSampleElev``). The wedge GEOMETRY is untouched: ``clampConvToTies`` is gated on
  // ``skipSide === null`` (the LENS wrap), and an onlap always passes a ``skipSide``.
  const gapTies = activeTies.filter((t) => t.gapIndex === gapIndex)
  emitFloodWedge(
    colX,
    facingX,
    facing,
    u.topElev,
    u.baseElev,
    apexX,
    apexElev,
    skip,
    nextFloodId,
    lensLabels,
    out,
    facingX,
    undefined,
    gapTies,
    floodFlankOverride,
    col,
  )
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
