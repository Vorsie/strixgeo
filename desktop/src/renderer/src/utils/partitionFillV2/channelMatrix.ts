/**
 * partitionFillV2/channelMatrix.ts — THE CHANNEL MATRIX OWNS THE VACANCY
 * (owner rulings, 2026-08-18).
 *
 * THE OWNER'S TWO SCENES. On his CS1 he found the same thing twice:
 *
 *   - S7A|S7. A 0.38 m denser silt with ZERO ties painted the whole 1 m channel
 *     between his silt-top tie and the two silt bases. His words: *"the silt is
 *     tied with a top tie — follow the tie, same silt same class, no onlap"*
 *     and *"it should cleanly onlap"* — the bases keep their own level, the
 *     channel stays the matrix.
 *   - S7|S6. A 0.41 m loose sand crust at the far end of a clay-base tie
 *     ballooned into a 2.8 m flood over the dense sand masses beneath it — "a
 *     very dense sand appearing out of nowhere". His ruling: *"i would prolly
 *     just extrapolate the md dense sand to the tie and let it fill all."*
 *
 * ONE MECHANISM BEHIND BOTH. When the units of a tie-bounded channel terminate
 * (pinch / onlap / lens), the arrangement leaves ONE enclosing-flood face
 * covering the width they vacated. The seed rule (SEED_FILL_MANDATE §B) paints
 * that face from the single ``col<ci>:u<ui>`` edge still touching it — and after
 * the terminations that surviving edge can be a sliver of a very thin band,
 * because the thick masses cut their own edges away with their pinch flanks. So
 * a 0.38 m band paints a 1 m channel, and a 0.41 m crust paints 2.8 m.
 *
 * THE RULE. A face that OTHER units pinched out of is the channel's enclosing
 * flood, not the sliver's own band. Its lithology is the channel's DOMINANT
 * mass: the unit of its own column that actually occupies the face's elevation
 * window. This restores, at the labelling layer, the owner's 8f intent ("fill
 * the void with the dominant lithology between correlations") that ruling
 * 8i(e) removed from the EMISSION layer — 8i(e) is untouched, every unit still
 * terminates unconditionally; only who inherits the vacated width changes.
 *
 * SELF-LIMITING BY CONSTRUCTION. When the surviving seed IS the dominant mass —
 * the ordinary case, e.g. a thick clay matrix that thin interbeds lensed out of —
 * the dominant lookup returns that same unit and nothing changes. The rule can
 * only ever move paint from a band that does NOT occupy the window to the band
 * that does, and it never reaches across to the facing column (the round-1
 * "never read across a tie" lesson): the answer always comes from ONE drilled
 * column.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { type Face, SNAP_GRID_M } from './types'

/**
 * Curve-id prefixes of a unit's OWN termination flank — the lines the TERMINATION SWEEP draws
 * as a unit pinches or onlaps out of a gap (``emitLensClosing`` → ``term<N>``, ``emitOnlap`` →
 * ``oflank…``). Their ``lensLabels`` entry carries that unit's own lithology, so a flank whose
 * label differs from a face's paint proves the face is space some OTHER unit vacated.
 *
 * Deliberately EXCLUDES:
 *   - ``floodsw`` — the flood wedge. Its label is the facing matrix by construction, so it is
 *     the CONSEQUENCE of a termination, not the termination.
 *   - ``subtdlens`` / ``btfloor`` / ``btcurtain`` — the SUB-TD substrate machinery. Below a
 *     column's TD there is no drilled mass to be dominant and the deep-to-deep bottom tie is
 *     the authority; measured, including them flipped whole sub-TD sand bands to a 0.32 m clay
 *     from a column that does not even reach them.
 *   - ``lens`` — an ENCLOSED lens's own loop; ruling 8r owns the matrix notch it bites.
 *   - the given line art (``tie`` / ``bridge`` / ``bandc`` / ``surface`` / ``flood<N>`` interval
 *     brackets / ``bandseam`` midpoint seams) — none of which is a unit pinching out.
 */
const OWN_FLANK_PREFIXES = ['term', 'oflank'] as const

/** The dominant unit of a column over an elevation window, plus its index and its overlap. */
export interface DominantUnit {
  unit: UnitGeom
  ci: number
  ui: number
  /** How much of the window (metres) this unit actually occupies. */
  overlap: number
}

/**
 * Whether a face is an ENCLOSING-FLOOD face: some OTHER unit's own termination flank
 * bounds it.
 *
 * Parameters
 * ----------
 * face : Face
 *     The traced arrangement face.
 * lensLabels : ReadonlyMap<string, LensLabel> | undefined
 *     The shared curve-label map (every termination flank registers its own lithology).
 * paintedFormationId : string
 *     The lithology the face currently carries — a flank of that same lithology is the
 *     face's OWN boundary, not evidence that someone else vacated it.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when at least one foreign unit's termination flank bounds the face.
 */
export function isEnclosingFloodFace(
  face: Face,
  lensLabels: ReadonlyMap<string, LensLabel> | undefined,
  paintedFormationId: string,
): boolean {
  if (!lensLabels) return false
  for (const id of face.boundingCurveIds) {
    if (!OWN_FLANK_PREFIXES.some((p) => id.startsWith(p))) continue
    const label = lensLabels.get(id)
    if (label && label.formationId !== paintedFormationId) return true
  }
  return false
}

/** The face's elevation window (its polygon's extremes). */
function elevationWindow(face: Face): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (const p of face.polygon) {
    if (p.y < lo) lo = p.y
    if (p.y > hi) hi = p.y
  }
  return { lo, hi }
}

/**
 * The columns whose position falls inside the face's x-range — i.e. the columns the face
 * actually reaches.
 *
 * A vacancy left by terminations lives on ONE column's side of a gap (the engine's own
 * midpoint-seam semantics). A face that reaches TWO columns is a BAND connecting them, and a
 * band's lithology is its seed's by construction — never a vacancy question. Measured: without
 * this, full-gap sand bands were being relabelled to a clay.
 */
function columnsReached(columns: readonly ColumnGeom[], face: Face): number[] {
  let xLo = Infinity
  let xHi = -Infinity
  for (const p of face.polygon) {
    if (p.x < xLo) xLo = p.x
    if (p.x > xHi) xHi = p.x
  }
  // The face's vertices come back SNAPPED to the arrangement's millimetre grid, while a
  // column's ``x`` is its raw alongM — so a face that ends exactly on a column sits up to
  // half a grid cell away from it. Compare at the grid tolerance, not at float epsilon
  // (measured: a float epsilon matched NOTHING and silently disabled the whole rule).
  const eps = SNAP_GRID_M
  const hit: number[] = []
  for (let ci = 0; ci < columns.length; ci++) {
    if (columns[ci].x >= xLo - eps && columns[ci].x <= xHi + eps) hit.push(ci)
  }
  return hit
}

/** The column's TD — the lowest elevation it drilled (``Infinity`` for an empty column). */
function columnTd(col: ColumnGeom): number {
  let td = Infinity
  for (const u of col.units) if (u.baseElev < td) td = u.baseElev
  return td
}

/**
 * The unit of ``columns[ci]`` with the greatest overlap of the elevation window — the
 * channel's dominant mass.
 *
 * Overlap, not thickness: a unit that only clips the window (the sliver at its edge) must
 * not out-weigh a unit that fills it, and a unit far outside the window weighs nothing.
 * Ties break on the smallest ``ui`` (strict ``>``), so the pick is deterministic.
 */
export function dominantUnitInWindow(
  columns: readonly ColumnGeom[],
  ci: number,
  lo: number,
  hi: number,
): DominantUnit | null {
  const col = columns[ci]
  if (!col) return null
  let best: DominantUnit | null = null
  let bestOverlap = 0
  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui]
    const overlap = Math.min(u.topElev, hi) - Math.max(u.baseElev, lo)
    if (overlap > bestOverlap + 1e-9) {
      bestOverlap = overlap
      best = { unit: u, ci, ui, overlap }
    }
  }
  return best
}

/**
 * The channel-matrix relabel for a face, or ``null`` when the face keeps its current paint.
 *
 * Answers "who owns the width these terminations vacated" (see the module doc). Returns
 * ``null`` — meaning LEAVE IT ALONE — whenever
 *
 *   - no foreign termination flank bounds the face (it is not an enclosing flood), or
 *   - no reference column can be resolved, or
 *   - the reference column does NOT REACH the bottom of the face's window — a column may
 *     never speak for space below its own TD (measured: without this, a borehole that stops
 *     at +4.23 relabelled a 5 m deep-to-deep substrate sand band to its own 0.32 m bottom
 *     clay, on a 2 cm overlap), or
 *   - the dominant unit of that column over the face's window already carries the face's
 *     current lithology (the ordinary case: a real matrix that interbeds lensed out of).
 *
 * Parameters
 * ----------
 * face : Face
 *     The traced face.
 * columns : readonly ColumnGeom[]
 *     The normalised section columns.
 * lensLabels : ReadonlyMap<string, LensLabel> | undefined
 *     The shared curve-label map.
 * paintedFormationId : string
 *     The lithology the face currently carries.
 * reference : number | 'nearest'
 *     Which column answers. A SEEDED face names its own column index — never a facing
 *     sample (the round-1 "never read across a tie" lesson), and the relabel is refused
 *     unless that IS the one column the face reaches. A SEEDLESS vacancy passes
 *     ``'nearest'``, which resolves to the single column the face reaches.
 *
 * Returns
 * -------
 * DominantUnit | null
 *     The unit whose lithology the face must take, or ``null`` to keep the current paint.
 */
export function channelMatrixRelabel(
  face: Face,
  columns: readonly ColumnGeom[],
  lensLabels: ReadonlyMap<string, LensLabel> | undefined,
  paintedFormationId: string,
  reference: number | 'nearest',
): DominantUnit | null {
  if (!isEnclosingFloodFace(face, lensLabels, paintedFormationId)) return null
  // A vacancy sits on ONE column's side of a gap; a face reaching two columns is a band (see
  // ``columnsReached``). Zero columns reached means a free-floating cell with no column to
  // answer for it.
  const reached = columnsReached(columns, face)
  if (reached.length !== 1) return null
  const ci = reference === 'nearest' ? reached[0] : reference
  if (!columns[ci] || ci !== reached[0]) return null
  const { lo, hi } = elevationWindow(face)
  if (!(hi > lo)) return null
  // A column cannot speak for a channel that runs deeper than the hole itself. Its TOP may
  // be overshot (a tie apex sits a few centimetres above a neighbour's collar and that is
  // ordinary), but below TD there is no drilled mass to be dominant — that space belongs to
  // the deep-to-deep substrate, whose own bottom-tie authority stays untouched.
  if (columnTd(columns[ci]) > lo + 1e-9) return null
  const dominant = dominantUnitInWindow(columns, ci, lo, hi)
  if (!dominant || dominant.unit.formationId === paintedFormationId) return null
  // THE MAJORITY CRITERION — what makes "dominant" mean something. A channel HAS a matrix only
  // when one mass actually occupies MOST of it; where no unit reaches half, nothing can claim
  // to be the channel's fill and the existing paint stands. This is the whole difference
  // between the owner's two cases and noise: his silt channel is 93 % one silt and his sand
  // channel 57 % one sand, whereas the faces this rejects are 6 m and 25 m composites where
  // the best candidate reaches 24-27 % — flipping those (measured: a sand to a clay on a 1.2x
  // margin) would be a coin toss dressed up as a rule, and it moved the litho-consistency
  // ratchet the wrong way.
  if (dominant.overlap <= (hi - lo) / 2) return null
  return dominant
}
