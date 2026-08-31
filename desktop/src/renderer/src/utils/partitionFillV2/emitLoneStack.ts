/**
 * partitionFillV2/emitLoneStack.ts â€” the LONE MULTI-UNIT INTERBEDDED STACK matrix,
 * NOTCHED-COMB decomposition (design partition-engine-v2.md Â§4 increment-16; owner CS1
 * repros S7 gap18 / S6 gap19 / B6 gap2 / B4|S13 gap3 / S8 gap14).
 *
 * A lone interbedded stack (several units on one column with NO facing counterpart IN THE
 * INTERVAL) fills as v1 renders it: the enclosing MATRIX bands FULL-WIDTH to the facing
 * column's continuous matrix run, and each minority pinches at its OWN mid-elevation
 * (a ~0.45 lens) as a NOTCH into that band.
 *
 * The increment-15 WALL: the increment-13 code flooded the matrix as a converging WEDGE
 * from the lone column edge to the facing convergence point ``conv`` and let the minority
 * lenses notch into it. That traces as a NON-SIMPLE COMB â€” the ring interleaves the
 * 0.45-apex notch vertices with the single facing vertex ``conv`` and self-crosses; the
 * slicer resolves interior holes + repeated vertices, not proper crossings.
 *
 * Increment-16 fix â€” MECHANISM (b), per-sub-interval emission. The matrix does NOT
 * converge to a point: the notches bite the LONE column edge; the LEFT STRIP [loneX ..
 * apexX] (apexX = the notch apex line) is sliced into per-minority SLABS by
 *   - a HORIZONTAL seam at every minority's top/base (loneX -> apexX), and
 *   - a VERTICAL seam at apexX over the notched range,
 * so every minority notch closes into its OWN simple lens face (never merged into an
 * adjacent notch's comb), and the pure-matrix flood BEYOND the apex line stays one clean
 * face carrying no minority column vertical. All minorities in one stack pinch to a
 * SINGLE apex fraction (the stack-min clamped fraction) so the vertical apex seam aligns
 * with every notch apex â€” a small parity divergence from v1's per-lens fractions, far
 * smaller than the alternative (an adjacent minority painted the matrix colour).
 *
 * The seams carry the MATRIX flood label so a slab's residual-matrix pentagon (bounded by
 * seams + notch closings, with NO lone matrix vertical) is stamped matrix (finding-A
 * ``labelFaces`` trick).
 *
 * Pure module â€” no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../sectionPartition'
import { lensReachFraction } from './lensReach'
import { emitLensClosing, extractLoneStackLenses, type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { enclosingMatrixOfInterval, facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { emitConvergingStack } from './tileConvergingStack'
import { type ConvergingSide } from './tileCoherentStackTypes'
import { type CorrUnit } from './tileCoherentStackTypes'
import { type EffectiveCorr } from './effectiveCorr'
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
 * The seams stop AT the apex line (not the facing column) â€” a full-width seam would cross
 * the interval's converging surface/tie brackets (measured crossing on gap18). The matrix
 * beyond the apex line stays one clean flood face carrying no minority vertical.
 *
 * Parameters
 * ----------
 * matrix : LensLabel
 *     The enclosing matrix formation (labels the seam curves so a slab's residual-matrix
 *     pentagon, bounded by seams + notch closings with no lone matrix vertical, is stamped
 *     matrix â€” the finding-A ``labelFaces`` trick).
 * loneX, facingX : number
 * loneTop, loneBase : number
 *     The lone stack's own top / base elevations.
 * plan : readonly { u: IntervalUnit; f: number }[]
 *     The minorities + their clamped apex fractions. The slab seams stop at the stack-min apex
 *     x (``apexFrac``) so they align with every notch apex; the minorities' top/base elevations
 *     give the slab boundaries.
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
  plan: readonly { u: IntervalUnit; f: number }[],
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const apexFrac = plan.reduce((m, p) => Math.min(m, p.f), LENS_PINCH_FRACTION)
  const apexX = loneX + apexFrac * (facingX - loneX)
  const push = (points: Point[]): void => {
    const id = nextFloodId()
    labels.set(id, matrix)
    out.push({ id, kind: 'closing', points })
  }
  const boundaries = new Set<number>()
  for (const { u } of plan) {
    boundaries.add(u.topElev)
    boundaries.add(u.baseElev)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)
  for (const e of sorted) {
    if (e > loneTop - ELEV_EPS || e < loneBase + ELEV_EPS) continue
    push([{ x: loneX, y: e }, { x: apexX, y: e }])
  }
}

/** Below this apex fraction a minority is a BOUNDARY unit lapping the bracket in a narrow
 *  band â€” v1 shapes it as an onlap, not a heavily-truncated lens; the lone-stack path bows
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
 *     The lone side's interval units (>1 â€” the single-unit case is the caller's).
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
  loneCol: ColumnGeom,
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
  const iTop = loneSide === 'left' ? top.leftElev : top.rightElev
  const iBase = loneSide === 'left' ? base.leftElev : base.rightElev
  // ENCLOSING-MATRIX correction (SURGICAL â€” fires only on the failure case, so the ~32 already-OK
  // routeLoneStack cases are byte-identical). ``facingMatrixLabel(convElev)`` is the normal enclosing
  // matrix sample, but at a ZERO-THICKNESS facing bracket (the interval sits on a CONTACT of the
  // facing column â€” both bracket lines meet at ``conv``) that sample lands on the contact and returns
  // whichever facing unit the loop hits FIRST, NOT the lithology that encloses the lone stack (Tie-6
  // gap0: conv on the facing ZAND/KLEI contact â†’ returns ZAND, not the enclosing KLEI â†’ the stack
  // can't reduce â†’ bail â†’ SILT floods full-width, a ruling-8 violation). ONLY when the bracket is
  // zero-thickness AND the sampled facing matrix is NOT a stack formation (the mis-sample signature)
  // do we override with the lone column's OWN bracket adjacency (v1's ``belowLith ?? aboveLith``).
  const stackFids = new Set(loneMatrix.map((u) => u.unit.formationId))
  const facingSample = facingMatrixLabel(facing, convElev)
  const bracketZeroThick = Math.abs(facingTopElev - facingBaseElev) < ELEV_EPS

  // CONVERGING-FACING MINORITY-STACK FALLBACK (session 12, TARGET A â€” CS1 col18 gap18 SILT+VEEN).
  // When the facing bracket CONVERGES to a point (a tied band that pinches, not a lateral matrix
  // run), the ordinary reduce path below bails at ``facingMatrixRunSpan`` â€” the enclosing matrix
  // (KLEI here) has NO facing run to band full-width to (col19 carries ZAND, not KLEI, across the
  // minority span) â€” so the seam tiled the SILT/VEEN minorities FULL-WIDTH (close50/close51). The
  // correct shape (ruling 8h phases 1-2): each 0-corr minority gets its OWN 8b lens hugging its
  // column, the own-column bracket enclosing floods around them to ``conv``. ``emitConvergingStack``
  // (session 10/11) closes exactly this hole-free (own-bracket enclosing + ``fitLensReach`` halving).
  // It is tried ONLY on the CONVERGING case AND ONLY AS A FALLBACK after the ordinary reduce+band
  // path bails, so every case that reduce currently handles stays byte-identical (the ~32 OK cases);
  // ``emitConvergingStack`` has its own guards (no-bracket / all-matrix / interleaved / facing-
  // carries-minority / true same-formation-annulus) and bails cleanly when it cannot close a shape.
  const tryConvergingStack = (): boolean => {
    if (!bracketZeroThick) return false
    // ``emitConvergingStack`` reads its enclosing from ``ownColumnBracket(iTop/iBase)`` where iTop = ``ownColumnBracket(iTop/iBase)`` where iTop =
    // the passed stack's first unit top, iBase = its last unit base. A stack whose TOP or BASE unit
    // is itself the ENCLOSING matrix (CS1 col18: SILT, VEEN, then KLEI[u6] as the below-enclosing at
    // the TD) sets iBase to the matrix's base â€” which sits at the TD with no unit below it â†’
    // ``ownColumnBracket`` returns null â†’ ``bail-no-bracket``. TRIM leading/trailing units that ARE an
    // own-column enclosing formation so the passed run is the pure MINORITY run: then iTop/iBase land
    // on the minority run's own contacts, whose adjacent units ARE the enclosing (KLEI u3 above at
    // 6.03, KLEI u6 below at 5.05), and ``ownColumnBracket`` resolves. The trimmed matrix units are
    // covered by ``emitConvergingStack``'s own-column flood (their column vertical reads matrix).
    const enclAdj = new Set<string>()
    for (const u of loneCol.units) {
      if (Math.abs(u.baseElev - iTop) <= ELEV_EPS + 1e-3) enclAdj.add(u.formationId) // unit above the interval
      if (Math.abs(u.topElev - iBase) <= ELEV_EPS + 1e-3) enclAdj.add(u.formationId) // unit below the interval
    }
    // Also treat a stack END unit that duplicates an adjacent enclosing formation as matrix (KLEI u6).
    let lo = 0
    let hi = loneMatrix.length - 1
    while (lo <= hi && enclAdj.has(loneMatrix[lo].unit.formationId)) lo++
    while (hi >= lo && enclAdj.has(loneMatrix[hi].unit.formationId)) hi--
    const run = loneMatrix.slice(lo, hi + 1)
    if (run.length === 0) return false // the whole stack is enclosing matrix â€” nothing to lens
    const conv: ConvergingSide = { col: loneCol, ownX: loneX, facing, facingX, facingTop: facingTopElev, facingBase: facingBaseElev }
    // ``emitConvergingStack`` consumes only ``cu.iu`` (never ``cu.corr``) â€” a placeholder corr is safe.
    const dummyCorr: EffectiveCorr = { topTied: false, baseTied: false, corr: 0, topTie: null, baseTie: null }
    const sorted: CorrUnit[] = run.map((iu, i) => ({ iu, corr: dummyCorr, colUnitIndex: i }))
    return emitConvergingStack(conv, sorted, nextId, nextFloodId, lensLabels, out)
  }

  const misSample = facingSample !== null && !stackFids.has(facingSample.formationId)
  const correctedMatrix = bracketZeroThick && misSample ? enclosingMatrixOfInterval(loneCol, stackFids, iTop, iBase) : null
  const bracketMatrix = correctedMatrix ?? facingSample
  if (bracketMatrix === null) return tryConvergingStack()
  const stackLenses: IntervalUnit[] = []
  const reduced = extractLoneStackLenses([...loneMatrix], bracketMatrix.formationId, stackLenses)
  if (reduced === null) return tryConvergingStack()

  // The facing matrix must span the lone stack CONTINUOUSLY to band full-width â€” if the
  // facing carries no matrix run overlapping the interval, this is a genuine data void,
  // not a lateral band: fall back to the caller's full-width tiling.
  const facingSpan = facingMatrixRunSpan(facing, bracketMatrix.formationId, iTop, iBase)
  // The enclosing matrix has NO facing run to band full-width to. Ordinarily a data void
  // (keep the full-width tiling). BUT a CONVERGING facing (a tied band pinching to a point over
  // the minority span â€” CS1 col18 SILT/VEEN) is NOT a void: the minorities lens toward the
  // convergence with the own-column enclosing flooding around them (``emitConvergingStack``,
  // session 12 TARGET A). Try it as the fallback; a non-converging genuine void still returns false.
  if (facingSpan === null) return tryConvergingStack()
  // Lens-apex clamp band edges. The DEFAULT (all pre-existing cases) rides the facing-matrix RUN edge
  // (``clamp``). ONLY the enclosing-matrix-corrected case uses the true INTERVAL bracket elevations
  // (the sloping tie lines iTop/iBase â†’ facingTopElev/facingBaseElev): there the run edge is flat at
  // iBase and would let a base-boundary lens apex poke BELOW the sloping base bracket (the Tie-6 SILT
  // 15.9 cm / CS1-g5 33.8 cm flood-bypass overlap â€” the base bracket rises to âˆ’3.88 on the facing
  // while the run edge reads âˆ’5.31). Gating this to the corrected case keeps the 32 OK cases unmoved.
  const clamp = (e: number): number => Math.min(facingSpan.top, Math.max(facingSpan.base, e))
  const facingTopEdge = correctedMatrix ? facingTopElev : clamp(iTop)
  const facingBaseEdge = correctedMatrix ? facingBaseElev : clamp(iBase)

  // Per-minority clamped apex fraction. If ANY needs clamping below MIN_CLAMPED_FRACTION
  // the stack is a BOUNDARY-minority case in a narrow band (v1 shapes it as an onlap
  // lapping the bracket): bow out to the caller's full-width fallback rather than emit a
  // divergent near-zero-apex lens (B4|S13 gap3's top SILT). Nothing has been pushed to
  // ``out`` yet, so returning false is clean.
  const plan: { u: IntervalUnit; f: number }[] = []
  for (const u of [...stackLenses, ...preLenses]) {
    // Band-clip fraction FIRST (v1's boundary-adjacent shortening): keeps the apex on the
    // matrix side of both band edges. The MIN_CLAMPED_FRACTION bail is a band-clip guard
    // (a boundary minority in a narrow band bows out to full-width); the ruling-8b reach
    // cap is NOT that guard and must not trip it â€” so the bail is tested on the band-clip
    // value BEFORE the 8b cap is applied.
    const clipF = clampedLensFraction(u, iTop, iBase, facingTopEdge, facingBaseEdge)
    if (clipF < MIN_CLAMPED_FRACTION) return false
    // Ruling 8b (design partition-engine-v2.md Â§8): tighten the apex to ~2Ã— the unit's own
    // thickness (a thin minority hugs its column). Applied to the plan so BOTH the flood
    // slab-seams (emitLoneStackBand) and the lens closings use the SAME fraction â€” a
    // mismatch would leave the slab-seam past the shortened lens apex.
    const f = Math.min(clipF, lensReachFraction(u.topElev - u.baseElev, facingX - loneX))
    plan.push({ u, f })
  }
  // Slab-seam decomposition of the matrix band (mechanism (b) â€” no converging wedge, so no
  // comb; horizontal seams at each minority top/base separate a minority enclosed between two
  // matrix runs). Each minority PINCHES to its OWN clamped apex fraction (v1's per-unit 0.45/
  // 0.38 apexes â€” restored in increment 17 now that residual-(i)'s per-sub-loop curve-id
  // labelling separates adjacent notches without a shared apex line).
  emitLoneStackBand(bracketMatrix, loneX, facingX, iTop, iBase, plan, nextFloodId, lensLabels, out)
  // Every minority pinches to its OWN clamped apex fraction as a notch biting the lone
  // column edge (NOT a shared-apex WEDGE â€” increment-11 self-inverts; each keeps its own
  // mid-elevation AND its own fraction).
  for (const { u, f } of plan) emitLensClosing(u, loneX, facingX, f, nextId, out)
  return true
}

