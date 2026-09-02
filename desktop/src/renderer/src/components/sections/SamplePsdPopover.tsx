/**
 * Floating grain-size preview card shown while a lab-sample marker is hovered.
 *
 * Two shapes, chosen by what the sample actually carries:
 *
 *   * With grain-size tests — a mini particle-size distribution chart. x is
 *     grain diameter in mm on the FIXED log window 63 → 0.001 mm, coarse on
 *     the left (owner 2026-08-14: "a fixed axis scale ... so it is always
 *     easy to see sand/silt/clay fraction" — every card is directly
 *     comparable and the fraction boundaries never move); y is % finer by
 *     weight, 0 at the bottom, 100 at the top. One polyline per test, so a
 *     sample with a repeat analysis shows both on one axis.
 *   * Without — a compact card carrying the metadata and an explicit
 *     "no grain-size test" line, rather than an empty chart frame that would
 *     read as a failed render.
 *
 * The card is ``pointer-events: none`` so it can never steal a click from the
 * canvas underneath, and it clamps itself inside the panel (see
 * ``clampPopoverPosition``). It owns its own size, because the size is what
 * the placement maths needs and only this component knows which shape it took.
 *
 * Positioned ``absolute`` inside SectionPanel's relative container. That works
 * because the section SVG's ``viewBox`` is matched 1:1 to its pixel size, so
 * an SVG coordinate and a container-local CSS offset are the same number.
 */

import type { SampleResponse } from '../../api/client'
import { clampPopoverPosition } from '../../utils/hoverPopoverPlacement'
import { selectOrganicContent } from '../../utils/organicContentSummary'
import { PSD_FIXED_DOMAIN, PSD_FRACTION_ZONES, psdCurvePoints, psdPolyline } from '../../utils/psdCurve'
import { useT } from '../../i18n/translate'

// --- Card + chart metrics --------------------------------------------------

/** Inner padding of the card (px). */
const CARD_PADDING = 8
/** Plot width of the mini chart (px). */
const CHART_WIDTH = 184
/** Plot height of the mini chart (px). */
const CHART_HEIGHT = 80
/** Card width — the chart plus its padding. */
const CARD_WIDTH = CHART_WIDTH + CARD_PADDING * 2
/** Height of the two-line header block (px). */
const HEADER_HEIGHT = 30
/** Height of the axis-label strip under the chart (px). */
const AXIS_LABEL_HEIGHT = 13
/**
 * Height of the organic-content line under the header (px).
 *
 * Added to the measured card height whenever the line renders — the same number
 * feeds ``clampPopoverPosition``, so a card that grew a line still clamps inside
 * the panel instead of hanging off its bottom edge.
 */
const ORGANIC_LINE_HEIGHT = 12
/**
 * Height of the "click to highlight packing body" hint line (px).
 *
 * Same treatment as the organic line: measured whenever it renders, so a card
 * that grew the hint still clamps inside the panel.
 */
const HINT_LINE_HEIGHT = 12
/** Card height when a chart is drawn. */
const CARD_HEIGHT_WITH_CHART =
  CARD_PADDING * 2 + HEADER_HEIGHT + CHART_HEIGHT + AXIS_LABEL_HEIGHT
/** Card height for the compact "no grain-size test" shape. */
const CARD_HEIGHT_COMPACT = CARD_PADDING * 2 + HEADER_HEIGHT + AXIS_LABEL_HEIGHT

/**
 * Series colours, cycled per grain-size test.
 *
 * Reuses the existing chart-curve tokens rather than minting new hues: each
 * already carries a light value and a contrast-corrected dark value, so the
 * curves stay legible in the theme the owner actually works in.
 */
const SERIES_COLORS = [
  'var(--chart-clr-qt)',
  'var(--chart-clr-fs)',
  'var(--chart-clr-u2)',
  'var(--chart-clr-rf)',
]

/** Format a grain diameter for the axis ends — sub-mm sizes need decimals. */
function formatDiameter(mm: number): string {
  if (mm >= 10) return mm.toFixed(0)
  if (mm >= 1) return mm.toFixed(1)
  // The fixed window's fine wall is 0.001 mm — keep it decimal, never "1e-3".
  if (mm >= 0.001) return mm.toFixed(3)
  return mm.toExponential(0)
}

/** Props for the hover card. */
export interface SamplePsdPopoverProps {
  /** The hovered sample. */
  sample: SampleResponse
  /** Display name of the borehole the sample came from. */
  boreholeName: string
  /** Container-local X of the hovered marker. */
  anchorX: number
  /** Container-local Y of the hovered marker. */
  anchorY: number
  /** Panel width in px — the card clamps inside it. */
  containerWidth: number
  /** Panel height in px — the card clamps inside it. */
  containerHeight: number
  /**
   * Whether clicking this sample's marker would highlight its packing body.
   *
   * Comes straight from the overlay's own ``bodyClickable`` verdict (sample has
   * a body AND this axis allows the gesture). Defaults to ``false``: the card
   * never invents an affordance nobody told it about.
   */
  bodyClickable?: boolean
}

/**
 * Render the grain-size hover card for one lab sample.
 *
 * @returns An absolutely-positioned, non-interactive card.
 */
export default function SamplePsdPopover({
  sample,
  boreholeName,
  anchorX,
  anchorY,
  containerWidth,
  containerHeight,
  bodyClickable = false,
}: SamplePsdPopoverProps): JSX.Element {
  const t = useT()
  const curves = sample.grain_sizes.map(test => ({
    id: test.id,
    points: psdCurvePoints(test),
  }))
  const domain = PSD_FIXED_DOMAIN
  const hasChart = curves.some(c => c.points.length > 0)
  // Organic content rides along on the same hover (owner, dogfeed 2026-08-15).
  // The helper says WHICH quantity it found; the label below prints that, since
  // organic matter and organic carbon are not the same number. It reads the
  // scalar catch-all as well as the typed family, because on the owner's own
  // project the measurement only ever arrived in the catch-all.
  const organic = selectOrganicContent(
    sample.organic_content_tests,
    sample.scalar_lab_tests,
  )
  // The click affordance moved off the marker's native tooltip and onto the
  // card (the tooltip covered the chart). The body id is re-checked here rather
  // than trusted from the prop alone: a card that promises a highlight on a
  // sample the subdivision never reached would be advertising a no-op.
  const showClickHint = bodyClickable && sample.geotech_body_id !== null

  const { left, top } = clampPopoverPosition({
    anchorX,
    anchorY,
    popoverWidth: CARD_WIDTH,
    popoverHeight:
      (hasChart ? CARD_HEIGHT_WITH_CHART : CARD_HEIGHT_COMPACT)
      + (organic !== null ? ORGANIC_LINE_HEIGHT : 0)
      + (showClickHint ? HINT_LINE_HEIGHT : 0),
    containerWidth,
    containerHeight,
  })

  const label =
    sample.sample_number !== null
      ? t('sections.sampleLabel', { n: sample.sample_number })
      : t('sections.sampleLabel', { n: sample.id.slice(0, 8) })

  return (
    <div
      data-testid="sample-psd-popover"
      // pointer-events-none is load-bearing, not cosmetic: the card follows the
      // cursor over an interactive canvas and must never intercept a gesture.
      className="absolute z-20 pointer-events-none rounded border border-gray-300 bg-white shadow-md dark:border-gray-600 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
      style={{
        left,
        top,
        width: CARD_WIDTH,
        padding: CARD_PADDING,
      }}
      aria-hidden="true"
    >
      <div className="text-[11px] font-medium leading-tight truncate">{label}</div>
      <div className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 truncate">
        {boreholeName} · {sample.depth_top_m.toFixed(2)}–{sample.depth_base_m.toFixed(2)} m
      </div>
      {/* One compact line under the header, and only when the sample was
          actually tested — an absent test renders nothing at all, never a dash
          or an empty row that would read as "measured, and it was zero". */}
      {organic !== null && (
        <div
          data-testid="sample-organic-content"
          className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 truncate"
        >
          {t('sections.psd.organic', {
            quantity: organic.quantity,
            pct: organic.pct.toFixed(1),
          })}
        </div>
      )}

      {hasChart ? (
        <>
          <svg
            data-testid="psd-chart"
            width={CHART_WIDTH}
            height={CHART_HEIGHT}
            className="mt-1 block overflow-visible"
          >
            {/* Frame + midline drawn in currentColor so both themes inherit a
                legible weight from the card's own text colour. */}
            <rect
              x={0.5}
              y={0.5}
              width={CHART_WIDTH - 1}
              height={CHART_HEIGHT - 1}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.25}
            />
            <line
              x1={0}
              y1={CHART_HEIGHT / 2}
              x2={CHART_WIDTH}
              y2={CHART_HEIGHT / 2}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            {/* One decade gridline per power of ten inside the domain, so the
                log spacing is visible rather than implied. */}
            {decadeTicks(domain.minMm, domain.maxMm).map(mm => {
              // Inverted axis (owner 2026-08-14) — same orientation as
              // psdPolyline: coarse left, fine right.
              const t =
                (Math.log10(domain.maxMm) - Math.log10(mm))
                / (Math.log10(domain.maxMm) - Math.log10(domain.minMm))
              return (
                <line
                  key={`decade-${mm}`}
                  x1={t * CHART_WIDTH}
                  y1={0}
                  x2={t * CHART_WIDTH}
                  y2={CHART_HEIGHT}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                />
              )
            })}
            {/* The sand/silt/clay fraction boundaries — the reason the axis
                is fixed. Slightly stronger than the decade lines, identical
                position on every card. */}
            {PSD_FRACTION_ZONES.slice(1).map(zone => {
              const t =
                (Math.log10(domain.maxMm) - Math.log10(zone.fromMm))
                / (Math.log10(domain.maxMm) - Math.log10(domain.minMm))
              return (
                <line
                  key={`boundary-${zone.fromMm}`}
                  data-testid="psd-fraction-boundary"
                  x1={t * CHART_WIDTH}
                  y1={0}
                  x2={t * CHART_WIDTH}
                  y2={CHART_HEIGHT}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  strokeDasharray="3 2"
                />
              )
            })}
            {PSD_FRACTION_ZONES.map(zone => {
              const logSpan = Math.log10(domain.maxMm) - Math.log10(domain.minMm)
              const tLeft = (Math.log10(domain.maxMm) - Math.log10(zone.toMm)) / logSpan
              const tRight = (Math.log10(domain.maxMm) - Math.log10(zone.fromMm)) / logSpan
              const widthPx = (tRight - tLeft) * CHART_WIDTH
              // The clay zone is only ~0.3 decade wide on the fixed window —
              // its label would collide with the frame, so narrow zones stay
              // line-only (the boundary line still marks them).
              if (widthPx < 24) return null
              return (
                <text
                  key={`zone-${zone.label}`}
                  data-testid="psd-zone-label"
                  x={((tLeft + tRight) / 2) * CHART_WIDTH}
                  y={9}
                  textAnchor="middle"
                  fontSize={7}
                  fill="currentColor"
                  fillOpacity={0.55}
                >
                  {zone.label}
                </text>
              )
            })}
            {curves.map((curve, i) =>
              curve.points.length === 0 ? null : (
                <polyline
                  key={curve.id}
                  data-testid={`psd-curve-${curve.id}`}
                  points={psdPolyline(curve.points, domain, {
                    width: CHART_WIDTH,
                    height: CHART_HEIGHT,
                  })}
                  fill="none"
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              ),
            )}
          </svg>
          <div
            data-testid="psd-axis-labels"
            className="flex justify-between text-[9px] leading-none text-gray-500 dark:text-gray-400"
          >
            {/* Inverted axis: the COARSE end labels the left wall. */}
            <span>{formatDiameter(domain.maxMm)} mm</span>
            <span>{t('sections.psd.finerByWeight')}</span>
            <span>{formatDiameter(domain.minMm)} mm</span>
          </div>
        </>
      ) : (
        <div className="mt-1 text-[10px] leading-tight text-gray-500 dark:text-gray-400">
          {t('sections.psd.noGrainSize')}
        </div>
      )}
      {/* The affordance the marker's native tooltip used to carry, now a card
          footer — and only where the click does something (geotech axis, and a
          sample the packing pipeline actually reached). */}
      {showClickHint && (
        <div
          data-testid="sample-click-hint"
          className="mt-1 text-[9px] leading-tight italic text-gray-400 dark:text-gray-500 truncate"
        >
          {t('sections.psd.highlightBody')}
        </div>
      )}
    </div>
  )
}

/**
 * Powers of ten strictly inside a log domain, used as chart gridlines.
 *
 * @param minMm - Left-edge diameter.
 * @param maxMm - Right-edge diameter.
 * @returns Ascending decade diameters between the two edges (exclusive).
 */
function decadeTicks(minMm: number, maxMm: number): number[] {
  const ticks: number[] = []
  const first = Math.ceil(Math.log10(minMm))
  const last = Math.floor(Math.log10(maxMm))
  // A wide domain would fill the card with lines; the mini chart only ever
  // spans a handful of decades in practice, so cap defensively.
  for (let e = first; e <= last && ticks.length < 12; e++) {
    const mm = Math.pow(10, e)
    if (mm > minMm && mm < maxMm) ticks.push(mm)
  }
  return ticks
}
