import type { ReactElement } from 'react'

import { soilStyle } from '../../../utils/soilColors'
import { pctForAmount } from '../utils'

/**
 * Combined main-lithology / admixture cap: at most 45 % of the layer
 * width is reserved for admixture strips so the main fill is always
 * at least 55 %. See ``mainLithologyFraction`` for the math.
 */
export const ADMIX_AREA_CAP_PCT = 45

interface Admixture {
  soil_code: string
  amount: string
  locally: boolean
}

/**
 * Vertical-strip column rendered along the RIGHT side of the layer
 * rect (left side carries the main lithology pattern). Each strip is
 * full-height, with a width proportional to the DOV ``amount`` token
 * (``veel`` = 3 × ``weinig``). Strips are arranged left → right in
 * source order, matching DOV's "primary admixture first" convention.
 *
 * Combined with ``mainLithologyFraction``, the relative on-page area
 * of an admixture is roughly:
 *
 *   weinig only:      20 % overall × (its weight / total weight)
 *   has matig/veel:   40 % overall × (its weight / total weight)
 *
 * A layer with "veel silt, weinig klei" shows: 60 % main, then a silt
 * strip (3/4 of 40 % = 30 %) and a klei strip (1/4 of 40 % = 10 %).
 * The composition reads at a glance.
 */
export function AdmixtureStrip({
  admixtures,
  x,
  y,
  width,
  height,
}: {
  admixtures: Admixture[]
  x: number
  y: number
  width: number
  height: number
}): ReactElement {
  const pcts = admixtures.map(a => pctForAmount(a.amount))
  const totalPct = pcts.reduce((s, p) => s + p, 0) || 1
  let cursor = 0
  return (
    <g>
      {admixtures.map((a, i) => {
        const segWidth = (pcts[i] / totalPct) * width
        const segX = x + cursor
        cursor += segWidth
        return (
          <rect
            key={i}
            x={segX}
            y={y}
            // Add a hair of overlap on inner segments so anti-aliasing
            // doesn't leave a 1-pixel gap between adjacent fills.
            width={i < admixtures.length - 1 ? segWidth + 0.5 : segWidth}
            height={height}
            fill={soilStyle(a.soil_code).fill}
            stroke="#374151"
            strokeWidth={0.3}
          >
            <title>
              {`${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`}
            </title>
          </rect>
        )
      })}
      <line
        x1={x}
        x2={x}
        y1={y}
        y2={y + height}
        stroke="#374151"
        strokeWidth={0.6}
      />
    </g>
  )
}

/**
 * Width of the main lithology fill as a fraction of the layer rect.
 *
 * Each admixture contributes a fixed percentage of admix-strip width
 * based on its DOV ``amount`` token:
 *
 *   weinig (little)   →  5 % of layer width
 *   matig  (moderate) → 10 %
 *   veel   (much)     → 15 %
 *
 * The contributions sum across admixtures, capped at
 * ``ADMIX_AREA_CAP_PCT`` (45 %) so the main lithology is always at
 * least 55 %. Past the cap individual strip widths get scaled down
 * proportionally (``AdmixtureStrip`` does that math from the same
 * per-amount weights), keeping the relative ratio between admixtures
 * intact.
 *
 * Examples:
 *   no admixtures         → main 100 %
 *   1 × weinig            → main 95 %
 *   2 × weinig            → main 90 %
 *   1 × matig             → main 90 %
 *   1 × matig + 1 × weinig → main 85 %
 *   1 × veel              → main 85 %
 *   3 × veel              → main 55 % (capped — 45 % total admix area)
 */
export function mainLithologyFraction(
  admixtures: { amount: string }[],
): number {
  if (admixtures.length === 0) return 1.0
  const totalPct = admixtures
    .map(a => pctForAmount(a.amount))
    .reduce((s, p) => s + p, 0)
  const cappedPct = Math.min(totalPct, ADMIX_AREA_CAP_PCT)
  return 1 - cappedPct / 100
}
