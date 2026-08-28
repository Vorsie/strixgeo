/**
 * The contract by which something outside the section canvas asks it to bring a
 * pair of columns into view.
 *
 * The caller names INVESTIGATIONS and an optional landing marker. It never names a
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
   * draws that edge, which resolves it against its own edge list. Omitted when
   * the reveal is about a column rather than a tie between two.
   */
  flashEdgeId?: string
  /**
   * Investigation whose COLUMN gets the landing pulse once the view has been
   * centred — the same one-shot flash Ctrl+F lands with, so a reveal that is
   * about one test looks like every other "here it is" in the section view.
   *
   * The Build pre-flight's one-click visit uses this (owner ruling 2026-08-26:
   * *"make it so that user can go to those test through one click"*): there is
   * no tie to mark, only a test he has to subdivide.
   */
  flashColumnId?: string
  /**
   * The two investigations bounding a GAP whose span gets the landing pulse.
   *
   * A model-check finding belongs to the ground between its columns, not to
   * either column. The panel resolves this pair against the same live column
   * layout it just centred, so even a very narrow gap receives a visible marker
   * without an index or an X coordinate crossing the boundary.
   */
  flashGapInvestigationIds?: readonly [string, string]
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
