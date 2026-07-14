/**
 * partitionFillV2/emitSurfaceOnlap.ts — the SURFACE-ANCHORED ONLAP
 * (design partition-engine-v2.md §4 increment-18 row).
 *
 * A lone TOP boundary minority that is the column's FIRST unit reaches the ground
 * surface via ruling 5 (``emitColumnVerticals`` extends its fill envelope up to the
 * surface band). When its BASE contact is tied to a band and its top rides the surface,
 * v1 renders it as an ONLAP: a pinch whose tip sits at ``INTERIOR_PINCH_FRACTION`` (0.5)
 * of the gap and whose top edge rides the surface band, the facing/matrix fill claiming
 * the remainder while the ruling-5 surface strip stays FULLY covered.
 *
 * The subtlety this module handles (why it can't just reuse the increment-17
 * ``emitLonePinch`` onlap default): the increment-17 onlap places the apex on the BASE
 * interface (``loneBase + 0.5·(facingBase − loneBase)``). When the base bracket is a
 * steeply DIPPING band (B6 gap2: the SILT band runs from 6.278 mTAW on the pinch column
 * up to 13.13 on the facing), that apex lands EXACTLY on the band line — the pinch's
 * lower ``close`` edge then runs collinear with the band, the flood ``conv→apex`` edge
 * coincides with the band contour, and the tracer merges the pinch into a full-width
 * band face (the KLEI ran to the far column). v1 instead RISES the apex to the midpoint
 * of the unit's own (drilled) top and the convergence point — a clean interior tip well
 * ABOVE the band, so the pinch is a strictly-simple triangle and the flood wedges never
 * coincide with the band. This module ports that rising apex and drives ``emitLonePinch``
 * with the ``apexElevOverride`` (increment 18), for BOTH the clean-lateral (B4|S13 gap3
 * ZAND) and dipping mixed-bracket (B6 gap2 KLEI) cases.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { emitLonePinch, type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** The FACING column's base-bracket elevation for a given lone side. */
function facingBaseElevOf(base: LonePinchBracket, loneSide: 'left' | 'right'): number {
  return loneSide === 'left' ? base.rightElev : base.leftElev
}

/** The FACING column's top-bracket elevation for a given lone side. */
function facingTopElevOf(top: LonePinchBracket, loneSide: 'left' | 'right'): number {
  return loneSide === 'left' ? top.rightElev : top.leftElev
}

/**
 * Whether the lone unit is a ruling-5 SURFACE-EXTENDED first unit, plus the
 * surface-effective unit whose top rides the surface band.
 *
 * The interval's TOP bracket is the SURFACE band when it is not a tie/floor anchor
 * (``!top.anchor``) and its elevation equals the lone column's surface. When the lone unit
 * is that column's FIRST unit and its DRILLED top sits below the surface, ruling 5
 * (``emitColumnVerticals``) extends its fill envelope UP to the surface — the layer IS at
 * the surface, the measurement just starts lower. ``u0eff`` then carries the surface as its
 * top so the fill-check + pinch/flood geometry read it consistently (increment 18).
 *
 * Parameters
 * ----------
 * u0 : IntervalUnit
 *     The single lone-side matrix unit.
 * loneCol : ColumnGeom
 *     The pinch column (its surface + first-unit identity decide the extension).
 * top : LonePinchBracket
 *     The interval's top bracket.
 * intervalTopElev : number
 *     The interval top elevation on the lone column.
 *
 * Returns
 * -------
 * { surfaceExtended: boolean; u0eff: IntervalUnit }
 *     ``surfaceExtended`` fires the surface-onlap route; ``u0eff`` is the effective unit
 *     (top = surface when extended, else ``u0`` unchanged).
 */
export function surfaceExtendedUnit(
  u0: IntervalUnit,
  loneCol: ColumnGeom,
  top: LonePinchBracket,
  intervalTopElev: number,
): { surfaceExtended: boolean; u0eff: IntervalUnit } {
  const firstUnit = loneCol.units.length > 0 && u0.unit.layerId === loneCol.units[0].layerId
  const topIsSurface = !top.anchor && Math.abs(intervalTopElev - loneCol.surfaceElevM) < ELEV_EPS
  const surfaceExtended =
    firstUnit && topIsSurface && u0.unit.topElev < loneCol.surfaceElevM - ELEV_EPS
  const u0eff: IntervalUnit = surfaceExtended ? { ...u0, topElev: intervalTopElev } : u0
  return { surfaceExtended, u0eff }
}

/**
 * Emit the SURFACE-ANCHORED ONLAP for a surface-extended, base-tied lone unit.
 *
 * The apex rises to the midpoint of the unit's OWN DRILLED top and the convergence point
 * ``conv`` (v1's rising-apex semantics) so it never lands on the base-band bracket — the
 * pinch triangle stays strictly simple and the ruling-5 surface strip is covered by the
 * descending matrix flood. The descending matrix is sampled at the FACING bracket
 * elevations (where the facing presents the enclosing matrix at the convergence), so a
 * dipping band whose LONE base sits in a different facing lithology still onlaps cleanly.
 *
 * Parameters
 * ----------
 * u0 : IntervalUnit
 *     The lone unit (already surface-extended: ``u0.topElev`` = surface). Its
 *     ``u0.unit.topElev`` is the DRILLED top used for the rising apex.
 * u0eff : IntervalUnit
 *     The surface-effective unit passed to ``emitLonePinch`` (top rides the surface band).
 * loneSide : 'left' | 'right'
 * loneX, facingX : number
 * facing : ColumnGeom
 *     The facing column (its bracket-endpoint lithology names the descending matrix).
 * top, base : LonePinchBracket
 *     The interval brackets (top = surface band, base = the tied band).
 * baseLenses : readonly IntervalUnit[]
 *     Enclosed lenses on the lone side (still pinch at their own 0.45 apex).
 * nextId, nextFloodId : () => string
 * lensLabels : Map<string, LensLabel>
 * out : InputCurve[]
 */
export function emitSurfaceOnlap(
  u0: IntervalUnit,
  u0eff: IntervalUnit,
  loneSide: 'left' | 'right',
  loneX: number,
  facingX: number,
  facing: ColumnGeom,
  top: LonePinchBracket,
  base: LonePinchBracket,
  baseLenses: readonly IntervalUnit[],
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const facingTopE = facingTopElevOf(top, loneSide)
  const facingBaseE = facingBaseElevOf(base, loneSide)
  // conv — where the two bracket interfaces meet on the FACING column (v1 ``conv``).
  const convElev = (facingTopE + facingBaseE) / 2
  // The enclosing matrix that descends into the wedge above the band = the facing matrix at
  // the band's FACING endpoint. On a clean-lateral context this equals the facing matrix
  // above; on a dipping band it is the matrix the band rises INTO (never the facing
  // lithology at the LONE column's unrelated deep base).
  const descendMatrix = facingMatrixLabel(facing, facingBaseE) ?? facingMatrixLabel(facing, facingTopE)
  if (descendMatrix === null) return
  // v1 rising apex: midpoint of the unit's OWN DRILLED top and conv — a clean interior tip
  // ABOVE the (possibly dipping) base band, so the pinch triangle is strictly simple.
  const apexElev = (u0.unit.topElev + convElev) / 2
  emitLonePinch(
    [u0eff],
    loneSide,
    loneX,
    facingX,
    top,
    base,
    descendMatrix,
    descendMatrix,
    nextId,
    nextFloodId,
    lensLabels,
    out,
    'onlap',
    apexElev,
  )
  for (const u of baseLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
}
