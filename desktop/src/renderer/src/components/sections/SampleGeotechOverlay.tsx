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
// useSelectedGeotechBodyId gives the raw id; the store record also carries
// assignmentSource, read by GeotechnicalInspector.
import { sampleGeotechScreenPos } from '../../utils/sampleGeotechScreenPos'

// Dot appearance constants.
const DOT_RADIUS = 4
/** Fill colour for unselected sample dots (teal — lab data theme). */
const DOT_COLOR_DEFAULT = '#0d9488' // teal-600
/** Fill colour for a dot whose body is currently selected. */
const DOT_COLOR_SELECTED = '#f59e0b' // amber-500
/** Stroke colour for unselected dots. */
const DOT_STROKE = '#fff'
/**
 * Minimum hit-target radius (px) for the invisible pointer-events circle.
 * WCAG 2.5.8 requires a ≥24 px touch target; 12 px radius gives 24 px diameter.
 */
const HIT_RADIUS = 12

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
            // B1: two orthogonal selection cues (size + stroke colour) alongside hue,
            // so selection is never conveyed by colour alone (WCAG 1.4.1).
            const dotRadius = isSelected ? DOT_RADIUS + 2 : DOT_RADIUS
            const strokeColor = isSelected ? DOT_COLOR_SELECTED : DOT_STROKE
            const strokeWidth = isSelected ? 2 : 1
            const label = sample.sample_number !== null
              ? String(sample.sample_number)
              : sample.id.slice(0, 8)

            return (
              <g key={`sample-group-${sample.id}`}>
                {/* B3/B4: invisible hit circle — large enough for WCAG 2.5.8 (≥24 px
                    touch target) with full keyboard access.  Rendered BEFORE the
                    visible dot so it sits below in z-order; the visible dot's
                    pointer-events:none lets clicks fall through to this circle. */}
                <circle
                  data-testid={`sample-hit-${sample.id}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={HIT_RADIUS}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`Sample ${label} — click to highlight body`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    // geotech_body_id is guaranteed non-null here (filtered above).
                    toggleGeotechBodySelection(
                      sample.geotech_body_id!,
                      sample.geotech_assignment_source,
                    )
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleGeotechBodySelection(
                        sample.geotech_body_id!,
                        sample.geotech_assignment_source,
                      )
                    }
                  }}
                >
                  {/* C1: title advertises the click action so assistive tech + tooltips
                      expose the gesture surface. */}
                  <title>
                    {`Sample ${label}\n${sample.depth_top_m.toFixed(2)}–${sample.depth_base_m.toFixed(2)} m\nClick to highlight packing body`}
                  </title>
                </circle>

                {/* Visual dot — B1: r + strokeWidth encode selection alongside fill hue.
                    pointer-events:none ensures the hit circle above receives all clicks. */}
                <circle
                  data-testid={`sample-dot-${sample.id}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={dotRadius}
                  fill={fill}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  style={{ pointerEvents: 'none' }}
                  aria-hidden="true"
                />
              </g>
            )
          })
      })}
    </g>
  )
}
