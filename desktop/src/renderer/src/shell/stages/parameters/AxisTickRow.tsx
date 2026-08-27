// The labelled tick row under a value axis — owner ruling S3, 2026-08-27,
// verbatim: "I want more sublabels on all axis ticks not too many."
//
// ONE component for every panel that labels a horizontal value axis (the CPT
// distribution rows and the identification scatter panels), so the label
// treatment cannot drift between them. The tick VALUES come from
// ``axisTickValues`` (utils/cptAxisScales.ts — the one source for tick
// steps); this row only places and formats them.
//
// HTML, not SVG text: the plots stretch a user-space viewBox non-uniformly,
// which would distort glyphs — the same reason the original end labels lived
// outside the SVG.

import { formatTickLabel, tickStepOf } from '../../../utils/cptAxisScales'

interface Props {
  /** Labelled tick values, ascending (from ``axisTickValues``). */
  ticks: readonly number[]
  /** The axis end value — the position denominator (ticks place at v/axisMax). */
  axisMax: number
  /** Unit string appended to the END label ("MPa", "%"); null/absent → none. */
  unit?: string | null
  /** data-testid for the zero (first) label. */
  zeroTestid?: string
  /** data-testid for the end (last) label. */
  maxTestid?: string
  /** data-testid each INTERIOR tick label carries. */
  tickTestid?: string
  /** Extra classes on the row (e.g. left padding to align with the plot). */
  className?: string
  /**
   * Verbatim text for the END label, when the axis end is NOT a tick (the
   * identification panels' exact-pooled-max axes). The last tick then counts
   * as an interior label instead of anchoring right. Absent → the last tick
   * is the end label (the CPT / fitted axes, whose end is a tick by
   * construction).
   */
  endLabel?: string
}

/**
 * Positioned tick labels for a zero-anchored horizontal value axis.
 *
 * The first tick anchors left, the last anchors right (so neither overhangs
 * the row), interior ticks centre on their position. Interior labels that
 * would crowd the ends (within 6 % of either) are dropped — the end labels
 * win, "not too many".
 *
 * Parameters
 * ----------
 * props : Props
 *     Tick values + placement metadata; see the interface.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The label row, or nothing when there are fewer than 2 ticks.
 */
export default function AxisTickRow({
  ticks,
  axisMax,
  unit = null,
  zeroTestid,
  maxTestid,
  tickTestid,
  className = '',
  endLabel,
}: Props): JSX.Element | null {
  if (ticks.length < 1 || axisMax <= 0) return null
  const step = tickStepOf(ticks)
  const last = ticks[ticks.length - 1]
  // With an explicit end label every non-zero tick is interior; otherwise the
  // last tick IS the end label.
  const interior = (endLabel !== undefined ? ticks.slice(1) : ticks.slice(1, -1)).filter(t => {
    const f = t / axisMax
    return f >= 0.06 && f <= 0.94
  })
  return (
    <div
      className={`relative h-3 text-[9px] text-text-muted tabular-nums leading-tight ${className}`}
    >
      <span data-testid={zeroTestid} className="absolute left-0">
        {formatTickLabel(ticks[0], step)}
      </span>
      {interior.map(t => (
        <span
          key={`tick-${t}`}
          data-testid={tickTestid}
          className="absolute -translate-x-1/2"
          style={{ left: `${(t / axisMax) * 100}%` }}
        >
          {formatTickLabel(t, step)}
        </span>
      ))}
      <span data-testid={maxTestid} className="absolute right-0">
        {endLabel !== undefined
          ? endLabel
          : `${formatTickLabel(last, step)}${unit !== null && unit !== '' ? ` ${unit}` : ''}`}
      </span>
    </div>
  )
}
