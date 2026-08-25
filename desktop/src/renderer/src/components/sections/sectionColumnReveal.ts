/**
 * The contract by which something outside the section canvas asks it to bring a
 * pair of columns into view.
 *
 * The caller names INVESTIGATIONS and an edge to flash. It never names a
 * position, an index, or a column-list slot — resolving where a column is drawn
 * belongs to the surface that drew it, and only that surface. The same rule
 * cost a real bug once already on the crossing chip, where the conflict's
 * ``gapIndex`` lived on the litho frame's column list rather than on the
 * caller's visible-column list; see ``PartitionFillOverlay.onJumpToConflictGap``.
 *
 * ``SectionPanel`` implements it (it owns ``visibleColumns`` and the pan);
 * ``SectionsCanvas`` holds the implementation and hands the outcome up.
 *
 * @module components/sections/sectionColumnReveal
 */

/** What to bring on screen, named the only way the caller can name it. */
export interface SectionColumnRevealRequest {
  /** Investigations whose columns must all be drawn for this to succeed. */
  investigationIds: readonly string[]
  /**
   * Correlation edge to highlight once the view has been centred.
   *
   * Passed through untouched: the panel only forwards it to the overlay that
   * draws that edge, which resolves it against its own edge list.
   */
  flashEdgeId: string
}

/** What the section view did — or could not do — with the request. */
export interface SectionColumnRevealResult {
  /** Every requested column was drawn, and the view has been centred on them. */
  revealed: boolean
  /**
   * Requested investigation ids the section view is NOT drawing.
   *
   * Ids only, deliberately: the panel is the authority on *whether* a column is
   * drawn, and the shell is the authority on *why* it is not — the shell can
   * see the project-level manifest and removed-set gates that never reach the
   * panel. Splitting it this way means the two can never disagree.
   */
  missingInvestigationIds: string[]
}

/** The panel-side implementation, published upward by ``SectionPanel``. */
export type SectionColumnRevealFn = (
  request: SectionColumnRevealRequest,
) => SectionColumnRevealResult
