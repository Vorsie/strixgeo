// Cross-section column nudging — keep crowded columns readable
// without lying about where they actually project on the line.
//
// The challenge: when N investigations project to nearly the same
// along-distance, their columns on the panel canvas overlap into
// an unreadable stack. The DOV "lengteprofiel" just lets them
// overlap — engineers can't read either column. Our fix: nudge
// each column rightward enough to fit a minimum gap, but draw a
// tie-back diagonal from the displaced column to a tick at its
// TRUE projected position. Reader gets both pieces:
//
//   * "this column is rendered HERE" (the displaced position),
//   * "but it actually projects THERE" (the tie-back tick).
//
// Spacing rule: edge-to-edge. Each item carries its own ``width``;
// adjacent items must keep at least ``edgeGap`` pixels of clear air
// between their edges. This generalises the previous "center-to-
// center" rule which assumed every column had the same width — the
// moment qc curves / Rf strips / borehole interpretation tracks
// land inside the columns, widths vary by toggle state and
// kind, and a fixed center-gap either wastes space or under-spaces
// wide columns.
//
// Algorithm: single left-to-right pass. Sort items by trueX, walk
// in order, pushing each one to keep ``halfWidth_prev + edgeGap +
// halfWidth_curr`` of clear space from the previous nudged center.
// Cascades — a tight cluster of 5 items propagates rightward, the
// first stays at its true position. A future iteration could
// centre clusters on their mean for symmetric distribution; the
// trade-off is added math vs. legibility, and v1's tie-backs make
// the asymmetry already inspectable.

export interface NudgeInput {
  /** Pixel position where the column would naturally land
   * (centerline). */
  trueX: number
  /** Visible pixel width of the column at its widest point. The
   * nudge enforces ``halfWidth_prev + edgeGap + halfWidth_curr``
   * of clear space between adjacent centerlines. */
  width: number
}

export interface NudgeResult<T extends NudgeInput> {
  item: T
  /** Original (un-displaced) screen X. Same as ``item.trueX`` —
   * exposed at the top level so callers don't have to thread the
   * generic. */
  trueX: number
  /** Where the column actually draws after nudging. Equal to
   * ``trueX`` when no displacement was needed. */
  nudgedX: number
  /** ``true`` when the column had to move more than half a pixel
   * from its true position. The renderer uses this to decide
   * whether to draw a tie-back. */
  displaced: boolean
}

/**
 * Nudge a set of column screen X-positions so adjacent columns
 * keep at least ``edgeGap`` pixels of clear space between their
 * edges. Each item declares its own ``width`` so mixed-width
 * profiles (data-laden CPTs next to bare boreholes) space
 * correctly. Output is in ascending-X order (i.e. sorted by
 * ``trueX``). The original array is not mutated.
 */
export function nudgeColumns<T extends NudgeInput>(
  items: readonly T[],
  edgeGap: number,
): NudgeResult<T>[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.trueX - b.trueX)
  const out: NudgeResult<T>[] = []
  // Track the previous column's nudged-X-centerline + half-width
  // separately so the next item's minimum position can be expressed
  // cleanly: ``prevNudgedX + prevHalfWidth + edgeGap + currHalfWidth``.
  let prevNudgedX = -Infinity
  let prevHalfWidth = 0
  for (const item of sorted) {
    const halfWidth = item.width / 2
    // First column in a sorted run lands at its true position
    // (prev = -Infinity → the max() picks trueX).
    const minCenter = prevNudgedX + prevHalfWidth + edgeGap + halfWidth
    const nudged = Math.max(item.trueX, minCenter)
    out.push({
      item,
      trueX: item.trueX,
      nudgedX: nudged,
      // Half a pixel is below the screen-render granularity, so
      // anything tinier is "effectively at the true position".
      displaced: Math.abs(nudged - item.trueX) > 0.5,
    })
    prevNudgedX = nudged
    prevHalfWidth = halfWidth
  }
  return out
}
