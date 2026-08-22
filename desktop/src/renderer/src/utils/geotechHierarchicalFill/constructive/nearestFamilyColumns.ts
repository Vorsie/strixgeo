/**
 * THE NEAREST CARRYING TEST ON EACH SIDE — who may speak for the ground in a
 * gap no run of this family brackets.
 *
 * Ordinarily a gap's ground is answered by its RUN: the two banded tests the
 * ground runs between (``familyFill``'s per-gap ``run``). A gap at the edge
 * of a family's extent — or between two of its runs — has no such pair, and
 * the fill used to fall back to *every* banded column of the family, anywhere
 * in the section, for both jobs it needs columns for: drawing each band's own
 * level as a horizontal across the gap, and offering candidates to the
 * dominant-mass step.
 *
 * That fallback has no notion of distance, and ``pickDominant`` ranks
 * ``ownsLevel`` — "does this mass own this very level" — ABOVE nearness,
 * deliberately and correctly ("the own-column rule is absolute and outranks
 * thickness"; it is what stops a thick neighbour painting over a thin log at
 * its own test). Between a gap's own two flanks that ordering is right. Over
 * the whole section it is not: on the owner's real CS1, gap 11's silt cover
 * (the family's westernmost column IS its right flank, B3 at ci 12, so no run
 * brackets the gap) had a 16 cm sliver at +11.73..+11.89 handed to
 * GEO-23/125-S7's SILT·MF band **144 m away** — the only band in the whole
 * family whose own window contained that elevation, since B3's own silt stops
 * at +11.98 and GEO-23/125-S9's starts at +11.73. It rendered as the slightly
 * greener quad the owner circled, wedged between two slivers of its own
 * neighbour's SILT·SF.
 *
 * The rule this module states: **only the nearest carrying test on each side
 * speaks for the ground beside it.** A test that never measured anywhere near
 * this ground states nothing about it — neither its class nor its levels.
 *
 * Pure module — no I/O, no React.
 *
 * @module utils/geotechHierarchicalFill/constructive/nearestFamilyColumns
 */

import type { RunColumn } from './constructs'

/**
 * The family's nearest banded column on each side of one gap.
 *
 * A gap with index ``g`` lies between frame columns ``g`` (left) and ``g + 1``
 * (right), so a column with ``ci <= g`` is on the left side and one with
 * ``ci >= g + 1`` is on the right.
 *
 * @param columns Every banded column of the family (any order).
 * @param gapIndex The frame gap being filled.
 * @returns At most two columns — the nearest on the left, then the nearest on
 *   the right. One-sided gaps return one; a family with no columns returns
 *   none.
 */
export function nearestFamilyColumns(
  columns: readonly RunColumn[],
  gapIndex: number,
): RunColumn[] {
  let left: RunColumn | null = null
  let right: RunColumn | null = null
  for (const column of columns) {
    if (column.ci <= gapIndex) {
      if (left === null || column.ci > left.ci) left = column
    } else if (right === null || column.ci < right.ci) {
      right = column
    }
  }
  const out: RunColumn[] = []
  if (left !== null) out.push(left)
  if (right !== null) out.push(right)
  return out
}
