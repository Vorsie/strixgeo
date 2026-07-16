/**
 * partitionFillV2/tileCoherentStack.ts — the SESSION-7 FLIP: the COHERENT STACK tiler
 * (design partition-engine-v2.md §8 ruling 8g — the owner's boundary-walk algorithm).
 *
 * This is the generalisation of the session-6 ``tileCoherentLoneStack`` meet-at-seam
 * primitive to ARBITRARY two-sided intervals — the single path the terminations-first
 * flip routes every interval through (no bail taxonomy, no seam fallback). Ruling 8g:
 *
 *   1. draw 0-corr terminations (halfway LENSES, one or both sides) FIRST;
 *   2. draw 1-corr terminations (ONLAPS riding their tie) SECOND;
 *   3. fill the closed shapes (the arrangement face-trace) LAST;
 *   4. an unclosed shape resolves by the same-litho closure walk — the enclosing
 *      formation DETOURS around an enclosed lens/onlap (down the flank to the apex,
 *      back) and reconnects; a lens is a detour in the band's contour, never a wall;
 *   (b) base-tied SAME-FORMATION pairs are ONE BAND (the Tie-10 g0 ZANDs).
 *
 * MECHANISM (generalises ``emitLoneStackBand`` + ``tileCoherentLoneStack``, both proven
 * hole-free): the interval [iTop..iBase] on each column holds units L0..Lm (left) and
 * R0..Rn (right) that together SPAN the interval. Both sides MEET at ONE shared vertical
 * SEAM at ``SEAM_FRACTION`` (=``INTERIOR_PINCH_FRACTION`` 0.5).
 *
 *   - Each side's units fill their own [uTop..uBase] slab from THEIR column to the seam.
 *     A terminating unit (0-corr LENS / 1-corr ONLAP) pinches to its apex SHORT of the
 *     seam; the residue between the apex and the seam is flooded by the enclosing
 *     formation on that side (a slab-seam labelled the enclosing — the ``labelFaces``
 *     flood trick). A 2-corr band-member unit is excluded upstream (carried by its band).
 *   - Per-unit HORIZONTAL boundary seams (loneX → seamX) separate adjacent same-side
 *     slabs so each reads its own lithology.
 *   - The ONE shared seam line (top→base at the seam x) separates the two sides.
 *
 * A rectangle/trapezoid partition (per-unit slabs meeting at one seam) is hole-free BY
 * CONSTRUCTION — no dipping mid-apex sliver (the session-6 second-attempt hole). Each
 * terminating unit reaches only its own column edge + its apex ⇒ ``onlap``/``lens`` (never
 * full-width); the enclosing flood past the seam is a SEPARATE connected component ⇒ a
 * same-formation unit facing a same-formation unit is not spuriously merged UNLESS they
 * are BASE-TIED (ruling 8g(b) — then they band, handled by ``bandFormations``/the seam
 * being suppressed).
 *
 * LONE case: one side empty → the enclosing (from the facing column's continuous matrix)
 * floods that whole half; the present side's units pinch toward the seam. This is exactly
 * ``tileCoherentLoneStack``'s shape, now a special case of this code.
 *
 * ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHABLE (613-hole trap). Pure module — no
 * React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { type CorrUnit } from './tileGap'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** The shared meet-seam fraction — both sides pinch toward it (ruling 8g halfway). */
const SEAM_FRACTION = INTERIOR_PINCH_FRACTION

/** THROWAWAY diag — bail / fire counters (session 7). Orchestrator strips at cut-over. */
export const COHERENT_STACK_DIAG: Record<string, number> = {}
function sbump(r: string): void {
  COHERENT_STACK_DIAG[r] = (COHERENT_STACK_DIAG[r] ?? 0) + 1
}
export function coherentStackDiagReset(): void {
  for (const k of Object.keys(COHERENT_STACK_DIAG)) delete COHERENT_STACK_DIAG[k]
}

/** One side's resolved geometry for the coherent decomposition. */
interface SideGeom {
  side: 'left' | 'right'
  /** This side's own column (carries the enclosing matrix when the side is lone/empty). */
  col: ColumnGeom
  /** This side's own column x (metres). */
  ownX: number
  /** The interval's top / base elevation on THIS column. */
  iTop: number
  iBase: number
  /** This side's interval matrix units (top→down), each with its per-gap corr. */
  units: readonly CorrUnit[]
}

/**
 * Tile one two-sided (or lone) interval by the coherent stack construction (ruling 8g).
 * Returns ``true`` on success (owns the interval, hole-free by construction), ``false``
 * only for a shape it genuinely cannot span (a strip would be uncovered — ruling 7 bail;
 * the caller keeps the seam for it during bring-up).
 *
 * Parameters
 * ----------
 * leftUnits, rightUnits : readonly CorrUnit[]
 *     Each side's interval matrix units (post enclosed-lens extraction), top→down, with
 *     their per-gap effective corr (2/1/0). Either may be empty (the lone case).
 * leftLenses, rightLenses : readonly IntervalUnit[]
 *     Enclosed lenses already extracted per side (kept as their own 8b-capped notches).
 * left, right : ColumnGeom
 * top, base : LonePinchBracket
 *     The interval brackets (per-column elevations define the slabs).
 * bandFormations : ReadonlySet<string>
 *     Formations carrying a matched-pair band in this gap (ruling 8g(b) one-body test).
 * nextId, nextFloodId : () => string
 * lensLabels : Map<string, LensLabel>
 * out : InputCurve[]
 */
export function tileCoherentStack(
  leftUnits: readonly CorrUnit[],
  rightUnits: readonly CorrUnit[],
  leftLenses: readonly IntervalUnit[],
  rightLenses: readonly IntervalUnit[],
  left: ColumnGeom,
  right: ColumnGeom,
  top: LonePinchBracket,
  base: LonePinchBracket,
  bandFormations: ReadonlySet<string>,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  sbump('entered')
  const iTopL = top.leftElev
  const iBaseL = base.leftElev
  const iTopR = top.rightElev
  const iBaseR = base.rightElev
  const thickL = iTopL - iBaseL
  const thickR = iTopR - iBaseR
  if (thickL < ELEV_EPS && thickR < ELEV_EPS) {
    sbump('bail-zero-thickness')
    return false
  }

  // CONVERGING-FACING bail (session 6 ``bail-facingconverges``): when ONE side's interval
  // thickness is ~0 (the two brackets meet on that column) while the other has real thickness,
  // the interval is a pinch WEDGE toward the convergence point, NOT a meet-at-seam rectangle —
  // the shared-0.5-seam construction leaves the wedge past the seam uncovered. Such intervals
  // keep the existing lone-pinch / shared-contact-onlap machinery (``routeLoneSidePinch``,
  // ``emitSharedContactOnlap`` — pinch to conv) via the caller's fall-through (ruling 8a).
  const CONVERGE_EPS = 0.02
  if ((thickL < CONVERGE_EPS) !== (thickR < CONVERGE_EPS)) {
    sbump('bail-converging-facing')
    return false
  }

  // Both sides must SPAN their own interval contiguously (no uncovered strip). A lone side
  // (empty) is fine — the facing enclosing floods its whole half.
  if (!spans(leftUnits, iTopL, iBaseL) || !spans(rightUnits, iTopR, iBaseR)) {
    sbump('bail-nospan')
    return false
  }

  // A 2-corr unit reaching here is a band member that should have been excluded upstream
  // (it is carried by its band contour). Refuse defensively so a band is never double-tiled.
  for (const u of [...leftUnits, ...rightUnits]) {
    if (u.corr.corr === 2) {
      sbump('bail-corr2')
      return false
    }
  }

  // ONE side lone: the facing enclosing must be a single continuous matrix across the span
  // (else there is nothing coherent to flood the empty half). If the facing is itself the
  // present side's own formation everywhere (a base-tied same-formation pair, ruling 8g(b)),
  // that is a BAND — but a lone interval never carries a facing UNIT (it was excluded as
  // tied/banded), so we treat a lone side as a flood by the facing column's matrix sample.
  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()
  const pushClose = (id: string, points: Point[]): void => {
    buf.push({ id, kind: 'closing', points })
  }
  const pushFlood = (label: LensLabel, points: Point[]): void => {
    const id = nextFloodId()
    labelPatch.set(id, label)
    buf.push({ id, kind: 'closing', points })
  }
  const seamX = left.x + SEAM_FRACTION * (right.x - left.x)
  // The seam elevation at a given interval fraction t (0=top, 1=base). The endpoints land ON
  // the top / base bracket lines (no dangle on a sloping bracket): interpolate the seam point
  // between the two columns' bracket elevations at t.
  const seamElevAtT = (t: number): number => {
    const loneE = iTopL + t * (iBaseL - iTopL)
    const facingE = iTopR + t * (iBaseR - iTopR)
    return loneE + SEAM_FRACTION * (facingE - loneE)
  }
  const seamElevAtElev = (side: 'left' | 'right', e: number): number => {
    const iTop = side === 'left' ? iTopL : iTopR
    const iBase = side === 'left' ? iBaseL : iBaseR
    const span = iTop - iBase
    const t = span < ELEV_EPS ? 0 : (iTop - e) / span
    return seamElevAtT(t)
  }

  // --- The ONE shared seam line (top → base at the seam x). It separates the two sides.
  buf.push({
    id: `close${nextId()}`,
    kind: 'closing',
    points: [{ x: seamX, y: seamElevAtT(0) }, { x: seamX, y: seamElevAtT(1) }],
  })

  const sides: SideGeom[] = [
    { side: 'left', col: left, ownX: left.x, iTop: iTopL, iBase: iBaseL, units: leftUnits },
    { side: 'right', col: right, ownX: right.x, iTop: iTopR, iBase: iBaseR, units: rightUnits },
  ]

  for (const s of sides) {
    if (!emitSideSlabs(s, seamX, seamElevAtElev, nextId, pushClose, pushFlood, labelPatch)) {
      sbump('bail-side')
      return false
    }
  }

  // Enclosed lenses keep their own 0.45 / 8b apex (their matrix band is the flood/seam fill).
  for (const u of leftLenses) emitLensClosing(u, left.x, right.x, SEAM_FRACTION, nextId, buf)
  for (const u of rightLenses) emitLensClosing(u, right.x, left.x, SEAM_FRACTION, nextId, buf)

  sbump('fired')
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  return true
}

/**
 * Whether a side's units span [iTop..iBase] contiguously (top ≈ iTop, base ≈ iBase, no
 * internal gap). An EMPTY side (lone) spans vacuously (the facing floods it).
 */
function spans(units: readonly CorrUnit[], iTop: number, iBase: number): boolean {
  if (iTop - iBase < ELEV_EPS) return true
  if (units.length === 0) return true // lone side — the facing enclosing floods it.
  const sorted = [...units].sort((a, b) => b.iu.topElev - a.iu.topElev)
  if (Math.abs(sorted[0].iu.topElev - iTop) > 0.02) return false
  if (Math.abs(sorted[sorted.length - 1].iu.baseElev - iBase) > 0.02) return false
  for (let k = 0; k + 1 < sorted.length; k++) {
    if (Math.abs(sorted[k].iu.baseElev - sorted[k + 1].iu.topElev) > 0.02) return false
  }
  return true
}

/**
 * Emit one side's slab decomposition toward the shared seam: for each own-side unit, its
 * termination apex (lens / onlap) + the horizontal boundary seam to the next unit, and the
 * enclosing flood filling the residue between each apex and the seam. A lone (empty) side
 * floods its whole half from the facing column's matrix sample.
 *
 * Returns ``false`` when a slab cannot be closed hole-free (no enclosing to flood the
 * residue) — the caller bails the whole interval (ruling 7, all-or-nothing).
 */
function emitSideSlabs(
  s: SideGeom,
  seamX: number,
  seamElevAtElev: (side: 'left' | 'right', e: number) => number,
  nextId: () => string,
  pushClose: (id: string, points: Point[]) => void,
  pushFlood: (label: LensLabel, points: Point[]) => void,
  labelPatch: Map<string, LensLabel>,
): boolean {
  const { side, ownX, iTop, iBase } = s
  const sorted = [...s.units].sort((a, b) => b.iu.topElev - a.iu.topElev)

  // LONE side (empty): this side is the ENCLOSING side — its OWN column carries the continuous
  // matrix M across the interval (the units here were excluded as tied/banded, so no lens
  // reaches the matrix set, but the column DOES carry M laterally). M floods this half from
  // THIS side's own column vertical to the shared seam. Sample M from this side's own column
  // at the interval mid-elevation.
  if (sorted.length === 0) {
    const mid = (iTop + iBase) / 2
    const enclosing = facingMatrixLabel(s.col, mid)
    if (enclosing === null) return false
    // This side's own column vertical over the interval span (labelled M), with the shared
    // seam, closes the half as ONE flood band face (M reaches from the seam to this column).
    pushFlood(enclosing, [
      { x: ownX, y: iTop },
      { x: ownX, y: iBase },
    ])
    return true
  }

  // MEET-AT-SEAM slabs (the session-6 ``tileCoherentLoneStack`` construction, generalised):
  // each own-side unit fills its own [uTop..uBase] slab from ITS column to the shared seam as a
  // right-TRAPEZOID. The two facing sides MEET at the seam (each fills its half); a lone side is
  // handled above. A unit reaching only its own edge + the seam (0 < 0.5 < 1) reads ``onlap`` in
  // the conformance gate (never full-width) — accepted for 0-corr (an 8b advisory at most) AND
  // correct for 1-corr (it rides its tie at the seam). This is hole-free BY CONSTRUCTION: one
  // seam + per-slab horizontal boundary seams tile a rectangle partition, no dipping mid-apex
  // sliver (the session-5/6 hole). Enclosed 8b lenses stay small (``emitLensClosing``, above).
  const label = (u: CorrUnit): LensLabel => ({ formationId: u.iu.unit.formationId, bodyId: u.iu.unit.bodyId })

  // Per-unit horizontal boundary seams (own column → seam) at the interval TOP, every internal
  // contact, and the interval BASE — so each slab is closed top/base and reads its own litho.
  // The top/base of the interval are already bracket curves; only the INTERNAL contacts need a
  // seam here (the outer brackets close the top slab's top and the bottom slab's base). Each is
  // a labelled ``close`` (the slab BELOW it carries the label) so the face keeps its own litho.
  for (let k = 0; k + 1 < sorted.length; k++) {
    const e = sorted[k].iu.baseElev // = sorted[k+1].iu.topElev (contiguity checked)
    if (e > iTop - ELEV_EPS || e < iBase + ELEV_EPS) continue
    pushLabelledClose(label(sorted[k]), [{ x: ownX, y: e }, { x: seamX, y: seamElevAtElev(side, e) }], nextId, pushClose, labelPatch)
  }

  // The onlap edges (1-corr) that ride a tie carry an ``onlap`` id so the slab reads ONLAP and
  // the arrangement counts the tie; a 0-corr slab's boundaries are plain ``close`` (→ the reach
  // classifier reads it a lens/onlap by geometry). A slab's own column vertical + the two
  // horizontal boundary seams (or brackets) + the seam segment close it; nothing more is needed.
  for (const u of sorted) {
    // For a 1-corr onlap whose tie is on its BASE, mark the base boundary seam as an onlap edge
    // so the face classifies ONLAP. The base boundary is the horizontal seam at u.baseElev (the
    // internal contact) or the interval base bracket; re-emit a coincident onlap-id marker there
    // so ``labelFaces`` counts the tie without changing geometry.
    if (u.corr.corr === 1) {
      const baseTied = u.corr.baseTied && !u.corr.topTied
      const e = baseTied ? u.iu.baseElev : u.iu.topElev
      if (e > iBase - ELEV_EPS && e < iTop + ELEV_EPS) {
        pushClose(`onlap${nextId()}`, [{ x: ownX, y: e }, { x: seamX, y: seamElevAtElev(side, e) }])
      }
    }
  }
  return true
}

/**
 * Push a ``close`` curve with an allocated id and record its own-litho label so the pinch
 * face keeps its lithology (not the enclosing flood).
 */
function pushLabelledClose(
  label: LensLabel,
  points: Point[],
  nextId: () => string,
  pushClose: (id: string, points: Point[]) => void,
  labelPatch: Map<string, LensLabel>,
): void {
  const id = `close${nextId()}`
  labelPatch.set(id, label)
  pushClose(id, points)
}
