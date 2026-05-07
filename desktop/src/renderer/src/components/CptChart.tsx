import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { CptPlotResponse, CptResponse } from '../api/client'

interface Props {
  plot: CptPlotResponse
  name: string
  detail?: CptResponse
}

// Geotechnical standard axis ranges (DOV / EC7)
const QC_MAX = 40   // MPa
const FS_MAX = 1    // MPa
const RF_MAX = 10   // %

const GRID    = '#fce4ec'
const QC_CLR  = '#111827'
const FS_CLR  = '#16a34a'
const RF_CLR  = '#b45309'
const PD_CLR  = '#dc2626'

// In Recharts layout="vertical" a number YAxis naturally reads top→bottom
// (min at top, max at bottom). No `reversed` prop needed — adding it flips
// to max-at-top, which is the wrong direction for a depth profile.
function depthYAxis(
  yAxisId: string,
  orientation: 'left' | 'right',
  domain: [number, number],
  formatter: (v: number) => string,
  label: string,
  hidden = false,
): React.ReactElement {
  if (hidden) {
    return (
      <YAxis
        key={yAxisId}
        yAxisId={yAxisId}
        dataKey="depth"
        type="number"
        domain={domain}
        orientation={orientation}
        tick={false}
        axisLine={false}
        tickLine={false}
        width={1}
      />
    )
  }
  return (
    <YAxis
      key={yAxisId}
      yAxisId={yAxisId}
      dataKey="depth"
      type="number"
      domain={domain}
      orientation={orientation}
      tickFormatter={formatter}
      tickCount={11}
      tick={{ fontSize: 9 }}
      label={{ value: label, angle: orientation === 'left' ? -90 : 90, position: 'insideLeft', offset: -8, style: { fontSize: 9 } }}
      width={50}
    />
  )
}

export default function CptChart({ plot, name, detail }: Props) {
  const elevationM = detail?.elevation_m ?? null
  const preDrillM  = detail?.pre_drill_m ?? 0

  const data = plot.depths_m.map((d, i) => ({
    depth: d,
    qc:   plot.qc_mpa[i] ?? null,
    fs:   plot.fs_mpa  ? (plot.fs_mpa[i]  ?? null) : null,
    rf:   plot.rf_pct  ? (plot.rf_pct[i]  ?? null) : null,
  }))

  const maxDepth   = Math.ceil((plot.depths_m.at(-1) ?? 1) * 10) / 10
  const depthDomain: [number, number] = [0, maxDepth]

  const hasFs = plot.fs_mpa != null
  const hasRf = plot.rf_pct != null

  const depthFmt = (d: number) => d.toFixed(1)
  const peilFmt  = (d: number) =>
    elevationM !== null ? (elevationM - d).toFixed(1) : d.toFixed(1)

  const topMargin = 28
  const botMargin = hasFs ? 28 : 12

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="text-sm font-semibold text-gray-700">{name}</div>
        <div className="text-xs text-gray-400 mt-0.5">
          {detail?.cpt_type} · {data.length} rows · {maxDepth.toFixed(2)} m
          {elevationM !== null ? ` · Z = ${elevationM.toFixed(2)} m TAW` : ''}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-1 shrink-0">
        <LegendItem color={QC_CLR} label="qc (MPa)" />
        {hasFs && <LegendItem color={FS_CLR} label="fs (MPa)" />}
        {hasRf && <LegendItem color={RF_CLR} label="Rf (%)" />}
        {preDrillM > 0 && (
          <LegendItem color={PD_CLR} label={`Pre-drill ${preDrillM.toFixed(1)} m`} dashed />
        )}
      </div>

      {/* Panels */}
      <div className="flex flex-1 overflow-hidden pb-2 px-1">

        {/* ── qc + fs panel ── */}
        <div style={{ flex: hasRf ? 3 : 1 }} className="min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              layout="vertical"
              margin={{ top: topMargin, right: 2, bottom: botMargin, left: 0 }}
            >
              <CartesianGrid strokeDasharray="2 4" stroke={GRID} />

              {depthYAxis('y', 'left', depthDomain, depthFmt, 'Diepte (m)')}

              <XAxis
                xAxisId="qc"
                type="number"
                orientation="top"
                domain={[0, QC_MAX]}
                tick={{ fontSize: 9, fill: QC_CLR }}
                tickCount={9}
                label={{ value: 'qc (MPa)', position: 'insideTopLeft', offset: 2, style: { fontSize: 9, fill: QC_CLR } }}
              />

              {hasFs && (
                <XAxis
                  xAxisId="fs"
                  type="number"
                  orientation="bottom"
                  domain={[0, FS_MAX]}
                  tick={{ fontSize: 9, fill: FS_CLR }}
                  tickCount={6}
                  label={{ value: 'fs (MPa)', position: 'insideBottomLeft', offset: 2, style: { fontSize: 9, fill: FS_CLR } }}
                />
              )}

              {preDrillM > 0 && (
                <ReferenceLine
                  yAxisId="y" xAxisId="qc"
                  y={preDrillM}
                  stroke={PD_CLR} strokeDasharray="6 3" strokeWidth={1.5}
                />
              )}

              <Tooltip
                contentStyle={{ fontSize: 10 }}
                formatter={(val, key) =>
                  val === null ? ['—', key] : [`${Number(val).toFixed(4)}`, key]
                }
                labelFormatter={d =>
                  `Diepte: ${Number(d).toFixed(2)} m` +
                  (elevationM !== null
                    ? `  |  Peil: ${(elevationM - Number(d)).toFixed(2)} m TAW`
                    : '')
                }
              />

              <Line
                yAxisId="y" xAxisId="qc"
                dataKey="qc" name="qc (MPa)"
                stroke={QC_CLR} dot={false} strokeWidth={1.5}
                isAnimationActive={false} connectNulls={false}
              />

              {hasFs && (
                <Line
                  yAxisId="y" xAxisId="fs"
                  dataKey="fs" name="fs (MPa)"
                  stroke={FS_CLR} dot={false} strokeWidth={1.5}
                  isAnimationActive={false} connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Rf panel ── */}
        {hasRf && (
          <div style={{ flex: 1 }} className="min-w-0 border-l border-gray-300">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                layout="vertical"
                margin={{ top: topMargin, right: 0, bottom: botMargin, left: 2 }}
              >
                <CartesianGrid strokeDasharray="2 4" stroke={GRID} />

                {/* Hidden left axis keeps grid lines and line positioning in sync with main panel */}
                {depthYAxis('y', 'left', depthDomain, depthFmt, '', true)}

                {depthYAxis(
                  'yr', 'right', depthDomain,
                  peilFmt,
                  elevationM !== null ? 'Peil (m TAW)' : 'Diepte (m)',
                )}

                <XAxis
                  xAxisId="rf"
                  type="number"
                  orientation="top"
                  domain={[0, RF_MAX]}
                  tick={{ fontSize: 9, fill: RF_CLR }}
                  tickCount={6}
                  label={{ value: 'Rf (%)', position: 'insideTopLeft', offset: 2, style: { fontSize: 9, fill: RF_CLR } }}
                />

                <XAxis
                  xAxisId="rf_bot"
                  type="number"
                  orientation="bottom"
                  domain={[0, RF_MAX]}
                  tick={{ fontSize: 9, fill: RF_CLR }}
                  tickCount={6}
                />

                {preDrillM > 0 && (
                  <ReferenceLine
                    yAxisId="y" xAxisId="rf"
                    y={preDrillM}
                    stroke={PD_CLR} strokeDasharray="6 3" strokeWidth={1.5}
                  />
                )}

                <Tooltip
                  contentStyle={{ fontSize: 10 }}
                  formatter={(val, key) =>
                    val === null ? ['—', key] : [`${Number(val).toFixed(2)} %`, key]
                  }
                  labelFormatter={d => `Diepte: ${Number(d).toFixed(2)} m`}
                />

                <Line
                  yAxisId="y" xAxisId="rf"
                  dataKey="rf" name="Rf (%)"
                  stroke={RF_CLR} dot={false} strokeWidth={1.5}
                  isAnimationActive={false} connectNulls={false}
                />
              </ComposedChart>
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
      <div
        className="w-6"
        style={{ borderTopWidth: 1.5, borderTopStyle: dashed ? 'dashed' : 'solid', borderTopColor: color }}
      />
      {label}
    </div>
  )
}
