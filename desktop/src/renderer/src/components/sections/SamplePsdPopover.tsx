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
 *     weight, 0 at the bottom, 100 at the top. ONE polyline per sample: the
 *     sample's grain-size tests (a sieve + a hydrometer) merge into one
 *     combined curve (owner 2026-10-01: "make a combined sieve + hydrometer
 *     graph"; one sample = one chart everywhere, ``mergeGrainSizeCurves``).
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
import { mergeGrainSizeCurves } from '../../utils/psdCurve'
import { useT } from '../../i18n/translate'
import PsdMiniChart from './PsdMiniChart'

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
  const combined = mergeGrainSizeCurves(sample.grain_sizes)
  const curves = [{ id: sample.id, points: combined }]
  const hasChart = combined.length > 0
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
        <PsdMiniChart curves={curves} width={CHART_WIDTH} height={CHART_HEIGHT} />
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
