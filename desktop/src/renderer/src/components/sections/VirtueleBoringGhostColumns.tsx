/**
 * Slim "ghost" columns rendered next to each investigation on the
 * section view, showing DOV Virtuele Boring predictions at the
 * investigation's (x, y). Informative overlay only — never contributes
 * to ``FormationContact`` placement, never gates Build. Engineers use
 * it to inform their manual contact picks ("DOV thinks Boom starts at
 * mTAW −14 here").
 *
 * Layout per investigation:
 *
 *   [own column / data band]   [model A ghost]   [model B ghost]
 *
 * Each ghost column is a fixed-width vertical stack of coloured
 * rectangles — one per layer present at the point, drawn between
 * ``levelToScreen(top_m_taw)`` and ``levelToScreen(base_m_taw)``.
 * Layer colour comes from DOV's ``dovlayercolor`` (a stable per-unit
 * RGB shipped inline in the doorprik response).
 *
 * Each rect carries a native ``<title>`` tooltip with the layer name
 * + top/base elevations so hover gives the exact numbers without a
 * second panel. Opacity stays low (0.5) so the ghost reads as
 * "DOV predicts" rather than "this is the truth" — the engineer's
 * own picks still own visual priority.
 */

import type {
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLayer,
} from '../../api/client'
import type { PlacedColumn } from './utils'

// Visual constants. Narrow + faded so the ghost reads as supplementary
// information, not the main investigation column. Two ghosts (model
// A + model B) per investigation = up to 30px of horizontal real
// estate next to each column — fits comfortably within the typical
// column spacing without crowding.
const GHOST_COLUMN_WIDTH_PX = 12
const GHOST_COLUMN_GAP_PX = 3
const GHOST_OPACITY = 0.55
// Half-band hop — the existing CPT / borehole data band sits ±bandHalfWidth
// from nudgedX. We anchor the first ghost ``GAP`` pixels right of the
// band's right edge.
const GHOST_GAP_FROM_BAND_PX = 4

export interface VirtueleBoringGhostColumnsProps {
  /** Same placement that ``InvestigationColumns`` renders against —
   * carries the nudged X + kind for every visible investigation. */
  columns: readonly PlacedColumn[]
  /** Ordered list of active model codes (A then B, B may be absent).
   * Empty array short-circuits to a no-op render — keeps the
   * SectionPanel call site simple. */
  activeModels: readonly string[]
  /** Per-investigation predictions, keyed by investigation_id. The
   * map comes from the App's project-wide fetch and is cached there
   * so toggle off/on doesn't re-fetch. */
  predictionsByInvestigationId: ReadonlyMap<string, VirtueleBoringInvestigationPrediction>
  /** mTAW elevation → screen Y. Same transform every other layer
   * uses; lets the ghost layers line up with the DEM polyline and
   * the formation contact lines pixel-for-pixel. */
  levelToScreen: (level: number) => number
  /** Visible plot Y bounds — passed in to clamp each layer's rect so
   * a layer extending far below the data view doesn't paint outside
   * the plot frame. */
  plotTop: number
  plotBottom: number
  /** Half-width of the data band each investigation already renders.
   * Used to position the first ghost to the right of that band. */
  bandHalfWidth: number
}

export default function VirtueleBoringGhostColumns({
  columns,
  activeModels,
  predictionsByInvestigationId,
  levelToScreen,
  plotTop,
  plotBottom,
  bandHalfWidth,
}: VirtueleBoringGhostColumnsProps): JSX.Element | null {
  if (activeModels.length === 0 || predictionsByInvestigationId.size === 0) return null

  return (
    <g data-testid="virtuele-boring-ghosts">
      {columns.map(col => {
        const investigationId =
          col.kind === 'cpt' ? col.proj.item.id : col.proj.item.id
        const pred = predictionsByInvestigationId.get(investigationId)
        if (!pred) return null
        // Place ghosts to the right of the data band. First ghost
        // starts at nudgedX + bandHalfWidth + gap; each subsequent
        // ghost shifts right by ghost-width + ghost-gap.
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
              {layers.map(layer => (
                <VirtueleBoringGhostLayer
                  key={`${layer.code}-${layer.top_m_taw}`}
                  layer={layer}
                  left={left}
                  width={GHOST_COLUMN_WIDTH_PX}
                  levelToScreen={levelToScreen}
                  plotTop={plotTop}
                  plotBottom={plotBottom}
                />
              ))}
            </g>
          )
        })
      })}
    </g>
  )
}

function VirtueleBoringGhostLayer({
  layer,
  left,
  width,
  levelToScreen,
  plotTop,
  plotBottom,
}: {
  layer: VirtueleBoringLayer
  left: number
  width: number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  // Top is the higher elevation → lower Y on screen. ``base`` is the
  // lower elevation → higher Y.
  const topY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(layer.top_m_taw)))
  const baseY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(layer.base_m_taw)))
  const height = baseY - topY
  // Zero-height layers (vanishingly thin in this VEX) wouldn't read
  // anyway and crash the SVG when rx > height. Skip them.
  if (height <= 0.5) return null
  const fill = layer.color_hex ?? '#9ca3af'
  return (
    <rect
      x={left}
      y={topY}
      width={width}
      height={height}
      fill={fill}
      fillOpacity={GHOST_OPACITY}
      stroke={fill}
      strokeOpacity={0.7}
      strokeWidth={0.5}
    >
      <title>
        {`${layer.beschrijving || layer.name}: ${layer.top_m_taw.toFixed(2)} → ${layer.base_m_taw.toFixed(2)} mTAW (${layer.thickness_m.toFixed(2)} m)`}
      </title>
    </rect>
  )
}
