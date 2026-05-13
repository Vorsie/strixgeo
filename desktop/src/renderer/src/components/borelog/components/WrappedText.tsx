import type { ReactElement } from 'react'

import { truncate } from '../utils'

/**
 * Word-wrap an SVG text label inside a bounded rectangle.
 *
 * Splits on whitespace, packs words greedily into lines that fit
 * ``maxWidth`` (estimated via average char width — SVG has no
 * ``measureText`` we can use synchronously), stops adding lines once
 * the next line would push past ``maxHeight``, and ellipsises the
 * last line when more words remain. Lines are emitted as ``<tspan>``s
 * with ``dy`` line spacing relative to the centre baseline.
 *
 * Used for the stratigraphy column where descriptions like
 * ``"Paleogeen: Formatie van Kortrijk - Lid van Roubaix"`` need to
 * read across multiple lines on tall layers (instead of overflowing
 * into the next column) and gracefully degrade to a single
 * truncated line on thin layers.
 */
export function WrappedText({
  text,
  centerX,
  centerY,
  maxWidth,
  maxHeight,
  fontSize,
  fontWeight,
  fill,
}: {
  text: string
  centerX: number
  centerY: number
  maxWidth: number
  maxHeight: number
  fontSize: number
  fontWeight?: number
  fill: string
}): ReactElement {
  // Average character width at 11pt ≈ 6 px for the Inter / system
  // fallback we ship. Approximate but stable enough for packing
  // words; centre alignment + ellipsis absorb the slack.
  const charW = fontSize * 0.55
  const lineH = fontSize * 1.15
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / charW))
  const maxLines = Math.max(1, Math.floor(maxHeight / lineH))

  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      current = candidate
    } else {
      if (current) lines.push(current)
      // Word longer than the line itself — hard-truncate.
      current = word.length <= maxCharsPerLine ? word : truncate(word, maxCharsPerLine)
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)

  // If we ran out of room before consuming every word, ellipsise the
  // last line so the user sees that more text exists.
  const consumedAll =
    lines.join(' ').length >= text.replace(/\s+/g, ' ').length - 1 &&
    lines.length <= maxLines
  if (!consumedAll && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = truncate(last, Math.max(1, last.length))
    // truncate only changes if it's already at the limit — force ellipsis:
    if (!lines[lines.length - 1].endsWith('…')) {
      lines[lines.length - 1] = truncate(last + ' …', maxCharsPerLine)
    }
  }

  // Centre vertically: the FIRST line's y offset is centerY minus the
  // half-stack so the whole block is balanced around centerY.
  const firstY = centerY - ((lines.length - 1) * lineH) / 2 + fontSize / 3

  return (
    <text
      x={centerX}
      y={firstY}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight={fontWeight}
      fill={fill}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  )
}
