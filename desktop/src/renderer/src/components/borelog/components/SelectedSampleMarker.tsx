import type { ReactElement } from 'react'

import type { SampleResponse } from '../../../api/client'
import { usePxPerM } from '../utils'

/**
 * Translucent yellow band overlay marking the selected sample's
 * depth interval across the full canvas width.
 *
 * Drawn after every track so it always sits on top; uses a low alpha
 * so the underlying lithology patterns and codes stay readable. Small
 * triangular markers on the left + right edges sharpen the "you are
 * here" signal.
 *
 * For spot samples (``depth_top == depth_base``) the band defaults to
 * 4 px tall so it doesn't collapse into an invisible line.
 *
 * ``pointerEvents: none`` so clicks through to the underlying sample
 * row are preserved (the overlay sits over the samples track).
 */
export function SelectedSampleMarker({
  sample,
  fromX,
  toX,
  y,
}: {
  sample: SampleResponse
  fromX: number
  toX: number
  y: number
}): ReactElement {
  const PX_PER_M = usePxPerM()
  const top = y + sample.depth_top_m * PX_PER_M
  const rawHeight = (sample.depth_base_m - sample.depth_top_m) * PX_PER_M
  const height = Math.max(rawHeight, 4)
  const width = toX - fromX
  // Tailwind ``yellow-400`` at low alpha — vivid enough to spot,
  // translucent enough to read through. The edge stroke is
  // ``yellow-600`` at higher alpha for definition.
  const fill = 'rgba(250, 204, 21, 0.30)'
  const stroke = 'rgba(202, 138, 4, 0.85)'
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={fromX} y={top} width={width} height={height} fill={fill} stroke="none" />
      <line x1={fromX} x2={toX} y1={top} y2={top} stroke={stroke} strokeWidth={1} />
      <line
        x1={fromX}
        x2={toX}
        y1={top + height}
        y2={top + height}
        stroke={stroke}
        strokeWidth={1}
      />
      <polygon
        points={`${fromX},${top + height / 2} ${fromX + 8},${top + height / 2 - 5} ${fromX + 8},${top + height / 2 + 5}`}
        fill={stroke}
      />
      <polygon
        points={`${toX},${top + height / 2} ${toX - 8},${top + height / 2 - 5} ${toX - 8},${top + height / 2 + 5}`}
        fill={stroke}
      />
    </g>
  )
}
