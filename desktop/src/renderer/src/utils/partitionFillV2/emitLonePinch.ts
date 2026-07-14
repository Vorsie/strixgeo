/**
 * partitionFillV2/emitLonePinch.ts — LONE-SIDE pinch + flood closure (finding A).
 *
 * The systematic finding-A defect: an untied litho unit with NO counterpart on the
 * facing column filled the WHOLE interval width in v2 (``emitIntervals.tileInterval``
 * with ``meet`` 1 / 0). v1 makes such a unit PINCH — its apex sits SHORT of the far
 * column — and the FACING/BRACKET matrix claims the vacated width past the apex.
 * This module ports v1's one-sided-pinch geometry (``partitionFill/carve.ts``
 * ``emitOneSidedPinch`` + ``partitionFill/columnReduce.ts`` ``runIntervalExtraction``
 * branches 2/3/4 + ``kindFor``) into v2 arrangement curves.
 *
 * v1 shape reproduced (per stacked untied unit on the lone side):
 *
 *   - a PINCH TRIANGLE from the unit's own column span to a SHARED apex — at
 *     ``LENS_PINCH_FRACTION`` (0.45) of the gap and the unit's OWN mid-elevation for
 *     a 0-tied LENS (``kindFor`` → lens, ``runIntervalExtraction`` branch 4), or at
 *     ``INTERIOR_PINCH_FRACTION`` (0.5) on the tied bracket interface for a 1-tied
 *     ONLAP (branches 2/3). The triangle is bounded by the unit's OWN column vertical
 *     plus two ``close`` curves, so ``labelFaces`` stamps it with the unit's own
 *     formation and classifies it LENS (0 ties, 2 closings) — matching v1, which
 *     emits both lens and onlap as ``kind:'lens'`` overlays (``emit.ts`` step 3/3a).
 *
 *   - FLOOD-CLOSURE curves that bound the vacated wedge BEYOND the apex — the exact
 *     ``emitOneSidedPinch`` matrix-extension triangles (``topCorner→conv→apex`` and/or
 *     ``baseCorner→apex→conv``, ``conv`` = the convergence point on the FACING column
 *     where the interval's two bracket interfaces meet). These wedge faces are bounded
 *     ONLY by synthesized ``flood`` curves + the tie/surface brackets + the pinch's
 *     own ``close`` curves — NEVER a full facing column-vertical edge — so ``units`` is
 *     empty for them and ``labelFaces`` stamps them from the FLOOD (bracket-matrix)
 *     label as a BAND. This is the same "label a synthesized-curve-bounded face" trick
 *     ``emitBottomTieSubstrate`` uses for the sub-TD wedge; it is what makes coverage
 *     complete (the naive lens-only fix left the wedge an untraced HOLE).
 *
 * Reach guard (v1 ``runIntervalExtraction`` full-observation guards): a LENS needs the
 * facing column to reach the unit's BASE; an ONLAP needs it to reach the TOP. A unit
 * the facing column is too shallow to reach is a DATA VOID — it continues SIDEWAYS at
 * full width and is NOT routed here (the caller keeps such intervals on the ordinary
 * lone-side full-width tiling). This module only ever emits for genuine pinch-outs.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { routeLoneStack } from './emitLoneStack'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** The FACING column's top-bracket elevation for a given lone side. */
function facingTopElevOf(top: LonePinchBracket, loneSide: 'left' | 'right'): number {
  return loneSide === 'left' ? top.rightElev : top.leftElev
}

/** The FACING column's base-bracket elevation for a given lone side. */
function facingBaseElevOf(base: LonePinchBracket, loneSide: 'left' | 'right'): number {
  return loneSide === 'left' ? base.rightElev : base.leftElev
}

/**
 * A bracket interface across one gap (a straight line the interval is bounded by).
 * ``anchor`` marks a real tie/bridge line (vs the surface / TD floor) — a unit whose
 * bounding contact sits on an anchor bracket is TIED on that contact (1-tie → onlap).
 */
export interface LonePinchBracket {
  leftElev: number
  rightElev: number
  anchor: boolean
}

/**
 * Whether a lone-side interval's units genuinely PINCH (the facing column reaches
 * them) rather than continue sideways (a data void). Ports v1's full-observation
 * reach guards (``runIntervalExtraction``): a lone stack pinches when the facing
 * column's TD (deepest base elevation) reaches the DEEPEST unit's base — the strict
 * reach for the lens gesture the lone-candidate branch (4) applies.
 *
 * Parameters
 * ----------
 * loneUnits : readonly IntervalUnit[]
 *     The lone side's matrix units in the interval (top->down), already
 *     enclosed-lens-extracted.
 * facingTDElev : number
 *     The facing column's deepest base elevation (its TD in mTAW).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the facing column reaches the deepest lone unit's base — a
 *     genuine pinch; ``false`` for a data void (caller keeps the full-width fill).
 */
export function loneSidePinches(loneUnits: readonly IntervalUnit[], facingTDElev: number): boolean {
  if (loneUnits.length === 0) return false
  let deepestBase = Infinity
  for (const u of loneUnits) if (u.unit.baseElev < deepestBase) deepestBase = u.unit.baseElev
  // Facing reaches the unit's base ⇔ its TD is at or below that base elevation.
  return facingTDElev <= deepestBase + ELEV_EPS
}

/**
 * Emit the lone-side pinch + flood-closure curves for one interval, and record the
 * per-curve litho labels (pinch = the unit's own formation; flood = the bracket
 * matrix). Mirrors v1 ``emitOneSidedPinch`` triangle decomposition.
 *
 * The convergence point ``conv`` is where the interval's top and base brackets meet on
 * the FACING column (a lone-side interval has zero thickness there — the unit is absent
 * on the facing column, so the two bracket lines converge). The apex sits mid-gap; the
 * flood triangles close the wedge from the apex to ``conv``.
 *
 * Parameters
 * ----------
 * loneUnits : readonly IntervalUnit[]
 *     The lone side's matrix units (top->down), already enclosed-lens-extracted.
 * side : 'left' | 'right'
 *     The column the lone units live on (the pinch side).
 * loneX, facingX : number
 *     Along-section x of the pinch column and the facing column (metres).
 * top, base : LonePinchBracket
 *     The interval's enclosing bracket interfaces.
 * aboveMatrix, belowMatrix : LensLabel | null
 *     The matrix ABOVE / BELOW the interval (the bracket lithology), or ``null`` at the
 *     surface (above) / TD floor (below). The flood formation is ``belowMatrix ??
 *     aboveMatrix`` (v1 ``(belowLith ?? aboveLith)`` in ``runIntervalExtraction``).
 * nextId : () => string
 *     Curve-id allocator (``close<n>`` — pinch triangles read as own-formation LENS).
 * nextFloodId : () => string
 *     Flood-curve id allocator (``flood<n>`` — ``labelFaces`` stamps the wedge from
 *     the flood label as a BAND).
 * labels : Map<string, LensLabel>
 *     Shared ``lensLabels`` map: pinch-curve ids -> the unit's litho; flood-curve ids
 *     -> the bracket-matrix litho.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitLonePinch(
  loneUnits: readonly IntervalUnit[],
  side: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  aboveMatrix: LensLabel | null,
  belowMatrix: LensLabel | null,
  nextId: () => string,
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  if (loneUnits.length === 0) return

  const loneTopElev = side === 'left' ? top.leftElev : top.rightElev
  const loneBaseElev = side === 'left' ? base.leftElev : base.rightElev
  const facingTopElev = side === 'left' ? top.rightElev : top.leftElev
  const facingBaseElev = side === 'left' ? base.rightElev : base.leftElev

  // conv — where the two bracket interfaces meet on the FACING column (the interval
  // has zero thickness there; v1 ``conv`` = ``oppSurface − (topOppDepth+baseOppDepth)/2``).
  const conv: Point = { x: facingX, y: (facingTopElev + facingBaseElev) / 2 }

  // LENS vs BOUNDARY pinch (v1 ``emitOneSidedPinch``):
  //   - same matrix formation ABOVE and BELOW → LENS: apex at LENS_PINCH_FRACTION at the
  //     unit's OWN mid-elevation (tapers horizontally), matrix fills from BOTH sides;
  //   - otherwise → BOUNDARY pinch: apex at INTERIOR_PINCH_FRACTION on the base interface
  //     (above matrix descends), or the top interface at the surface (below rises).
  const isLens =
    aboveMatrix !== null && belowMatrix !== null && aboveMatrix.formationId === belowMatrix.formationId
  const apexFrac = isLens ? LENS_PINCH_FRACTION : INTERIOR_PINCH_FRACTION
  const apexX = loneX + apexFrac * (facingX - loneX)
  let apexElev: number
  if (isLens) {
    apexElev = (loneTopElev + loneBaseElev) / 2
  } else if (aboveMatrix) {
    // Apex on the BASE interface at the apex fraction (the above matrix descends to it).
    apexElev = loneBaseElev + apexFrac * (facingBaseElev - loneBaseElev)
  } else {
    // Surface interval — apex on the TOP interface (the below matrix rises to it).
    apexElev = loneTopElev + apexFrac * (facingTopElev - loneTopElev)
  }
  const apex: Point = { x: apexX, y: apexElev }

  // (a) Pinch sub-triangles: each stacked unit's own column span -> the shared apex.
  // Two ``close`` curves per unit (top corner -> apex, apex -> base corner); the unit's
  // own column vertical closes the loop, so ``labelFaces`` reads its own formation and
  // classifies it LENS (0 ties, 2 closings) — v1 emits both lens + onlap as ``kind:'lens'``.
  for (const u of loneUnits) {
    const label: LensLabel = { formationId: u.unit.formationId, bodyId: u.unit.bodyId }
    pushLabelled(nextId, label, labels, out, [{ x: loneX, y: u.topElev }, apex])
    pushLabelled(nextId, label, labels, out, [apex, { x: loneX, y: u.baseElev }])
  }

  // (b) Matrix-extension (FLOOD) triangles closing the wedge beyond the apex (v1
  // ``emitOneSidedPinch``). The NEW edges (topCorner->conv, baseCorner->conv, conv->apex)
  // are the flood-boundary curves the naive lens-only fix left open (the HOLE). Emit
  // them as ``flood`` curves labelled with the bracket matrix so the wedge faces read as
  // a BAND. The selection of which triangle(s) to close follows the SAME above/below
  // presence rule as v1: LENS → both sides; above-only → above descends (top wedge);
  // below-only / surface → below rises (base wedge); different above+below → both.
  const topCorner: Point = { x: loneX, y: loneTopElev }
  const baseCorner: Point = { x: loneX, y: loneBaseElev }
  const floodFrom = (label: LensLabel, corner: Point): void => {
    // Skip a degenerate wedge (conv coincides with the corner — zero facing thickness on
    // that side), matching v1's ``Math.abs(topOpp − baseOpp) ≥ EPS`` guard for the lens case.
    if (Math.abs(corner.y - conv.y) < ELEV_EPS && Math.abs(corner.x - conv.x) < ELEV_EPS) return
    const floodLabelled = (points: Point[]): void => pushLabelled(nextFloodId, label, labels, out, points)
    floodLabelled([corner, conv])
    floodLabelled([conv, apex])
  }
  if (isLens) {
    // Same material above + below — the wedge is closed from BOTH corners.
    floodFrom(aboveMatrix!, topCorner)
    floodFrom(belowMatrix!, baseCorner)
  } else if (aboveMatrix && belowMatrix) {
    // Different bracket materials — the above descends over the top wedge, the below over
    // the base wedge (v1's two-triangle mixed-bracket close).
    floodFrom(aboveMatrix, topCorner)
    floodFrom(belowMatrix, baseCorner)
  } else if (aboveMatrix) {
    floodFrom(aboveMatrix, topCorner)
  } else if (belowMatrix) {
    // Surface interval — the below matrix rises to fill from the base corner.
    floodFrom(belowMatrix, baseCorner)
  }
}

/** Push one closing curve and record its litho label under the allocated id. */
function pushLabelled(
  nextId: () => string,
  label: LensLabel,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
  points: Point[],
): void {
  const id = nextId()
  labels.set(id, label)
  out.push({ id, kind: 'closing', points })
}

/** One interval's per-side matrix units + enclosed lenses, plus the two columns. */
export interface LoneIntervalContext {
  left: ColumnGeom
  right: ColumnGeom
  top: LonePinchBracket
  base: LonePinchBracket
  leftMatrix: IntervalUnit[]
  rightMatrix: IntervalUnit[]
  leftLenses: IntervalUnit[]
  rightLenses: IntervalUnit[]
}

/**
 * Route a lone-side interval (one side has matrix units, the other is empty) to the
 * lone-side pinch geometry when it genuinely pinches, and emit it. Returns ``true``
 * when the lone-pinch path handled the interval (the caller then skips the ordinary
 * seam tiling), ``false`` when the interval is two-sided OR a data-void lone unit that
 * must keep the full-width tiling (v1's sideways continuation — NOT the finding-A defect).
 *
 * Parameters
 * ----------
 * ctx : LoneIntervalContext
 *     The interval's columns, brackets, and per-side matrix / lens units.
 * nextId : () => string
 *     ``close``-curve allocator (pinch triangles + enclosed-lens closings).
 * nextFloodId : () => string
 *     ``flood``-curve allocator (the vacated-wedge boundary).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map (pinch = own formation; flood = bracket matrix).
 * out : InputCurve[]
 *     Curve accumulator.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when a lone-side pinch was emitted; ``false`` to fall through.
 */
export function routeLoneSidePinch(
  ctx: LoneIntervalContext,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftMatrix, rightMatrix, leftLenses, rightLenses } = ctx
  const loneSide: 'left' | 'right' | null =
    leftMatrix.length > 0 && rightMatrix.length === 0
      ? 'left'
      : rightMatrix.length > 0 && leftMatrix.length === 0
        ? 'right'
        : null
  if (loneSide === null) return false

  const loneMatrix = loneSide === 'left' ? leftMatrix : rightMatrix
  const facing = loneSide === 'left' ? right : left
  const facingTDElev = facing.units[facing.units.length - 1].baseElev
  // Data-void lone unit (facing too shallow to reach it) → keep the full-width fill.
  if (!loneSidePinches(loneMatrix, facingTDElev)) return false

  const loneX = loneSide === 'left' ? left.x : right.x
  const facingX = loneSide === 'left' ? right.x : left.x
  // The interval span on the lone column (the bracket elevations the flood wedge fills).
  const intervalTopElev = loneSide === 'left' ? top.leftElev : top.rightElev
  const intervalBaseElev = loneSide === 'left' ? base.leftElev : base.rightElev
  // CLEAN LATERAL-LENS guard (finding A, conservative scope): fire ONLY when
  //   (a) the lone side is a SINGLE unit that fills the WHOLE interval (its clamped span
  //       == the interval brackets) — so the pinch triangle + flood wedges tile the
  //       interval with NO leftover strip above/below the unit (the gap20 sliver-hole
  //       class); and
  //   (b) the facing column carries ONE continuous matrix formation across that span — a
  //       true lens laterally enclosed in one material (the finding-A gate shape, whose
  //       both-sided flood tiles gaplessly BY CONSTRUCTION).
  // LONE MULTI-UNIT INTERBEDDED STACK (increment 13): the loneMatrix carries several
  // units (e.g. S7 gap18 SILT/KLEI/SILT/VEEN/KLEI). v1 renders each minority as an
  // own-elevation lens over the enclosing matrix band (design §4 increment-11/12/13,
  // owner CS1 repros). Reduce the stack to a single dominant facing-carried matrix +
  // its pinching minorities; the reduced single matrix then takes the same-formation
  // flood path below (the matrix floods full-width, minorities pinch as own-elevation
  // lens holes). ``extractLoneStackLenses`` returns ``null`` when no single dominant
  // facing-carried matrix exists (a genuinely interbedded lone stack with no enclosing
  // lithology) — that stack keeps the full-width fallback.
  // Reduce a multi-unit stack into LOCAL scratch arrays first; only merge them into
  // the shared lens accumulator once the flood path below is confirmed (returning
  // false must leave the caller's ``leftLenses``/``rightLenses`` untouched, else the
  // full-width fallback double-covers the pulled minorities).
  const baseLenses = loneSide === 'left' ? leftLenses : rightLenses
  // LONE MULTI-UNIT INTERBEDDED STACK (increment 13): the enclosing matrix floods the
  // interval wedge while every minority pinches at its own elevation. Delegated to
  // ``routeLoneStack`` (returns false to fall through to the single-unit / full-width
  // paths when no single facing-carried enclosing matrix exists).
  if (loneMatrix.length !== 1) {
    return routeLoneStack(
      loneMatrix,
      facing,
      loneSide,
      loneX,
      facingX,
      top,
      base,
      baseLenses,
      nextId,
      nextFloodId,
      lensLabels,
      out,
    )
  }
  // SINGLE-UNIT lone pinch (finding A): the conservative clean-lateral-lens case (a
  // single unit filling the interval against a facing that carries ONE continuous
  // matrix). See the guard comments below.
  const u0 = loneMatrix[0]
  if (
    Math.abs(u0.topElev - intervalTopElev) > ELEV_EPS ||
    Math.abs(u0.baseElev - intervalBaseElev) > ELEV_EPS
  ) {
    return false // unit does not fill the interval — a strip would be left uncovered.
  }
  const aboveMatrix = facingMatrixLabel(facing, intervalTopElev)
  const belowMatrix = facingMatrixLabel(facing, intervalBaseElev)
  if (aboveMatrix === null || belowMatrix === null) return false
  if (
    aboveMatrix.formationId !== belowMatrix.formationId ||
    !facingCoversSpan(facing, aboveMatrix.formationId, intervalTopElev, intervalBaseElev)
  ) {
    return false
  }
  // Continuous-band flood (v1 ``emitInterval`` connectivity inference): when the lone
  // matrix formation EQUALS the facing matrix formation, the matrix is ONE body banding
  // across the gap — it floods FULL-WIDTH (not a 0.45 pinch). The facing column is EMPTY
  // across this interval (a lone side), so its column-vertical curve is absent there and
  // the full-width band face would be UNBOUNDED on the facing edge (an untraced HOLE —
  // the CS1 gap0 multi-lens class before increment 9). Synthesize the facing column-
  // vertical segment as a flood-labelled closing curve so the band face closes; then emit
  // the (already facing-aware extracted) enclosed lenses' 0.45 closings — the minorities
  // pinch, the clay matrix bands across. This is the same synthesized-edge trick
  // ``emitBottomTieSubstrate`` uses for the sub-TD wedge.
  if (u0.unit.formationId === aboveMatrix.formationId) {
    const floodId = nextFloodId()
    lensLabels.set(floodId, aboveMatrix)
    out.push({
      id: floodId,
      kind: 'closing',
      points: [
        { x: facingX, y: facingTopElevOf(top, loneSide) },
        { x: facingX, y: facingBaseElevOf(base, loneSide) },
      ],
    })
    for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
    return true
  }
  emitLonePinch(
    loneMatrix,
    loneSide,
    loneX,
    facingX,
    top,
    base,
    aboveMatrix,
    belowMatrix,
    nextId,
    nextFloodId,
    lensLabels,
    out,
  )
  // Enclosed lenses on the lone side still pinch to their own 0.45 apex — their matrix
  // band IS the lone-pinch flood, which reaches them.
  for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
  return true
}

/**
 * Whether the facing column carries formation ``fid`` CONTINUOUSLY across the elevation
 * span [``base``..``top``] — i.e. every point of that span on the facing column is that
 * one formation (a single continuous matrix laterally enclosing the lone unit). This is
 * the guard that keeps the lone-pinch to the clean lateral-lens case whose flood wedges
 * tile gaplessly (v1 ``facingCarriesMatrix``, strengthened to require FULL coverage).
 */
function facingCoversSpan(facing: ColumnGeom, fid: string, top: number, base: number): boolean {
  // Walk the facing units overlapping [base..top]; the run must be all ``fid`` and cover
  // the whole span with no gap (the normalised stack is gap-free, so contiguous ``fid``
  // units spanning the range suffice).
  let covered = base // highest elevation covered so far, working up from the base
  const overlapping = facing.units
    .filter((u) => u.topElev > base - ELEV_EPS && top > u.baseElev - ELEV_EPS)
    .sort((a, b) => a.baseElev - b.baseElev)
  for (const u of overlapping) {
    if (u.formationId !== fid) return false
    if (u.baseElev > covered + ELEV_EPS) return false // gap below this unit
    if (u.topElev > covered) covered = u.topElev
  }
  return covered >= top - ELEV_EPS
}

/**
 * The facing column's matrix label at elevation ``e`` — the lithology that laterally
 * encloses the pinching unit on the facing side. Picks the facing unit whose elevation
 * span contains ``e``; falls back to the nearest unit (an ``e`` at/above the surface or
 * below TD). Returns ``null`` only when the facing column is empty (never, given a valid
 * section).
 */
function facingMatrixLabel(facing: ColumnGeom, e: number): LensLabel | null {
  let best: ColumnGeom['units'][number] | null = null
  let bestDist = Infinity
  for (const u of facing.units) {
    if (u.topElev >= e - ELEV_EPS && e >= u.baseElev - ELEV_EPS) {
      return { formationId: u.formationId, bodyId: u.bodyId }
    }
    const dist = e > u.topElev ? e - u.topElev : u.baseElev - e
    if (dist < bestDist) {
      bestDist = dist
      best = u
    }
  }
  return best ? { formationId: best.formationId, bodyId: best.bodyId } : null
}
