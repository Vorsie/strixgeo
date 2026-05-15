import type { ReactElement } from 'react'

import { soilStyle } from '../../../utils/soilColors'

interface Admixture {
  soil_code: string
  amount: string
  locally: boolean
}

/**
 * Per-layer admixture chips rendered along the bottom of a lithology
 * layer block.
 *
 * Chips render as: ``[■] amount code [(loc.)]`` separated by a small
 * gap, packed left-to-right inside ``maxWidth``. When too many chips
 * don't fit we drop the last ones and show ``+N`` to flag the
 * truncation. The hover ``<title>`` on the parent layer block already
 * lists every admixture, so truncation here only affects the visible
 * label.
 *
 * Chip widths are estimated from average character width — SVG has no
 * synchronous ``measureText``. The estimate is conservative enough
 * that the +N counter rarely lies in practice.
 */
export function AdmixtureChips({
  admixtures,
  x,
  y,
  maxWidth,
}: {
  admixtures: Admixture[]
  x: number
  y: number
  maxWidth: number
}): ReactElement {
  const SWATCH = 7 // colour square edge
  const GAP = 6
  const CHAR_W = 5 // average char width at 9pt

  const chips: { label: string; fill: string; width: number }[] = []
  let usedWidth = 0
  let dropped = 0

  for (const a of admixtures) {
    const text = `${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`
    const chipWidth = SWATCH + 2 + text.length * CHAR_W + GAP
    if (usedWidth + chipWidth > maxWidth && chips.length > 0) {
      dropped = admixtures.length - chips.length
      break
    }
    chips.push({ label: text, fill: soilStyle(a.soil_code).fill, width: chipWidth })
    usedWidth += chipWidth
  }

  let cursor = 0
  return (
    <g>
      {chips.map((chip, i) => {
        const cx = x + cursor
        cursor += chip.width
        return (
          <g key={i}>
            {/* Swatch: domain soil-colour fill (soilStyle — must not change).
                Border and label text use CSS vars so they stay legible on dark. */}
            <rect
              x={cx}
              y={y + 1}
              width={SWATCH}
              height={SWATCH}
              fill={chip.fill}
              stroke="var(--borelog-text-primary)"
              strokeWidth={0.4}
              rx={1}
            />
            <text x={cx + SWATCH + 2} y={y + 8} fontSize={9} fill="var(--borelog-badge-text)">
              {chip.label}
            </text>
          </g>
        )
      })}
      {dropped > 0 && (
        <text
          x={x + cursor}
          y={y + 8}
          fontSize={9}
          fill="var(--borelog-text-muted)"
          fontStyle="italic"
        >
          +{dropped}
        </text>
      )}
    </g>
  )
}
