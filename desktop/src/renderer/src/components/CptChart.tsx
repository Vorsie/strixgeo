import { useState, useEffect, useRef } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import type { CptPlotResponse, CptResponse } from '../api/client'

interface Props {
  plot:   CptPlotResponse
  name:   string
  detail?: CptResponse
}

// ── DOV standard axis ranges ────────────────────────────────────────────────
const Y_W    = 52    // px — every Y-axis (real and ghost) uses this width so grid lines align
const QC_MAX = 40    // MPa
const FS_MAX = 1     // MPa
const RF_MAX = 10    // %
const U2_MIN = -100  // kPa
const U2_MAX = 300   // kPa
const IC_MAX = 4     // dimensionless

const GRID   = '#fce4ec'
const QC_CLR = '#111827'
const FS_CLR = '#16a34a'
const RF_CLR = '#b45309'
const U2_CLR = '#7c3aed'
const QT_CLR = '#1d4ed8'
const IC_CLR = '#374151'
const PD_CLR = '#dc2626'

const IC_ZONES = [
  { x1: 0,    x2: 1.31, fill: '#fef9c3', label: 'Sand'      },
  { x1: 1.31, x2: 2.05, fill: '#ffedd5', label: 'Sand mix'  },
  { x1: 2.05, x2: 2.60, fill: '#dcfce7', label: 'Silt mix'  },
  { x1: 2.60, x2: 2.95, fill: '#dbeafe', label: 'Clay'      },
  { x1: 2.95, x2: 3.60, fill: '#fef3c7', label: 'Organic'   },
  { x1: 3.60, x2: 4.00, fill: '#f3e8ff', label: 'Sensitive' },
] as const

const IC_ZONE_BOUNDARIES = [1.31, 2.05, 2.60, 2.95, 3.60]

function makeLevelFmt(elevationM: number | null) {
  return (d: number) => {
    const v = elevationM !== null ? elevationM - d : d
    return (v >= 0 ? '+' : '') + v.toFixed(1)
  }
}
const fmtDepth = (d: number) => d.toFixed(1)

// ── Y-axis builders ─────────────────────────────────────────────────────────
function yLevel(domain: [number, number], fmt: (d: number) => string, label: string) {
  return (
    <YAxis yAxisId="y" orientation="left" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 11 }}
      tickFormatter={fmt}
      label={{ value: label, angle: -90, position: 'insideLeft', offset: -(Y_W - 12), style: { fontSize: 10 } }}
      width={Y_W}
    />
  )
}
function yLength(domain: [number, number]) {
  return (
    <YAxis yAxisId="yr" orientation="right" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 11 }}
      tickFormatter={fmtDepth}
      label={{ value: 'Length (m)', angle: 90, position: 'insideRight', offset: -(Y_W - 12), style: { fontSize: 10 } }}
      width={Y_W}
    />
  )
}
function yGhostLeft(domain: [number, number]) {
  return (
    <YAxis yAxisId="y" orientation="left" dataKey="depth" type="number"
      domain={domain} tick={false} axisLine={false} tickLine={false} width={Y_W}
    />
  )
}
function yGhostRight(domain: [number, number]) {
  return (
    <YAxis yAxisId="yr" orientation="right" dataKey="depth" type="number"
      domain={domain} tick={false} axisLine={false} tickLine={false} width={Y_W}
    />
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CptChart({ plot, name, detail }: Props) {
  const elevationM = detail?.elevation_m ?? null
  const preDrillM  = detail?.pre_drill_m ?? 0
  const cptType    = detail?.cpt_type ?? ''

  const data = plot.depths_m.map((d, i) => ({
    depth:   d,
    qc:      plot.qc_mpa[i]                    ?? null,
    fs:      plot.fs_mpa ?  (plot.fs_mpa[i]    ?? null) : null,
    rf:      plot.rf_pct ?  (plot.rf_pct[i]    ?? null) : null,
    u2_kpa:  plot.u2_mpa && plot.u2_mpa[i] != null ? plot.u2_mpa[i]! * 1000 : null,
    qt:      plot.qt_mpa ?  (plot.qt_mpa[i]    ?? null) : null,
    ic:      plot.ic     ?  (plot.ic[i]         ?? null) : null,
  }))

  const maxDepth = Math.ceil((plot.depths_m.at(-1) ?? 1) * 10) / 10

  const [zoomDomain, setZoomDomain] = useState<[number, number]>([0, maxDepth])
  const [isDragging, setIsDragging] = useState(false)

  // Keep a ref so event listeners always see the latest domain without being recreated
  const zoomDomainRef = useRef(zoomDomain)
  zoomDomainRef.current = zoomDomain

  useEffect(() => {
    setZoomDomain([0, maxDepth])
  }, [plot, maxDepth])

  const panelsRef = useRef<HTMLDivElement>(null)
  const dragRef   = useRef<{ startY: number; domainAtStart: [number, number] } | null>(null)

  useEffect(() => {
    const el = panelsRef.current
    if (!el) return

    // Scroll = zoom centred on the depth under the cursor (Y axis only, X stays locked)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect  = el.getBoundingClientRect()
      const relY  = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15

      setZoomDomain(([min, max]) => {
        const range        = max - min
        const depthAtMouse = min + relY * range
        const newRange     = Math.max(0.5, Math.min(maxDepth, range * factor))
        let   newMin       = depthAtMouse - relY * newRange
        let   newMax       = newMin + newRange
        if (newMin < 0)         { newMin = 0;         newMax = Math.min(maxDepth, newRange) }
        if (newMax > maxDepth)  { newMax = maxDepth;  newMin = Math.max(0, maxDepth - newRange) }
        return [newMin, newMax]
      })
    }

    // Drag = pan along depth (only when zoomed in)
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
      const delta = (dy / rect.height) * range  // pixels → depth metres
      const newMin = Math.max(0, min - delta)
      const newMax = Math.min(maxDepth, newMin + range)
      setZoomDomain([newMin, newMax])
    }

    const onMouseUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setIsDragging(false)
    }

    el.addEventListener('wheel',      onWheel,     { passive: false })
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

  const hasFs  = plot.fs_mpa != null
  const hasRf  = plot.rf_pct != null
  const hasU2  = plot.u2_mpa != null
  const hasQt  = plot.qt_mpa != null
  const hasIc  = plot.ic != null
  const showU2 = hasU2 && (cptType === 'CPTU' || hasU2)

  const fmtLevel   = makeLevelFmt(elevationM)
  const levelLabel = elevationM !== null ? 'Level (m TAW)' : 'Depth (m)'

  const topM = 16
  const botM = 16

  // Filter to visible depth window so lines actually clip (domain alone only clips the axis)
  const zoomedData = data.filter(d => d.depth >= zoomDomain[0] && d.depth <= zoomDomain[1])
  const chartProps = { data: zoomedData, layout: 'vertical' as const }

  function preDrillZone(xAxisId: string) {
    if (preDrillM <= 0) return null
    return (
      <>
        <ReferenceArea yAxisId="y" xAxisId={xAxisId} y1={0} y2={preDrillM}
          fill={PD_CLR} fillOpacity={0.08} />
        <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={preDrillM}
          stroke={PD_CLR} strokeDasharray="6 3" strokeWidth={1.5} />
      </>
    )
  }
  function surfaceElevationRef(xAxisId: string) {
    if (elevationM === null) return null
    return (
      <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={0}
        stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={1}
        label={{ value: `${fmtLevel(0)} m — surface`, position: 'insideTopLeft', style: { fontSize: 9, fill: '#6b7280' } }}
      />
    )
  }

  function renderU2Panel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain)                      : yGhostRight(zoomDomain)}
        <XAxis xAxisId="u2" type="number" orientation="top" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 11, fill: U2_CLR }} ticks={[-100, 0, 100, 200, 300]}
        />
        <XAxis xAxisId="u2b" type="number" orientation="bottom" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 11, fill: U2_CLR }} ticks={[-100, 0, 100, 200, 300]}
        />
        <ReferenceLine yAxisId="y" xAxisId="u2" x={0} stroke="#9ca3af" strokeWidth={0.5} />
        {preDrillZone('u2')}
        {surfaceElevationRef('u2')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(1)} kPa`, key]}
          labelFormatter={d => `Depth: ${Number(d).toFixed(2)} m`}
        />
        <Line yAxisId="y" xAxisId="u2" dataKey="u2_kpa" name="u (kPa)"
          stroke={U2_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  function renderQcFsPanel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain)                      : yGhostRight(zoomDomain)}
        <XAxis xAxisId="qc" type="number" orientation="top" domain={[0, QC_MAX]}
          tick={{ fontSize: 11, fill: QC_CLR }} ticks={[0, 5, 10, 15, 20, 25, 30, 35, 40]}
        />
        {hasFs
          ? <XAxis xAxisId="fs" type="number" orientation="bottom" domain={[0, FS_MAX]}
              tick={{ fontSize: 11, fill: FS_CLR }} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1.0]}
            />
          : <XAxis xAxisId="fs" type="number" orientation="bottom" domain={[0, FS_MAX]}
              tick={false} axisLine={false} tickLine={false}
            />
        }
        {surfaceElevationRef('qc')}
        {preDrillZone('qc')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(4)}`, key]}
          labelFormatter={d =>
            `Depth: ${Number(d).toFixed(2)} m` +
            (elevationM !== null ? `  |  Level: ${fmtLevel(Number(d))} m TAW` : '')
          }
        />
        <Line yAxisId="y" xAxisId="qc" dataKey="qc" name="qc (MPa)"
          stroke={QC_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        {hasQt && (
          <Line yAxisId="y" xAxisId="qc" dataKey="qt" name="Qt (MPa)"
            stroke={QT_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        )}
        {hasFs && (
          <Line yAxisId="y" xAxisId="fs" dataKey="fs" name="fs (MPa)"
            stroke={FS_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        )}
      </ComposedChart>
    )
  }

  function renderRfPanel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain)                      : yGhostRight(zoomDomain)}
        <XAxis xAxisId="rf" type="number" orientation="top" domain={[0, RF_MAX]}
          tick={{ fontSize: 11, fill: RF_CLR }} ticks={[0, 2, 4, 6, 8, 10]}
        />
        <XAxis xAxisId="rfb" type="number" orientation="bottom" domain={[0, RF_MAX]}
          tick={{ fontSize: 11, fill: RF_CLR }} ticks={[0, 2, 4, 6, 8, 10]}
        />
        {preDrillZone('rf')}
        {surfaceElevationRef('rf')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(2)} %`, key]}
          labelFormatter={d => `Depth: ${Number(d).toFixed(2)} m`}
        />
        <Line yAxisId="y" xAxisId="rf" dataKey="rf" name="Rf (%)"
          stroke={RF_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  function renderIcPanel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain)                      : yGhostRight(zoomDomain)}
        <XAxis xAxisId="ic" type="number" orientation="top" domain={[0, IC_MAX]}
          tick={{ fontSize: 11 }} ticks={[0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]}
        />
        <XAxis xAxisId="icb" type="number" orientation="bottom" domain={[0, IC_MAX]}
          tick={{ fontSize: 11 }} ticks={[0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]}
        />
        {IC_ZONES.map(z => (
          <ReferenceArea key={`zone-${z.x1}`} yAxisId="y" xAxisId="ic"
            x1={z.x1} x2={z.x2} fill={z.fill} fillOpacity={1}
          />
        ))}
        {IC_ZONE_BOUNDARIES.map(v => (
          <ReferenceLine key={`line-${v}`} yAxisId="y" xAxisId="ic" x={v}
            stroke="#d1d5db" strokeWidth={0.8} />
        ))}
        {surfaceElevationRef('ic')}
        {preDrillZone('ic')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(2)}`, key]}
          labelFormatter={d => `Depth: ${Number(d).toFixed(2)} m`}
        />
        <Line yAxisId="y" xAxisId="ic" dataKey="ic" name="Ic"
          stroke={IC_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  const leftmost  = showU2 ? 'u2' : 'qcfs'
  const rightmost = hasIc ? 'ic' : (hasRf ? 'rf' : 'qcfs')
  const isZoomed  = zoomDomain[0] !== 0 || zoomDomain[1] !== maxDepth

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="text-sm font-semibold text-gray-700">{name}</div>
        <div className="text-xs text-gray-400 mt-0.5">
          {cptType} · {data.length} rows · {maxDepth.toFixed(2)} m
          {elevationM !== null ? ` · Z = ${elevationM.toFixed(2)} m TAW` : ''}
        </div>
      </div>

      {/* Legend + zoom controls */}
      <div className="flex items-center justify-between px-4 pb-1 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <LegendItem color={QC_CLR} label="qc (MPa)" />
          {hasQt  && <LegendItem color={QT_CLR} label="Qt (MPa)" />}
          {hasFs  && <LegendItem color={FS_CLR} label="fs (MPa)" />}
          {hasRf  && <LegendItem color={RF_CLR} label="Rf (%)" />}
          {showU2 && <LegendItem color={U2_CLR} label="u (kPa)" />}
          {hasIc  && <LegendItem color={IC_CLR} label="Ic (Robertson 1990)" />}
          {preDrillM > 0 && <LegendItem color={PD_CLR} label={`Pre-drill ${preDrillM.toFixed(1)} m`} dashed />}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-gray-400 text-[10px] select-none">
          {isZoomed && (
            <span className="mr-1">
              {zoomDomain[0].toFixed(1)}–{zoomDomain[1].toFixed(1)} m
            </span>
          )}
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 border border-gray-200 leading-none text-gray-500"
            title="Zoom in"
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.max(0.5, (max - min) / 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >+</button>
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 border border-gray-200 leading-none text-gray-500"
            title="Zoom out"
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.min(maxDepth, (max - min) * 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >−</button>
          {isZoomed && (
            <button
              className="px-2 h-6 rounded hover:bg-gray-100 border border-gray-200 text-gray-500"
              title="Reset zoom"
              onClick={() => setZoomDomain([0, maxDepth])}
            >Reset</button>
          )}
        </div>
      </div>

      {/* Ic SBT zone colour key */}
      {hasIc && (
        <div className="flex items-center gap-2 px-4 pb-1 shrink-0 flex-wrap">
          <span className="text-[9px] text-gray-400 mr-1">SBT:</span>
          {IC_ZONES.map(z => (
            <div key={z.x1} className="flex items-center gap-1 text-[9px] text-gray-500">
              <div className="w-3 h-2.5 rounded-sm border border-gray-200" style={{ background: z.fill }} />
              {z.label}
            </div>
          ))}
        </div>
      )}

      {/* Panels — scroll to zoom at cursor, drag to pan */}
      <div
        ref={panelsRef}
        className="flex flex-1 overflow-hidden px-1"
        style={{ cursor: isDragging ? 'grabbing' : (isZoomed ? 'grab' : 'default') }}
      >
        {showU2 && (
          <div style={{ flex: 1, position: 'relative' }} className="min-w-0 border-r border-gray-200">
            <ResponsiveContainer width="100%" height="100%">
              {renderU2Panel(leftmost === 'u2', rightmost === 'u2')}
            </ResponsiveContainer>
            <ChartLabel left={{ color: U2_CLR, text: 'u (kPa)' }} />
          </div>
        )}

        <div style={{ flex: 2, position: 'relative' }} className={`min-w-0${(hasRf || hasIc) ? ' border-r border-gray-200' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            {renderQcFsPanel(leftmost === 'qcfs', rightmost === 'qcfs')}
          </ResponsiveContainer>
          <ChartLabel
            left={{ color: QC_CLR, text: hasQt ? 'qc / Qt (MPa)' : 'qc (MPa)' }}
            right={hasFs ? { color: FS_CLR, text: 'fs (MPa)' } : undefined}
          />
        </div>

        {hasRf && (
          <div style={{ flex: 1, position: 'relative' }} className={`min-w-0${hasIc ? ' border-r border-gray-200' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              {renderRfPanel(leftmost === 'rf', rightmost === 'rf')}
            </ResponsiveContainer>
            <ChartLabel left={{ color: RF_CLR, text: 'Rf (%)' }} />
          </div>
        )}

        {hasIc && (
          <div style={{ flex: 1, position: 'relative' }} className="min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {renderIcPanel(leftmost === 'ic', rightmost === 'ic')}
            </ResponsiveContainer>
            <IcZoneLabelsOverlay />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Absolute-positioned label overlay inside each panel ──────────────────────
// bottom: 46px clears recharts' bottom axis area (margin 16 + tick text ~26px + 4px gap).
// Inset by Y_W on each side so text aligns under the plot area, not the Y-axis gutters.
interface LabelEntry { color: string; text: string }
// 46px clears the recharts bottom axis area (margin.bottom=16 + tick text ~26px + 4px gap)
function ChartLabel({ left, right }: { left: LabelEntry; right?: LabelEntry; botM?: number }) {
  return (
    <div
      className="absolute flex justify-between pointer-events-none select-none"
      style={{ bottom: 46, left: Y_W + 4, right: Y_W + 4 }}
    >
      <span style={{ fontSize: 10, fontWeight: 500, color: left.color }}>{left.text}</span>
      {right && <span style={{ fontSize: 10, fontWeight: 500, color: right.color }}>{right.text}</span>}
    </div>
  )
}

// Short labels for narrow zones in the Ic panel overlay
const IC_ZONE_SHORT: Record<string, string> = {
  'Sand': 'Sand', 'Sand mix': 'S.mix', 'Silt mix': 'Silt',
  'Clay': 'Clay', 'Organic': 'Org.', 'Sensitive': 'Sens.',
}

function IcZoneLabelsOverlay() {
  return (
    <div
      className="absolute pointer-events-none select-none"
      style={{ bottom: 60, left: Y_W + 2, right: Y_W + 2, height: 44 }}
    >
      {IC_ZONES.map(z => {
        const centerPct = ((z.x1 + z.x2) / 2 / IC_MAX) * 100
        return (
          <span
            key={z.x1}
            style={{
              position:        'absolute',
              bottom:          0,
              left:            `${centerPct}%`,
              transform:       'translateX(-50%) rotate(-55deg)',
              transformOrigin: 'bottom center',
              fontSize:        7.5,
              color:           '#374151',
              fontWeight:      500,
              whiteSpace:      'nowrap',
            }}
          >
            {IC_ZONE_SHORT[z.label] ?? z.label}
          </span>
        )
      })}
    </div>
  )
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-gray-600">
      <div className="w-6" style={{ borderTopWidth: 1.5, borderTopStyle: dashed ? 'dashed' : 'solid', borderTopColor: color }} />
      {label}
    </div>
  )
}
