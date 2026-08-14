/**
 * Floating grain-size preview card shown while a lab-sample marker is hovered.
 *
 * Two shapes, chosen by what the sample actually carries:
 *
 *   * With grain-size tests — a mini particle-size distribution chart. x is
 *     grain diameter in mm on a LOG scale ascending left→right; y is % finer
 *     by weight, 0 at the bottom, 100 at the top. One polyline per test, so a
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
import { psdCurvePoints, psdLogDomain, psdPolyline } from '../../utils/psdCurve'

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
  if (mm >= 0.01) return mm.toFixed(3)
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
}: SamplePsdPopoverProps): JSX.Element {
  const curves = sample.grain_sizes.map(test => ({
    id: test.id,
    points: psdCurvePoints(test),
  }))
  const domain = psdLogDomain(curves.map(c => c.points))
  const hasChart = domain !== null && curves.some(c => c.points.length > 0)

  const { left, top } = clampPopoverPosition({
    anchorX,
    anchorY,
    popoverWidth: CARD_WIDTH,
    popoverHeight: hasChart ? CARD_HEIGHT_WITH_CHART : CARD_HEIGHT_COMPACT,
    containerWidth,
    containerHeight,
  })

  const label = sample.sample_number !== null
    ? `Sample ${sample.sample_number}`
    : `Sample ${sample.id.slice(0, 8)}`

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
            {decadeTicks(domain!.minMm, domain!.maxMm).map(mm => {
              // Inverted axis (owner 2026-08-14) — same orientation as
              // psdPolyline: coarse left, fine right.
              const t =
                (Math.log10(domain!.maxMm) - Math.log10(mm))
                / (Math.log10(domain!.maxMm) - Math.log10(domain!.minMm))
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
            {curves.map((curve, i) =>
              curve.points.length === 0 ? null : (
                <polyline
                  key={curve.id}
                  data-testid={`psd-curve-${curve.id}`}
                  points={psdPolyline(curve.points, domain!, {
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
            <span>{formatDiameter(domain!.maxMm)} mm</span>
            <span>% finer by weight</span>
            <span>{formatDiameter(domain!.minMm)} mm</span>
          </div>
        </>
      ) : (
        <div className="mt-1 text-[10px] leading-tight text-gray-500 dark:text-gray-400">
          No grain-size test
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
