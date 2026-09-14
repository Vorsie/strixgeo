/**
 * SVG overlay that renders one lab-sample marker per sample on a borehole
 * column.
 *
 * Each marker is a vertical capsule spanning the sample's ``depth_top_m`` to
 * ``depth_base_m`` at the exact depths — a lab result speaks for an interval,
 * not for a point, and the mid-depth dot this replaced hid that. A spot sample
 * (top == base) is floored to a minimum drawn height so it stays findable.
 *
 * EVERY sample draws, whether or not the geotech subdivision has assigned it a
 * packing body: a body-less sample gets a neutral marker whose click is a
 * no-op. That keeps the lab evidence visible on a section the engineer has not
 * subdivided yet.
 *
 * The overlay mounts on BOTH the lithostratigraphic and the geotechnical axis.
 * The body-selection gesture stays geotech-only, via ``bodyClickEnabled`` —
 * on the litho axis the markers are read-only evidence.
 *
 * The horizontal position uses ``warpedXToScreen`` — NEVER raw ``xToScreen``
 * — so the marker stays aligned with the column glyph at any spacing setting.
 */

import type { BoreholeDetailResponse, SampleResponse } from '../../api/client'
import type { BoreholePlacedColumn } from './utils'
import {
  toggleGeotechBodySelection,
  useSelectedGeotechBodyId,
} from '../../utils/geotechBodySelectionStore'
// useSelectedGeotechBodyId gives the raw id; the store record also carries
// assignmentSource, read by GeotechnicalInspector.
import { forwardContextMenuBeneath } from './forwardContextMenuBeneath'
import { usePsdPreviewOn } from '../../utils/psdPreviewOnStore'
import { sampleExtentScreenSpan } from '../../utils/sampleExtentSpan'
import { useT } from '../../i18n/translate'

// Marker appearance constants.
/** Drawn width of an unselected marker bar (px). */
const MARKER_WIDTH = 8
/** Drawn width when the marker's packing body is selected (size cue). */
const MARKER_WIDTH_SELECTED = 12
/**
 * Corner radius of the marker bar (px).
 *
 * Deliberately a small CONSTANT, never ``width / 2``: nearly every real sample
 * is 0.35–0.5 m, which at section zoom sits at the minimum-height floor, and a
 * fully-rounded bar at that height IS a circle — the owner's "those dots are
 * still there not nice rectangular marks" (dogfeed 2026-08-14). The marker
 * must read as a rectangle spanning the depth interval at every zoom.
 */
const MARKER_CORNER_RADIUS = 1.5
/**
 * Fill for every sample marker (teal — lab data theme).
 *
 * ONE style regardless of packing body (owner 2026-08-14 night: "you dont
 * need to make a diff between packing density or not" — samples only exist on
 * boreholes and only gain a body through the CPT pipeline, so body-less is
 * the normal resting state, not a variant).
 */
const MARKER_COLOR = '#0d9488' // teal-600
/** Fill for a marker whose body is currently selected. */
const MARKER_COLOR_SELECTED = '#f59e0b' // amber-500
/** Stroke colour outlining every marker. */
const MARKER_STROKE = '#fff'
/**
 * Minimum drawn height (px) for a marker.
 *
 * A spot sample has zero extent, and a thin sample collapses below a pixel
 * when zoomed out; both would disappear entirely without this floor.
 */
const MIN_MARKER_HEIGHT = 6
/**
 * Hit-target size (px) for the invisible pointer-events rect.
 * WCAG 2.5.8 requires a ≥24 px target in both directions.
 */
const HIT_SIZE = 24

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** What the overlay reports to its parent when the cursor enters a marker. */
export interface HoveredSample {
  /** The sample under the cursor. */
  sample: SampleResponse
  /** Display name of the borehole the sample came from. */
  boreholeName: string
  /** Marker's horizontal centre, in section-SVG pixels. */
  x: number
  /** Marker's vertical centre, in section-SVG pixels. */
  y: number
  /**
   * Whether clicking this marker would actually highlight a packing body.
   *
   * Only the overlay knows both halves — the sample carries a body AND this
   * axis allows the gesture — so it reports the same verdict its own cursor
   * and ARIA role already use. The hover card prints its "click to highlight"
   * line from this, and must never promise a click that does nothing.
   */
  bodyClickable: boolean
}

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
   * ``xToScreen``) — the same transform used by every other section overlay.
   */
  warpedXToScreen: (along: number) => number
  /** Elevation-to-pixel vertical transform. */
  levelToScreen: (level: number) => number
  /** SVG top boundary (MARGIN.top) — markers are trimmed to it. */
  plotTop: number
  /** SVG bottom boundary (MARGIN.top + plotHeight). */
  plotBottom: number
  /**
   * Whether clicking a marker toggles its packing-body selection.
   *
   * True on the geotechnical axis only. Required rather than defaulted so a
   * new mount cannot silently inherit the geotech gesture on an axis that has
   * no packing bodies to select.
   */
  bodyClickEnabled: boolean
  /**
   * Fired when the cursor enters a marker (with the sample) and when it leaves
   * (with ``null``). Drives the grain-size hover preview; omit to disable it.
   */
  onSampleHover?: (hover: HoveredSample | null) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SVG ``<g>`` group rendering the lab-sample extent markers.
 *
 * Reads the active body selection from ``geotechBodySelectionStore`` to
 * highlight matched markers in amber.  A marker whose sample carries a
 * ``geotech_body_id`` fires ``toggleGeotechBodySelection`` on click, but only
 * while ``bodyClickEnabled`` is set.
 *
 * @returns An SVG ``<g>`` group of sample markers (may be empty).
 */
export default function SampleGeotechOverlay({
  boreholePlacedColumns,
  boreholeDetails,
  warpedXToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
  bodyClickEnabled,
  onSampleHover,
}: SampleGeotechOverlayProps): JSX.Element {
  const t = useT()
  const selectedBodyId = useSelectedGeotechBodyId()
  // The native tooltip and the grain-size card fire on the SAME hover, and the
  // OS draws the tooltip ON TOP of the card — the owner's "when i hover a psd,
  // the click to highlight packing density overlaps the psd graph". So the
  // tooltip yields whenever the card can take over: the card is the richer
  // surface and already carries the sample number and the depth range. With
  // the card switched off (the ``P`` accelerator / the Display menu item) the
  // tooltip is the only thing left saying the marker is clickable, so it
  // returns. ``onSampleHover`` is the second half of "can take over": without
  // a listener no card is ever mounted, however the toggle stands.
  const cardCanShow = usePsdPreviewOn() && onSampleHover !== undefined

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
        const boreholeName = col.proj.item.name

        return detail.samples.map(sample => {
          const span = sampleExtentScreenSpan(
            sample,
            column,
            warpedXToScreen,
            levelToScreen,
            MIN_MARKER_HEIGHT,
          )
          if (!span) return null
          // Drop only a marker lying wholly outside the plot area; one that
          // straddles an edge is trimmed so its visible part still shows.
          if (span.yBase < plotTop || span.yTop > plotBottom) return null

          const drawnTop = Math.max(span.yTop, plotTop)
          const drawnBottom = Math.min(span.yBase, plotBottom)
          const drawnHeight = drawnBottom - drawnTop

          const hasBody = sample.geotech_body_id !== null
          const isSelected = hasBody && sample.geotech_body_id === selectedBodyId
          const clickable = hasBody && bodyClickEnabled

          const fill = isSelected ? MARKER_COLOR_SELECTED : MARKER_COLOR
          // Width is the second, non-hue selection cue (WCAG 1.4.1).
          const width = isSelected ? MARKER_WIDTH_SELECTED : MARKER_WIDTH

          const label = sample.sample_number !== null
            ? String(sample.sample_number)
            : sample.id.slice(0, 8)

          const activate = (): void => {
            if (!clickable) return
            // geotech_body_id is non-null whenever `clickable` is true.
            toggleGeotechBodySelection(
              sample.geotech_body_id!,
              sample.geotech_assignment_source,
            )
          }

          // The hit rect is centred on the marker and never smaller than the
          // WCAG floor in either direction.
          const hitHeight = Math.max(HIT_SIZE, drawnHeight)
          const hitTop = drawnTop + drawnHeight / 2 - hitHeight / 2

          return (
            <g key={`sample-group-${sample.id}`}>
              {/* Invisible hit rect — rendered BEFORE the visible capsule so it
                  sits below in z-order; the capsule's pointer-events:none lets
                  clicks fall through to this rect. */}
              <rect
                data-testid={`sample-hit-${sample.id}`}
                x={span.x - HIT_SIZE / 2}
                y={hitTop}
                width={HIT_SIZE}
                height={hitHeight}
                fill="transparent"
                tabIndex={0}
                role={clickable ? 'button' : 'img'}
                aria-label={
                  clickable
                    ? t('sections.sampleGeotech.ariaClickable', { label })
                    : t('sections.sampleLabel', { n: label })
                }
                style={{ cursor: clickable ? 'pointer' : 'default' }}
                onClick={activate}
                // A right-click on a sample capsule must reach the packing band
                // BENEATH it (the band menu), not bubble to the section's column
                // menu: this hit rect sits ABOVE the band-edit overlay on a
                // borehole column (owner installer #37, GEO-99/201-B1). This
                // overlay owns no right-click of its own, so it forwards the
                // event to whatever lies under the cursor below it — the band
                // (band menu), or the column glyph past the bands (column menu,
                // which is the correct target there).
                onContextMenu={(e: React.MouseEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  forwardContextMenuBeneath(e.clientX, e.clientY, (el) =>
                    el.closest('[data-testid="sample-geotech-overlay"]') !== null,
                  )
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    activate()
                  }
                }}
                onMouseEnter={() =>
                  onSampleHover?.({
                    sample,
                    boreholeName,
                    x: span.x,
                    y: (drawnTop + drawnBottom) / 2,
                    bodyClickable: clickable,
                  })
                }
                onMouseLeave={() => onSampleHover?.(null)}
              >
                {/* Native tooltip so the depth range is readable without the
                    richer hover popover — and ONLY then, because the OS draws
                    it over that popover (see ``cardCanShow`` above). */}
                {!cardCanShow && (
                  <title>
                    {t('sections.sampleGeotech.tooltip', {
                      label,
                      top: sample.depth_top_m.toFixed(2),
                      base: sample.depth_base_m.toFixed(2),
                      tail: clickable ? `\n${t('sections.psd.highlightBody')}` : '',
                    })}
                  </title>
                )}
              </rect>

              {/* Visible capsule — pointer-events:none so the hit rect above
                  receives every click. */}
              <rect
                data-testid={`sample-marker-${sample.id}`}
                x={span.x - width / 2}
                y={drawnTop}
                width={width}
                height={drawnHeight}
                rx={MARKER_CORNER_RADIUS}
                fill={fill}
                stroke={MARKER_STROKE}
                strokeWidth={1}
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
