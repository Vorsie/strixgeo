/**
 * partitionFillV2/emitBoundaryLens.ts — WATERTIGHT boundary lens (owner directive
 * 2026-07-17, session 20: "fix those 2 lenses first — lensing needs to be watertight by
 * design"; design partition-engine-v2.md §8 ruling 8b/8i(e)).
 *
 * THE CLASS. A 0-corr minority that is a BOUNDARY unit of its column — the FIRST unit
 * (ui 0, whose top contact IS the top-band line) or the LAST unit (ui last, whose base
 * contact IS the column TD / shallow-TD floor) — with a single interior neighbour of a
 * DIFFERENT formation. Ruling 8i(e) requires it to LENS like any 0-corr side, but the
 * INTERIOR lens shape (``emitLens`` — a diamond apex at the unit's mid-elevation + an
 * ``emitFloodWedge`` converging at the GAP MIDPOINT) leaves a linearly-growing hole
 * against the boundary polyline: the wedge's top leg dives to mid-elevation while the
 * top band rides above it, so the sliver between them is untraced (session 19 measured
 * +65 holes when the interior lens was fired for these five units; reverted, tagged
 * ``boundaryResidual``).
 *
 * THE WATERTIGHT CONSTRUCTION (session 6/7 trapezoid-slab lesson: every leg lies ON
 * existing line art or meets another emitted leg EXACTLY). A boundary lens is a TRIANGLE
 * against a KNOWN polyline:
 *   - the unit's own COLUMN VERTICAL between its two contacts (already emitted);
 *   - ONE free-contact flank (a ``term`` phase-1 lens flank) from the FREE contact
 *     corner to the apex — the audit-visible lens closing;
 *   - the BOUNDARY POLYLINE segment from the column corner to the apex point ON it: for
 *     a surface first unit the TOP BAND (``surface:gi``, which rides the first-litho
 *     boundary — the unit's own top); for a TD last unit the SHALLOW-TD FLOOR line
 *     (``emitEnclosingFlood`` emits it across every gap). The apex sits ON that polyline
 *     (``apexElev`` = the polyline interpolated at the apex x), so the tied leg is
 *     EXISTING line art — never a synthesized horizontal that diverges from it (the
 *     session-19 +65-hole root). The tied leg is NOT re-emitted (a second leg riding the
 *     polyline duplicates given line art — ruling 8i(d)).
 *
 * NO SEPARATE FLOOD WEDGE. Unlike the interior ``emitLens`` (which emits an ``floodsw``
 * wedge to claim the width past the apex), the boundary lens draws ONLY its free flank.
 * The vacated width is already filled by the ENCLOSING FLOOD's interval closure
 * (``emitEnclosingFlood`` tiles ``[top band .. shallow TD]`` full-width with the facing
 * enclosing formation); the free flank simply CARVES the lens hole out of it — hole-free
 * by construction, since the lens's three legs (column vertical + free flank + boundary
 * polyline) all lie on existing line art or meet exactly. An extra facing-converging
 * flood wedge here would DOUBLE-COVER that fill with a different-litho band (session 20
 * measured 117 different-litho overlaps when it was emitted — KLEI×SILT / SILT×ZAND
 * quads); the enclosing flood is the single fill authority (owner's sequencing: lens
 * first, fill after).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { facingMatrixLabel } from './facingMatrix'
import { lensReachFraction } from './lensReach'
import { type LensLabel } from './emitLenses'
import { firstLithoTopElev, type ColumnGeom, type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type InputCurve, type Point } from './types'

/**
 * A margin (metres) so the apex sits strictly OFF the free contact corner — a zero-height
 * flank collapses the lens into the enclosing fill. The reach halves until the apex clears it.
 */
const APEX_MARGIN = 1e-3

/** The reach floor (fraction of the gap) below which the lens degenerates to a no-op. */
const MIN_REACH_FRACTION = 1e-3

/**
 * Emit the watertight boundary lens for one 0-corr boundary minority: the free-contact
 * flank whose apex rides the boundary polyline. Returns ``true`` when the flank was
 * emitted, ``false`` on a physical degenerate no-op (the flank collapses to a 1 mm grid
 * cell at every reach, or the facing carries no lateral matrix — the enclosing flood
 * covers the slot, holes stay 0).
 *
 * Parameters
 * ----------
 * u : UnitGeom
 *     The boundary minority (its free contact flank + apex on the boundary polyline).
 * boundary : 'surface' | 'td'
 *     Which contact rides existing line art: ``surface`` → the top contact rides the
 *     top band (top is the tied leg, base is the free flank); ``td`` → the base contact
 *     rides the shallow-TD floor (base is the tied leg, top is the free flank).
 * colX, facingX : number
 *     The unit's column x and the facing column x (metres — REAL alongM).
 * facing : ColumnGeom
 *     The facing column (its first-litho top / TD anchors the boundary polyline's facing
 *     endpoint; its lateral-matrix presence is the reach guard).
 * shallowTD : number
 *     The gap's shallow TD (``max(leftTD, rightTD)``) — the TD-floor polyline elevation a
 *     ``td`` last unit's base rides (a horizontal line across the gap).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — the free flank carries the unit's own litho.
 * nextId : () => string
 *     ``term``-prefixed lens-flank id allocator (audit-visible phase-1 lens flank).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the lens flank was emitted; ``false`` on a physical degenerate no-op.
 */
export function emitBoundaryLens(
  u: UnitGeom,
  boundary: 'surface' | 'td',
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  shallowTD: number,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): boolean {
  // The boundary polyline the TIED leg rides, per side:
  //   surface → the TOP band (first-litho boundary): near = u.topElev, facing = firstLithoTop(facing).
  //   td      → the SHALLOW-TD floor: a HORIZONTAL line at ``shallowTD`` across the whole gap.
  const nearBandElev = boundary === 'surface' ? u.topElev : shallowTD
  const facingBandElev = boundary === 'surface' ? firstLithoTopElev(facing) : shallowTD
  // The FREE contact corner (the flank the lens draws) is the OTHER contact.
  const freeElev = boundary === 'surface' ? u.baseElev : u.topElev

  // Reach guard: the facing column must carry a lateral matrix at the free contact (else the
  // apparent boundary is a data void, not a lens context — keep the enclosing flood's fill).
  if (facingMatrixLabel(facing, freeElev) === null) return false

  // Ruling 8b reach: start at the ~2× thickness cap, HALVE on conflict (owner 2026-07-16 —
  // "shorten the lenses by half if there is conflict with a tie") until the free flank fits.
  // The apex rides the boundary polyline at fraction f; the free flank runs from the apex to
  // the free corner. The apex must clear the free corner by the margin (a zero-height flank
  // merges the lens into the enclosing fill) and not collapse to a 1 mm grid cell.
  let f = lensReachFraction(u.topElev - u.baseElev, facingX - colX)
  const freeCorner: Point = { x: colX, y: freeElev }
  let apex: Point | null = null
  while (f >= MIN_REACH_FRACTION) {
    const apexX = colX + f * (facingX - colX)
    // The boundary polyline elevation at the apex x (straight interpolation between the
    // near-column corner and the facing endpoint — RIDES the real polyline; a true horizontal
    // for the TD floor, a sloping ride for the surface top band).
    const apexElev = nearBandElev + f * (facingBandElev - nearBandElev)
    const cand: Point = { x: apexX, y: apexElev }
    if (!segmentDegenerate(cand, freeCorner) && Math.abs(apexElev - freeElev) > APEX_MARGIN) {
      apex = cand
      break
    }
    f /= 2
  }
  if (apex === null) return false // no reach fits — physical no-op (the enclosing flood covers it)

  // The FREE flank — a ``term`` phase-1 lens flank from the apex (ON the boundary polyline)
  // to the FREE contact corner, carrying the unit's OWN litho. Audit-visible (``isLensFlankId``
  // counts ``term`` at the unit's contact) so the boundary lens reads PRESENT. The lens face
  // closes as: column vertical + this free flank + the boundary polyline sub-segment.
  const flankId = nextId()
  lensLabels.set(flankId, { formationId: u.formationId, bodyId: u.bodyId })
  out.push({ id: flankId, kind: 'closing', points: [apex, freeCorner] })
  return true
}
