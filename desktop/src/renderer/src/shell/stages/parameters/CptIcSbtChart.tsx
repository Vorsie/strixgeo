// CptIcSbtChart — Robertson Ic curve + SBT zone bands for one CPT.
//
// Lifted from CptChart.tsx (debt #22, 2026-06-01): the Ic panel is
// interpretation, not a raw measurement. It belongs in the Parameters
// stage's per-test tab alongside the Ic̄ / dominant-SBT statistics
// already shown there.
//
// Data source: the same ``plot.ic`` field that the CptChart used —
// the ``/cpt/{id}/plot`` endpoint populates it from
// ``robertson_2015.ic_series_2015``.
//
// Rendering: uses the same Recharts primitives (ComposedChart, Line,
// XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer)
// as CptChart so there is no new viz dependency.
//
// Interactions: scroll-to-zoom + drag-to-pan on the depth axis,
// identical to CptChart (the same event-listener pattern).

import { useState, useEffect, useRef } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import type { CptPlotResponse } from '../../../api/client'

// ── Axis geometry ────────────────────────────────────────────────────────────
// Y_W matches CptChart so any side-by-side arrangement aligns grid lines.
const Y_W   = 52
const IC_MAX = 4

// Curve + chrome colours — CSS vars from index.css for dark/light parity.
const IC_CLR          = 'var(--chart-clr-ic)'
const IC_BOUNDARY_CLR = 'var(--chart-ic-boundary)'
const IC_ZONE_LABEL_CLR = 'var(--chart-ic-zone-label)'
const GRID            = 'var(--chart-grid)'
const SURFACE_REF_CLR = 'var(--chart-surface-ref)'

// Robertson (2009) SBT zone boundaries + fill colours.
// Hues are domain colours (Tier 5 — must not change; ux.md).
export const IC_ZONES = [
  { x1: 0,    x2: 1.31, fill: '#fef9c3', label: 'Sand'      },
  { x1: 1.31, x2: 2.05, fill: '#ffedd5', label: 'Sand mix'  },
  { x1: 2.05, x2: 2.60, fill: '#dcfce7', label: 'Silt mix'  },
  { x1: 2.60, x2: 2.95, fill: '#dbeafe', label: 'Clay'      },
  { x1: 2.95, x2: 3.60, fill: '#fef3c7', label: 'Organic'   },
  { x1: 3.60, x2: 4.00, fill: '#f3e8ff', label: 'Sensitive' },
] as const

const IC_ZONE_BOUNDARIES = [1.31, 2.05, 2.60, 2.95, 3.60]

// Short labels for narrow zones (rotated 90° in the overlay).
const IC_ZONE_SHORT: Record<string, string> = {
  Sand: 'Sand', 'Sand mix': 'S.mix', 'Silt mix': 'Silt',
  Clay: 'Clay', Organic: 'Org.', Sensitive: 'Sens.',
}

interface DataPoint {
  depth: number
  ic: number | null
}

interface Props {
  /** Plot payload from ``/cpt/{id}/plot``.  ic must be non-null for this
   *  component to render; callers should gate on ``plot.ic !== null``. */
  plot: CptPlotResponse
  /** Optional title displayed above the chart (e.g. the CPT name). */
  title?: string
  /** Height of the chart area in CSS pixels. Defaults to 400. */
  heightPx?: number
}

/**
 * Standalone Robertson Ic curve + SBT zone-band chart for one CPT.
 *
 * Lifted from ``CptChart.tsx`` (debt #22): Ic/SBT is *interpretation*,
 * not a raw measurement — it belongs in the Parameters stage, not in
 * the raw-data chart.
 *
 * Parameters
 * ----------
 * plot : CptPlotResponse
 *     Plot payload from ``/cpt/{id}/plot``.  ``plot.ic`` must be
 *     non-null; otherwise the component returns null.
 * title : string, optional
 *     Optional heading shown above the chart.
 * heightPx : number, optional
 *     Chart area height in pixels. Defaults to 400.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     Null when ``plot.ic`` is absent or empty.
 */
export default function CptIcSbtChart({ plot, title, heightPx = 400 }: Props): JSX.Element | null {
  if (!plot.ic || plot.ic.length === 0) return null

  const rawData: DataPoint[] = plot.depths_m.map((d, i) => ({
    depth: d,
    ic: plot.ic![i] ?? null,
  }))

  const maxDepth = Math.ceil((plot.depths_m.at(-1) ?? 1) * 10) / 10

  return (
    <CptIcSbtChartInner
      rawData={rawData}
      maxDepth={maxDepth}
      elevationM={null}
      title={title}
      heightPx={heightPx}
    />
  )
}

// ── Inner component (stateful) ────────────────────────────────────────────────
// Separated from the outer shell so the outer guard (plot.ic check) keeps the
// hook call count stable — hooks can't be placed after a conditional return.

interface InnerProps {
  rawData: DataPoint[]
  maxDepth: number
  elevationM: number | null
  title?: string
  heightPx: number
}

function CptIcSbtChartInner({
  rawData,
  maxDepth,
  title,
  heightPx,
}: InnerProps): JSX.Element {
  const [zoomDomain, setZoomDomain] = useState<[number, number]>([0, maxDepth])
  const [isDragging, setIsDragging] = useState(false)

  const zoomDomainRef = useRef(zoomDomain)
  zoomDomainRef.current = zoomDomain

  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<{ startY: number; domainAtStart: [number, number] } | null>(null)

  useEffect(() => {
    setZoomDomain([0, maxDepth])
  }, [maxDepth])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const relY   = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      setZoomDomain(([min, max]) => {
        const range        = max - min
        const depthAtMouse = min + relY * range
        const newRange     = Math.max(0.5, Math.min(maxDepth, range * factor))
        let   newMin       = depthAtMouse - relY * newRange
        let   newMax       = newMin + newRange
        if (newMin < 0)        { newMin = 0;        newMax = Math.min(maxDepth, newRange) }
        if (newMax > maxDepth) { newMax = maxDepth; newMin = Math.max(0, maxDepth - newRange) }
        return [newMin, newMax]
      })
    }

    const onMouseDown = (e: MouseEvent) => {
      const [min, max] = zoomDomainRef.current
      if (min === 0 && max === maxDepth) return
      dragRef.current = { startY: e.clientY, domainAtStart: [min, max] }
      setIsDragging(true)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const rect  = el.getBoundingClientRect()
      const dy    = e.clientY - dragRef.current.startY
      const [min, max] = dragRef.current.domainAtStart
      const range = max - min
      const delta = (dy / rect.height) * range
      const newMin = Math.max(0, min - delta)
      const newMax = Math.min(maxDepth, newMin + range)
      setZoomDomain([newMin, newMax])
    }

    const onMouseUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setIsDragging(false)
    }

    el.addEventListener('wheel',      onWheel,    { passive: false })
    el.addEventListener('mousedown',  onMouseDown)
    el.addEventListener('mousemove',  onMouseMove)
    el.addEventListener('mouseup',    onMouseUp)
    el.addEventListener('mouseleave', onMouseUp)
    return () => {
      el.removeEventListener('wheel',      onWheel)
      el.removeEventListener('mousedown',  onMouseDown)
      el.removeEventListener('mousemove',  onMouseMove)
      el.removeEventListener('mouseup',    onMouseUp)
      el.removeEventListener('mouseleave', onMouseUp)
    }
  }, [maxDepth])

  const isZoomed    = zoomDomain[0] !== 0 || zoomDomain[1] !== maxDepth
  const zoomedData  = rawData.filter(d => d.depth >= zoomDomain[0] && d.depth <= zoomDomain[1])
  const topM = 16
  const botM = 16

  return (
    <div className="flex flex-col" data-testid="cpt-ic-sbt-chart">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {title && (
            <span className="text-[11px] font-semibold text-text-primary">
              {title}
            </span>
          )}
          {/* Ic legend item */}
          <div className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-slate-300"
            data-testid="cpt-ic-sbt-legend-ic">
            <div className="w-6" style={{ borderTopWidth: 1.5, borderTopStyle: 'solid', borderTopColor: IC_CLR }} />
            Ic (Robertson 2015)
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 shrink-0 text-gray-400 dark:text-slate-400 text-[10px] select-none">
          {isZoomed && (
            <span className="mr-1">
              {zoomDomain[0].toFixed(1)}–{zoomDomain[1].toFixed(1)} m
            </span>
          )}
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 leading-none text-gray-500 dark:text-slate-300"
            title="Zoom in"
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.max(0.5, (max - min) / 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >+</button>
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 leading-none text-gray-500 dark:text-slate-300"
            title="Zoom out"
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.min(maxDepth, (max - min) * 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >−</button>
          {isZoomed && (
            <button
              className="px-2 h-6 rounded hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300"
              title="Reset zoom"
              onClick={() => setZoomDomain([0, maxDepth])}
            >Reset</button>
          )}
        </div>
      </div>

      {/* SBT zone colour key */}
      <div className="flex items-center gap-2 px-3 pb-1 shrink-0 flex-wrap" data-testid="cpt-ic-sbt-zone-key">
        <span className="text-[9px] text-gray-400 dark:text-slate-500 mr-1">SBT:</span>
        {IC_ZONES.map(z => (
          <div key={z.x1} className="flex items-center gap-1 text-[9px] text-gray-500 dark:text-slate-400"
            data-testid={`cpt-ic-sbt-zone-${z.label.replace(/\s+/g, '-').toLowerCase()}`}>
            <div
              className="w-3 h-2.5 rounded-sm border border-gray-200 dark:border-slate-600"
              style={{ background: z.fill }}
            />
            {z.label}
          </div>
        ))}
      </div>

      {/* Chart panel — scroll-to-zoom + drag-to-pan */}
      <div
        ref={panelRef}
        style={{ height: heightPx, position: 'relative', cursor: isDragging ? 'grabbing' : (isZoomed ? 'grab' : 'default') }}
        className="px-1"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={zoomedData}
            layout="vertical"
            margin={{ top: topM, right: 0, bottom: botM, left: 0 }}
          >
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} />

            {/* Left Y-axis — depth label */}
            <YAxis
              yAxisId="y"
              orientation="left"
              dataKey="depth"
              type="number"
              domain={zoomDomain}
              tickCount={11}
              tick={{ fontSize: 11 }}
              tickFormatter={(d: number) => d.toFixed(1)}
              label={{
                value: 'Depth (m)',
                angle: -90,
                position: 'insideLeft',
                offset: -(Y_W - 12),
                style: { fontSize: 10 },
              }}
              width={Y_W}
            />

            {/* Right Y-axis — depth echo (ghost, no ticks) */}
            <YAxis
              yAxisId="yr"
              orientation="right"
              dataKey="depth"
              type="number"
              domain={zoomDomain}
              tick={false}
              axisLine={false}
              tickLine={false}
              width={Y_W}
            />

            {/* Ic X-axis — top */}
            <XAxis
              xAxisId="ic"
              type="number"
              orientation="top"
              domain={[0, IC_MAX]}
              tick={{ fontSize: 11 }}
              ticks={[0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]}
            />
            {/* Ic X-axis — bottom mirror */}
            <XAxis
              xAxisId="icb"
              type="number"
              orientation="bottom"
              domain={[0, IC_MAX]}
              tick={{ fontSize: 11 }}
              ticks={[0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]}
            />

            {/* SBT zone background fills */}
            {IC_ZONES.map(z => (
              <ReferenceArea
                key={`zone-${z.x1}`}
                yAxisId="y"
                xAxisId="ic"
                x1={z.x1}
                x2={z.x2}
                fill={z.fill}
                fillOpacity={1}
              />
            ))}

            {/* SBT zone boundary lines */}
            {IC_ZONE_BOUNDARIES.map(v => (
              <ReferenceLine
                key={`line-${v}`}
                yAxisId="y"
                xAxisId="ic"
                x={v}
                stroke={IC_BOUNDARY_CLR}
                strokeWidth={0.8}
              />
            ))}

            {/* Surface reference line when depth=0 is an elevation */}
            <ReferenceLine
              yAxisId="y"
              xAxisId="ic"
              y={0}
              stroke={SURFACE_REF_CLR}
              strokeWidth={0.5}
            />

            <Tooltip
              contentStyle={{ fontSize: 10 }}
              formatter={(val: unknown, key: string) =>
                val === null ? ['—', key] : [`${Number(val).toFixed(2)}`, key]
              }
              labelFormatter={(d: number) => `Depth: ${Number(d).toFixed(2)} m`}
            />

            {/* Ic curve */}
            <Line
              yAxisId="y"
              xAxisId="ic"
              dataKey="ic"
              name="Ic (Robertson 2015)"
              stroke={IC_CLR}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* SBT zone short-label overlay — rotated text inside each zone column */}
        <IcZoneLabelsOverlay topM={topM} botM={botM} />
      </div>
    </div>
  )
}

// ── Zone labels overlay ───────────────────────────────────────────────────────
// Absolute-positioned over the chart area; mirrors the overlay in CptChart.
function IcZoneLabelsOverlay({ topM, botM }: { topM: number; botM: number }): JSX.Element {
  return (
    <div
      className="absolute pointer-events-none select-none"
      // bottom offset: botM (recharts margin) + tick-text (~22px) + gap (~4px)
      style={{ bottom: botM + 26, left: Y_W, right: Y_W, height: 44 }}
      data-testid="cpt-ic-sbt-zone-labels"
    >
      {IC_ZONES.map(z => {
        const centerPct = ((z.x1 + z.x2) / 2 / IC_MAX) * 100
        return (
          <span
            key={z.x1}
            data-testid={`cpt-ic-sbt-zone-label-${z.label.replace(/\s+/g, '-').toLowerCase()}`}
            style={{
              position:        'absolute',
              bottom:          2,
              left:            `${centerPct}%`,
              transform:       'translate(-50%, 0) rotate(-90deg)',
              transformOrigin: 'center bottom',
              fontSize:        8,
              color:           IC_ZONE_LABEL_CLR,
              fontWeight:      500,
              whiteSpace:      'nowrap',
              lineHeight:      1,
            }}
          >
            {IC_ZONE_SHORT[z.label] ?? z.label}
          </span>
        )
      })}
    </div>
  )
}
