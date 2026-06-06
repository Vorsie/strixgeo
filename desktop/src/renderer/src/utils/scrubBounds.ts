/**
 * Pure geometry helper for the section scrub-bar track bounds.
 *
 * The scrub-bar track represents the along-section span the engineer can
 * pan over. It must match the RENDERED extent of the placed columns — not
 * their raw projected along-section positions.
 *
 * Why the distinction matters: the section view applies a spacing warp
 * (``column_spacing`` lerp + width-aware collision nudge) so adjacent
 * columns don't overlap. At low spacing the columns pack LEFT, so a
 * column's rendered screen x (``nudgedX``) sits left of
 * ``xToScreen(rawAlong)``. If the scrub bounds use the raw along, the
 * handle lets the viewport scroll well past the packed columns into empty
 * space (dogfeed 2026-06-06). Mapping each column's ``nudgedX`` back
 * through the viewport inverse (``screenXToAlong``) yields its
 * warp-effective along — the world-m coordinate that actually renders at
 * the packed position — and the extremes of those are the true track
 * bounds. This is pan-independent: ``nudgedX`` already embeds the current
 * ``viewport.xMin``, which ``screenXToAlong`` adds back, so the two cancel.
 */

/** A placed section column, reduced to the only field the bounds need. */
export interface ScrubBoundsColumn {
  /** Rendered screen x of the column after the spacing warp + nudge. */
  nudgedX: number
}

/** Inclusive along-section range (world metres) the scrub track spans. */
export interface ScrubBounds {
  min: number
  max: number
}

/**
 * Compute the scrub-bar track bounds from the placed columns.
 *
 * Parameters
 * ----------
 * columns
 *     The placed section columns, each carrying its rendered ``nudgedX``.
 * screenXToAlong
 *     The viewport's screen-x → along-section inverse (the same transform
 *     used to render). Applied to each column's ``nudgedX`` to recover its
 *     warp-effective along.
 * fallback
 *     Range to return when ``columns`` is empty (e.g. a fresh section
 *     before projection lands), so the bar stays grab-able.
 *
 * Returns
 * -------
 * ScrubBounds
 *     The min/max warp-effective along over all columns, or ``fallback``
 *     when there are no columns.
 */
export function computeScrubBounds(
  columns: readonly ScrubBoundsColumn[],
  screenXToAlong: (screenX: number) => number,
  fallback: ScrubBounds,
): ScrubBounds {
  if (columns.length === 0) return fallback
  let min = Infinity
  let max = -Infinity
  for (const col of columns) {
    const effectiveAlong = screenXToAlong(col.nudgedX)
    if (effectiveAlong < min) min = effectiveAlong
    if (effectiveAlong > max) max = effectiveAlong
  }
  return { min, max }
}
