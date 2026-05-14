/**
 * Slim labelled "ghost" columns rendered next to each investigation
 * on the section view, showing DOV Virtuele Boring predictions at
 * the investigation's (x, y). Informative overlay only — never
 * contributes to ``FormationContact`` placement, never gates Build.
 * Engineers use it to inform their manual contact picks ("DOV thinks
 * Boom starts at mTAW -14 here").
 *
 * Layout per investigation:
 *
 *   [own column / data band]   [model A ghost]   [model B ghost]
 *
 * Each ghost column is a vertical stack of coloured rectangles —
 * one per layer present at the point, drawn between
 * ``levelToScreen(top_m_taw)`` and ``levelToScreen(base_m_taw)``.
 * Layer colour comes from DOV's ``dovlayercolor`` (a stable per-unit
 * RGB shipped inline in the doorprik response). Each rect carries
 * an inline text label when the rect is tall enough; otherwise the
 * label lives in the native ``<title>`` tooltip on hover. The
 * column header (just above the rect stack) labels the active
 * model code so two side-by-side ghosts are distinguishable.
 *
 * Vertical clipping: the caller passes ``maxDepthMBelowSurface`` so
 * layers below the investigation's surface elevation minus that
 * depth get hidden / clipped. ``null`` = no clip (render the full
 * DOV column).
 *
 * Visual identity: opacity 0.55 + a thin stroke so the ghost reads
 * as "DOV predicts" rather than ground truth. The engineer's own
 * picks still own visual priority.
 */

import type {
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLayer,
} from '../../api/client'
import {
  maxCharsForWidth,
  maxLinesForHeight,
  wrapLabelToLines,
} from '../../utils/labelWrap'
import type { PlacedColumn } from './utils'

// Visual constants. Wide enough to fit a short label like "Fm Boom"
// or "A0100"; narrow enough that two side-by-side ghosts don't
// double the column footprint on the section view. Exported so the
// SectionPanel's nudge layout can fold the ghost rail width into
// each column's visualWidth for collision avoidance.
export const GHOST_COLUMN_WIDTH_PX = 44
export const GHOST_COLUMN_GAP_PX = 4
export const GHOST_GAP_FROM_BAND_PX = 6
const GHOST_OPACITY = 0.55
const LABEL_FONT_SIZE = 9
const HEADER_FONT_SIZE = 8

/**
 * Compute the horizontal footprint (in px) of the ghost rail for a
 * given number of active models. Returns 0 when nothing is active so
 * callers can skip the collision-padding branch entirely.
 */
export function virtueleBoringGhostRailWidth(activeModelCount: number): number {
  if (activeModelCount <= 0) return 0
  return (
    GHOST_GAP_FROM_BAND_PX +
    activeModelCount * GHOST_COLUMN_WIDTH_PX +
    Math.max(0, activeModelCount - 1) * GHOST_COLUMN_GAP_PX
  )
}

export interface VirtueleBoringGhostColumnsProps {
  /** Same placement that ``InvestigationColumns`` renders against —
   * carries the nudged X + kind for every visible investigation. */
  columns: readonly PlacedColumn[]
  /** Ordered list of active model codes (A then B, B may be absent).
   * Empty array short-circuits to a no-op render — keeps the
   * SectionPanel call site simple. */
  activeModels: readonly string[]
  /** Per-investigation predictions, keyed by investigation_id. */
  predictionsByInvestigationId: ReadonlyMap<string, VirtueleBoringInvestigationPrediction>
  /** mTAW elevation → screen Y. */
  levelToScreen: (level: number) => number
  /** Visible plot Y bounds — used to clamp each layer's rect so a
   * layer extending far below / above the data view doesn't paint
   * outside the plot frame. */
  plotTop: number
  plotBottom: number
  /** Half-width of the data band each investigation already renders. */
  bandHalfWidth: number
  /** Vertical clip in metres below each investigation's surface
   * elevation. Layers entirely below ``elevation_m - maxDepth`` are
   * omitted; layers crossing the boundary are clipped at it.
   * ``null`` = no clip (render the full DOV column). */
  maxDepthMBelowSurface: number | null
}

export default function VirtueleBoringGhostColumns({
  columns,
  activeModels,
  predictionsByInvestigationId,
  levelToScreen,
  plotTop,
  plotBottom,
  bandHalfWidth,
  maxDepthMBelowSurface,
}: VirtueleBoringGhostColumnsProps): JSX.Element | null {
  if (activeModels.length === 0 || predictionsByInvestigationId.size === 0) return null

  return (
    <g data-testid="virtuele-boring-ghosts">
      {columns.map(col => {
        const investigationId = col.proj.item.id
        const pred = predictionsByInvestigationId.get(investigationId)
        if (!pred) return null
        // Compute the absolute mTAW depth cap once per investigation
        // so every layer rendered for it shares the same lower bound.
        const surfaceElevation = pred.elevation_m_taw
        const depthCapMTaw =
          maxDepthMBelowSurface !== null && surfaceElevation !== null
            ? surfaceElevation - maxDepthMBelowSurface
            : null
        const baseLeft = col.nudgedX + bandHalfWidth + GHOST_GAP_FROM_BAND_PX
        return activeModels.map((modelCode, modelIdx) => {
          const layers = pred.predictions_by_model[modelCode]
          if (!layers || layers.length === 0) return null
          const left =
            baseLeft + modelIdx * (GHOST_COLUMN_WIDTH_PX + GHOST_COLUMN_GAP_PX)
          return (
            <g
              key={`${col.kind}-${investigationId}-${modelCode}`}
              data-testid={`vb-ghost-${investigationId}-${modelCode}`}
            >
              <GhostColumnHeader
                left={left}
                width={GHOST_COLUMN_WIDTH_PX}
                bottomY={plotTop}
                modelCode={modelCode}
              />
              {layers.map(layer => (
                <VirtueleBoringGhostLayer
                  key={`${layer.code}-${layer.top_m_taw}`}
                  layer={layer}
                  left={left}
                  width={GHOST_COLUMN_WIDTH_PX}
                  levelToScreen={levelToScreen}
                  plotTop={plotTop}
                  plotBottom={plotBottom}
                  depthCapMTaw={depthCapMTaw}
                />
              ))}
            </g>
          )
        })
      })}
    </g>
  )
}

function GhostColumnHeader({
  left,
  width,
  bottomY,
  modelCode,
}: {
  left: number
  width: number
  bottomY: number
  modelCode: string
}): JSX.Element {
  // Mount above the plot, with the baseline ending just at plotTop
  // so the header reads as "this column = X" without intruding on
  // the level axis. Truncate by SVG ellipsis-equivalent (just
  // visible width) — DOV's model codes are short ("g3dv3_F", 7
  // chars) so this is rarely needed.
  return (
    <text
      x={left + width / 2}
      y={bottomY - 3}
      textAnchor="middle"
      fontSize={HEADER_FONT_SIZE}
      fill="#6b7280"
      style={{ pointerEvents: 'none' }}
    >
      {modelCode}
    </text>
  )
}

function VirtueleBoringGhostLayer({
  layer,
  left,
  width,
  levelToScreen,
  plotTop,
  plotBottom,
  depthCapMTaw,
}: {
  layer: VirtueleBoringLayer
  left: number
  width: number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  depthCapMTaw: number | null
}): JSX.Element | null {
  // Apply the per-investigation depth cap before clipping to plot
  // bounds — drops layers entirely below the cap and clips those
  // that straddle it.
  let effectiveBase = layer.base_m_taw
  if (depthCapMTaw !== null) {
    if (layer.top_m_taw <= depthCapMTaw) return null
    if (layer.base_m_taw < depthCapMTaw) effectiveBase = depthCapMTaw
  }
  // Top is the higher elevation → lower Y on screen. ``base`` is the
  // lower elevation → higher Y.
  const topY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(layer.top_m_taw)))
  const baseY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(effectiveBase)))
  const height = baseY - topY
  if (height <= 0.5) return null
  const fill = layer.color_hex ?? '#9ca3af'
  const label = layer.beschrijving || layer.name
  const tooltip = `${label}: ${layer.top_m_taw.toFixed(2)} → ${layer.base_m_taw.toFixed(2)} mTAW (${layer.thickness_m.toFixed(2)} m)`
  // Wrap the label across as many lines as fit in the rect. Falls
  // back to tooltip-only when the rect is too thin for even one
  // line — never renders a partial-letter clipped label.
  const maxLines = maxLinesForHeight(height, LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(label, maxCharsForWidth(width, LABEL_FONT_SIZE), maxLines)
    : []
  return (
    <g>
      <rect
        x={left}
        y={topY}
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
        <MultiLineLabel
          lines={lines}
          centerX={left + width / 2}
          rectTopY={topY}
          rectHeight={height}
          fontSize={LABEL_FONT_SIZE}
          tooltip={tooltip}
        />
      )}
    </g>
  )
}

/**
 * Render a vertically-centred multi-line label inside a ghost rect.
 * Uses SVG ``<tspan>`` for each line so the renderer doesn't need
 * to measure text widths per render — the line array carries the
 * exact wrap our character-budget heuristic produced.
 */
function MultiLineLabel({
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
  // Centre the multi-line block vertically inside the rect:
  // first baseline = rect centre minus half the block height plus
  // the font's typical ascender (≈ 0.75 × fontSize).
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
