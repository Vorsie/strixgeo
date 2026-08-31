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
 *     session-19 +65-hole root). RULING 8q (owner 2026-07-19, session 54): the tied leg is
 *     ALSO emitted as a second ``term``-family curve coincident with that polyline sub-segment
 *     — the paint tool paints ON line art, so the lens loop must CLOSE as real lens-family art,
 *     not merely via the phase-3 flood scaffold + the region edge. Coincident with the existing
 *     polyline → the arrangement unions it, NO topology change. This SUPERSEDES the 8i(d)
 *     "don't duplicate the polyline" withholding for the boundary lens's OWN closing loop.
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

import { INTERIOR_PINCH_FRACTION, type LensApexOverride } from '../sectionPartition'
import { terminationApexOverride } from './apexOverride'
import { emitFloodWedge } from './emitFloodWedge'
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
  gapIndex = -1,
  overrides?: ReadonlyMap<string, LensApexOverride>,
): boolean {
  // The boundary polyline the TIED leg rides, per side:
  //   surface → the TOP band (first-litho boundary): near = u.topElev, facing = firstLithoTop(facing).
  //   td      → the SHALLOW-TD floor: a HORIZONTAL line at ``shallowTD`` across the whole gap.
  const nearBandElev = boundary === 'surface' ? u.topElev : shallowTD
  const facingBandElev = boundary === 'surface' ? firstLithoTopElev(facing) : shallowTD
  // The FREE contact corner (the flank the lens draws) is the OTHER contact.
  const freeElev = boundary === 'surface' ? u.baseElev : u.topElev
  // FREE-DRAW APEX OVERRIDE (owner 2026-07-22, THIRD engine grant — "make every handle reshape"):
  // a per-body node MOVES this boundary lens's tip REACH (fraction). The apex ELEVATION always rides
  // the boundary polyline at that fraction (the top band for a surface lens, the flat TD floor for a
  // td lens) — the tied leg is that existing line art, so keeping the apex ON the polyline preserves
  // the watertight closure (letting it float off would separate the tied leg from the polyline and
  // open a sliver). NO override → the 8b-halved default reach, byte-identical. The override passes
  // UN-capped by the 8b halving (an overridden apex is the user's explicit reach, design §8 line 795),
  // clamped only to the strictly-interior envelope so it never sits ON/PAST the far column.
  const ov = terminationApexOverride(overrides, u.bodyId, gapIndex)

  // RULING 8i(e) "EVERYTHING MUST LENS" (audit item 5, S34): the ``facingMatrixLabel === null`` reach
  // guard is DELETED. A boundary corr-0 unit lenses regardless of whether the facing sample finds a
  // lateral matrix — a formation/void comparison of the FACING column may never GATE this emission
  // (the same letter-of-the-law that deleted the sweep's ``isMinorityWide``/``boundaryMinorityKind``).
  // The remaining suppressions are PHYSICAL only: 8b reach-halving on a tie conflict, the genuine
  // 1 mm snap degeneration, and the geometric validity of the emitted segment (all below).

  // Ruling 8b reach: start at the ~2× thickness cap, HALVE on conflict (owner 2026-07-16 —
  // "shorten the lenses by half if there is conflict with a tie") until the free flank fits.
  // The apex rides the boundary polyline at fraction f; the free flank runs from the apex to
  // the free corner. The apex must clear the free corner by the margin (a zero-height flank
  // merges the lens into the enclosing fill) and not collapse to a 1 mm grid cell.
  const freeCorner: Point = { x: colX, y: freeElev }
  let apex: Point | null = null
  if (ov) {
    // OVERRIDE: the user's explicit reach — no 8b halving. The apex rides the boundary polyline at
    // the override fraction; only a genuine degenerate (apex on the free corner) is a no-op.
    const apexX = colX + ov.fraction * (facingX - colX)
    const apexElev = nearBandElev + ov.fraction * (facingBandElev - nearBandElev)
    const cand: Point = { x: apexX, y: apexElev }
    if (!segmentDegenerate(cand, freeCorner) && Math.abs(apexElev - freeElev) > APEX_MARGIN) apex = cand
  } else {
    // Ruling 8b reach: start at the ~2× thickness cap, HALVE on conflict until the free flank fits.
    let f = lensReachFraction(u.topElev - u.baseElev, facingX - colX)
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
  }
  if (apex === null) return false // no reach fits — physical no-op (the enclosing flood covers it)

  // The FREE flank — a ``term`` phase-1 lens flank from the apex (ON the boundary polyline)
  // to the FREE contact corner, carrying the unit's OWN litho. Audit-visible (``isLensFlankId``
  // counts ``term`` at the unit's contact) so the boundary lens reads PRESENT. The lens face
  // closes as: column vertical + this free flank + the boundary polyline sub-segment.
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const flankId = nextId()
  lensLabels.set(flankId, label)
  out.push({ id: flankId, kind: 'closing', points: [apex, freeCorner] })

  // The TIED closing leg — RULING 8q (owner 2026-07-19, session 54; supersedes the 8i(d)
  // "don't re-emit a leg riding the polyline" note above for the LENS case). The paint tool
  // PAINTS ON LINE ART, so every termination loop must close as REAL lens-family art: the paint
  // bucket sees a CLOSED lens, not a loop that only closes via a phase-3 flood scaffold + the
  // region edge. This second ``term``-family curve runs from the near-column corner ON the
  // boundary polyline (``(colX, nearBandElev)`` — the shallow-TD floor for ``td``, the top band
  // for ``surface``) to the SAME apex, carrying the unit's OWN litho. It is EXACTLY coincident
  // with the boundary-polyline sub-segment the arrangement already traces (TD floor / top band),
  // so the planar arrangement UNIONS it → NO topology change (holes/overlaps stay 0/0), while the
  // lens now reads as a fully-closed loop of lens-family line art.
  const tiedCornerElev = nearBandElev
  const tiedCorner: Point = { x: colX, y: tiedCornerElev }
  // Guard: a degenerate tied leg (the apex snapped onto the tied corner) adds nothing — the free
  // flank already closed the lens against the polyline. Only emit a real, non-degenerate segment.
  if (!segmentDegenerate(tiedCorner, apex)) {
    const tiedId = nextId()
    lensLabels.set(tiedId, label)
    out.push({ id: tiedId, kind: 'closing', points: [tiedCorner, apex] })
  }
  return true
}

/**
 * Emit the WATERTIGHT SURFACE ONLAP for a FIRST unit tied ONLY by the top band (owner ruling
 * 8d-rev, 2026-07-16 evening — "the top band counts as one correlation"; design §8 8d-rev). The
 * same watertight triangle as the surface branch of ``emitBoundaryLens`` (free BASE flank riding
 * to an apex ON the top-band polyline; the top-band ``surface:gi`` curve is the tied leg —
 * existing line art, never re-emitted, ruling 8i(d)), but with the ONLAP convention rather than
 * the LENS convention:
 *   - APEX AT ``INTERIOR_PINCH_FRACTION`` (0.5), NOT the 8b-halved lens reach (design §8 8a/8b:
 *     "1 → onlaps its tie, tip at 0.5"; a corr-1 onlap uses the 0.5 tip, the 8b reach cap is a
 *     0-corr LENS device). The tip rides the top band at fraction 0.5.
 *   - a PHASE-2 ``oflank``-prefixed id (``labelFaces``-neutral, ``phaseOf`` → phase 2), so the
 *     surface onlap never mis-renders as a phase-1 lens (the §20 confusion) — matching the
 *     sweep's ordinary onlap flank vocabulary (``drawTermination`` ``emitOnlap``).
 *
 * NO separate flood wedge (identical rationale to ``emitBoundaryLens``): the enclosing flood's
 * interval closure already fills the width past the tip; the free flank simply carves the onlap
 * face out of it, hole-free by construction (all three legs — column vertical + free flank +
 * top-band polyline — lie on existing line art or meet exactly).
 *
 * Parameters mirror ``emitBoundaryLens`` (surface case), minus ``boundary``/``shallowTD`` (this is
 * always the surface top-band case) and ``nextId`` allocates the ``oflank`` id via a passed
 * closure. Returns ``true`` when the flank was emitted, ``false`` on a physical degenerate no-op
 * (the apex snaps onto the free corner / the facing carries no lateral matrix — the enclosing
 * flood covers the slot).
 */
export function emitSurfaceOnlapFlank(
  u: UnitGeom,
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  lensLabels: Map<string, LensLabel>,
  nextOflankId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  gapIndex = -1,
  overrides?: ReadonlyMap<string, LensApexOverride>,
): boolean {
  // The top-band polyline the TIED leg rides: near = u.topElev (the first-litho boundary), facing
  // = firstLithoTop(facing). The FREE contact (the flank the onlap draws) is the BASE.
  const nearBandElev = u.topElev
  const facingBandElev = firstLithoTopElev(facing)
  const freeElev = u.baseElev

  // Reach guard: the facing must carry a lateral matrix at the free contact (else an apparent
  // boundary is a data void, not an onlap context — the enclosing flood keeps the slot).
  if (facingMatrixLabel(facing, freeElev) === null) return false

  // ONLAP tip at 0.5 (design §8 8a) riding the top-band polyline. No 8b reach-halving: an onlap
  // uses the fixed 0.5 tip. The apex must still clear the free corner (a zero-height flank merges
  // the onlap into the enclosing fill) — a 0.5-gap onlap on a first unit does so by construction
  // (the apex elevation is the top band, well above the unit's base); the degenerate guard below
  // catches the pathological sub-snap case.
  // ITEM B (free-draw onlap reshape): a per-body override MOVES the tip's REACH (fraction); the apex
  // ELEVATION always rides the top-band polyline at that fraction (an onlap laps its tie — letting
  // the elevation float off the band would separate the flank from the tie and open a sliver, the
  // S64 emitOnlap lesson). No override → the fixed 0.5 tip (byte-identical no-override path).
  const ov = terminationApexOverride(overrides, u.bodyId, gapIndex)
  const f = ov ? ov.fraction : INTERIOR_PINCH_FRACTION
  const apexX = colX + f * (facingX - colX)
  const apexElev = nearBandElev + f * (facingBandElev - nearBandElev)
  const apex: Point = { x: apexX, y: apexElev }
  const freeCorner: Point = { x: colX, y: freeElev }
  if (segmentDegenerate(apex, freeCorner) || Math.abs(apexElev - freeElev) <= APEX_MARGIN) return false

  // The FREE flank — a ``oflank`` PHASE-2 onlap flank from the apex (ON the top-band polyline) to
  // the FREE BASE corner, carrying the unit's own litho. The onlap face closes as: column vertical
  // + this free flank + the top-band ``surface:gi`` sub-segment (existing line art, not re-emitted).
  const flankId = `oflank${nextOflankId()}`
  lensLabels.set(flankId, { formationId: u.formationId, bodyId: u.bodyId })
  out.push({ id: flankId, kind: 'closing', points: [apex, freeCorner] })
  // FLOOD the vacated width past the onlap tip with the facing enclosing formation (identical to
  // ``drawTermination``'s ``emitOnlap``): the TIED side (TOP, riding the top band) is closed by
  // that polyline, so its wedge is SKIPPED; the enclosing floods the UNTIED BASE side. At a 0.5
  // apex the flood wedge is what closes the region between the tip and the free base corner — the
  // top-band case is NOT the small-reach lens (which the enclosing flood covered on its own,
  // ``emitBoundaryLens``); a mid-gap tip needs the wedge (else the 2 m sliver hole at CS1 g7 f0.5).
  emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, 'top', nextFloodId, lensLabels, out, facingX)
  return true
}
