// All the unit's grain-size curves on ONE graph — owner ruling S5,
// 2026-08-27, verbatim: "i'm missing all PSD's on one graph."
//
// The axis is the section hover card's OWN convention, deliberately: the
// fixed 63 → 0.001 mm log window, INVERTED (coarse left — owner 2026-08-14:
// "the psd x-axis should be inverted"), so a curve read here and a curve read
// on the section hover are the same picture. Geometry goes through
// ``psdPolyline`` / ``PSD_FIXED_DOMAIN`` (utils/psdCurve.ts) — one maths, two
// surfaces.
//
// Y is % passing (finer by weight), 0 at the bottom, 100 at the top, with the
// conventional sieve anchors labelled: 63 / 2 / 0.2 / 0.063 / 0.002 mm — the
// fraction boundaries plus the 0.2 mm fine/medium-sand sieve.
//
// NO EMPTY JARS: a unit without a drawable curve renders nothing at all.

import type { UnitPsdPool } from './unitPsd'
import {
  PSD_FIXED_DOMAIN,
  PSD_FRACTION_ZONES,
  psdPolyline,
} from '../../../utils/psdCurve'

// User-space plot box, stretched to the row width by a non-uniform viewBox —
// the same trick every panel in this stage uses. Text stays in HTML.
const PLOT_W = 100
const PLOT_H = 60
const GRID = 'var(--chart-grid, #e5e7eb)'

/**
 * Curve colours, cycled — the chart-curve tokens the section's PSD hover card
 * already cycles, so a curve wears familiar ink in both places.
 */
const SERIES_COLORS = [
  'var(--chart-clr-qt, #1d4ed8)',
  'var(--chart-clr-fs, #16a34a)',
  'var(--chart-clr-u2, #9333ea)',
  'var(--chart-clr-rf, #b45309)',
]

/** The labelled sieve anchors (mm), conventional. */
const SIEVE_ANCHORS = [63, 2, 0.2, 0.063, 0.002]

/** % passing gridline + label positions. */
const PCT_TICKS = [0, 25, 50, 75, 100]

/** Fraction of the plot width where a diameter sits (inverted log axis). */
function anchorFraction(mm: number): number {
  const logMin = Math.log10(PSD_FIXED_DOMAIN.minMm)
  const logMax = Math.log10(PSD_FIXED_DOMAIN.maxMm)
  return (logMax - Math.log10(mm)) / (logMax - logMin)
}

/** Format a labelled anchor — sub-mm sieves keep their decimals. */
function anchorLabel(mm: number): string {
  if (mm >= 1) return mm.toFixed(0)
  if (mm >= 0.01) return String(mm)
  return mm.toFixed(3)
}

/**
 * The unit's PSD overlay graph.
 *
 * Parameters
 * ----------
 * props.pool : UnitPsdPool
 *     The pooled curves + the skipped-count (from ``poolUnitPsdCurves``).
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The graph, or nothing at all when the unit has no drawable curve.
 */
export default function UnitPsdPanel({ pool }: { pool: UnitPsdPool }): JSX.Element | null {
  if (pool.curves.length === 0) return null

  return (
    <div className="px-3 py-2 max-w-xl" data-testid="unit-psd-panel">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-text-primary">
          Grain-size distributions{' '}
          <span className="text-text-muted font-normal">(% passing)</span>
        </span>
        <span className="text-[10px] text-text-muted tabular-nums">
          {pool.curves.length} curve{pool.curves.length === 1 ? '' : 's'}
          {pool.skippedCurves > 0 && (
            <span data-testid="unit-psd-skipped">
              {' '}
              · {pool.skippedCurves} skipped (fewer than 2 sieve points)
            </span>
          )}
        </span>
      </div>

      {/* Zone names over the plot — the reason the axis is fixed. HTML so the
          stretched SVG cannot distort the glyphs; zones too narrow on the log
          window (clay, ~6 %) stay line-only, as on the hover card. */}
      <div className="relative h-3 text-[9px] text-text-muted leading-tight">
        {PSD_FRACTION_ZONES.map(zone => {
          const left = anchorFraction(zone.toMm)
          const right = anchorFraction(zone.fromMm)
          if (right - left < 0.08) return null
          return (
            <span
              key={zone.label}
              data-testid="unit-psd-zone-label"
              className="absolute -translate-x-1/2"
              style={{ left: `${((left + right) / 2) * 100}%` }}
            >
              {zone.label}
            </span>
          )
        })}
      </div>

      <div className="flex gap-1">
        {/* % passing labels — HTML, ends + quarters. */}
        <div className="relative w-6 text-[9px] text-text-muted tabular-nums leading-tight text-right">
          {PCT_TICKS.map(pct => (
            <span
              key={`pct-${pct}`}
              data-testid="unit-psd-pct-label"
              className="absolute right-0"
              style={
                pct === 0
                  ? { bottom: 0 }
                  : pct === 100
                    ? { top: 0 }
                    : { top: `${100 - pct}%`, transform: 'translateY(-50%)' }
              }
            >
              {pct}
            </span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: 180 }}
          role="img"
          aria-label={`Grain-size distributions: ${pool.curves.length} curves, % passing against diameter`}
        >
          {/* % passing gridlines. */}
          {PCT_TICKS.slice(1, -1).map(pct => (
            <line
              key={`gy-${pct}`}
              x1={0}
              x2={PLOT_W}
              y1={((100 - pct) / 100) * PLOT_H}
              y2={((100 - pct) / 100) * PLOT_H}
              stroke={GRID}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Sieve-anchor gridlines; the fraction boundaries among them draw
              dashed and slightly stronger, exactly as on the hover card. */}
          {SIEVE_ANCHORS.map(mm => {
            const boundary = PSD_FRACTION_ZONES.some(z => z.fromMm === mm)
            const x = anchorFraction(mm) * PLOT_W
            return (
              <line
                key={`gx-${mm}`}
                x1={x}
                x2={x}
                y1={0}
                y2={PLOT_H}
                stroke={GRID}
                strokeOpacity={boundary ? 1 : 0.6}
                strokeWidth={boundary ? 0.75 : 0.5}
                strokeDasharray={boundary ? '3 2' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          <rect
            x={0}
            y={0}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke={GRID}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
          {/* The curves — one polyline per grain-size test, ``<title>`` names
              the sample so hovering answers "whose curve is this". */}
          {pool.curves.map((curve, i) => (
            <polyline
              key={curve.key}
              data-testid={`unit-psd-curve-${curve.key}`}
              points={psdPolyline(curve.points, PSD_FIXED_DOMAIN, {
                width: PLOT_W,
                height: PLOT_H,
              })}
              fill="none"
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={1.2}
              strokeOpacity={0.8}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'visibleStroke' }}
            >
              <title>
                {`${curve.boreholeName}${curve.sampleNumber ? ` · sample ${curve.sampleNumber}` : ''} · ${curve.depthTopM.toFixed(2)}–${curve.depthBaseM.toFixed(2)} m`}
              </title>
            </polyline>
          ))}
        </svg>
      </div>

      {/* Diameter anchors — labelled at their log positions (inverted axis:
          coarse LEFT). */}
      <div className="relative ml-7 h-3 text-[9px] text-text-muted tabular-nums leading-tight">
        {SIEVE_ANCHORS.map(mm => {
          const f = anchorFraction(mm)
          return (
            <span
              key={`al-${mm}`}
              data-testid="unit-psd-anchor-label"
              className={f < 0.03 ? 'absolute left-0' : 'absolute -translate-x-1/2'}
              style={f < 0.03 ? undefined : { left: `${f * 100}%` }}
            >
              {anchorLabel(mm)}
            </span>
          )
        })}
        <span className="absolute right-0">mm</span>
      </div>
    </div>
  )
}
