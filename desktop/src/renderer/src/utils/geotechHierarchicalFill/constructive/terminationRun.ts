/**
 * A COLUMN THAT READ NOTHING IS NOT A BOUNDARY — the geotech constructive
 * arm's half of the law the litho arm already carries
 * (``partitionFillV2/emitContinuation.ts``, owner 2026-08-21: *"it should be
 * a continuous band starting from S7 but now it is interrupted at S7A's
 * column"* / *"how do we get open terminations for lenses"*).
 *
 * A termination is a statement about where a band meets what a FACING TEST
 * read. A column with no band at any of the terminating band's own levels read
 * nothing, so it states nothing, so it is NOT a boundary: the true reading
 * column is the first one, in that direction, whose bands overlap the
 * terminating band's own elevation window — one gap away, or several. Only when
 * no column in that direction ever reads it is the run's own edge the true
 * boundary.
 *
 * WHAT COUNTS AS READING is the SECTION-WIDE stack, not this family's own bands
 * (owner ruling 2026-08-25, ``columnReading.ts``): the walk stops at any column
 * that measured this ground, whatever class or soil it measured there. A column
 * whose sand belongs to another family is still a column that read the levels,
 * and walking past it faked continuity through ground it had already described.
 *
 * This module is the walk alone — it draws nothing. The geotech arm is
 * fundamentally gap-by-gap (unlike the litho arm's whole-section
 * arrangement), so the CONSEQUENCE of this walk is realised differently: see
 * ``bandContinuation.ts`` for how a band that must cross a blind column gets
 * carried into the gaps it needs to be visible in.
 *
 * Pure module — no I/O, no React.
 *
 * @module utils/geotechHierarchicalFill/constructive/terminationRun
 */

import { readsWindow } from './columnReading'
import type { RunBand, RunColumn } from './constructs'

/** The column a termination measures against, within one run. */
export interface GeotechTerminationRun {
  /** Index into ``runColumns`` of the first column that reads the window, or
   *  the outermost column reached in that direction when none does. */
  columnIndex: number
  /** ``true`` when ``columnIndex`` genuinely reads the window (the ordinary
   *  pinch measures against it). ``false`` = nothing in this direction ever
   *  reads it — the run's own edge, where today's curtain is the final,
   *  correct answer. */
  reads: boolean
}

/**
 * Resolve the run column a band's termination measures against, crossing
 * blind columns.
 *
 * @param runColumns The family's run, left to right (one run, not the whole section).
 * @param nearIndex The terminating band's own column index within ``runColumns``.
 * @param dir The look direction: ``1`` = rightward, ``-1`` = leftward.
 * @param topElev The band's own top elevation (mTAW).
 * @param baseElev The band's own base elevation (mTAW).
 * @param stacks EVERY packing band per FRAME column index, whatever family owns
 *   it — the walk stops at the first column that measured this ground, and the
 *   class it measured is not consulted (owner ruling 2026-08-25, see
 *   ``columnReading.ts``). Reading the run column's OWN bands instead let a
 *   column carrying another family's soil at these very levels pass as blind.
 */
export function terminationRun(
  runColumns: readonly RunColumn[],
  nearIndex: number,
  dir: 1 | -1,
  topElev: number,
  baseElev: number,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
): GeotechTerminationRun {
  let last = nearIndex
  for (let i = nearIndex + dir; i >= 0 && i < runColumns.length; i += dir) {
    last = i
    if (readsWindow(stacks.get(runColumns[i].ci), topElev, baseElev)) {
      return { columnIndex: i, reads: true }
    }
  }
  // Nothing in this direction ever read the ground: the outermost column
  // reached IS the run's own edge.
  return { columnIndex: last, reads: false }
}
