/**
 * Depth-axis Virtuele Boring ghost column — used inside the CPT
 * detail chart and the borehole log, both of which think in
 * "metres below surface" rather than absolute mTAW elevation.
 *
 * Takes the active prediction(s) for one investigation + the visible
 * depth window, converts DOV's absolute mTAW (top_m_taw, base_m_taw)
 * to depth-below-surface using the investigation's surface elevation,
 * clips to the visible window plus the user's "Show down to" cap,
 * and renders one labelled column per active model.
 *
 * Sibling of ``sections/VirtueleBoringGhostColumns`` but
 * deliberately split — the section view works in mTAW + scaled
 * horizontal layout (dozens of investigations); the detail panes
 * work in depth-below-surface for one investigation.
 */

import { useRef } from 'react'

import type {
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLayer,
} from '../api/client'
import {
  maxCharsForWidth,
  maxLinesForHeight,
  wrapLabelToLines,
} from '../utils/labelWrap'
import { useElementSize } from './sections/utils'
import { useT } from '../i18n/translate'

const COLUMN_WIDTH_PX = 48
const COLUMN_GAP_PX = 4
const LABEL_FONT_SIZE = 9
const GHOST_OPACITY = 0.55
const HEADER_FONT_SIZE = 9

interface Props {
  /** Active prediction for this investigation. ``null`` = no data
   * (CRS != 31370, or DOV missing this point); the component renders
   * a faint "no data" placeholder so the layout doesn't reflow when
   * the user toggles the overlay. */
  prediction: VirtueleBoringInvestigationPrediction | null
  /** Ordered list of active model codes (max 2). */
  activeModels: readonly string[]
  /** Visible depth window in m below surface. Matches the host
   * pane's zoom so the ghost stays aligned with the data tracks. */
  depthDomain: readonly [number, number]
  /** Surface elevation in mTAW. ``null`` = no Z; component renders
   * a placeholder rather than guessing. */
  surfaceElevationM: number | null
  /** Project-level depth clip in m below surface. */
  maxDepthMBelowSurface: number | null
  /** Top + bottom pixel margins reserved inside the column's SVG so
   * y=0 lines up with the host chart's depth=0 (matches the host's
   * recharts top + bottom margins). */
  topMarginPx: number
  bottomMarginPx: number
}

export default function VirtueleBoringDepthColumn({
  prediction,
  activeModels,
  depthDomain,
  surfaceElevationM,
  maxDepthMBelowSurface,
  topMarginPx,
  bottomMarginPx,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const totalWidth =
    activeModels.length === 0
      ? COLUMN_WIDTH_PX
      : activeModels.length * COLUMN_WIDTH_PX +
        (activeModels.length - 1) * COLUMN_GAP_PX

  return (
    <div
      ref={ref}
      className="relative shrink-0 border-l border-gray-200 bg-gray-50/60 select-none overflow-hidden"
      style={{ width: totalWidth + 8 }}
    >
      {size !== null && (
        <svg width={size.width} height={size.height}>
          <DepthGhost
            prediction={prediction}
            activeModels={activeModels}
            depthDomain={depthDomain}
            surfaceElevationM={surfaceElevationM}
            maxDepthMBelowSurface={maxDepthMBelowSurface}
            heightPx={size.height}
            topMarginPx={topMarginPx}
            bottomMarginPx={bottomMarginPx}
          />
        </svg>
      )}
    </div>
  )
}

function DepthGhost({
  prediction,
  activeModels,
  depthDomain,
  surfaceElevationM,
  maxDepthMBelowSurface,
  heightPx,
  topMarginPx,
  bottomMarginPx,
}: {
  prediction: VirtueleBoringInvestigationPrediction | null
  activeModels: readonly string[]
  depthDomain: readonly [number, number]
  surfaceElevationM: number | null
  maxDepthMBelowSurface: number | null
  heightPx: number
  topMarginPx: number
  bottomMarginPx: number
}): JSX.Element {
  const t = useT()
  const usableTop = topMarginPx
  const usableBottom = heightPx - bottomMarginPx
  const [dMin, dMax] = depthDomain
  const range = dMax - dMin

  const empty =
    !prediction ||
    activeModels.length === 0 ||
    surfaceElevationM === null ||
    activeModels.every(
      m => (prediction.predictions_by_model[m]?.length ?? 0) === 0,
    )

  if (empty || !prediction || surfaceElevationM === null) {
    return (
      <text x={4} y={20} fontSize={9} fill="#9ca3af">
        {t('borelog.noData')}
      </text>
    )
  }

  function depthToY(depthM: number): number {
    if (range <= 0) return usableTop
    const frac = (depthM - dMin) / range
    return usableTop + frac * (usableBottom - usableTop)
  }

  return (
    <>
      {activeModels.map((modelCode, modelIdx) => {
        const layers = prediction.predictions_by_model[modelCode]
        if (!layers || layers.length === 0) return null
        const left = modelIdx * (COLUMN_WIDTH_PX + COLUMN_GAP_PX)
        return (
          <g key={modelCode} data-testid={`vb-depth-${modelCode}`}>
            <text
              x={left + COLUMN_WIDTH_PX / 2}
              y={usableTop - 2}
              textAnchor="middle"
              fontSize={HEADER_FONT_SIZE}
              fill="#6b7280"
            >
              {modelCode}
            </text>
            {layers.map(layer => (
              <DepthGhostLayer
                key={`${layer.code}-${layer.top_m_taw}`}
                layer={layer}
                left={left}
                width={COLUMN_WIDTH_PX}
                surfaceElevationM={surfaceElevationM}
                depthMin={dMin}
                depthMax={dMax}
                maxDepthMBelowSurface={maxDepthMBelowSurface}
                depthToY={depthToY}
                usableTop={usableTop}
                usableBottom={usableBottom}
              />
            ))}
          </g>
        )
      })}
    </>
  )
}

function DepthGhostLayer({
  layer,
  left,
  width,
  surfaceElevationM,
  depthMin,
  depthMax,
  maxDepthMBelowSurface,
  depthToY,
  usableTop,
  usableBottom,
}: {
  layer: VirtueleBoringLayer
  left: number
  width: number
  surfaceElevationM: number
  depthMin: number
  depthMax: number
  maxDepthMBelowSurface: number | null
  depthToY: (d: number) => number
  usableTop: number
  usableBottom: number
}): JSX.Element | null {
  const layerDepthTop = Math.max(0, surfaceElevationM - layer.top_m_taw)
  let layerDepthBase = surfaceElevationM - layer.base_m_taw
  if (maxDepthMBelowSurface !== null && layerDepthTop >= maxDepthMBelowSurface) {
    return null
  }
  if (maxDepthMBelowSurface !== null && layerDepthBase > maxDepthMBelowSurface) {
    layerDepthBase = maxDepthMBelowSurface
  }
  if (layerDepthBase <= depthMin || layerDepthTop >= depthMax) return null
  const clippedTop = Math.max(depthMin, layerDepthTop)
  const clippedBase = Math.min(depthMax, layerDepthBase)
  const yTop = Math.max(usableTop, Math.min(usableBottom, depthToY(clippedTop)))
  const yBase = Math.max(usableTop, Math.min(usableBottom, depthToY(clippedBase)))
  const height = yBase - yTop
  if (height <= 0.3) return null
  const fill = layer.color_hex ?? '#9ca3af'
  const label = layer.beschrijving || layer.name
  const tooltip = `${label}: ${layer.top_m_taw.toFixed(2)} → ${layer.base_m_taw.toFixed(2)} mTAW (${layer.thickness_m.toFixed(2)} m)`
  const maxLines = maxLinesForHeight(height, LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(label, maxCharsForWidth(width, LABEL_FONT_SIZE), maxLines)
    : []
  return (
    <g>
      <rect
        x={left}
        y={yTop}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={GHOST_OPACITY}
        stroke={fill}
        strokeOpacity={0.75}
        strokeWidth={0.5}
      >
        <title>{tooltip}</title>
      </rect>
      {lines.length > 0 && (
        <MultiLineSvgLabel
          lines={lines}
          centerX={left + width / 2}
          rectTopY={yTop}
          rectHeight={height}
          fontSize={LABEL_FONT_SIZE}
          tooltip={tooltip}
        />
      )}
    </g>
  )
}

function MultiLineSvgLabel({
  lines,
  centerX,
  rectTopY,
  rectHeight,
  fontSize,
  tooltip,
}: {
  lines: readonly string[]
  centerX: number
  rectTopY: number
  rectHeight: number
  fontSize: number
  tooltip: string
}): JSX.Element {
  const lineHeight = fontSize * 1.15
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    rectTopY + rectHeight / 2 - blockHeight / 2 + fontSize * 0.8
  return (
    <text
      x={centerX}
      y={firstBaselineY}
      textAnchor="middle"
      fontSize={fontSize}
      fill="#111827"
      style={{ pointerEvents: 'none' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
      <title>{tooltip}</title>
    </text>
  )
}
