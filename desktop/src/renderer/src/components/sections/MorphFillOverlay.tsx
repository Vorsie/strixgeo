/**
 * SVG overlay that fills the section CONTINUOUSLY between adjacent columns via
 * the depth morph (``utils/morphFill``) — the "draw between the correlation
 * bands from test to test, then cut out the pinch-outs" render
 * (owner directive 2026-06-04).
 *
 * For every adjacent column pair it builds each column's gap-free unit stack
 * from the accepted litho layers, computes one quad per LEFT unit (its left edge
 * at the left column, its right edge at the morphed right-column position), and
 * paints each quad in its lithology colour. Matched bodies become wide bands;
 * unmatched units collapse to triangles that pinch out exactly where the
 * bracketing correlation lines converge — so the gap tiles surface-to-floor with
 * NO dark holes.
 *
 * Replaces ``BodyBandOverlay`` (which only painted member-to-member trapezoids
 * and left a triangular hole at every pinch-out). Rendered BENEATH
 * ``BodyExtentOverlay`` so a user-claimed cap / lens still paints on top as an
 * override.
 */

import { useMemo } from 'react'

import type { LithoLayerResponse } from '../../api/client'
import { computeMorphFill, type MorphColumn, type MorphUnit } from '../../utils/morphFill'
import type { PlacedColumn } from './utils'

// A fairly solid fill so the gap reads as continuous units; matches the prior
// band fill weight so the look is unchanged where bands already worked.
const FILL_OPACITY = 0.62
const STROKE_OPACITY = 0.5
const FALLBACK_COLOR = '#888888'

export interface Props {
  /** Accepted litho layers carrying ``body_id`` + the unit's depth interval. */
  lithoLayers: readonly LithoLayerResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation + screen x/width). */
  placedColumns: readonly PlacedColumn[]
  /** formation_id → lithology colour for the fill. */
  formationColorById: ReadonlyMap<string, string>
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /** Top / bottom of the plot area in screen px (clamp). */
  plotTop: number
  plotBottom: number
}

interface ColumnScreen {
  /** Right edge of the column in screen px. */
  rightX: number
  /** Left edge of the column in screen px. */
  leftX: number
  /** Along-section distance for left→right ordering. */
  along: number
}

/** Render the continuous morph fill across every adjacent column gap. */
export default function MorphFillOverlay({
  lithoLayers,
  placedColumns,
  formationColorById,
  levelToScreen,
  plotTop,
  plotBottom,
}: Props): JSX.Element {
  const { orderedInvs, morphColByInv, screenByInv } = useMemo(() => {
    // Group accepted layers by their anchor investigation → a gap-free stack.
    const unitsByInv = new Map<string, MorphUnit[]>()
    for (const layer of lithoLayers) {
      if (layer.status !== 'accepted') continue
      const inv = layer.cpt_id ?? layer.borehole_id
      if (!inv) continue
      const bucket = unitsByInv.get(inv)
      const unit: MorphUnit = {
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
      }
      if (bucket) bucket.push(unit)
      else unitsByInv.set(inv, [unit])
    }

    const morphCols = new Map<string, MorphColumn>()
    const screen = new Map<string, ColumnScreen>()
    const ordered: string[] = []
    for (const col of placedColumns) {
      const elev = col.proj.item.elevation_m
      if (elev === null || elev === undefined) continue
      const id = col.proj.item.id
      const units = (unitsByInv.get(id) ?? []).slice().sort((a, b) => a.topDepthM - b.topDepthM)
      if (units.length === 0) continue
      const halfW = col.width / 2
      morphCols.set(id, { investigationId: id, surfaceElevM: elev, units })
      screen.set(id, {
        rightX: col.nudgedX + halfW,
        leftX: col.nudgedX - halfW,
        along: col.proj.along,
      })
      ordered.push(id)
    }
    ordered.sort((a, b) => (screen.get(a)?.along ?? 0) - (screen.get(b)?.along ?? 0))
    return { orderedInvs: ordered, morphColByInv: morphCols, screenByInv: screen }
  }, [lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  return (
    <g data-testid="morph-fill-overlay" style={{ pointerEvents: 'none' }}>
      {orderedInvs.slice(0, -1).flatMap((leftId, gapIndex) => {
        const rightId = orderedInvs[gapIndex + 1]
        const left = morphColByInv.get(leftId)
        const right = morphColByInv.get(rightId)
        const lScreen = screenByInv.get(leftId)
        const rScreen = screenByInv.get(rightId)
        if (!left || !right || !lScreen || !rScreen) return []
        const leftX = lScreen.rightX
        const rightX = rScreen.leftX
        // Overlapping / zero-width gap (columns too close) → nothing to fill.
        if (rightX <= leftX) return []

        const quads = computeMorphFill(left, right)
        return quads.map((q, i) => {
          const color = formationColorById.get(q.formationId) ?? FALLBACK_COLOR
          const lTop = clampY(levelToScreen(q.leftTopElev))
          const lBase = clampY(levelToScreen(q.leftBaseElev))
          const rTop = clampY(levelToScreen(q.rightTopElev))
          const rBase = clampY(levelToScreen(q.rightBaseElev))
          const d =
            `M ${leftX.toFixed(2)},${lTop.toFixed(2)} ` +
            `L ${rightX.toFixed(2)},${rTop.toFixed(2)} ` +
            `L ${rightX.toFixed(2)},${rBase.toFixed(2)} ` +
            `L ${leftX.toFixed(2)},${lBase.toFixed(2)} Z`
          return (
            <path
              key={`morph-${leftId}-${i}`}
              data-testid={`morph-fill-${leftId}-${i}`}
              d={d}
              fill={color}
              fillOpacity={FILL_OPACITY}
              stroke={color}
              strokeOpacity={STROKE_OPACITY}
              strokeWidth={0.75}
            />
          )
        })
      })}
    </g>
  )
}
