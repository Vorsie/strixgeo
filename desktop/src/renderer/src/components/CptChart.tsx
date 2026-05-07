import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import type { CptPlotResponse } from '../api/client'

interface Props {
  plot: CptPlotResponse
  name: string
}

export default function CptChart({ plot, name }: Props) {
  const data = plot.depths_m.map((d, i) => ({
    depth: d,
    qc: plot.qc_mpa[i],
    ...(plot.fs_mpa ? { fs: plot.fs_mpa[i] } : {}),
    ...(plot.u2_mpa ? { u2: plot.u2_mpa[i] } : {}),
  }))

  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <div className="text-sm font-semibold text-gray-700">{name}</div>
      <div className="text-xs text-gray-400">
        {plot.depths_m.length} rows · max {plot.depths_m[plot.depths_m.length - 1]?.toFixed(2)} m
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, bottom: 8, left: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

          {/* Depth on Y axis, increasing downward (geotechnical convention) */}
          <YAxis
            dataKey="depth"
            type="number"
            reversed
            domain={['dataMin', 'dataMax']}
            tickFormatter={v => `${v.toFixed(1)}`}
            label={{ value: 'Depth (m)', angle: -90, position: 'insideLeft', offset: -25, style: { fontSize: 11 } }}
            tick={{ fontSize: 10 }}
            width={55}
          />

          {/* qc on primary X axis */}
          <XAxis
            dataKey="qc"
            type="number"
            xAxisId="qc"
            orientation="top"
            domain={[0, 'dataMax']}
            label={{ value: 'qc (MPa)', position: 'insideTopLeft', offset: 4, style: { fontSize: 11 } }}
            tick={{ fontSize: 10 }}
          />

          {/* fs on secondary X axis — only when present */}
          {plot.fs_mpa && (
            <XAxis
              dataKey="fs"
              type="number"
              xAxisId="fs"
              orientation="bottom"
              domain={[0, 'dataMax']}
              label={{ value: 'fs (MPa)', position: 'insideBottomLeft', offset: 4, style: { fontSize: 11 } }}
              tick={{ fontSize: 10 }}
            />
          )}

          <Tooltip
            formatter={(val: number, name: string) => [`${val?.toFixed(4)} MPa`, name]}
            labelFormatter={(d: number) => `Depth: ${d?.toFixed(3)} m`}
            contentStyle={{ fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          <Line
            xAxisId="qc"
            dataKey="qc"
            name="qc (MPa)"
            stroke="#2563eb"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />

          {plot.fs_mpa && (
            <Line
              xAxisId="fs"
              dataKey="fs"
              name="fs (MPa)"
              stroke="#16a34a"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          )}

          {plot.u2_mpa && (
            <Line
              xAxisId="qc"
              dataKey="u2"
              name="u2 (MPa)"
              stroke="#9333ea"
              dot={false}
              strokeWidth={1}
              strokeDasharray="4 2"
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
