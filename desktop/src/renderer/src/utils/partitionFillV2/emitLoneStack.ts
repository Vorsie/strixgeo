/**
 * partitionFillV2/emitLoneStack.ts — the LONE MULTI-UNIT INTERBEDDED STACK matrix
 * flood wedge (design partition-engine-v2.md §4 increment-13; owner CS1 repros S7
 * gap18 / S6 gap19 / B6 gap2 / B4|S13 gap3 / S8 gap14).
 *
 * A lone interbedded stack (several units on one column with NO facing counterpart —
 * the facing bracket span collapses to ~a point) fills as v1 renders it: each minority
 * pinches at its OWN mid-elevation (a 0.45 lens), and the enclosing MATRIX floods the
 * interval BEHIND them. The increment-11 diagnosis proved a shared-apex multi-unit wedge
 * self-inverts (+19 overlaps); each minority must therefore be an own-elevation lens
 * (``emitLensClosing``), NOT a shared apex.
 *
 * The matrix flood is a WEDGE: the enclosing lithology fills the interval from the lone
 * column's full-height span (loneTop..loneBase) converging to the facing bracket point
 * ``conv`` (where the two bracket lines meet on the facing column — a lone interval has
 * zero facing thickness there). Unlike ``emitLonePinch``, NO per-unit pinch triangle is
 * emitted — the matrix is the flooding BACKGROUND. The two flood curves
 * ``loneTop→conv`` and ``conv→loneBase`` (labelled with the matrix formation) close the
 * wedge; where the lone column's own vertical carries the matrix lithology it labels the
 * matrix regions between the lens notches, and the ``flood`` label stamps the wedge tip
 * beyond the deepest column vertical (the finding-A flood-label trick that
 * ``labelFaces`` reads). Each minority lens closing cuts its own face out (a notch where
 * it rides the lone column edge, a hole where it floats interior → ``slice.splitAnnulus``).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, extractLoneStackLenses, type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Emit the matrix flood wedge for a lone multi-unit interbedded stack.
 *
 * Parameters
 * ----------
 * matrix : LensLabel
 *     The enclosing matrix formation (the facing bracket lithology at the convergence
 *     point — v1's ``belowLith ?? aboveLith``).
 * side : 'left' | 'right'
 *     The lone column's side.
 * loneX, facingX : number
 *     Along-metres x of the lone / facing columns.
 * top, base : LonePinchBracket
 *     The interval's enclosing brackets.
 * nextFloodId : () => string
 *     Flood-curve id allocator (``flood<n>`` — ``labelFaces`` stamps a flood-bounded
 *     face from its label as a BAND).
 * labels : Map<string, LensLabel>
 *     Shared label map — the two flood curves register the matrix formation here.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitLoneStackWedge(
  matrix: LensLabel,
  side: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const loneTopElev = side === 'left' ? top.leftElev : top.rightElev
  const loneBaseElev = side === 'left' ? base.leftElev : base.rightElev
  const facingTopElev = side === 'left' ? top.rightElev : top.leftElev
  const facingBaseElev = side === 'left' ? base.rightElev : base.leftElev
  // conv — where the two bracket interfaces meet on the FACING column (a lone interval
  // has zero facing thickness there); v1 ``emitOneSidedPinch`` ``conv``.
  const conv: Point = { x: facingX, y: (facingTopElev + facingBaseElev) / 2 }
  const push = (points: Point[]): void => {
    const id = nextFloodId()
    labels.set(id, matrix)
    out.push({ id, kind: 'closing', points })
  }
  push([{ x: loneX, y: loneTopElev }, conv])
  push([conv, { x: loneX, y: loneBaseElev }])
}

/** Below this clamped apex fraction a minority is a BOUNDARY unit lapping the bracket
 *  in a narrow wedge — v1 shapes it as an onlap, not a heavily-truncated lens; the
 *  lone-stack path bows out so as not to diverge (the caller keeps the full-width
 *  fallback). The interior-enclosed minorities (S7 VEEN clamps to 0.35) stay above it. */
const MIN_CLAMPED_FRACTION = 0.3

/**
 * The apex FRACTION for a minority lens, clamped to stay INSIDE the matrix wedge. The
 * wedge upper edge runs loneTop→conv, its lower edge loneBase→conv (both meeting at the
 * facing point). A minority's own-elevation 0.45 apex can fall OUTSIDE the wedge when
 * the interval is a steep wedge and the minority sits near a bracket (the S7-gap18 VEEN
 * crossed the KLEI/ZAND base diagonal → a 6.4 cm lens×ZAND overlap). The fraction is
 * reduced so the apex point stays on the matrix side of BOTH wedge edges — the lens
 * still pinches at its own elevation, just short enough to remain a hole in the matrix
 * (v1 shortens such a boundary-adjacent lens too — its VEEN apex is 0.38).
 */
function clampedLensFraction(
  u: IntervalUnit,
  loneTopElev: number,
  loneBaseElev: number,
  convElev: number,
): number {
  const apexElev = (u.topElev + u.baseElev) / 2
  const upperAt = (f: number): number => loneTopElev + f * (convElev - loneTopElev)
  const lowerAt = (f: number): number => loneBaseElev + f * (convElev - loneBaseElev)
  let f = LENS_PINCH_FRACTION
  const MARGIN = 1e-3
  while (f > 0.02 && (apexElev > upperAt(f) - MARGIN || apexElev < lowerAt(f) + MARGIN)) {
    f -= 0.02
  }
  return f
}

/**
 * Route + emit a LONE MULTI-UNIT INTERBEDDED STACK interval (increment 13). Returns
 * ``true`` when handled (the caller skips the ordinary tiling), ``false`` to fall
 * through to the single-unit lone-pinch / full-width paths.
 *
 * The enclosing matrix formation is the facing lithology at the interval's facing
 * convergence point (v1's ``belowLith ?? aboveLith``). Every non-matrix unit is pulled
 * as an own-elevation lens (clamped to the matrix wedge); the matrix floods the interval
 * wedge behind them.
 *
 * Parameters
 * ----------
 * loneMatrix : readonly IntervalUnit[]
 *     The lone side's interval units (>1 — the single-unit case is the caller's).
 * facing : ColumnGeom
 *     The facing column (its convergence-point lithology names the matrix).
 * loneSide : 'left' | 'right'
 * loneX, facingX : number
 *     Along-metres x of the lone / facing columns.
 * top, base : LonePinchBracket
 *     The interval brackets.
 * preLenses : IntervalUnit[]
 *     Pre-existing enclosed lenses on the lone side (emitted at 0.45 too).
 * nextId, nextFloodId : () => string
 *     Curve-id allocators.
 * lensLabels : Map<string, LensLabel>
 * out : InputCurve[]
 */
export function routeLoneStack(
  loneMatrix: readonly IntervalUnit[],
  facing: ColumnGeom,
  loneSide: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  preLenses: readonly IntervalUnit[],
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const facingTopElev = loneSide === 'left' ? top.rightElev : top.leftElev
  const facingBaseElev = loneSide === 'left' ? base.rightElev : base.leftElev
  const convElev = (facingTopElev + facingBaseElev) / 2
  const bracketMatrix = facingMatrixLabel(facing, convElev)
  if (bracketMatrix === null) return false
  const stackLenses: IntervalUnit[] = []
  const reduced = extractLoneStackLenses([...loneMatrix], bracketMatrix.formationId, stackLenses)
  if (reduced === null) return false

  const iTop = loneSide === 'left' ? top.leftElev : top.rightElev
  const iBase = loneSide === 'left' ? base.leftElev : base.rightElev

  // Pre-compute the clamped apex fraction for every minority. If ANY needs clamping
  // below MIN_CLAMPED_FRACTION the stack is a BOUNDARY-minority case in a narrow wedge
  // (v1 shapes it as an onlap lapping the bracket, not a truncated own-elevation lens):
  // bow out so the ordinary full-width fallback runs, rather than emit a divergent
  // near-zero-apex lens (B4|S13 gap3's top SILT). Nothing has been pushed to ``out``
  // yet, so returning false is clean.
  const plan: { u: IntervalUnit; f: number }[] = []
  for (const u of [...stackLenses, ...preLenses]) {
    const f = clampedLensFraction(u, iTop, iBase, convElev)
    if (f < MIN_CLAMPED_FRACTION) return false
    plan.push({ u, f })
  }

  // The enclosing matrix floods the interval WEDGE (lone full-height → facing point).
  emitLoneStackWedge(bracketMatrix, loneSide, loneX, facingX, top, base, nextFloodId, lensLabels, out)
  // Every minority pinches to its OWN own-elevation apex, clamped inside the matrix
  // wedge (NOT a shared-apex wedge — increment-11 self-inverts). The lens cuts itself
  // out of the matrix (increment-12 hole/notch).
  for (const { u, f } of plan) emitLensClosing(u, loneX, facingX, f, nextId, out)
  return true
}

/**
 * The facing column's matrix label at elevation ``e`` (the lithology enclosing the
 * stack). Picks the facing unit whose span contains ``e``; falls back to the nearest.
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
