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

import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from '../sectionPartition'
import { lensReachFraction } from './lensReach'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { routeLoneStack } from './emitLoneStack'
import { type LensLabel } from './emitLenses'
import { emitSharedContactOnlap } from './emitSharedContactOnlap'
import { chooseOnlapEnclosing } from './emitTerminations'
import { emitSurfaceOnlap, surfaceExtendedUnit } from './emitSurfaceOnlap'
import { facingCoversSpan, facingMatrixLabel } from './facingMatrix'
import { firstLithoTopElev, type ColumnGeom } from './sectionGeom'
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
  forceKind?: 'onlap',
  apexElevOverride?: number,
  forceLens?: boolean,
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
  // ``forceKind='onlap'`` (increment 17 residual (ii)) overrides the same-matrix lens
  // heuristic: a tie-decided boundary onlap (v1 ``kindFor``) laps its bracket regardless
  // of whether the facing matrix happens to be uniform above and below.
  // ``forceLens`` (STRICT 2/1/0, ruling 8): a MIXED-bracket untied unit (aboveMatrix ≠
  // belowMatrix) is still a 0-tied LENS — apex at 0.45, own mid-elevation — even though the two
  // bracket lithologies differ. Without it, ``isLens`` is false for a mixed bracket and the apex
  // lands on the base interface (a dipping-bracket collapse) at the 0.5 onlap fraction. The
  // mixed flood wedges below still fire (both matrices present) so coverage stays complete.
  const isLens =
    forceLens ||
    (forceKind !== 'onlap' &&
      aboveMatrix !== null &&
      belowMatrix !== null &&
      aboveMatrix.formationId === belowMatrix.formationId)
  // Ruling 8b (design partition-engine-v2.md §8): a 0-corr LENS reach caps at ~2× the unit's
  // own thickness in real metres. A lone stack shares ONE apex fraction (so the notch comb
  // traces simple); use the THINNEST unit's cap so no unit's halo is exceeded (the shared
  // apex can only shrink, never grow — hole-safe, and it can never newly cross a band). The
  // ONLAP interior fraction (``!isLens``) is NOT a lens and is left uncapped (it rides a tie).
  const lensCapFrac = loneUnits.reduce(
    (m, u) => Math.min(m, lensReachFraction(u.topElev - u.baseElev, facingX - loneX)),
    LENS_PINCH_FRACTION,
  )
  const apexFrac = isLens ? lensCapFrac : INTERIOR_PINCH_FRACTION
  const apexX = loneX + apexFrac * (facingX - loneX)
  let apexElev: number
  if (apexElevOverride !== undefined) {
    // SURFACE-ANCHORED ONLAP (increment 18): the caller pins the apex to a RISING interior
    // elevation (v1's ``(own drilled top + conv)/2``) so the pinch tip does NOT land on a
    // dipping base-band bracket — an apex sitting exactly on that band makes the pinch's
    // lower ``close`` edge collinear with the band, the flood ``conv→apex`` edge coincide
    // with the band, and the pinch face merge into a full-width band (B6 gap2 KLEI defect).
    apexElev = apexElevOverride
  } else if (isLens) {
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
  // own column vertical closes the loop, so ``labelFaces`` reads its own formation. The
  // triangle's KIND (onlap vs lens) falls out of the traced boundary: a BOUNDARY pinch
  // (``!isLens``) is accompanied by the matrix-extension FLOOD wedge below, whose tie/
  // flood curves make the unit's own face read as an ONLAP (nTie > 0); a same-matrix
  // pinch closes as a 0-tied LENS. v1 emits both as ``kind:'lens'`` overlays; v2 keeps
  // the distinction as a true partition (onlap → pinch region, lens → lens region).
  //
  // SURFACE-ANCHORED ONLAP (increment 18, ``apexElevOverride`` set): the rising apex does
  // NOT land on the base-band bracket, so unlike the increment-17 onlap (apex on the tie)
  // the pinch face touches no tie/flood curve — ``classifyFace`` would read it a LENS. Emit
  // the BASE edge (the one lapping the tied band) with an ``onlap`` id, which ``labelFaces``
  // counts as a tie WITHOUT a label: the pinch face then reads ONLAP (nTie 1 + nClose 1) and
  // keeps its own column-vertical litho, while the adjacent flood face (labelled by its own
  // ``flood`` id, ``units`` empty) is unaffected.
  const onlapEdge = apexElevOverride !== undefined
  for (const u of loneUnits) {
    const label: LensLabel = { formationId: u.unit.formationId, bodyId: u.unit.bodyId }
    pushLabelled(nextId, label, labels, out, [{ x: loneX, y: u.topElev }, apex])
    if (onlapEdge) {
      out.push({ id: `onlap${nextId()}`, kind: 'closing', points: [apex, { x: loneX, y: u.baseElev }] })
    } else {
      pushLabelled(nextId, label, labels, out, [apex, { x: loneX, y: u.baseElev }])
    }
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
  /** Layer ids tied on top/base per side (v1 ``kindFor`` — decides onlap vs lens). */
  leftTied: { top: Set<string>; base: Set<string> }
  rightTied: { top: Set<string>; base: Set<string> }
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
  const loneX = loneSide === 'left' ? left.x : right.x
  const facingX = loneSide === 'left' ? right.x : left.x
  // The interval span on the lone column (the bracket elevations the flood wedge fills).
  const intervalTopElev = loneSide === 'left' ? top.leftElev : top.rightElev
  const intervalBaseElev = loneSide === 'left' ? base.leftElev : base.rightElev

  // Data-void lone unit (facing too shallow to reach it) → keep the full-width fill. The
  // reach criterion differs by gesture (v1 ``runIntervalExtraction`` full-observation guards,
  // emitLonePinch doc): a LENS needs the facing to reach the unit's BASE, an ONLAP needs it
  // to reach the TOP. A SURFACE-TOPPED base-tied ONLAP (shape (i): a first unit riding the
  // top-band whose base is a tied shared contact) laps that TIE — the facing carries the
  // enclosing matrix at the tie/top-band level even when it bottoms out ABOVE the unit's own
  // drilled base (CS1 g16 B2 KLEI: facing S7A TD 10.42 > the KLEI base 10.05). For that case
  // the base-reach guard is the WRONG criterion — it treats the shallow facing as a void and
  // bails to full width. Defer the guard: a single-unit surface-extended base-tied onlap
  // proceeds to the surface-onlap route below (which re-checks the facing carries the
  // enclosing matrix); every other lone case keeps the strict base-reach guard.
  const singleSurfaceOnlapCandidate = ((): boolean => {
    if (loneMatrix.length !== 1) return false
    const u = loneMatrix[0]
    const col = loneSide === 'left' ? left : right
    const { surfaceExtended: se } = surfaceExtendedUnit(u, col, top, intervalTopElev)
    return se
  })()
  if (!singleSurfaceOnlapCandidate && !loneSidePinches(loneMatrix, facingTDElev)) {
    return false
  }
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
    const loneColumn = loneSide === 'left' ? left : right
    return routeLoneStack(
      loneMatrix,
      facing,
      loneColumn,
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
  // SURFACE-ANCHORED ONLAP (increment 18): a ruling-5 surface-extended first unit fills up
  // to the surface band, so its EFFECTIVE top is the surface bracket, not its drilled
  // ``topElev``. Without this the fill-check below (drilled top ≠ surface bracket) bails to
  // the full-width tiler — the B4|S13 gap3 ZAND / B6 gap2 KLEI defect (design §4 increment-17
  // residual). ``surfaceExtendedUnit`` (emitSurfaceOnlap) decides + builds the effective unit.
  const loneCol = loneSide === 'left' ? left : right
  const { surfaceExtended, u0eff } = surfaceExtendedUnit(u0, loneCol, top, intervalTopElev)
  if (
    Math.abs(u0eff.topElev - intervalTopElev) > ELEV_EPS ||
    Math.abs(u0.baseElev - intervalBaseElev) > ELEV_EPS
  ) {
    return false // unit does not fill the interval — a strip would be left uncovered.
  }
  // The top-band-effective matrix passed to ``emitLonePinch`` — the pinch triangle's TOP
  // corner rides the top-band line (``u0eff.topElev`` = first-litho top = the unit's own
  // drilled top for a first unit), so the onlap top re-anchors to the drilled top
  // (ruling 5-revised — no fill above the first data point).
  const loneMatrixEff: IntervalUnit[] = [u0eff]
  // The facing-column enclosing-matrix lookup must sample the FACING column at elevations
  // the facing actually PRESENTS. For a top-band-topped interval the lone column's first-litho
  // top may sit ABOVE the facing column's own first-litho top — the top-band converges there.
  // Sampling / covering the facing above its own first-litho top would ask the facing to carry
  // matrix above its first data point (it does not — ``facingCoversSpan`` then falsely bails).
  // Clamp the sampled top DOWN to the facing column's first-litho top so the lateral-enclosure
  // test runs over the span the facing genuinely holds (v1 ``kindFor`` samples the OPPOSITE
  // column's real stack).
  const sampleTopElev = surfaceExtended
    ? Math.min(intervalTopElev, firstLithoTopElev(facing))
    : intervalTopElev
  const aboveMatrix = facingMatrixLabel(facing, sampleTopElev)
  const belowMatrix = facingMatrixLabel(facing, intervalBaseElev)
  if (aboveMatrix === null || belowMatrix === null) return false

  // ONLAP vs LENS (increment 17 residual (ii); v1 ``kindFor``): v1 shapes a lone unit as an
  // ONLAP when EXACTLY ONE of its bracketing contacts is TIED (it laps that bracket, apex
  // ``INTERIOR_PINCH_FRACTION``) and a LENS when untied (own-elevation 0.45).
  const tied = loneSide === 'left' ? ctx.leftTied : ctx.rightTied
  const topTied = tied.top.has(u0.unit.layerId)
  const baseTied = tied.base.has(u0.unit.layerId)
  const onlap = (topTied || baseTied) && !(topTied && baseTied)

  // SURFACE-ANCHORED ONLAP (increment 18): a surface-extended first unit whose BASE contact
  // is tied to a band that CONVERGES on the facing (the band's facing endpoint sits at/near
  // the facing surface, so the interval has zero facing thickness there — B4|S13 gap3 ZAND /
  // B6 gap2 KLEI). The pinch's top rides the surface band; its tip sits at 0.5 with a RISING
  // apex (``emitSurfaceOnlap`` — v1's ``(own drilled top + conv)/2``), so a dipping base band
  // never collapses the pinch into a full-width face (B6). Handles BOTH the clean-lateral
  // (SILT above and below) and dipping mixed-bracket cases.
  // The convergence gate is what keeps the unchanged repros (S7 gap18 surface SILT) OUT: when
  // the facing carries REAL thickness across the interval (facingTop ≠ facingBase), the unit
  // is not lapping out onto a converging band and stays on its existing route.
  const facingTopE = facingTopElevOf(top, loneSide)
  const facingBaseE = facingBaseElevOf(base, loneSide)
  const facingConverges = Math.abs(facingTopE - facingBaseE) < ELEV_EPS
  if (
    surfaceExtended &&
    onlap &&
    baseTied &&
    !topTied &&
    facingConverges &&
    u0.unit.formationId !== aboveMatrix.formationId
  ) {
    emitSurfaceOnlap(u0, u0eff, loneSide, loneX, facingX, facing, top, base, baseLenses, nextId, nextFloodId, lensLabels, out)
    return true
  }

  // STRICT 2/1/0 (owner ruling 8, design §8): a MIXED-bracket untied unit (the facing carries
  // a DIFFERENT lithology above vs below it — the Tie-6/9/11 VEEN class: KLEI above, SILT below)
  // must still TERMINATE. v2 previously bailed here (mixed bracket ≠ single continuous matrix)
  // and the interval tiler ran the unit FULL-WIDTH (the retired sideways continuation). It now
  // pinches to a 0.45 OWN-ELEVATION lens; the above matrix floods the top wedge, the below matrix
  // the base wedge (``emitLonePinch`` mixed-bracket branch — two disjoint wedges sharing the
  // conv→apex edge, hole-free by construction). The apex is pinned to the unit's OWN mid-elevation
  // (``apexElevOverride``) so a DIPPING bracket never collapses the pinch full-width (the B6
  // symptom). A CONVERGING facing bracket (zero facing thickness — a genuine data void) is NOT
  // routed here: its flood wedge is degenerate (conv coincides with the apex → self-touching
  // ring), so it stays the full-width sideways continuation (owner §8 Q3 — nothing anchors it).
  if (aboveMatrix.formationId !== belowMatrix.formationId) {
    // SHARED-CONTACT ONLAP (ruling 8a, owner 2026-07-15, S5A|S5 KLEI): a mixed-bracket unit
    // whose top OR base contact is a TIED shared contact (``onlap``) — including a CONVERGING
    // facing bracket where the two adjacent tied bands meet at a point — is 1-corr and must
    // ONLAP that tie, tip at ``INTERIOR_PINCH_FRACTION`` (0.5). The space beyond the tip closes
    // by boundary composition: the ENCLOSING matrix on the UNTIED side floods around the onlap
    // notch (owner's own trace: the SILT face above closes around the KLEI onlap). This DISSOLVES
    // the pre-8a "converging = data void" bail (which left the unit full-width) — a shared tied
    // contact IS an anchor, never a void. The tied band below keeps its own full-width band; it
    // must NOT rise into the interval (routing the below matrix into the base wedge was the ZAND-
    // above-tie symptom), so ``emitSharedContactOnlap`` floods BOTH wedges with the untied-side
    // enclosing matrix (aboveMatrix for a base-tied onlap; belowMatrix for a top-tied one).
    // ``emitSharedContactOnlap`` fires only for an INTERIOR minority — one sitting between two
    // REAL tied bands (``top.anchor && base.anchor``). Its enclosing-matrix flood spans from the
    // unit's own column to the facing convergence; against the SURFACE (a non-anchor top bracket)
    // that flood would invent a full-width band of the above matrix UP to the surface where the
    // facing carries a different lithology (the CS1 g8 KLEI-to-surface symptom). Surface-topped
    // onlaps are the ``emitSurfaceOnlap`` route (ruling 5-revised, no invented top matrix).
    if (onlap && top.anchor && base.anchor) {
      // ENCLOSING-MATRIX CHOICE — the onlap notch is closed by whichever bracket enclosing
      // DIFFERS from the unit's own formation (ruling 8a generalised to same-formation
      // enclosure, ruling 8c). Extracted to ``emitTerminations`` to keep this file's budget.
      const enclosing = chooseOnlapEnclosing(loneMatrixEff[0].unit.formationId, baseTied, aboveMatrix, belowMatrix)
      emitSharedContactOnlap(
        loneMatrixEff[0],
        loneSide,
        loneX,
        facingX,
        top,
        base,
        baseTied,
        enclosing,
        nextId,
        nextFloodId,
        lensLabels,
        out,
      )
      for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
      return true
    }
    // A 0-TIED mixed-bracket unit (no shared tied contact) still TERMINATES as a LENS — but only
    // when the facing bracket has real thickness. A CONVERGING facing with NO tied contact is a
    // genuine data void (owner §8 Q3 — nothing anchors it): keep the full-width sideways fill.
    if (facingConverges) return false
    // ``forceLens`` pins the apex to the unit's own mid-elevation at 0.45 (a true 0-tied lens)
    // and keeps the base edge a plain ``close`` (no onlap-id) so ``labelFaces`` reads LENS. The
    // mixed above/below flood wedges fire (both matrices non-null) and tile the vacated width.
    emitLonePinch(
      loneMatrixEff,
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
      undefined,
      undefined,
      true,
    )
    for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
    return true
  }
  if (!facingCoversSpan(facing, aboveMatrix.formationId, sampleTopElev, intervalBaseElev)) {
    return false
  }
  // ONLAP on the CLEAN lateral context (increment 17 residual (ii)): reaching here the
  // facing carries ONE continuous matrix across the interval — a true lateral enclosure
  // whose flood wedges tile gaplessly. Deciding the onlap HERE — after the clean-lateral
  // guard — keeps the flood wedge gapless (never the band-overrunning full-width wedge a
  // non-converging bracket would produce). A unit tied on BOTH or NEITHER contact keeps the
  // lens shape (v1: a 2-tied unit bands, a 0-tied one lenses). (A surface-extended base-tied
  // onlap is already handled above by ``emitSurfaceOnlap``.)
  if (onlap && u0.unit.formationId !== aboveMatrix.formationId) {
    emitLonePinch(
      loneMatrixEff,
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
      'onlap',
    )
    for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
    return true
  }
  // ENCLOSING-MATRIX full-flood (ruling-8 legit) vs BARE auto-match (retired). When the lone
  // matrix formation EQUALS the facing matrix AND it ENCLOSES own-column lenses (``baseLenses``
  // non-empty), the matrix is a true §2 closed loop through its OWN column (matrix above AND
  // below the minorities) — it floods FULL-WIDTH, minorities pinch 0.45 inside. Synthesize the
  // absent facing column-vertical as a flood-labelled closing so the band face closes (the
  // ``emitBottomTieSubstrate`` sub-TD trick). STRICT 2/1/0 (owner ruling 8, design §8): a BARE
  // same-formation lone unit (``baseLenses`` EMPTY) is the RETIRED geometric auto-match — it must
  // TERMINATE. It falls through to ``emitLonePinch`` (``aboveMatrix === belowMatrix`` → ``isLens``
  // 0.45 own-elevation pinch, the same-formation matrix floods both wedges past the apex).
  if (u0.unit.formationId === aboveMatrix.formationId && baseLenses.length > 0) {
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
    loneMatrixEff,
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
