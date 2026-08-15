/**
 * The seam-stroke pass's element list — including the CARD strips.
 *
 * ``sectionSeamStrokes.ts`` keeps a fill polygon's hairline-closing stroke only
 * where the edge's outward side is not covered by a same-formation fill. Its
 * three cases are same-formation neighbour (drop), different formation (keep),
 * unfilled space (keep) — and its docstring still names "the column glyph
 * strip" as unfilled space, which was true when it was written.
 *
 * It stopped being true when the fill started painting THROUGH the cards
 * (``columnStripFills.ts``, 2026-08-14). The strips joined the dissolved FILL
 * layer but not this classifier, so every gap region still counted its card
 * edge as bordering nothing and stroked it. A self-colour stroke over the
 * region's own translucent fill composites darker (0.62 over 0.62 ≈ 0.855), so
 * the result is a darker rim down the gap side of every card edge — one soil
 * body reading as two tones across the card boundary, which is the residue the
 * owner kept seeing after the veil went to 0 ("fill tone still seems a bit
 * off?", dogfeed 2026-08-15; measured that day: 0 double coats and 0 opacity
 * mismatches at any card edge on all 14 sections, so the veil arithmetic was
 * never the remaining half).
 *
 * The strips are classification-only: they are not stroked themselves (they
 * never were), they only tell the classifier that the card is filled.
 *
 * Pure: no React, no DOM — see ``sectionSeamStrokeElements.test.ts``.
 */

import { computeSeamStrokePaths, type SeamStrokeElement } from './sectionSeamStrokes'

/** Stroke path data for the two element groups the overlay actually draws. */
export interface SectionSeamStrokes {
  /** Index-aligned with the under-column substrate quads. */
  undercol: string[]
  /** Index-aligned with the gap regions. */
  regions: string[]
}

/**
 * Classify every fill edge with the cards counted as filled ground.
 *
 * Parameters
 * ----------
 * underColumnFills : readonly SeamStrokeElement[]
 *     The below-TD substrate quads, in render order.
 * screenRegions : readonly SeamStrokeElement[]
 *     The gap regions, in render order.
 * columnStrips : readonly SeamStrokeElement[]
 *     The card-covering quads. Classification input ONLY — they carry no
 *     stroke of their own and never appear in the result.
 *
 * Returns
 * -------
 * SectionSeamStrokes
 *     ``undercol`` and ``regions``, each index-aligned with its input.
 */
export function computeSectionSeamStrokes(
  underColumnFills: readonly SeamStrokeElement[],
  screenRegions: readonly SeamStrokeElement[],
  columnStrips: readonly SeamStrokeElement[],
): SectionSeamStrokes {
  if (underColumnFills.length + screenRegions.length === 0) {
    return { undercol: [], regions: [] }
  }
  // Strips LAST so the two stroked groups keep the indices the caller expects;
  // their own entries are dropped with the slice.
  const ds = computeSeamStrokePaths([...underColumnFills, ...screenRegions, ...columnStrips])
  return {
    undercol: ds.slice(0, underColumnFills.length),
    regions: ds.slice(underColumnFills.length, underColumnFills.length + screenRegions.length),
  }
}
