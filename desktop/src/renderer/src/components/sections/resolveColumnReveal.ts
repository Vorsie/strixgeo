/**
 * Turn "reveal these investigations" into a screen position, on the section
 * panel's OWN column list.
 *
 * The pending-tie chip lives in the toolbar and names investigations, because
 * that is the only vocabulary it shares with the canvas. This is where those
 * names become pixels — and it runs inside ``SectionPanel``, against the same
 * ``visibleColumns`` the overlays draw from, deliberately. Handing a position
 * or a column index ACROSS a surface boundary is what already cost a bug on the
 * crossing chip, where the conflict's ``gapIndex`` indexed the litho frame's
 * column list rather than the caller's (see
 * ``PartitionFillOverlay.onJumpToConflictGap``).
 *
 * Pure, so the rule can be pinned without mounting the 4 000-line panel.
 *
 * @module components/sections/resolveColumnReveal
 */

/** One drawn column, reduced to what the centring needs. */
export interface ColumnPosition {
  /** The investigation the column stands for. */
  id: string
  /** Where it is actually DRAWN in screen px, after packing and nudging. */
  nudgedX: number
}

/** Where to point the camera, and what could not be found. */
export interface ResolvedReveal {
  /**
   * Screen X to centre on, or ``null`` when anything asked for is not drawn.
   *
   * Null rather than a best effort: panning to the one end that IS drawn tells
   * the engineer the tie is there when half of it is not.
   */
  centreX: number | null
  /** Requested ids with no drawn column, in the order they were asked for. */
  missingInvestigationIds: string[]
}

/**
 * Resolve a reveal request against the columns the section is drawing.
 *
 * Parameters
 * ----------
 * investigationIds : readonly string[]
 *     Investigations that must all be drawn — typically a tie's two ends.
 * columns : readonly ColumnPosition[]
 *     The panel's own drawn columns.
 *
 * Returns
 * -------
 * ResolvedReveal
 *     The centre to pan to, or the ids that stopped it.
 */
export function resolveColumnReveal(
  investigationIds: readonly string[],
  columns: readonly ColumnPosition[],
): ResolvedReveal {
  const byId = new Map(columns.map(c => [c.id, c.nudgedX]))
  const missingInvestigationIds = investigationIds.filter(id => !byId.has(id))
  if (missingInvestigationIds.length > 0 || investigationIds.length === 0) {
    return { centreX: null, missingInvestigationIds }
  }
  const xs = investigationIds.map(id => byId.get(id) as number)
  // Midpoint of the SPAN, not the mean: with three or more columns the mean
  // drifts toward wherever they cluster, and the point of the pan is to frame
  // the whole tie.
  return {
    centreX: (Math.min(...xs) + Math.max(...xs)) / 2,
    missingInvestigationIds,
  }
}
