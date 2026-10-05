import type { ReactElement } from 'react'

import { labFlaskLayers } from './mapMarkerStyle'

/**
 * The lab-test flask glyph inside an existing ``<svg>``: the light halo, then
 * the dark outline, both from ``labFlaskLayers`` (the map marker's string
 * markup draws the same layers), so the glyph reads the same on light and
 * dark ground everywhere it appears.
 *
 * @param props.left - Left edge of the outline's box, px.
 * @param props.top - Top edge of the outline's box, px.
 * @param props.height - Outline height, px.
 * @param props.testId - Optional ``data-testid`` on the outline path.
 * @returns A ``<g>`` holding the two paths.
 */
export function LabFlaskGlyph({
  left,
  top,
  height,
  testId,
}: {
  left: number
  top: number
  height: number
  testId?: string
}): ReactElement {
  return (
    <g>
      {labFlaskLayers(left, top, height).map(l => (
        <path
          key={l.glyph}
          data-glyph={l.glyph}
          data-testid={l.glyph === 'lab-flask' ? testId : undefined}
          d={l.d}
          fill={l.fill}
          stroke={l.stroke}
          strokeWidth={l.strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}
