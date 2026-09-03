/**
 * The SVG profile: fills (the screen's partition polygons), seams, column
 * hairlines with the qc trace or lithology strip ON the fill, both axes,
 * A / A′ and the column codes. Coordinates are CSS px at 96 dpi; the
 * geometry (Task 4) is in mm and converted here once.
 */
import BoreholeColumn from '../components/sections/BoreholeColumn'
import CptDataColumn from '../components/sections/CptDataColumn'
import { readBoreholeChannels, readCptChannels } from '../components/sections/cptChannels'
import { projectColour } from './projectPalette'
import { regionBounds, regionPathD } from './regionPath'
import {
  ALONG_BAND_MM, COLUMN_HALF_WIDTH_MM, LABEL_MIN_HEIGHT_PX, LABEL_MIN_WIDTH_PX, PX_PER_MM, TOP_BAND_MM,
} from './sheetConstants'
import type { SheetGeometry } from './sheetGeometry'
import type { SheetPayload } from './sheetPayload'
import { unitFillColour, unitLabel } from './unitStyle'

const INK = '#1f2933'

export function ProfileDrawing({ payload, geometry, mTawLabel }: {
  payload: SheetPayload; geometry: SheetGeometry; mTawLabel: string
}): JSX.Element {
  const g = geometry
  const widthPx = (g.drawingLeftMm + g.drawingWidthMm) * PX_PER_MM
  const topPx = TOP_BAND_MM * PX_PER_MM
  const heightPx = topPx + g.drawingHeightMm * PX_PER_MM + ALONG_BAND_MM * PX_PER_MM
  const scaleVpx = g.scaleVmmPerM * PX_PER_MM
  const levelToY = (level: number): number => topPx + (payload.levelMaxM - level) * scaleVpx
  const columnX = g.columnXmm.map(mm => mm * PX_PER_MM)
  const unitById = new Map(payload.units.map(u => [u.formationId, u]))
  const axisX = g.drawingLeftMm * PX_PER_MM
  const bottomY = levelToY(payload.levelMinM)
  const halfWidthPx = COLUMN_HALF_WIDTH_MM * PX_PER_MM
  const cptChannels = readCptChannels(payload.section.viewState)
  const boreholeChannels = readBoreholeChannels(payload.section.viewState)
  const fill = payload.settings.fill

  // Level ticks every 1, 2, 5, 10 or 20 m so there are at most 14 of them.
  const range = payload.levelMaxM - payload.levelMinM
  const step = [1, 2, 5, 10, 20].find(s => range / s <= 14) ?? 50
  const ticks: number[] = []
  for (let l = Math.ceil(payload.levelMinM / step) * step; l <= payload.levelMaxM; l += step) ticks.push(l)
  const alongStep = [10, 20, 50, 100, 200, 500].find(s => payload.section.lengthM / s <= 12) ?? 1000

  return (
    <svg data-testid="sheet-profile" width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`} style={{ display: 'block', fontFamily: 'inherit' }}>
      {/* fills — the partition, seams shared, nothing drawn over them but the logs */}
      {payload.regions.map((r, i) => {
        const unit = unitById.get(r.formation_id)
        return (
          <path key={i} data-testid="sheet-region" d={regionPathD(r, columnX, levelToY)} fill={unit ? unitFillColour(unit, fill) : '#dddddd'} stroke={INK} strokeWidth={0.6} strokeLinejoin="round" />
        )
      })}
      {/* unit names inside big-enough regions */}
      {payload.regions.map((r, i) => {
        const b = regionBounds(r, columnX, levelToY)
        if (b.maxX - b.minX < LABEL_MIN_WIDTH_PX || b.maxY - b.minY < LABEL_MIN_HEIGHT_PX) return null
        const unit = unitById.get(r.formation_id)
        return (
          <text key={`l${i}`} x={(b.minX + b.maxX) / 2} y={(b.minY + b.maxY) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={INK} opacity={0.85}>
            {unit ? unitLabel(unit, fill, payload.language) : ''}
          </text>
        )
      })}
      {/* columns: hairline + log, drawn on the fill (no white column mask) */}
      {payload.columns.map((c, i) => {
        const x = columnX[i]
        const y0 = levelToY(c.collarElevationM)
        const y1 = levelToY(c.collarElevationM - c.totalDepthM)
        return (
          <g key={c.investigationId}>
            <line x1={x} y1={y0} x2={x} y2={y1} stroke={INK} strokeWidth={0.5} opacity={0.55} />
            {c.kind === 'cpt' && c.plot && (
              <CptDataColumn plot={c.plot} cptType={c.cptType ?? 'CPT'} channels={cptChannels} halfWidth={halfWidthPx} screenX={x} surfaceElevationM={c.collarElevationM} plotTop={topPx} plotBottom={bottomY} levelToScreen={levelToY} showLabels={false} cardVeilOpacity={0} />
            )}
            {c.kind === 'borehole' && c.detail && (
              <BoreholeColumn detail={c.detail} channels={boreholeChannels} screenX={x} halfWidth={halfWidthPx} surfaceElevationM={c.collarElevationM} plotTop={topPx} plotBottom={bottomY} levelToScreen={levelToY} />
            )}
            <text x={x} y={topPx - 4} textAnchor="middle" fontSize={9} fontWeight={500} fill={projectColour(c.colourIndex)}>{c.code}</text>
          </g>
        )
      })}
      {/* axes */}
      <line x1={axisX} y1={topPx} x2={axisX} y2={bottomY} stroke={INK} strokeWidth={0.8} />
      {ticks.map(l => (
        <g key={l}>
          <line x1={axisX - 4} y1={levelToY(l)} x2={axisX} y2={levelToY(l)} stroke={INK} strokeWidth={0.6} />
          <text x={axisX - 6} y={levelToY(l)} textAnchor="end" dominantBaseline="middle" fontSize={7} fill={INK}>{l > 0 ? `+${l}` : String(l)}</text>
        </g>
      ))}
      <text x={axisX - 6} y={topPx - 6} textAnchor="end" fontSize={6.5} fill={INK}>{mTawLabel}</text>
      <line x1={axisX} y1={bottomY} x2={columnX[columnX.length - 1] ?? axisX} y2={bottomY} stroke={INK} strokeWidth={0.8} />
      {payload.columns.map((c, i) => (
        c.alongM % alongStep === 0 || i === 0 || i === payload.columns.length - 1
          ? <text key={`a${i}`} x={columnX[i]} y={bottomY + 12} textAnchor="middle" fontSize={7} fill={INK}>{Math.round(c.alongM)}{i === payload.columns.length - 1 ? ' m' : ''}</text>
          : null
      ))}
      {/* A / A′ */}
      <text x={axisX} y={12} fontSize={12} fontWeight={600} fill="#c8442b">A</text>
      <text x={columnX[columnX.length - 1] ?? axisX} y={12} textAnchor="end" fontSize={12} fontWeight={600} fill="#c8442b">A′</text>
    </svg>
  )
}
