/**
 * SVG overlay that renders a clickable dot per lab sample on the geotech axis.
 *
 * Each borehole column is checked for samples in ``boreholeDetails``.  For
 * every sample that has a ``geotech_body_id`` a small circle is rendered at
 * the sample mid-depth position.  Clicking a dot selects (or deselects) the
 * body via the ``geotechBodySelectionStore``.
 *
 * The horizontal position uses ``warpedXToScreen`` — NEVER raw ``xToScreen``
 * — so the dot stays aligned with the column glyph at any spacing setting.
 */

import type { BoreholeDetailResponse } from '../../api/client'
import type { BoreholePlacedColumn } from './utils'
import {
  toggleGeotechBodySelection,
  useSelectedGeotechBodyId,
} from '../../utils/geotechBodySelectionStore'
import { sampleGeotechScreenPos } from '../../utils/sampleGeotechScreenPos'

// Dot appearance constants.
const DOT_RADIUS = 4
/** Fill colour for unselected sample dots (teal — lab data theme). */
const DOT_COLOR_DEFAULT = '#0d9488' // teal-600
/** Fill colour for a dot whose body is currently selected. */
const DOT_COLOR_SELECTED = '#f59e0b' // amber-500
/** Stroke colour for all dots. */
const DOT_STROKE = '#fff'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SampleGeotechOverlayProps {
  /**
   * All placed borehole columns on the current section.  CPT columns are
   * ignored (samples belong to boreholes, not CPTs).
   */
  boreholePlacedColumns: readonly BoreholePlacedColumn[]
  /**
   * Map of borehole id → full detail response (samples live here).
   * May be ``null`` while the async fetch is in flight — the overlay
   * renders nothing until data lands.
   */
  boreholeDetails: Map<string, BoreholeDetailResponse> | null
  /**
   * Spacing-aware X transform.  MUST be ``warpedXToScreen`` (not raw
   * ``xToScreen``) — the same transform used by every other geotech overlay.
   */
  warpedXToScreen: (along: number) => number
  /** Elevation-to-pixel vertical transform. */
  levelToScreen: (level: number) => number
  /** SVG top boundary (MARGIN.top) — clips dots outside the plot area. */
  plotTop: number
  /** SVG bottom boundary (MARGIN.top + plotHeight). */
  plotBottom: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SVG ``<g>`` group that renders sample dots on the geotech axis.
 *
 * Reads the active body selection from ``geotechBodySelectionStore`` to
 * highlight matched dots in amber.  Each dot fires
 * ``toggleGeotechBodySelection`` on click.
 *
 * Parameters
 * ----------
 * boreholePlacedColumns
 *     Borehole columns on the section (CPT columns ignored).
 * boreholeDetails
 *     Map of borehole id → full detail (including samples).
 * warpedXToScreen
 *     Spacing-aware column X transform.
 * levelToScreen
 *     Elevation-to-pixel Y transform.
 * plotTop
 *     Upper clip boundary (SVG px).
 * plotBottom
 *     Lower clip boundary (SVG px).
 *
 * Returns
 * -------
 * JSX.Element
 *     An SVG ``<g>`` group of sample dots (may be empty).
 */
export default function SampleGeotechOverlay({
  boreholePlacedColumns,
  boreholeDetails,
  warpedXToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
}: SampleGeotechOverlayProps): JSX.Element {
  const selectedBodyId = useSelectedGeotechBodyId()

  if (!boreholeDetails) {
    return <g data-testid="sample-geotech-overlay-loading" />
  }

  return (
    <g data-testid="sample-geotech-overlay">
      {boreholePlacedColumns.map(col => {
        const detail = boreholeDetails.get(col.proj.item.id)
        if (!detail) return null

        const column = {
          along: col.proj.along,
          elevationM: col.proj.item.elevation_m,
        }

        return detail.samples
          .filter(s => s.geotech_body_id !== null)
          .map(sample => {
            const pos = sampleGeotechScreenPos(sample, column, warpedXToScreen, levelToScreen)
            if (!pos) return null
            // Clip dots outside the visible plot area.
            if (pos.y < plotTop || pos.y > plotBottom) return null

            const isSelected = sample.geotech_body_id === selectedBodyId
            const fill = isSelected ? DOT_COLOR_SELECTED : DOT_COLOR_DEFAULT

            return (
              <circle
                key={`sample-dot-${sample.id}`}
                data-testid={`sample-dot-${sample.id}`}
                cx={pos.x}
                cy={pos.y}
                r={DOT_RADIUS}
                fill={fill}
                stroke={DOT_STROKE}
                strokeWidth={1}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  // geotech_body_id is guaranteed non-null here (filtered above).
                  toggleGeotechBodySelection(sample.geotech_body_id!)
                }}
              >
                <title>
                  {`Sample ${sample.sample_number ?? sample.id.slice(0, 8)}\n${sample.depth_top_m.toFixed(2)}–${sample.depth_base_m.toFixed(2)} m`}
                </title>
              </circle>
            )
          })
      })}
    </g>
  )
}
