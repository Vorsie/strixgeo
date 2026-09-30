// A small SVG line chart for lab readings (settlement vs log time, deviator vs
// strain, e vs log stress …). Hand-rolled rather than Recharts because the
// oedometer panels need one thing Recharts' log axis cannot give: the t = 0
// reading of a stage has no place on a log time axis, so it is drawn as a
// MARKER ON THE LEFT EDGE of the plot (reviewer ruling 2026-09-29), at its
// value, in the series colour.
//
// One axis per chart (no dual axes); legend always present for >= 2 series;
// text in text tokens, colour only on the marks; a nearest-point tooltip on
// hover.

import { useMemo, useState } from 'react'

import { chartDomain, linearTicks, logTicks, type XY } from '../../utils/labSeriesViewerData'

/** One line (with optional point markers and an optional t = 0 edge marker). */
export interface ChartSeries {
  id: string
  label: string
  color: string
  points: XY[]
  /** Value drawn as a marker on the left edge (the stage's t = 0 reading). */
  leftEdgeValue?: number | null
  /** Draw a dot on every point (sparse series, e.g. one point per stage). */
  dots?: boolean
}

interface Props {
  title: string
  xLabel: string
  yLabel: string
  series: ChartSeries[]
  xLog?: boolean
  /** Settlement grows downward: the y axis runs top = 0. */
  invertY?: boolean
  /** Shown instead of the plot when no series has a point. */
  emptyText: string
  testid?: string
}

const W = 460
const H = 240
const M = { left: 52, right: 12, top: 10, bottom: 34 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

/** Compact number for ticks and the tooltip. */
function fmt(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a < 0.001 || a >= 1e5)) return v.toExponential(1)
  return Number(v.toPrecision(3)).toString()
}

/**
 * Line chart with optional log x axis and left-edge t = 0 markers.
 *
 * @returns An SVG figure with legend.
 */
export default function LabSeriesChart({
  title,
  xLabel,
  yLabel,
  series,
  xLog = false,
  invertY = false,
  emptyText,
  testid,
}: Props): JSX.Element {
  const [hover, setHover] = useState<{ s: ChartSeries; p: XY; px: number; py: number } | null>(
    null,
  )
  const geom = useMemo(() => {
    // Every drawn reading strictly inside the frame (owner 2026-09-30: "make
    // sure full trap is visible in plots"); see chartDomain for the margins.
    const d = chartDomain(series, { xLog })
    if (!d) return null
    const { x0, x1, y0, y1 } = d
    const lx0 = Math.log10(x0)
    const lx1 = Math.log10(x1)
    const sx = (x: number): number =>
      M.left + (xLog ? (Math.log10(x) - lx0) / (lx1 - lx0) : (x - x0) / (x1 - x0)) * PW
    const sy = (y: number): number => {
      const f = (y - y0) / (y1 - y0)
      return M.top + (invertY ? f : 1 - f) * PH
    }
    const xt = xLog ? logTicks(x0, x1) : linearTicks(x0, x1)
    return { sx, sy, xt, yt: linearTicks(y0, y1) }
  }, [series, xLog, invertY])

  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H
    let best: { s: ChartSeries; p: XY; px: number; py: number; d: number } | null = null
    for (const s of series) {
      for (const p of s.points) {
        if (xLog && p.x <= 0) continue
        const px = geom.sx(p.x)
        const py = geom.sy(p.y)
        const d = (px - mx) ** 2 + (py - my) ** 2
        if (!best || d < best.d) best = { s, p, px, py, d }
      }
    }
    setHover(best && best.d < 30 ** 2 ? best : null)
  }

  return (
    <figure className="m-0" data-testid={testid}>
      <figcaption className="text-xs font-medium text-text-primary mb-1">{title}</figcaption>
      {!geom ? (
        <p className="text-xs text-text-muted py-6">{emptyText}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto text-text-secondary"
          role="img"
          aria-label={title}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {geom.xt.map(t => (
            <g key={`x${t}`}>
              <line
                x1={geom.sx(t)}
                x2={geom.sx(t)}
                y1={M.top}
                y2={M.top + PH}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text x={geom.sx(t)} y={H - M.bottom + 12} fontSize={9} textAnchor="middle" fill="currentColor">
                {fmt(t)}
              </text>
            </g>
          ))}
          {geom.yt.map(t => (
            <g key={`y${t}`}>
              <line
                x1={M.left}
                x2={M.left + PW}
                y1={geom.sy(t)}
                y2={geom.sy(t)}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text x={M.left - 4} y={geom.sy(t) + 3} fontSize={9} textAnchor="end" fill="currentColor">
                {fmt(t)}
              </text>
            </g>
          ))}
          <rect x={M.left} y={M.top} width={PW} height={PH} fill="none" stroke="currentColor" strokeOpacity={0.35} />
          <text x={M.left + PW / 2} y={H - 4} fontSize={10} textAnchor="middle" fill="currentColor">
            {xLabel}
          </text>
          <text
            x={12}
            y={M.top + PH / 2}
            fontSize={10}
            textAnchor="middle"
            fill="currentColor"
            transform={`rotate(-90 12 ${M.top + PH / 2})`}
          >
            {yLabel}
          </text>
          {series.map(s => {
            const pts = s.points.filter(p => !xLog || p.x > 0)
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${geom.sx(p.x)},${geom.sy(p.y)}`).join('')
            return (
              <g key={s.id} data-series={s.id}>
                {pts.length > 1 && <path d={d} fill="none" stroke={s.color} strokeWidth={1.5} />}
                {(s.dots || pts.length === 1) &&
                  pts.map((p, i) => (
                    <circle key={i} cx={geom.sx(p.x)} cy={geom.sy(p.y)} r={3} fill={s.color} />
                  ))}
                {s.leftEdgeValue != null && (
                  // The t = 0 reading: a left-pointing triangle ON the plot's
                  // left edge, at its value.
                  <path
                    data-testid="t0-marker"
                    d={`M${M.left},${geom.sy(s.leftEdgeValue)} l6,-4 l0,8 z`}
                    fill={s.color}
                  />
                )}
              </g>
            )
          })}
          {hover && (
            <g pointerEvents="none">
              <circle cx={hover.px} cy={hover.py} r={4} fill="none" stroke={hover.s.color} strokeWidth={2} />
              <text x={Math.min(hover.px + 6, W - 120)} y={Math.max(hover.py - 6, 12)} fontSize={10} fill="currentColor">
                {`${hover.s.label}: ${fmt(hover.p.x)}, ${fmt(hover.p.y)}`}
              </text>
            </g>
          )}
        </svg>
      )}
      {geom && series.length > 1 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-text-secondary">
          {series.map(s => (
            <li key={s.id} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
