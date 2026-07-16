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
 *   - corr === 1 → FOLLOW THE TIE. ``followTieMatchedFacing`` samples the facing unit on the
 *     MATCHED side of the tie (BELOW the tie's facing endpoint for a TOP tie, ABOVE for a
 *     BASE tie). SAME formation → do nothing (the unit merges into the tied band — the
 *     ``emitRuledBands`` pass closes its same-formation band face). DIFFERENT formation →
 *     emit the ONLAP riding that tie (never absent). This DISSOLVES the old 8e/8g(b)
 *     ``sameFormationEnclosedByTiedBand`` band-existence heuristic (which merged on a run
 *     existing anywhere in the gap, not on the unit's actual tie) and with it the
 *     mismatched-facing ABSENT class.
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
import { sameFormationBaseTiedPair, sameFormationEnclosedByTiedBand } from './terminationRules'
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
 * OWNER RULING 8i "follow the tie" — the FACING UNIT on the matched side of a 1-corr unit's tie.
 * A TOP tie → the facing unit BELOW the tie's facing endpoint (sample just below); a BASE tie →
 * the facing unit ABOVE it (sample just above). Returns the facing unit, or ``null`` when the
 * facing column carries nothing there. Shared by the sweep's merge decision AND
 * ``emitRuledBands``' band-close decision so the two CANNOT drift (a merged unit's band always
 * closes; an onlapped unit's never does — the 11-row ABSENT class dissolves).
 */
export function matchedFacingUnit(
  tieSide: 'top' | 'base',
  facingTiedElev: number,
  facing: ColumnGeom,
): UnitGeom | null {
  // "below for a top tie, above for a bottom tie" — nudge the sample off the exact contact so the
  // lookup picks the unit on the MATCHED side, not the one the contact belongs to. The nudge
  // (1 mm, the snap grid) is well below any real unit thickness.
  const NUDGE = 1e-3
  const sampleElev = tieSide === 'top' ? facingTiedElev - NUDGE : facingTiedElev + NUDGE
  let best: UnitGeom | null = null
  let bestDist = Infinity
  for (const u of facing.units) {
    if (u.topElev >= sampleElev - ELEV_EPS && sampleElev >= u.baseElev - ELEV_EPS) return u
    const dist = sampleElev > u.topElev ? sampleElev - u.topElev : u.baseElev - sampleElev
    if (dist < bestDist) {
      bestDist = dist
      best = u
    }
  }
  return best
}

/**
 * The tie's FACING endpoint elevation for the tie that anchors this unit's tied contact — the
 * tie-line geometry the onlap apex rides and the ``matchedFacingUnit`` sample uses. Searches
 * ``activeTies`` for the tie in this gap whose endpoint on ``side`` matches ``tiedElev``. When
 * none matches (a DERIVED tie whose curve lives on a neighbouring unit, or a top-band implicit
 * tie), falls back to the facing unit spanning the elevation. Exported so ``emitRuledBands``
 * consumes the SAME endpoint the sweep does.
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
 * OWNER RULING 8i "follow the tie" — whether the matched facing unit is the SAME litho as the
 * 1-corr unit (a MERGE — do nothing) or a different one (an ONLAP). Thin wrapper over
 * ``matchedFacingUnit`` so the boolean and the unit come from ONE lookup.
 */
export function followTieMatchedFacing(
  u: UnitGeom,
  tieSide: 'top' | 'base',
  facingTiedElev: number,
  facing: ColumnGeom,
): boolean {
  const matched = matchedFacingUnit(tieSide, facingTiedElev, facing)
  return matched !== null && matched.formationId === u.formationId
}

/**
 * RULING 8i MERGE DECISION — whether a corr-1 unit MERGES into a same-formation band (no
 * termination) rather than ONLAPPING. ONE source of truth shared by the sweep (which suppresses
 * a merged unit's termination) and ``emitRuledBands`` (which closes the merged unit's band
 * face) — they CANNOT drift, so a merged unit is never absent and an onlapped unit never gets a
 * spurious band.
 *
 * The decision combines the session-15 band-existence base (the ruled 8e / 8g(b) same-formation
 * cases that closed hole-free) with ruling 8i's LITERAL tie-follow: a unit merges ONLY IF a
 * same-formation band of its formation exists in the gap (8e) OR it base-ties a same-formation
 * facing run (8g(b)) — AND FOLLOWING ITS TIE lands on the SAME litho on the matched facing side
 * (below-for-top-tie / above-for-bottom-tie). When the band-existence base holds but the tie
 * lands on a DIFFERENT facing litho (the 11-row mismatched-facing class), the unit ONLAPS that
 * tie instead of silently merging-then-being-absorbed (owner 8i: "different litho → onlap").
 *
 * Parameters
 * ----------
 * u : UnitGeom
 *     The corr-1 unit.
 * topTied, baseTied : boolean
 *     Its effective tie flags.
 * gapIndex : number
 * side : 'left' | 'right'
 * facing : ColumnGeom
 * bands : readonly GapBand[]
 *     The gap's matched-pair bands (``collectGapBands``).
 * activeTies : readonly ResolvedTie[]
 *
 * Returns
 * -------
 * boolean
 *     ``true`` → merge (suppress the termination, close a band); ``false`` → onlap the tie.
 */
export function mergesSameFormationBand(
  u: UnitGeom,
  topTied: boolean,
  baseTied: boolean,
  gapIndex: number,
  side: 'left' | 'right',
  facing: ColumnGeom,
  bands: readonly GapBand[],
  activeTies: readonly ResolvedTie[],
): boolean {
  // A BOTH-TIED unit whose own formation carries a matched-pair band is a SPANNING BAND member (8e)
  // — it bands full-width by construction (top tie above + base tie below both in its own
  // formation). MERGE unconditionally: the tie-follow must NOT apply, because a both-tied enclosing
  // matrix samples its facing NEIGHBOUR (a different minority in the enclosed interval) and would
  // wrongly read "mismatched" → onlap → the enclosing floods over itself (the coherentStack(b) /
  // coherentLoneStack KLEI-enclosing regression). Only a ONE-tied unit is a genuine onlap candidate.
  const bothTied = topTied && baseTied
  if (bothTied && sameFormationEnclosedByTiedBand(bands, u.formationId)) return true
  // ONE-tied same-formation cases (8e band-existence OR 8g(b) base-tied pair): ruling 8i's
  // tie-follow decides. MERGE only when following the unit's OWN tie lands on the SAME litho on the
  // matched facing side (below-for-top-tie / above-for-bottom-tie). A mismatched facing (the 11-row
  // ABSENT class) → onlap instead of a silent merge-then-absorb.
  const bandExists =
    sameFormationEnclosedByTiedBand(bands, u.formationId) ||
    sameFormationBaseTiedPair(baseTied, topTied, u.formationId, u.baseElev, u.topElev, facing)
  if (!bandExists) return false
  const tieSide = tiedContactSide(topTied, baseTied)
  const tiedElev = tieSide === 'base' ? u.baseElev : u.topElev
  const facingTiedElev = tieFacingElevAt(gapIndex, side, tiedElev, activeTies, facing)
  return followTieMatchedFacing(u, tieSide, facingTiedElev, facing)
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
  if (corr === 2) return false // band member / first-unit band — given line art (bandc)
  const iu: IntervalUnit = { unit: u, topElev: u.topElev, baseElev: u.baseElev }
  if (corr === 0) {
    // RULING 8i: 0 correlations → draw the lens lines ALWAYS. No merge exemption; the only
    // suppressions are PHYSICAL (degenerate / sub-snap), applied inside ``emitLensClosing``.
    return emitLens(iu, colX, facingX, facing, u, lensLabels, nextId, nextFloodId, out)
  }
  // corr === 1: RULING 8i "follow the tie". MERGE (do nothing — ``emitRuledBands`` closes the
  // band) when the unit connects to a same-formation band AND the tie lands on the SAME litho on
  // the matched facing side; otherwise ONLAP the tie (the 11-row mismatched-facing fix: a
  // different facing litho onlaps, never absent).
  if (mergesSameFormationBand(u, topTied, baseTied, gapIndex, side, facing, bands, activeTies)) {
    return false
  }
  // ONLAP SIDE — which contact the onlap tip rides + which side the flood wedge fills. This uses
  // the DIRECT/derived-base tie flags (``directTop``/``directBase`` from ``tiedFlags``) with the
  // v1 default (BASE when neither is set), NOT the effective flags: a lone-stack unit whose only
  // effective tie is a ruling-8a DERIVED BAND (``eff`` top/base set, direct flags clear) must
  // still flood AWAY from its stack neighbour, and the base default does that (the
  // coherentLoneStack / coherentStack(b) composition — a top-side flood there sends the wedge into
  // the adjacent terminating unit and the enclosing flood re-labels the vacated wedge). Ruling 8i's
  // MERGE decision (above) uses the effective flags; only the geometric SIDE keeps the v1 default.
  const tieSide = tiedContactSide(directTop, directBase)
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
 * Emit a 1-corr ONLAP: a pinch from the unit's own column span to a tip at
 * ``INTERIOR_PINCH_FRACTION`` (0.5) ON the tied contact's interpolated line. The TIED-side
 * edge carries an ``onlap`` id so ``labelFaces`` counts it as a tie (nTie 1) and the face
 * reads ONLAP; the UNTIED-side edge is a plain ``close``. The unit's own column vertical
 * closes the loop. The enclosing flood fills the vacated width past the tip. Returns ``true``
 * when emitted, ``false`` on a physical degenerate no-op.
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
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const pushClose = (points: Point[]): void => {
    const id = nextId()
    lensLabels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  const pushOnlap = (points: Point[]): void => {
    out.push({ id: `onlap${nextId()}`, kind: 'closing', points })
  }
  // Degenerate guard: a sub-snap onlap (apex on the column) drops both flanks (the enclosing
  // flood covers the slot — the ``emitLensClosing`` no-op parity).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return false
  if (baseTied) {
    pushClose([topPt, apex]) // untied top edge = plain close
    pushOnlap([apex, basePt]) // base edge rides the tied band → onlap id
  } else {
    pushOnlap([topPt, apex]) // top edge rides the tied band above → onlap id
    pushClose([apex, basePt]) // untied base edge = plain close
  }
  // FLOOD the vacated width past the onlap tip with the facing enclosing formation. The TIED
  // side is closed by its own tie line (the ``onlap`` edge rides it), so its wedge is SKIPPED —
  // for a base-tied onlap the UNTIED side is the TOP (skip 'base'); for a top-tied onlap the
  // untied side is the BASE (skip 'top'). The wedge rides the sloping bracket contour (Front 2).
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
