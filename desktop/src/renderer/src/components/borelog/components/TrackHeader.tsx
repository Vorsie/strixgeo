import type { ReactElement } from 'react'

import { HEADER_HEIGHT } from '../constants'
import { truncate } from '../utils'

/**
 * Title block at the top of every SVG track.
 *
 * Renders a faint background rectangle with a bold title line + an
 * optional muted subtitle (author / interpretation kind). Text is
 * horizontal — diagonal looks nice on print but is hard to read at
 * on-screen sizes; the rectangle absorbs the column width so
 * narrower stratigraphy tracks don't bleed.
 *
 * Title and subtitle are length-truncated client-side because SVG has
 * no synchronous ``measureText`` — magic numbers (22 chars / 26 chars)
 * were dialled in against the default 150 px / 90 px column widths.
 */
export function TrackHeader({
  x,
  width,
  y,
  title,
  subtitle,
}: {
  x: number
  width: number
  y: number
  title: string
  subtitle: string | null
}): ReactElement {
  return (
    <g>
      {/* fill / stroke use CSS custom properties so TrackHeader is legible
          in both light and dark themes without prop drilling the theme down
          into every SVG sub-component. Vars defined in index.css. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={HEADER_HEIGHT}
        fill="var(--borelog-track-header-bg)"
        stroke="var(--borelog-track-header-border)"
        strokeWidth={0.5}
      />
      <text x={x + 4} y={y + 14} fontSize={10} fontWeight={600} fill="var(--borelog-text-primary)">
        {truncate(title, 22)}
      </text>
      {subtitle && (
        <text x={x + 4} y={y + 28} fontSize={9} fill="var(--borelog-text-muted)">
          {truncate(subtitle, 26)}
        </text>
      )}
    </g>
  )
}
