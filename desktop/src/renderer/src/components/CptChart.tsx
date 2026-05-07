import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { CptPlotResponse, CptResponse } from '../api/client'

interface Props {
  plot:   CptPlotResponse
  name:   string
  detail?: CptResponse
}

// ── DOV standard axis ranges ────────────────────────────────────────────────
// All Y-axis columns use the same pixel width so grid lines align across panels.
const Y_W    = 52    // px — level and length axes
const QC_MAX = 40    // MPa
const FS_MAX = 1     // MPa
const RF_MAX = 10    // %
const U2_MIN = -100  // kPa
const U2_MAX = 300   // kPa

const GRID   = '#fce4ec'
const QC_CLR = '#111827'
const FS_CLR = '#16a34a'
const RF_CLR = '#b45309'
const U2_CLR = '#7c3aed'
const PD_CLR = '#dc2626'

// Tick formatter: shows depth as peil mTAW (with explicit + sign) or plain depth
function makePeilFmt(elevationM: number | null) {
  return (d: number) => {
    const v = elevationM !== null ? elevationM - d : d
    return (v >= 0 ? '+' : '') + v.toFixed(1)
  }
}
const fmtDepth = (d: number) => d.toFixed(1)

// ── Y-axis builders ─────────────────────────────────────────────────────────
// Called as render helpers (not React components) — they close over chart-level
// constants, have no hooks, and are re-called only when the parent re-renders.
function yPeil(domain: [number, number], fmt: (d: number) => string, label: string) {
  return (
    <YAxis yAxisId="y" orientation="left" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 9 }}
      tickFormatter={fmt}
      label={{ value: label, angle: -90, position: 'insideLeft', offset: -(Y_W - 12), style: { fontSize: 9 } }}
      width={Y_W}
    />
  )
}

function yLengte(domain: [number, number]) {
  return (
    <YAxis yAxisId="yr" orientation="right" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 9 }}
      tickFormatter={fmtDepth}
      label={{ value: 'Length (m)', angle: 90, position: 'insideRight', offset: -(Y_W - 12), style: { fontSize: 9 } }}
      width={Y_W}
    />
  )
}

// Ghost axes preserve the same pixel width as real axes → plot areas stay aligned
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
    // Store u2 in kPa for display (source data is MPa)
    u2_kpa:  plot.u2_mpa && plot.u2_mpa[i] != null ? plot.u2_mpa[i]! * 1000 : null,
  }))

  const maxDepth   = Math.ceil((plot.depths_m.at(-1) ?? 1) * 10) / 10
  const domain: [number, number] = [0, maxDepth]

  const hasFs  = plot.fs_mpa != null
  const hasRf  = plot.rf_pct != null
  const hasU2  = plot.u2_mpa != null
  // Show u2 panel when CPTU type or actual u2 data present
  const showU2 = hasU2 && (cptType === 'CPTU' || hasU2)

  const fmtPeil   = makePeilFmt(elevationM)
  const peilLabel = elevationM !== null ? 'Level (m TAW)' : 'Depth (m)'

  const topM = 28
  const botM = hasFs ? 28 : 12

  // Common props used in every Recharts ComposedChart
  const chartProps = { data, layout: 'vertical' as const }

  // ── Pre-drill & surface reference lines (shared logic) ──────────────────
  function preDrillRef(xAxisId: string) {
    if (preDrillM <= 0) return null
    return (
      <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={preDrillM}
        stroke={PD_CLR} strokeDasharray="6 3" strokeWidth={1.5} />
    )
  }
  function surfaceElevationRef(xAxisId: string) {
    if (elevationM === null) return null
    return (
      <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={0}
        stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={1}
        label={{ value: `${fmtPeil(0)} m — surface`, position: 'insideTopLeft', style: { fontSize: 8, fill: '#6b7280' } }}
      />
    )
  }

  // ── Panel renderers (called as functions, not as JSX components) ─────────
  function renderU2Panel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yPeil(domain, fmtPeil, peilLabel) : yGhostLeft(domain)}
        {isRight ? yLengte(domain)                   : yGhostRight(domain)}
        <XAxis xAxisId="u2" type="number" orientation="top" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 9, fill: U2_CLR }} tickCount={5}
          label={{ value: 'u (kPa)', position: 'insideTopLeft', offset: 2, style: { fontSize: 9, fill: U2_CLR } }}
        />
        <XAxis xAxisId="u2b" type="number" orientation="bottom" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 9, fill: U2_CLR }} tickCount={5}
        />
        {/* Hydrostatic zero reference */}
        <ReferenceLine yAxisId="y" xAxisId="u2" x={0} stroke="#9ca3af" strokeWidth={0.5} />
        {preDrillRef('u2')}
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
        {isLeft  ? yPeil(domain, fmtPeil, peilLabel) : yGhostLeft(domain)}
        {isRight ? yLengte(domain)                   : yGhostRight(domain)}
        <XAxis xAxisId="qc" type="number" orientation="top" domain={[0, QC_MAX]}
          tick={{ fontSize: 9, fill: QC_CLR }} tickCount={9}
          label={{ value: 'qc (MPa)', position: 'insideTopLeft', offset: 2, style: { fontSize: 9, fill: QC_CLR } }}
        />
        {hasFs && (
          <XAxis xAxisId="fs" type="number" orientation="bottom" domain={[0, FS_MAX]}
            tick={{ fontSize: 9, fill: FS_CLR }} tickCount={6}
            label={{ value: 'fs (MPa)', position: 'insideBottomLeft', offset: 2, style: { fontSize: 9, fill: FS_CLR } }}
          />
        )}
        {surfaceElevationRef('qc')}
        {preDrillRef('qc')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(4)}`, key]}
          labelFormatter={d =>
            `Depth: ${Number(d).toFixed(2)} m` +
            (elevationM !== null ? `  |  Level: ${fmtPeil(Number(d))} m TAW` : '')
          }
        />
        <Line yAxisId="y" xAxisId="qc" dataKey="qc" name="qc (MPa)"
          stroke={QC_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
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
        {isLeft  ? yPeil(domain, fmtPeil, peilLabel) : yGhostLeft(domain)}
        {isRight ? yLengte(domain)                   : yGhostRight(domain)}
        <XAxis xAxisId="rf" type="number" orientation="top" domain={[0, RF_MAX]}
          tick={{ fontSize: 9, fill: RF_CLR }} tickCount={6}
          label={{ value: 'Rf (%)', position: 'insideTopLeft', offset: 2, style: { fontSize: 9, fill: RF_CLR } }}
        />
        <XAxis xAxisId="rfb" type="number" orientation="bottom" domain={[0, RF_MAX]}
          tick={{ fontSize: 9, fill: RF_CLR }} tickCount={6}
        />
        {preDrillRef('rf')}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(2)} %`, key]}
          labelFormatter={d => `Depth: ${Number(d).toFixed(2)} m`}
        />
        <Line yAxisId="y" xAxisId="rf" dataKey="rf" name="Rf (%)"
          stroke={RF_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  // ── Layout: leftmost panel gets peil axis, rightmost gets lengte axis ────
  const leftmost  = showU2 ? 'u2' : 'qcfs'
  const rightmost = hasRf  ? 'rf' : 'qcfs'

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

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-1 shrink-0">
        <LegendItem color={QC_CLR} label="qc (MPa)" />
        {hasFs  && <LegendItem color={FS_CLR} label="fs (MPa)" />}
        {hasRf  && <LegendItem color={RF_CLR} label="Rf (%)" />}
        {showU2 && <LegendItem color={U2_CLR} label="u (kPa)" />}
        {preDrillM > 0 && <LegendItem color={PD_CLR} label={`Pre-drill ${preDrillM.toFixed(1)} m`} dashed />}
      </div>

      {/* Panels */}
      <div className="flex flex-1 overflow-hidden pb-2 px-1">
        {showU2 && (
          <div style={{ flex: 1 }} className="min-w-0 border-r border-gray-200">
            <ResponsiveContainer width="100%" height="100%">
              {renderU2Panel(leftmost === 'u2', rightmost === 'u2')}
            </ResponsiveContainer>
          </div>
        )}

        <div
          style={{ flex: 3 }}
          className={`min-w-0${hasRf ? ' border-r border-gray-200' : ''}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {renderQcFsPanel(leftmost === 'qcfs', rightmost === 'qcfs')}
          </ResponsiveContainer>
        </div>

        {hasRf && (
          <div style={{ flex: 1 }} className="min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {renderRfPanel(leftmost === 'rf', rightmost === 'rf')}
            </ResponsiveContainer>
          </div>
        )}
      </div>
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
