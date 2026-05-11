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
// Algorithm: single left-to-right pass. Sort items by trueX, walk
// in order, pushing each one to ``max(trueX, prev + minGap)``.
// Cascades — a tight cluster of 5 items propagates rightward, the
// first stays at its true position. A future iteration could
// centre clusters on their mean for symmetric distribution; the
// trade-off is added math vs. legibility, and v1's tie-backs make
// the asymmetry already inspectable.

export interface NudgeInput {
  /** Pixel position where the column would naturally land. */
  trueX: number
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
 * Nudge a set of column screen X-positions so no two are closer
 * than ``minGap`` pixels. Output is in ascending-X order (i.e.
 * sorted by ``trueX``). The original array is not mutated.
 */
export function nudgeColumns<T extends NudgeInput>(
  items: readonly T[],
  minGap: number,
): NudgeResult<T>[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.trueX - b.trueX)
  const out: NudgeResult<T>[] = []
  let prev = -Infinity
  for (const item of sorted) {
    // ``Math.max`` enforces the minimum gap from the previous
    // nudged position. The first column in a sorted run keeps its
    // true position (prev=-Infinity → nudged = trueX).
    const nudged = Math.max(item.trueX, prev + minGap)
    out.push({
      item,
      trueX: item.trueX,
      nudgedX: nudged,
      // Half a pixel is below the screen-render granularity, so
      // anything tinier is "effectively at the true position".
      displaced: Math.abs(nudged - item.trueX) > 0.5,
    })
    prev = nudged
  }
  return out
}
