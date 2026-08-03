/**
 * partitionFillV2/columnSeparation.ts — keep every gap wide enough to slice.
 *
 * A CPT and a borehole drilled at ONE station project onto the same ``alongM``. The
 * arrangement snaps metres to a 1 mm grid, so two such columns collapse onto ONE vertical:
 * the slicer's strip clip for that gap is empty and the gap emits ZERO regions — an empty
 * white ribbon between the pair, where v1 (which works in per-gap fraction space and never
 * sees real spacing) paints normally.
 *
 * Columns are DRAWN at their nudged screen positions, so the strip the engineer looks at
 * is a normal width regardless of the real spacing, and the output contract is per-gap
 * fraction×elevation — a gap's real width never reaches the renderer. Widening a degenerate
 * gap to a floor therefore changes nothing the user sees except that it now paints.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ColumnGeom } from './sectionGeom'

/**
 * Minimum along-section distance (metres) between two consecutive columns.
 *
 * Chosen to sit far ABOVE the arrangement's 1 mm snap grid (``types.SNAP_GRID_M``) so the
 * two verticals stay distinct integers after snapping, and far BELOW the closest real
 * spacing on any interpreted section in the dev model (Tie-section 8's 42 mm pair) so no
 * existing section's geometry moves.
 */
export const MIN_COLUMN_SEPARATION_M = 0.02

/**
 * Push any column that sits at or behind its left neighbour out to the separation floor.
 *
 * The sweep is monotone — each column is moved to at least
 * ``previous.x + MIN_COLUMN_SEPARATION_M`` — so a run of coincident columns fans out in
 * input order and the sequence stays strictly increasing. Columns already spaced beyond
 * the floor are untouched.
 *
 * Parameters
 * ----------
 * geom : ColumnGeom[]
 *     Surviving columns with ``x`` already assigned, left to right. Mutated in place.
 */
export function enforceMinimumColumnSeparation(geom: ColumnGeom[]): void {
  for (let i = 1; i < geom.length; i++) {
    const minX = geom[i - 1].x + MIN_COLUMN_SEPARATION_M
    if (geom[i].x < minX) geom[i].x = minX
  }
}
