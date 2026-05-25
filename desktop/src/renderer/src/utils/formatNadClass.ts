/**
 * Pure formatter for the NAD class tooltip label.
 *
 * The segmenter merge pass (debt #119) introduces ``nad_class_range``
 * on merged ghost layers. A range of (3, 7) means the constituent
 * Robertson segments spanned NAD classes 3 through 7; (5, 5) means
 * they all share class 5.
 *
 * Precedence: ``range`` wins when present; ``single`` is the fallback
 * for un-merged / borehole-path layers that only carry the scalar
 * ``suggested_nad_class``. Returns ``null`` when neither is available
 * (non-sand, borehole-observation layers without a Robertson zone).
 */

/**
 * Format a NAD class value for display in the ghost-layer tooltip.
 *
 * @param range  Merged segment range [lo, hi] or null.
 * @param single Scalar suggested_nad_class (un-merged / borehole) or null.
 * @returns      Display string e.g. "NAD 5", "NAD 1–3", or null.
 */
export function formatNadClass(
  range: [number, number] | null | undefined,
  single: number | null | undefined,
): string | null {
  if (range != null) {
    const [lo, hi] = range
    return lo === hi ? `NAD ${lo}` : `NAD ${lo}–${hi}`
  }
  if (single != null) return `NAD ${single}`
  return null
}
