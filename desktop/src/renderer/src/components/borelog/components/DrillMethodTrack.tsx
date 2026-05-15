import type { ReactElement } from 'react'

import type { DrillSegmentResponse } from '../../../api/client'
import { drillMethodStyle } from '../../../utils/drillMethodColors'
import { truncate, usePxPerM } from '../utils'

/**
 * Vertical track showing the driller's recorded method per segment
 * (mechanical auger / wash boring / sonic / ...). Each segment is a
 * coloured rectangle whose fill is keyed off the method string via
 * ``drillMethodStyle``; the method label is rendered inside when the
 * segment is tall enough to fit, with a hover tooltip surfacing the
 * full method + depth range.
 */
export function DrillMethodTrack({
  segments,
  x,
  y,
  width,
  totalDepth,
}: {
  segments: DrillSegmentResponse[]
  x: number
  y: number
  width: number
  totalDepth: number
}): ReactElement {
  const PX_PER_M = usePxPerM()
  return (
    <g>
      {/* Background rect — CSS var so the track is visible against the
          dark canvas surface (index.css --borelog-track-bg). */}
      <rect
        x={x}
        y={y}
        width={width}
        height={totalDepth * PX_PER_M}
        fill="var(--borelog-track-bg)"
        stroke="var(--borelog-track-header-border)"
        strokeWidth={0.5}
      />
      {segments.map(seg => {
        const top = y + seg.top_m * PX_PER_M
        const height = (seg.base_m - seg.top_m) * PX_PER_M
        const style = drillMethodStyle(seg.method)
        return (
          <g key={seg.id}>
            <title>
              {`${seg.top_m.toFixed(2)} – ${seg.base_m.toFixed(2)} m\n${seg.method ?? '—'}`}
            </title>
            <rect
              x={x}
              y={top}
              width={width}
              height={height}
              fill={style.fill}
              stroke="#9ca3af"
              strokeWidth={0.4}
            />
            {height >= 14 && (
              // Text rendered on top of the domain drill-method fill colour.
              // #1f2937 (near-black) is legible on the mid-saturation curated
              // fills in light theme; on dark theme the fills are unchanged
              // but near-black text on them still reads well because the fills
              // are not dark. The badge-text token is lighter, intended for
              // pill-on-dark-bg — not applicable here; keep near-black.
              <text
                x={x + width / 2}
                y={top + height / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fill="#1f2937"
              >
                {truncate(seg.method ?? '', 12)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
