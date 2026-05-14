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
import type { PlacedColumn } from './utils'

// Visual constants. Wide enough to fit a short label like "Fm Boom"
// or "A0100"; narrow enough that two side-by-side ghosts don't
// double the column footprint on the section view.
const GHOST_COLUMN_WIDTH_PX = 44
const GHOST_COLUMN_GAP_PX = 4
const GHOST_OPACITY = 0.55
// The data band already sits ±bandHalfWidth around nudgedX. Anchor
// the first ghost ``GAP`` pixels past the band's right edge.
const GHOST_GAP_FROM_BAND_PX = 6
// Inline-label minimum height — fonts at 9px can't read at 8px
// height. Below this threshold we fall back to tooltip-only.
const LABEL_MIN_HEIGHT_PX = 12
const LABEL_FONT_SIZE = 9
const HEADER_HEIGHT_PX = 12
const HEADER_FONT_SIZE = 8

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
  const showInlineLabel = height >= LABEL_MIN_HEIGHT_PX && label.length > 0
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
      {showInlineLabel && (
        <text
          x={left + width / 2}
          y={topY + height / 2 + LABEL_FONT_SIZE / 3}
          textAnchor="middle"
          fontSize={LABEL_FONT_SIZE}
          // Black text on faded coloured backgrounds reads better
          // than the inverse — most DOV colours are saturated
          // medium-tone, and we never see a near-black fill.
          fill="#111827"
          style={{ pointerEvents: 'none' }}
        >
          {truncateForWidth(label, width)}
          <title>{tooltip}</title>
        </text>
      )}
    </g>
  )
}

/**
 * Truncate ``label`` so it fits inside the ghost column width
 * (approximate — SVG doesn't measure text without a layout pass).
 * Falls back to a 6-char-and-ellipsis approximation tuned for the
 * 44 px column + 9 px font: typical labels (``Fm Boom``,
 * ``Antropogeen``, ``Quartair``) fit unmodified; longer ones get
 * clipped.
 */
function truncateForWidth(label: string, width: number): string {
  // 9 px font ≈ 5 px per character at the upper bound for non-narrow
  // glyphs (lowercase letters average less). 44 px / 5 ≈ 8 chars
  // safely; allow 10 for typical mixed-case labels with thinner
  // glyphs ("Fm Gent", "Antropogeen").
  const maxChars = Math.max(4, Math.floor((width - 4) / 4.5))
  if (label.length <= maxChars) return label
  return label.slice(0, maxChars - 1) + '…'
}
