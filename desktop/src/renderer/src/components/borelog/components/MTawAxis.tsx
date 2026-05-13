import type { ReactElement } from 'react'

import { verticalDatumShort } from '../../../utils/verticalDatum'
import { M_TAW_AXIS_WIDTH } from '../constants'
import { formatMtaw, roundTo, usePxPerM } from '../utils'

/**
 * Absolute-level (Z) axis on the left edge of the SVG canvas.
 *
 * Renders a vertical guide line with tick marks at the surface, every
 * whole-metre level, and the bottom. Tick labels are absolute levels in
 * the row's vertical datum (signed, 2 decimals). The header chip above
 * the axis switches based on ``zEpsg`` — "MTAW" / "NAP" / "M" — so the
 * user always sees what datum the numbers are in.
 *
 * Surface and bottom ticks are deduplicated against the whole-metre
 * series so they don't double up when those happen to land on whole
 * metres.
 */
export function MTawAxis({
  x,
  y,
  height,
  surfaceElevation,
  totalDepth,
  zEpsg,
}: {
  x: number
  y: number
  height: number
  surfaceElevation: number
  totalDepth: number
  zEpsg: number | null
}): ReactElement {
  const PX_PER_M = usePxPerM()
  const bottomElevation = surfaceElevation - totalDepth
  const ticks = new Set<number>()
  ticks.add(roundTo(surfaceElevation, 2))
  for (let lvl = Math.floor(surfaceElevation); lvl > bottomElevation; lvl -= 1) {
    if (lvl < surfaceElevation && lvl > bottomElevation) ticks.add(lvl)
  }
  ticks.add(roundTo(bottomElevation, 2))

  const axisRight = x + M_TAW_AXIS_WIDTH

  return (
    <g>
      <line
        x1={axisRight - 1}
        x2={axisRight - 1}
        y1={y}
        y2={y + height}
        stroke="#d4d4d8"
        strokeWidth={1}
      />
      <text
        x={axisRight - 4}
        y={y - 6}
        textAnchor="end"
        fontSize={9}
        fill="#9ca3af"
        style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {verticalDatumShort(zEpsg) || 'm'}
      </text>
      {[...ticks]
        .sort((a, b) => b - a)
        .map(lvl => {
          const depth = surfaceElevation - lvl
          const ty = y + depth * PX_PER_M
          return (
            <g key={lvl}>
              <line x1={axisRight - 6} x2={axisRight - 1} y1={ty} y2={ty} stroke="#9ca3af" />
              <text
                x={axisRight - 8}
                y={ty + 3}
                textAnchor="end"
                fontSize={10}
                fill="#6b7280"
                fontFamily="monospace"
              >
                {formatMtaw(lvl)}
              </text>
            </g>
          )
        })}
    </g>
  )
}
