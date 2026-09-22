/**
 * ONE SMOOTH TAPER — the shape a band draws while it crosses ground no test read.
 *
 * Owner ruling, 2026-08-25, shown a band carried past a column blind at its own
 * levels: flat at full thickness through the first gap, then starting the next
 * gap already 36 % pinched, so the band STEPPED exactly at the blind column —
 * the one place on the section where nothing was measured.
 *
 *   *"option 1, one smooth taper ofcourse, but look at alongM (because a test
 *    is a 1 cm point but on the section it has a width)"*
 *
 * Approved visual: ``blend_viewer/carried_band_choice.html`` (mockup, not kept in the repo), panel OPTION 1 —
 * ONE straight taper from the band's own home test to THE SAME apex as today
 * (*"pinches at the same place as today"*), the blind column passed through
 * mid-taper.
 *
 * THE alongM CAVEAT, and why nothing here insets anything. A test is a point in
 * reality but occupies a strip of WIDTH on the section, and the band must leave
 * its home test at full thickness at that strip's DRAWN EDGE, not at its centre.
 * The renderer already places it there: ``PartitionFillOverlay`` builds each
 * gap's fraction space as ``leftX = columns[i].rightX`` /
 * ``rightX = columns[i + 1].leftX`` — the left column's strip RIGHT edge to the
 * right column's strip LEFT edge, each ``nudgedX ± width / 2`` in POST-SPACING
 * screen coordinates (``assemblePlacedPartitionColumns.ts``). Fraction 0 of a
 * gap therefore IS the home column's drawn edge, and a taper anchored on the
 * band's own ``x`` — which is fraction 0 in its own gap — leaves the strip edge
 * at full thickness by construction. Insetting again here would double it.
 *
 * The engine's along-metres map onto the screen piecewise per gap, each gap's
 * metre span onto the space BETWEEN two strips, so one straight line in metres
 * draws as one continuous polyline that changes slope at each strip and steps
 * nowhere: both sides of a column evaluate at that column's own metre position.
 * That is exactly the owner's OPTION 1.
 *
 * Pure module — no I/O, no React, and no runtime dependency on ``constructs.ts``
 * (types only), so the two never form an import cycle.
 *
 * @module utils/geotechHierarchicalFill/constructive/carriedTaper
 */

import type { RunBand, RunTie } from './constructs'

/**
 * Where a band CARRIED past a blind column actually measures its pinch.
 *
 * Resolved once per (band, direction) by ``bandContinuation.ts`` and stamped on
 * the band for every gap the carry crosses EXCEPT the terminal one — that gap
 * already draws the pinch, and this carry only reproduces its apex.
 */
export interface BandCarry {
  /** Along-x of the column that genuinely reads the band's levels, in metres. */
  farX: number
  /** The TERMINAL gap's own two run columns, by frame index (low). */
  loCi: number
  /** The TERMINAL gap's own two run columns, by frame index (high). */
  hiCi: number
}

/**
 * The ties the TERMINAL gap's own pinch is measured against.
 *
 * ``lensReach`` halves a lens's reach while its diamond would cross a
 * correlation, and it consults only the ties crossing the gap it runs in. The
 * carried gaps must reproduce the terminal gap's answer EXACTLY — the ruling is
 * *"pinches at the same place as today"* — so they ask the same question of the
 * same ties, not of their own gap's.
 *
 * @param ties The run's surviving packing ties.
 * @param carry The band's resolved carry.
 * @returns The subset crossing the terminal gap, in the run's own order.
 */
export function carryReachTies(ties: readonly RunTie[], carry: BandCarry): RunTie[] {
  return ties.filter(
    (t) =>
      Math.min(t.leftCi, t.rightCi) <= carry.loCi && Math.max(t.leftCi, t.rightCi) >= carry.hiCi,
  )
}

/** A construct's two boundaries as functions of along-x. */
export interface TaperBoundaries {
  topAt: (x: number) => number
  baseAt: (x: number) => number
}

/**
 * The straight taper from a band's own column to an apex, both contacts closing
 * on the band's mid-level.
 *
 * One definition, used by the ordinary lens (whose apex is inside its own gap)
 * and by a carried band (whose apex lies gaps away) alike, so the two can never
 * draw different lines through the same point — which is the whole of the
 * ruling: the carried band is the ordinary lens, merely seen one gap early.
 *
 * @param band The band the taper belongs to.
 * @param apexX Along-x at which both contacts meet, in metres.
 * @returns Its top and base boundaries, clamped flat past the apex.
 */
export function taperBetween(band: RunBand, apexX: number): TaperBoundaries {
  const mid = (band.top + band.base) / 2
  const span = apexX - band.x
  const t = (x: number): number =>
    Math.min(1, Math.max(0, Math.abs(span) < 1e-9 ? 1 : (x - band.x) / span))
  return {
    topAt: (x) => band.top - t(x) * (band.top - mid),
    baseAt: (x) => band.base + t(x) * (mid - band.base),
  }
}
