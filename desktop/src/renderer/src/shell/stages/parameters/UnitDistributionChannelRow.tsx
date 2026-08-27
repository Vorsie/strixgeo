// One channel's box + strip row of the per-unit distribution panel.
//
// Split out of ``UnitDistributionPanels`` when the second-dogfeed rulings
// (fit toggle, off-axis notifier, tick labels — owner 2026-08-27) pushed the
// panel past the 500-line god-component gate (debt #201). The parent owns the
// heading, the fit toggle and the empty states; this file owns everything a
// single channel draws.
//
// COLOUR. The three channel tokens are the ones ``CptSbtDepthPanels`` already
// draws qc / fs / Rf with, deliberately: the same measurement wears the same
// ink in the depth panels directly above this one in the same inspector. Run
// through the categorical-palette validator these three FAIL the lightness-band
// and CVD-separation checks — but those checks exist so a reader can tell two
// series apart INSIDE one chart, and here every chart has exactly one series
// named by its own title. The check that does bind for a single-series mark,
// contrast against the surface, passes in both light and dark.

import { useMemo } from 'react'

import {
  FS_AXIS_MAX_MPA,
  QC_AXIS_MAX_MPA,
  RF_AXIS_MAX_PCT,
  axisTickValues,
  fitAxisMax,
} from '../../../utils/cptAxisScales'
import AxisTickRow from './AxisTickRow'
import type { UnitChannelStatistics, UnitStatisticsChannel } from './unitStatistics'

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

/**
 * Per-channel presentation — the ink, the words and the AXIS for each row.
 *
 * ``axisMax`` is the CPT plot's own full scale (owner ruling 2026-08-27,
 * verbatim: "Qc/fs/rf should start at zero, u can use the same axes as the
 * cpt plot") — the DOV standard fixed ranges from ``utils/cptAxisScales.ts``,
 * the ONE source ``CptChart`` also reads. A fixed 0-anchored axis is what
 * makes two units — and a unit against its CPT chart — comparable at a
 * glance; the observed-range axis it replaces made every unit's box look the
 * same width. The fit toggle (S1, same day) trades that comparability for
 * resolution on demand, and reverts exactly.
 */
const CHANNEL_SPEC: Readonly<
  Record<
    UnitStatisticsChannel,
    { title: string; unit: string; color: string; decimals: number; axisMax: number }
  >
> = {
  qc: {
    title: 'Cone resistance',
    unit: 'MPa',
    color: 'var(--chart-clr-qc, #111827)',
    decimals: 1,
    axisMax: QC_AXIS_MAX_MPA,
  },
  fs: {
    title: 'Sleeve friction',
    unit: 'MPa',
    color: 'var(--chart-clr-fs, #16a34a)',
    decimals: 3,
    axisMax: FS_AXIS_MAX_MPA,
  },
  rf: {
    title: 'Friction ratio',
    unit: '%',
    color: 'var(--chart-clr-rf, #b45309)',
    decimals: 2,
    axisMax: RF_AXIS_MAX_PCT,
  },
}

const GRID = 'var(--chart-grid, #e5e7eb)'

/** Box + strip + numeric readout for a single channel. */
export default function ChannelRow({
  channel,
  fit,
}: {
  channel: UnitChannelStatistics
  /** S1 — fitted axis (0 → pooled max, rounded up) instead of the fixed one. */
  fit: boolean
}): JSX.Element {
  const spec = CHANNEL_SPEC[channel.channel]
  const { summary, samples } = channel

  // The axis: 0 → the DOV full scale (the CPT plot's own axis, first-dogfeed
  // ruling), or — fit mode (S1) — 0 → the pooled max rounded up to a tick.
  // In fit mode nothing can sit ABOVE the axis by construction — but
  // ``fitAxisMax`` only raises the CEILING, so a NEGATIVE reading (live: fs
  // down to −0.091 MPa) is off axis in BOTH modes: a zero-anchored axis
  // cannot place it. It stays excluded and counted below (audit F6).
  const axisMax = fit ? fitAxisMax(summary.max ?? 0, spec.axisMax) : spec.axisMax

  // S2 (owner 2026-08-27): "No clamping, if something is off the axis then it
  // doesn't render, maybe a notifier # off axis that way." A reading past the
  // axis end (or a negative artefact) is EXCLUDED from the strip — never
  // pinned to the wall — and counted for the notifier below. The numeric
  // readouts still report the true values.
  const { onAxisSamples, offAxisCount } = useMemo(() => {
    const onAxis = samples.filter(v => v >= 0 && v <= axisMax)
    return { onAxisSamples: onAxis, offAxisCount: samples.length - onAxis.length }
  }, [samples, axisMax])

  // Even subsample of the SORTED on-axis samples — keeps the shape, bounds
  // the DOM.
  const dots = useMemo<number[]>(() => {
    if (onAxisSamples.length <= MAX_STRIP_DOTS) return onAxisSamples
    const step = onAxisSamples.length / MAX_STRIP_DOTS
    const out: number[] = []
    for (let i = 0; i < MAX_STRIP_DOTS; i++) out.push(onAxisSamples[Math.floor(i * step)])
    return out
  }, [onAxisSamples])

  const hasData = summary.n > 0 && summary.min !== null && summary.max !== null

  // No clamp (S2): the mapping is linear and honest; anything the axis cannot
  // place simply is not drawn (each mark below checks its own values).
  const toX = (v: number): number => (v / axisMax) * PLOT_W
  /** A box/whisker mark renders only when the axis can place it whole. */
  const onAxis = (...values: (number | null)[]): boolean =>
    values.every(v => v !== null && v >= 0 && v <= axisMax)
  const lo = summary.min ?? 0
  const hi = summary.max ?? axisMax

  // F6 — never drop a summary mark SILENTLY: when the whisker / box / median
  // span off-axis values (negative readings pull every order statistic left),
  // the notifier names what is missing and why instead of leaving a bare row.
  const droppedMarks = hasData
    ? [
        onAxis(summary.p5 ?? lo, summary.p95 ?? hi) ? null : 'whisker',
        onAxis(summary.q1 ?? lo, summary.q3 ?? hi) ? null : 'box',
        onAxis(summary.median ?? lo) ? null : 'median',
      ].filter((m): m is string => m !== null)
    : []

  // S3: labelled ticks derived from the ACTIVE axis span — the shared helper
  // reproduces the DOV convention on the fixed axes and follows the fitted
  // span in fit mode. First tick is the 0 anchor, last is the axis end.
  const ticks = axisTickValues(0, axisMax)

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
            {/* S3 — tick gridlines at the labelled positions, so the labels
                below have a mark to hang off. Interior ticks only; the two
                range ends draw their own (stronger) marks last. */}
            {ticks.slice(1, -1).map(t => (
              <line
                key={`tick-${t}`}
                x1={toX(t)}
                x2={toX(t)}
                y1={0}
                y2={PLOT_H}
                stroke={GRID}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Whisker P5 → P95. Percentile ends rather than 1.5×IQR fences:
                an IQR fence declares which readings are outliers, and every
                sample is drawn below anyway, so nothing is hidden by saying
                less. Off the axis → not drawn (S2 — a truncated whisker would
                be the clamp again). */}
            {onAxis(summary.p5 ?? lo, summary.p95 ?? hi) && (
              <line
                x1={toX(summary.p5 ?? lo)}
                x2={toX(summary.p95 ?? hi)}
                y1={AXIS_Y}
                y2={AXIS_Y}
                stroke={spec.color}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Box Q1 → Q3 — only when the axis can place the whole box. */}
            {onAxis(summary.q1 ?? lo, summary.q3 ?? hi) && (
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
            )}
            {/* Median — the one mark that must stay readable on top of the box. */}
            {onAxis(summary.median ?? lo) && (
              <line
                x1={toX(summary.median ?? lo)}
                x2={toX(summary.median ?? lo)}
                y1={AXIS_Y - BOX_HALF_H}
                y2={AXIS_Y + BOX_HALF_H}
                stroke={spec.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
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

          {/* Axis tick labels (S3) — shared row, one tick-step source. Outside
              the SVG because its non-uniform viewBox stretch would distort
              text glyphs. */}
          <AxisTickRow
            ticks={ticks}
            axisMax={axisMax}
            unit={spec.unit}
            zeroTestid={`unit-stats-axis-zero-${channel.channel}`}
            maxTestid={`unit-stats-axis-max-${channel.channel}`}
            tickTestid={`unit-stats-axis-tick-${channel.channel}`}
          />

          {/* S2 — the notifier: readings the axis could not place. Rendered
              only when something actually fell off, so the quiet case stays
              quiet. F6 adds the WHY when summary marks are missing too — a
              dropped whisker/box must never just vanish. */}
          {offAxisCount > 0 && (
            <div
              className="text-[10px] text-text-muted tabular-nums"
              data-testid={`unit-stats-offaxis-${channel.channel}`}
            >
              {offAxisCount} off axis
              {droppedMarks.length > 0 && (
                <span data-testid={`unit-stats-marksoff-${channel.channel}`}>
                  {' '}· {droppedMarks.join(' / ')} not drawn — spanning off-axis values
                </span>
              )}
            </div>
          )}

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
