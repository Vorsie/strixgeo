/**
 * BoreholeColumn — narrow lithology strip for the cross-section.
 *
 * Renders a single borehole's coded-lithology layers as a stack of
 * patterned coloured rectangles inside the borehole's column band on
 * the cross-section. Mirrors the DOV "lengteprofiel" PDF convention:
 * each layer appears as a rect filled with the soil code's pattern
 * (sand dots, clay hatching, glauconite chevrons, etc.) so the
 * geologist can scan the section and see lithology context.
 *
 * Prerequisite for the geological model editor — drawing formation
 * tops between investigations needs the user to SEE the underlying
 * soil, not just stick columns.
 *
 * v1 scope:
 *
 *   * Layers from the first coded_lithology / geotechnical_coding
 *     observation on the borehole. The PDF picks the granular
 *     ISO-14688 stream the same way.
 *   * Soil-code → pattern fill via ``getSoilFillUrl``. Unknown codes
 *     fall back to the solid colour from ``soilStyle``.
 *   * Vertical clip to the plot area; deep layers extending past
 *     ``plotBottom`` clamp cleanly.
 *
 * Deferred to future passes:
 *
 *   * Sample track (depth markers + sample IDs on the right edge).
 *   * Observation labels (description text alongside layers).
 *   * Admixture chips (colour swatches at layer edges).
 *   * Layer hover / select hooks for the geological model editor.
 */

import type { BoreholeDetailResponse } from '../../api/client'
import { getSoilFillUrl } from '../../utils/soilPatterns'

// Lithology observation kinds — same set ``BoreholeLog.tsx`` uses
// to gate the lithology track. Duplicated here as a 2-element set;
// promote to ``utils/observationTypes.ts`` if a third caller lands.
const LITHOLOGY_TYPES = new Set(['coded_lithology', 'geotechnical_coding'])

interface Props {
  detail: BoreholeDetailResponse
  /** Screen X of the column centerline (the nudged X from the
   * width-aware layout pass — see ``nudgeColumns``). */
  screenX: number
  /** Half-width of the lithology strip in px. The band extends
   * ±halfWidth from ``screenX``; total visual width is
   * ``2 * halfWidth``. Caller scales this with horizontal zoom so
   * the strip matches the CPT band on the same section. */
  halfWidth: number
  /** Elevation in m of the borehole's surface (column top). Caller
   * MUST skip rendering when the borehole has no elevation —
   * without a Z we can't position the layers vertically. */
  surfaceElevationM: number
  /** Plot-area Y bounds — anything outside gets clamped. */
  plotTop: number
  plotBottom: number
  /** World-level (m TAW) → screen Y converter from the section
   * panel's viewport. */
  levelToScreen: (level: number) => number
}

export default function BoreholeColumn({
  detail,
  screenX,
  halfWidth,
  surfaceElevationM,
  plotTop,
  plotBottom,
  levelToScreen,
}: Props): JSX.Element | null {
  // Pick the first lithology observation. DOV boreholes typically
  // carry one ``coded_lithology`` plus optional ``geotechnical_coding``
  // and ``formal_stratigraphy`` streams; for cross-section context
  // the coded lithology is the most useful single track. If a
  // borehole has only ``geotechnical_coding`` we fall back to it.
  const lithology = detail.observations.find(o =>
    LITHOLOGY_TYPES.has(o.observation_type),
  )
  if (!lithology || lithology.layers.length === 0) return null

  const leftX = screenX - halfWidth
  const width = 2 * halfWidth

  return (
    <g pointerEvents="none">
      {lithology.layers.map(layer => {
        const yTop = levelToScreen(surfaceElevationM - layer.top_m)
        const yBottom = levelToScreen(surfaceElevationM - layer.base_m)
        // Clip to the plot area so layers extending past the viewport
        // bottom don't paint into the axis chrome below.
        const clampedTop = Math.max(plotTop, Math.min(plotBottom, yTop))
        const clampedBottom = Math.max(plotTop, Math.min(plotBottom, yBottom))
        const height = clampedBottom - clampedTop
        if (height <= 0) return null
        const primaryCode = layer.main_soil_codes[0] ?? null
        return (
          <rect
            key={layer.id}
            x={leftX}
            y={clampedTop}
            width={width}
            height={height}
            fill={getSoilFillUrl(primaryCode)}
            stroke="#9ca3af"
            strokeWidth={0.3}
          />
        )
      })}
    </g>
  )
}
