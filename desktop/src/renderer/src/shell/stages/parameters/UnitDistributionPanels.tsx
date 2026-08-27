// Per-unit distribution panel — box + strip of qc, fs and Rf over one geotech
// unit (owner ballot 2026-08-26).
//
// WHY BOX + STRIP RATHER THAN A RAINCLOUD. The ballot allowed either. A
// raincloud's half-violin is a kernel density estimate, and a KDE carries a
// bandwidth — a smoothing choice that invents or hides a mode depending on how
// it is set. On a unit pooling two sand bodies the engineer would be reading a
// shape the smoother chose. A box says only what the order statistics say, and
// the strip behind it draws the measurements themselves, so nothing about the
// spread is asserted that the samples do not carry. For a panel whose whole
// point is that it makes NO interpretive claim, that is the honest form.
//
// WHY HORIZONTAL, WHEN THE SIBLING DEPTH PANELS ARE TALL. The owner's 2026-08-03
// ruling ("all horizontal and squished") was about a DEPTH series, which reads
// tall because depth is its axis. A distribution has no depth axis — it is a
// spread along one measurement axis — so it reads wide, and three of them stack
// into the same 420 px inspector without squeezing anything.
//
// WHY EACH ROW IS ITS OWN CHART. qc (MPa), fs (MPa) and Rf (%) have different
// units and ranges. One shared axis would be the dual-axis mistake; three rows
// with their own scales are small multiples, and each row's title names its
// single series so no legend is needed.
//
// COLOUR. The three channel tokens are the ones ``CptSbtDepthPanels`` already
// draws qc / fs / Rf with, deliberately: the same measurement wears the same
// ink in the depth panels directly above this one in the same inspector. Run
// through the categorical-palette validator these three FAIL the lightness-band
// and CVD-separation checks — but those checks exist so a reader can tell two
// series apart INSIDE one chart, and here every chart has exactly one series
// named by its own title. The check that does bind for a single-series mark,
// contrast against the surface, passes in both light and dark.
//
// CHARACTERISATION ONLY — see ``unitStatistics.ts`` and the on-screen note.

import { memo, useMemo } from 'react'
import { BarChart3 } from 'lucide-react'

import { EmptyState } from '../../EmptyState'
import type {
  UnitChannelStatistics,
  UnitStatistics,
  UnitStatisticsChannel,
} from './unitStatistics'

// ── Layout ───────────────────────────────────────────────────────────────────
// The plot draws in a 0-100 user-space box and is stretched to the row width by
// a non-uniform viewBox, the same trick ``CptSbtDepthPanels`` uses for its
// curves: the geometry stays in percentages and never has to know the pixel
// width of the inspector.
const PLOT_W = 100
const PLOT_H = 34
/** Vertical centre of the box + whisker. */
const AXIS_Y = 13
/** Half-height of the box rectangle. */
const BOX_HALF_H = 6
/** Band the jittered sample dots occupy, below the box. */
const STRIP_TOP = 22
const STRIP_H = 10

/**
 * How many sample dots the strip draws at most.
 *
 * A 30 m unit sampled every 2 cm is ~1500 readings per band; three channels of
 * those is thousands of DOM nodes for a picture that stops changing long before
 * that. Subsampling EVENLY over the sorted samples preserves the shape of the
 * distribution — it is a systematic sample of the order statistics, not a
 * random or head-first cut. The reported n is always the true count.
 */
const MAX_STRIP_DOTS = 400

/** Per-channel presentation — the ink and the words for each row. */
const CHANNEL_SPEC: Readonly<
  Record<UnitStatisticsChannel, { title: string; unit: string; color: string; decimals: number }>
> = {
  qc: {
    title: 'Cone resistance',
    unit: 'MPa',
    color: 'var(--chart-clr-qc, #111827)',
    decimals: 1,
  },
  fs: {
    title: 'Sleeve friction',
    unit: 'MPa',
    color: 'var(--chart-clr-fs, #16a34a)',
    decimals: 3,
  },
  rf: {
    title: 'Friction ratio',
    unit: '%',
    color: 'var(--chart-clr-rf, #b45309)',
    decimals: 2,
  },
}

const GRID = 'var(--chart-grid, #e5e7eb)'

interface Props {
  /** The unit's pooled measurements + summaries. */
  statistics: UnitStatistics
  /** Unit name for the heading — already resolved by the caller. */
  unitLabel: string
  /**
   * CPTs of this unit that contributed NO series, if any.
   *
   * Named so a partial answer cannot read as the whole unit. It deliberately
   * does not distinguish "still arriving" from "has no series at all" — the
   * batch endpoint drops ids it cannot answer for rather than failing, so both
   * look the same from here, and the honest wording covers both.
   */
  pendingCptCount?: number
}

/**
 * Distribution panel for one geotech unit.
 *
 * Parameters
 * ----------
 * props : Props
 *     The computed statistics plus the unit's display name.
 *
 * Returns
 * -------
 * JSX.Element
 *     A heading, one box+strip row per channel, and the characterisation note.
 */
function UnitDistributionPanels({
  statistics,
  unitLabel,
  pendingCptCount = 0,
}: Props): JSX.Element {
  const totalSamples = statistics.channels.reduce((sum, c) => sum + c.summary.n, 0)

  return (
    <div className="flex flex-col min-h-0 overflow-auto" data-testid="unit-stats-panel">
      {/* Heading — what ground these numbers describe. */}
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="text-xs font-semibold text-text-primary truncate" data-testid="unit-stats-title">
          {unitLabel}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {statistics.bandCount} band{statistics.bandCount === 1 ? '' : 's'} on{' '}
          {statistics.cptCount} CPT{statistics.cptCount === 1 ? '' : 's'}
          {statistics.coveredThicknessM > 0
            ? ` · ${statistics.coveredThicknessM.toFixed(1)} m of ground`
            : ''}
          {pendingCptCount > 0
            ? ` · ${pendingCptCount} without series`
            : ''}
        </div>
      </div>

      {totalSamples === 0 ? (
        // Wrapped so the state is addressable — ``EmptyState`` takes no
        // testid, the same reason ``ParametersInspector`` wraps its
        // ``LoadingState``.
        <div data-testid="unit-stats-empty">
          <EmptyState
            icon={<BarChart3 />}
            title="No cone measurements in this unit"
            hint={
              statistics.bandCount === 0
                ? 'This unit has no bands on a CPT — a borehole-only unit carries no cone resistance to summarise.'
                : 'The bands are there, but no CPT series covers them yet.'
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          {statistics.channels.map(channel => (
            <ChannelRow key={channel.channel} channel={channel} />
          ))}
        </div>
      )}

      {/* The liability line. Every number above describes measurements that
          were taken; none of them is a design-ready parameter. */}
      <div
        className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle shrink-0"
        data-testid="unit-stats-characterisation-note"
      >
        Characterisation only — the spread of the measurements inside this
        unit&apos;s bands. These are not design parameters; φ′, c′, cu, E50, OCR
        and Vs are not derived here.
      </div>
    </div>
  )
}

export default memo(UnitDistributionPanels)

// ---------------------------------------------------------------------------
// One channel's row
// ---------------------------------------------------------------------------

/** Box + strip + numeric readout for a single channel. */
function ChannelRow({ channel }: { channel: UnitChannelStatistics }): JSX.Element {
  const spec = CHANNEL_SPEC[channel.channel]
  const { summary, samples } = channel

  // Even subsample of the SORTED samples — keeps the shape, bounds the DOM.
  const dots = useMemo<number[]>(() => {
    if (samples.length <= MAX_STRIP_DOTS) return samples
    const step = samples.length / MAX_STRIP_DOTS
    const out: number[] = []
    for (let i = 0; i < MAX_STRIP_DOTS; i++) out.push(samples[Math.floor(i * step)])
    return out
  }, [samples])

  const hasData = summary.n > 0 && summary.min !== null && summary.max !== null

  // The axis spans the observed range. A distribution's job here is to show
  // spread and skew, not to be compared against zero, so the scale is not
  // forced through the origin — that would squash every real unit into a
  // sliver at the right of the row.
  const lo = summary.min ?? 0
  const hi = summary.max ?? 1
  const span = hi - lo
  // A span that is only floating-point noise is NOT spread, and mapping it
  // linearly would stretch 2e-16 across the whole row — drawing a wide
  // distribution over readings the readout correctly calls identical (min =
  // max, sd = 0). Rf computed as fs·100/qc does exactly this on a hole whose
  // sleeve friction tracks the cone.
  //
  // The threshold is RELATIVE to the magnitude, not an absolute floor: qc runs
  // in tens of MPa and fs in thousandths, so one absolute epsilon cannot be
  // right for both. Below it, every mark collapses onto the row's centre.
  const degenerate = span <= Math.max(Math.abs(lo), Math.abs(hi)) * 1e-9
  const toX = (v: number): number =>
    degenerate ? PLOT_W / 2 : ((v - lo) / span) * PLOT_W

  return (
    <div
      className="px-3 py-2 border-b border-border-subtle"
      data-testid={`unit-stats-row-${channel.channel}`}
    >
      {/* Title names the single series — which is why no legend is needed. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-text-primary">
          {spec.title}{' '}
          <span className="text-text-muted font-normal">({spec.unit})</span>
        </span>
        <span
          className="text-[10px] text-text-muted tabular-nums"
          data-testid={`unit-stats-n-${channel.channel}`}
        >
          n = {summary.n}
        </span>
      </div>

      {!hasData ? (
        <div
          className="py-2 text-[10px] text-text-muted"
          data-testid={`unit-stats-nodata-${channel.channel}`}
        >
          Not recorded on the CPTs covering this unit.
        </div>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: 52 }}
            role="img"
            aria-label={`${spec.title} distribution over this unit: median ${fmt(
              summary.median,
              spec.decimals,
            )} ${spec.unit}, ${summary.n} samples`}
          >
            {/* Whisker P5 → P95. Percentile ends rather than 1.5×IQR fences:
                an IQR fence declares which readings are outliers, and every
                sample is drawn below anyway, so nothing is hidden by saying
                less. */}
            <line
              x1={toX(summary.p5 ?? lo)}
              x2={toX(summary.p95 ?? hi)}
              y1={AXIS_Y}
              y2={AXIS_Y}
              stroke={spec.color}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* Box Q1 → Q3. */}
            <rect
              data-testid={`unit-stats-box-${channel.channel}`}
              x={toX(summary.q1 ?? lo)}
              y={AXIS_Y - BOX_HALF_H}
              width={Math.max(0.4, toX(summary.q3 ?? hi) - toX(summary.q1 ?? lo))}
              height={BOX_HALF_H * 2}
              fill={spec.color}
              fillOpacity={0.22}
              stroke={spec.color}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* Median — the one mark that must stay readable on top of the box. */}
            <line
              x1={toX(summary.median ?? lo)}
              x2={toX(summary.median ?? lo)}
              y1={AXIS_Y - BOX_HALF_H}
              y2={AXIS_Y + BOX_HALF_H}
              stroke={spec.color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {/* The measurements themselves. Deterministic pseudo-jitter keyed
                on the index so the picture does not reshuffle on every render
                — a strip that dances is a strip nobody trusts. */}
            {dots.map((v, i) => (
              <circle
                key={`dot-${i}`}
                data-testid={`unit-stats-dot-${channel.channel}`}
                cx={toX(v)}
                cy={STRIP_TOP + jitter(i) * STRIP_H}
                r={0.6}
                fill={spec.color}
                fillOpacity={0.35}
              />
            ))}
            {/* Range ends, drawn last so they sit above the dots. */}
            <line
              x1={0}
              x2={0}
              y1={AXIS_Y - 3}
              y2={AXIS_Y + 3}
              stroke={GRID}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={PLOT_W}
              x2={PLOT_W}
              y1={AXIS_Y - 3}
              y2={AXIS_Y + 3}
              stroke={GRID}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* The same numbers as a table — the plot is never the only way to
              read them (and it is what an engineer copies into a report). */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-secondary tabular-nums">
            <Stat label="min" value={summary.min} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="P5" value={summary.p5} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="Q1" value={summary.q1} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="median" value={summary.median} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="Q3" value={summary.q3} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="P95" value={summary.p95} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="max" value={summary.max} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="mean" value={summary.mean} decimals={spec.decimals} channel={channel.channel} />
            <Stat label="sd" value={summary.sd} decimals={spec.decimals} channel={channel.channel} />
          </div>
        </>
      )}
    </div>
  )
}

/** One labelled number in the readout row. */
function Stat({
  label,
  value,
  decimals,
  channel,
}: {
  label: string
  value: number | null
  decimals: number
  channel: UnitStatisticsChannel
}): JSX.Element {
  return (
    <span data-testid={`unit-stats-${label}-${channel}`}>
      <span className="text-text-muted">{label} </span>
      {fmt(value, decimals)}
    </span>
  )
}

/** Format a possibly-absent statistic; an em dash where there is no value. */
function fmt(value: number | null, decimals: number): string {
  return value === null ? '—' : value.toFixed(decimals)
}

/**
 * Deterministic pseudo-jitter in [0, 1) for the strip's vertical spread.
 *
 * A hash of the index rather than ``Math.random`` so a re-render redraws the
 * identical picture. The multiplier is an arbitrary irrational-ish constant —
 * its only job is to decorrelate neighbouring indices.
 */
function jitter(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
