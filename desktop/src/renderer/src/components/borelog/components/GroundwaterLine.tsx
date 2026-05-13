import type { ReactElement } from 'react'

import { usePxPerM } from '../utils'

/**
 * Horizontal dashed line marking the water table inside the canvas.
 *
 * Spans the full track band (``fromX`` → ``toX``) at the water-table
 * depth, with a small ``▾ water at X.XX m`` label above the line so
 * the level reads at a glance even on dense borelogs.
 *
 * Skipped entirely when the water table is below the deepest drawn
 * extent — drawing it past the canvas just confuses.
 */
export function GroundwaterLine({
  waterDepth,
  fromX,
  toX,
  y,
  totalDepth,
}: {
  waterDepth: number
  fromX: number
  toX: number
  y: number
  totalDepth: number
}): ReactElement | null {
  const PX_PER_M = usePxPerM()
  if (waterDepth > totalDepth) return null

  const ly = y + waterDepth * PX_PER_M
  return (
    <g>
      <line
        x1={fromX}
        x2={toX}
        y1={ly}
        y2={ly}
        stroke="#1e88e5"
        strokeWidth={1.2}
        strokeDasharray="6 3"
      />
      <text
        x={fromX + 4}
        y={ly - 3}
        fontSize={9}
        fill="#1e88e5"
        fontStyle="italic"
      >
        ▾ water at {waterDepth.toFixed(2)} m
      </text>
    </g>
  )
}
