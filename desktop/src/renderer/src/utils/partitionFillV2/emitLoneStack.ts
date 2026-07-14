/**
 * partitionFillV2/emitLoneStack.ts — the LONE MULTI-UNIT INTERBEDDED STACK matrix,
 * NOTCHED-COMB decomposition (design partition-engine-v2.md §4 increment-16; owner CS1
 * repros S7 gap18 / S6 gap19 / B6 gap2 / B4|S13 gap3 / S8 gap14).
 *
 * A lone interbedded stack (several units on one column with NO facing counterpart IN THE
 * INTERVAL) fills as v1 renders it: the enclosing MATRIX bands FULL-WIDTH to the facing
 * column's continuous matrix run, and each minority pinches at its OWN mid-elevation
 * (a ~0.45 lens) as a NOTCH into that band.
 *
 * The increment-15 WALL: the increment-13 code flooded the matrix as a converging WEDGE
 * from the lone column edge to the facing convergence point ``conv`` and let the minority
 * lenses notch into it. That traces as a NON-SIMPLE COMB — the ring interleaves the
 * 0.45-apex notch vertices with the single facing vertex ``conv`` and self-crosses; the
 * slicer resolves interior holes + repeated vertices, not proper crossings.
 *
 * Increment-16 fix — MECHANISM (b), per-sub-interval emission. The matrix does NOT
 * converge to a point: the notches bite the LONE column edge; the LEFT STRIP [loneX ..
 * apexX] (apexX = the notch apex line) is sliced into per-minority SLABS by
 *   - a HORIZONTAL seam at every minority's top/base (loneX -> apexX), and
 *   - a VERTICAL seam at apexX over the notched range,
 * so every minority notch closes into its OWN simple lens face (never merged into an
 * adjacent notch's comb), and the pure-matrix flood BEYOND the apex line stays one clean
 * face carrying no minority column vertical. All minorities in one stack pinch to a
 * SINGLE apex fraction (the stack-min clamped fraction) so the vertical apex seam aligns
 * with every notch apex — a small parity divergence from v1's per-lens fractions, far
 * smaller than the alternative (an adjacent minority painted the matrix colour).
 *
 * The seams carry the MATRIX flood label so a slab's residual-matrix pentagon (bounded by
 * seams + notch closings, with NO lone matrix vertical) is stamped matrix (finding-A
 * ``labelFaces`` trick).
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

/** The facing matrix run's [base..top] elevation span overlapping the lone span, or
 *  ``null`` when the facing column carries no ``matrixFid`` unit overlapping it (then the
 *  stack cannot band full-width and the caller falls back). */
function facingMatrixRunSpan(
  facing: ColumnGeom,
  matrixFid: string,
  loneTop: number,
  loneBase: number,
): { top: number; base: number } | null {
  let top = -Infinity
  let base = Infinity
  for (const u of facing.units) {
    if (u.formationId !== matrixFid) continue
    if (u.topElev <= loneBase + ELEV_EPS || u.baseElev >= loneTop - ELEV_EPS) continue
    if (u.topElev > top) top = u.topElev
    if (u.baseElev < base) base = u.baseElev
  }
  return top > base ? { top, base } : null
}

/**
 * Emit the slab-seam decomposition curves for a lone multi-unit interbedded stack
 * (mechanism (b), increment 16): a HORIZONTAL seam at every minority top/base, from the
 * lone column edge to the notch apex line. Together with the minority lens closings
 * (emitted by the caller at the SAME ``apexFrac``) they slice the notched left strip into
 * per-minority slabs so a minority enclosed BETWEEN two matrix runs closes into its own
 * simple lens face, and no matrix face absorbs an adjacent minority's column vertical.
 *
 * The seams stop AT the apex line (not the facing column) — a full-width seam would cross
 * the interval's converging surface/tie brackets (measured crossing on gap18). The matrix
 * beyond the apex line stays one clean flood face carrying no minority vertical.
 *
 * Parameters
 * ----------
 * matrix : LensLabel
 *     The enclosing matrix formation (labels the seam curves so a slab's residual-matrix
 *     pentagon, bounded by seams + notch closings with no lone matrix vertical, is stamped
 *     matrix — the finding-A ``labelFaces`` trick).
 * loneX, facingX : number
 * loneTop, loneBase : number
 *     The lone stack's own top / base elevations.
 * apexFrac : number
 *     The single apex fraction every minority pinches to (stack-min clamped fraction).
 * lenses : readonly IntervalUnit[]
 *     The minorities (their top/base elevations give the slab boundaries).
 * nextFloodId : () => string
 * labels : Map<string, LensLabel>
 * out : InputCurve[]
 */
function emitLoneStackBand(
  matrix: LensLabel,
  loneX: number,
  facingX: number,
  loneTop: number,
  loneBase: number,
  apexFrac: number,
  lenses: readonly IntervalUnit[],
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const apexX = loneX + apexFrac * (facingX - loneX)
  const push = (points: Point[]): void => {
    const id = nextFloodId()
    labels.set(id, matrix)
    out.push({ id, kind: 'closing', points })
  }
  const boundaries = new Set<number>()
  for (const l of lenses) {
    boundaries.add(l.topElev)
    boundaries.add(l.baseElev)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)
  for (const e of sorted) {
    if (e > loneTop - ELEV_EPS || e < loneBase + ELEV_EPS) continue
    push([{ x: loneX, y: e }, { x: apexX, y: e }])
  }
}

/** Below this apex fraction a minority is a BOUNDARY unit lapping the bracket in a narrow
 *  band — v1 shapes it as an onlap, not a heavily-truncated lens; the lone-stack path bows
 *  out so the caller keeps the full-width fallback. */
const MIN_CLAMPED_FRACTION = 0.3

/**
 * The apex FRACTION for a minority lens, clamped to stay INSIDE the full-width band. A
 * minority whose own mid-elevation sits above the band top contour or below the base
 * contour near an edge would pinch past a band boundary; the fraction is reduced so the
 * apex point stays on the matrix side of BOTH band edges (v1 shortens such a
 * boundary-adjacent lens too). Returns ``<= LENS_PINCH_FRACTION``.
 */
function clampedLensFraction(
  u: IntervalUnit,
  loneTopElev: number,
  loneBaseElev: number,
  facingTop: number,
  facingBase: number,
): number {
  const apexElev = (u.topElev + u.baseElev) / 2
  const upperAt = (f: number): number => loneTopElev + f * (facingTop - loneTopElev)
  const lowerAt = (f: number): number => loneBaseElev + f * (facingBase - loneBaseElev)
  let f = LENS_PINCH_FRACTION
  const MARGIN = 1e-3
  while (f > 0.02 && (apexElev > upperAt(f) - MARGIN || apexElev < lowerAt(f) + MARGIN)) {
    f -= 0.02
  }
  return f
}

/**
 * Route + emit a LONE MULTI-UNIT INTERBEDDED STACK interval (increment 13/16). Returns
 * ``true`` when handled (the caller skips the ordinary tiling), ``false`` to fall through
 * to the single-unit lone-pinch / full-width paths.
 *
 * The enclosing matrix formation is the facing lithology at the interval's convergence
 * point (v1's ``belowLith ?? aboveLith``). It bands FULL-WIDTH to the facing matrix run;
 * every non-matrix unit pinches as an own-elevation lens notch, all sharing ONE apex
 * fraction so the slab-seam decomposition keeps every notch a simple face.
 *
 * Parameters
 * ----------
 * loneMatrix : readonly IntervalUnit[]
 *     The lone side's interval units (>1 — the single-unit case is the caller's).
 * facing : ColumnGeom
 *     The facing column (its convergence-point lithology names the matrix; its matrix run
 *     confirms the full-width band reach).
 * loneSide : 'left' | 'right'
 * loneX, facingX : number
 * top, base : LonePinchBracket
 *     The interval brackets (lone-side elevations define the band).
 * preLenses : IntervalUnit[]
 * nextId, nextFloodId : () => string
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

  // The facing matrix must span the lone stack CONTINUOUSLY to band full-width — if the
  // facing carries no matrix run overlapping the interval, this is a genuine data void,
  // not a lateral band: fall back to the caller's full-width tiling.
  const facingSpan = facingMatrixRunSpan(facing, bracketMatrix.formationId, iTop, iBase)
  if (facingSpan === null) return false
  const clamp = (e: number): number => Math.min(facingSpan.top, Math.max(facingSpan.base, e))
  const facingTopEdge = clamp(iTop)
  const facingBaseEdge = clamp(iBase)

  // Per-minority clamped apex fraction. If ANY needs clamping below MIN_CLAMPED_FRACTION
  // the stack is a BOUNDARY-minority case in a narrow band (v1 shapes it as an onlap
  // lapping the bracket): bow out to the caller's full-width fallback rather than emit a
  // divergent near-zero-apex lens (B4|S13 gap3's top SILT). Nothing has been pushed to
  // ``out`` yet, so returning false is clean.
  const plan: { u: IntervalUnit; f: number }[] = []
  for (const u of [...stackLenses, ...preLenses]) {
    const f = clampedLensFraction(u, iTop, iBase, facingTopEdge, facingBaseEdge)
    if (f < MIN_CLAMPED_FRACTION) return false
    plan.push({ u, f })
  }
  // A single stack-wide apex fraction (the tightest clamp) so every notch apex lands on
  // ONE vertical line — the slab decomposition's vertical apex seam then meets each notch
  // only at its apex vertex (simple by construction).
  const apexFrac = plan.reduce((m, p) => Math.min(m, p.f), LENS_PINCH_FRACTION)

  // Slab-seam decomposition of the matrix band (mechanism (b) — no converging wedge, so
  // no comb; horizontal seams separate a minority enclosed between two matrix runs).
  emitLoneStackBand(bracketMatrix, loneX, facingX, iTop, iBase, apexFrac, plan.map((p) => p.u), nextFloodId, lensLabels, out)
  // Every minority pinches to the shared apex fraction as a notch biting the lone column
  // edge (NOT a shared-apex WEDGE — increment-11 self-inverts; here each keeps its OWN
  // mid-elevation, only the fraction is shared).
  for (const { u } of plan) emitLensClosing(u, loneX, facingX, apexFrac, nextId, out)
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
