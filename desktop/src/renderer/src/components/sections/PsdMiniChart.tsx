/**
 * The mini grain-size distribution (PSD) chart: one polyline per grain-size
 * test on the FIXED log window 63 -> 0.001 mm, coarse on the left (owner
 * 2026-08-14: "a fixed axis scale ... so it is always easy to see
 * sand/silt/clay fraction"), y = % finer by weight, the fraction boundaries
 * dashed, plus the axis-end labels underneath.
 *
 * Shared by the section view's sample hover card (``SamplePsdPopover``) and
 * the borehole track editor's reference pane (owner 2026-10-01: "i also want
 * the psd's of monster to be visible in the right hand pane"). The geometry is
 * the pure maths of ``utils/psdCurve``.
 */
import type { PsdPoint } from '../../utils/psdCurve'
import { PSD_FIXED_DOMAIN, PSD_FRACTION_ZONES, psdPolyline } from '../../utils/psdCurve'
import { useT } from '../../i18n/translate'

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

/** One curve to draw: the test id (test ids + keys) and its points. */
export interface PsdMiniChartCurve {
  id: string
  points: readonly PsdPoint[]
}

interface Props {
  /** One entry per grain-size test; an entry without points draws nothing. */
  curves: readonly PsdMiniChartCurve[]
  /** Plot width in px. */
  width: number
  /** Plot height in px. */
  height: number
}

/** Format a grain diameter for the axis ends — sub-mm sizes need decimals. */
function formatDiameter(mm: number): string {
  if (mm >= 10) return mm.toFixed(0)
  if (mm >= 1) return mm.toFixed(1)
  // The fixed window's fine wall is 0.001 mm — keep it decimal, never "1e-3".
  if (mm >= 0.001) return mm.toFixed(3)
  return mm.toExponential(0)
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

/**
 * Render the mini PSD chart and its axis labels.
 *
 * @returns The chart SVG followed by the axis-label strip.
 */
export default function PsdMiniChart({ curves, width, height }: Props): JSX.Element {
  const t = useT()
  const domain = PSD_FIXED_DOMAIN
  return (
    <>
    <svg
      data-testid="psd-chart"
      width={width}
      height={height}
      className="mt-1 block overflow-visible"
    >
      {/* Frame + midline drawn in currentColor so both themes inherit a
          legible weight from the card's own text colour. */}
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
      />
      <line
        x1={0}
        y1={height / 2}
        x2={width}
        y2={height / 2}
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
            x1={t * width}
            y1={0}
            x2={t * width}
            y2={height}
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
            x1={t * width}
            y1={0}
            x2={t * width}
            y2={height}
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
        const widthPx = (tRight - tLeft) * width
        // The clay zone is only ~0.3 decade wide on the fixed window —
        // its label would collide with the frame, so narrow zones stay
        // line-only (the boundary line still marks them).
        if (widthPx < 24) return null
        return (
          <text
            key={`zone-${zone.label}`}
            data-testid="psd-zone-label"
            x={((tLeft + tRight) / 2) * width}
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
              width: width,
              height: height,
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
  )
}
