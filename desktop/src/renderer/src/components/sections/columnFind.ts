/**
 * Ctrl+F on a cross-section — find a column by its header name.
 *
 * Owner, 2026-08-17: *"on crosssections i want a ctrl+f feature so i can go
 * easily to a column header like s8 or so for example"*. His columns are named
 * like ``GEO-10/170-S8`` and ``1411-GEO-23/126-B3``; the thing he types is the
 * short tail (``s8``, ``b3``), so matching is case-insensitive substring.
 *
 * Pure module — the find bar owns the input state, `SectionPanel` owns the
 * viewport write; everything testable lives here.
 */

import type { Viewport } from './utils'

/** One placed column, reduced to what find needs. */
export interface ColumnFindEntry {
  /** Investigation id — handed back to the caller on a jump. */
  id: string
  /** The header name the engineer reads on the section (e.g. ``GEO-10/170-S8``). */
  name: string
  /** True along-distance, used only to order matches left-to-right. */
  along: number
  /**
   * The column's rendered screen X. The jump centres on THIS, never on
   * ``along``: at packed spacing the two diverge by the whole
   * cumulative-width offset, and centring on ``along`` would land the camera
   * beside the column (the section-view spacing rule).
   */
  nudgedX: number
}

/**
 * The columns whose header matches the query, ordered left-to-right.
 *
 * @param columns - Every placed column on the open section.
 * @param query - Whatever the engineer typed; trimmed, case-insensitive
 *   substring. Empty matches NOTHING — a bar that lit every column on open
 *   would flash the whole section before the first keystroke.
 * @returns Matches sorted by ``along`` ascending, so repeated Enter walks the
 *   section left-to-right.
 */
export function matchColumns(
  columns: readonly ColumnFindEntry[],
  query: string,
): ColumnFindEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  return columns
    .filter(col => col.name.toLowerCase().includes(needle))
    .sort((a, b) => a.along - b.along)
}

/**
 * The viewport panned so a target screen X lands at the plot centre.
 *
 * A pure horizontal slide: width and the vertical window survive, so the jump
 * keeps whatever zoom the engineer set. One shot is exact at every spacing —
 * a viewport shift moves every rendered column by the same pixel delta, packed
 * or not.
 *
 * @param viewport - The current window.
 * @param targetScreenX - The matched column's rendered X (``nudgedX``).
 * @param plotCentreX - The plot's horizontal centre in the same pixel space.
 * @param scaleH - Pixels per along-metre. ``<= 0`` (layout not measured yet)
 *   answers the viewport unchanged — panning by Infinity would NaN the window
 *   and blank the section.
 * @returns A new viewport; never mutates the input.
 */
export function panViewportToScreenX(
  viewport: Viewport,
  targetScreenX: number,
  plotCentreX: number,
  scaleH: number,
): Viewport {
  if (scaleH <= 0) return viewport
  const shiftAlong = (targetScreenX - plotCentreX) / scaleH
  return {
    ...viewport,
    xMin: viewport.xMin + shiftAlong,
    xMax: viewport.xMax + shiftAlong,
  }
}
