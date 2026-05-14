// Word-aware label wrapping for narrow SVG ghost columns.
//
// All three Virtuele Boring overlay surfaces (section view, CPT
// chart depth column, borehole log rail) face the same problem:
// labels like "Quartaire Aquifersystemen" need to fit in a 44–50 px
// wide column without cutting off mid-syllable. The shared helper
// produces an array of lines, wrapping on whitespace where possible
// and falling back to mid-word splits when a single word exceeds the
// per-line budget. The final line gets an ellipsis when content had
// to be dropped to honour the line cap.
//
// The function is character-aware, not pixel-aware — measuring SVG
// text width per render is expensive. Callers compute
// ``maxCharsPerLine`` from the column width + font size once; the
// resulting layout is "approximately right" rather than typographically
// optimal, which is fine for a faded informational overlay.

/**
 * Wrap a label to fit within ``maxLines`` lines of ``maxCharsPerLine``
 * characters each.
 *
 * Algorithm:
 *  1. Tokenise on whitespace, pre-splitting oversized words at the
 *     line boundary.
 *  2. Greedy-pack tokens onto lines.
 *  3. If the natural wrap exceeds ``maxLines``, take the first
 *     ``maxLines - 1`` lines as-is and pack as much remainder as
 *     fits into the last line, ending with an ellipsis.
 *
 * @returns Array of lines. Length ranges from 0 (empty input) to
 *   ``maxLines``. Each entry is the visible text for that line — no
 *   trailing whitespace.
 */
export function wrapLabelToLines(
  label: string,
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  if (maxLines <= 0 || maxCharsPerLine <= 0) return []
  const trimmed = label.trim()
  if (trimmed.length === 0) return []

  // Step 1: tokenise into atoms small enough to fit on a line. A token
  // is normally a whitespace-delimited word, but oversized tokens get
  // pre-split into ``maxCharsPerLine``-sized fragments so the greedy
  // packer can place them as if they were normal words.
  const rawTokens = trimmed.split(/\s+/)
  const tokens: string[] = []
  for (const t of rawTokens) {
    if (t.length <= maxCharsPerLine) {
      tokens.push(t)
    } else {
      let remaining = t
      while (remaining.length > maxCharsPerLine) {
        tokens.push(remaining.slice(0, maxCharsPerLine))
        remaining = remaining.slice(maxCharsPerLine)
      }
      if (remaining.length > 0) tokens.push(remaining)
    }
  }

  // Step 2: greedy pack tokens onto lines — no early termination.
  // Overflow handling is deferred to step 3 so we know exactly what
  // content would otherwise have been dropped.
  const allLines: string[] = []
  let current = ''
  for (const t of tokens) {
    if (current.length === 0) {
      current = t
      continue
    }
    if (current.length + 1 + t.length <= maxCharsPerLine) {
      current = current + ' ' + t
    } else {
      allLines.push(current)
      current = t
    }
  }
  if (current.length > 0) allLines.push(current)

  // Step 3: if the wrap fits the cap, return as-is. Otherwise keep
  // the first (maxLines - 1) lines untouched, then fill the last
  // visible line with as much remainder as fits + ellipsis. This
  // packs more text into view than a "push and bail" approach,
  // which is the difference between "e…" and "e Aquif…" — the
  // latter is more informative.
  if (allLines.length <= maxLines) return allLines
  const visible = allLines.slice(0, maxLines - 1)
  const remainderTokens = allLines.slice(maxLines - 1)
  const remainder = remainderTokens.join(' ')
  if (remainder.length <= maxCharsPerLine - 1) {
    visible.push(remainder + '…')
  } else {
    visible.push(remainder.slice(0, maxCharsPerLine - 1) + '…')
  }
  return visible
}

/**
 * Compute how many lines of a given font size fit inside a rect of
 * a given height. Each line consumes ``fontSize * lineHeightMultiplier``
 * pixels; we deduct a small top/bottom inset so text doesn't touch the
 * rect edges.
 *
 * Returns 0 when the rect is too short to fit even one line, so the
 * caller can fall back to a tooltip-only render without a partial
 * label.
 */
export function maxLinesForHeight(
  rectHeight: number,
  fontSize: number,
  lineHeightMultiplier = 1.15,
  verticalInsetPx = 2,
): number {
  const usable = rectHeight - verticalInsetPx * 2
  if (usable <= 0) return 0
  const lineHeight = fontSize * lineHeightMultiplier
  if (lineHeight <= 0) return 0
  return Math.max(0, Math.floor(usable / lineHeight))
}

/**
 * Translate a column width + font size into a sensible chars-per-line
 * budget. Calibrated for Helvetica-style sans-serif at ≈ 0.55 × fontSize
 * pixels per character. Always returns at least 1 so callers don't get
 * an empty wrap layout for extreme widths.
 */
export function maxCharsForWidth(
  columnWidth: number,
  fontSize: number,
  horizontalInsetPx = 2,
): number {
  const usable = Math.max(0, columnWidth - horizontalInsetPx * 2)
  const charPx = Math.max(1, fontSize * 0.55)
  return Math.max(1, Math.floor(usable / charPx))
}
