import type { ReactElement } from 'react'

import type { FieldLogIntervalResponse } from '../../../api/client'
import {
  consistencyFill,
  fieldColorFill,
  moistureFill,
} from '../../../utils/fieldLogColors'
import { FIELD_LOG_SUB_WIDTH } from '../constants'
import { truncate, usePxPerM } from '../utils'

/**
 * Field-log track: three side-by-side sub-stripes (colour / moisture /
 * consistency) summarising the driller's per-interval log. Each
 * stripe uses its own fill-mapper because the source vocabulary
 * (DOV-Vlaanderen tokens) is different per axis.
 */
export function FieldLogTrack({
  intervals,
  x,
  y,
}: {
  intervals: FieldLogIntervalResponse[]
  x: number
  y: number
}): ReactElement {
  const colour = intervals.filter(i => i.kind === 'color')
  const moisture = intervals.filter(i => i.kind === 'moisture')
  const consistency = intervals.filter(i => i.kind === 'consistency')

  return (
    <g>
      <FieldLogStripe
        x={x}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={colour}
        fillFor={fieldColorFill}
      />
      <FieldLogStripe
        x={x + FIELD_LOG_SUB_WIDTH}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={moisture}
        fillFor={moistureFill}
      />
      <FieldLogStripe
        x={x + FIELD_LOG_SUB_WIDTH * 2}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={consistency}
        fillFor={consistencyFill}
      />
    </g>
  )
}

/** Single column inside a ``FieldLogTrack``. One rect per interval +
 * a small label when the interval is tall enough. */
function FieldLogStripe({
  x,
  y,
  width,
  intervals,
  fillFor,
}: {
  x: number
  y: number
  width: number
  intervals: FieldLogIntervalResponse[]
  fillFor: (v: string | null | undefined) => string
}): ReactElement {
  const PX_PER_M = usePxPerM()
  return (
    <g>
      {intervals.map(it => {
        const top = y + it.top_m * PX_PER_M
        const height = (it.base_m - it.top_m) * PX_PER_M
        return (
          <g key={it.id}>
            <title>
              {`${it.top_m.toFixed(2)} – ${it.base_m.toFixed(2)} m\n${it.kind}: ${it.value ?? '—'}`}
            </title>
            <rect
              x={x}
              y={top}
              width={width}
              height={height}
              fill={fillFor(it.value)}
              stroke="#9ca3af"
              strokeWidth={0.4}
            />
            {height >= 12 && it.value && (
              <text
                x={x + width / 2}
                y={top + height / 2 + 3}
                textAnchor="middle"
                fontSize={8}
                fill="#1f2937"
              >
                {truncate(it.value, 8)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
