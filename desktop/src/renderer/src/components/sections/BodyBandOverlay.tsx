/**
 * SVG overlay that fills each body's closed loop with its lithology colour —
 * the "colour the closed loop with one internal lithology" render.
 *
 * Drawn GAP BY GAP: for every pair of consecutive on-section member columns of
 * a body, a trapezoid fills the dark space BETWEEN the columns (right edge of
 * the left column → left edge of the right column), bounded by the unit's top
 * correlation line (over) and base correlation line (under). Filling only the
 * gaps means the fill never paints over a column's own glyphs, stacked units
 * tile cleanly with no overlap, and there is no big self-crossing polygon.
 *
 * A continuous unit reads as a chain of band segments; a unit absent on one
 * side leaves the gap empty (the pinch-out — the cap fills it later). Read-only
 * fill; lateral end-caps + interaction stay in ``BodyExtentOverlay`` on top.
 */

import { useMemo } from 'react'

import type { BodyListItem, LithoLayerResponse } from '../../api/client'
import { computeBodyBands, type BandColumn } from '../../utils/bodyBands'
import type { PlacedColumn } from './utils'

// Fill opacity: the gap is otherwise empty, so a fairly solid fill reads as a
// continuous unit from column through gap without fighting the qc curves
// (which live inside the columns, not the gaps).
const FILL_OPACITY = 0.62

export interface Props {
  /** Bodies on the active litho model. */
  bodies: readonly BodyListItem[]
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
}

/** Render filled body band segments in the inter-column gaps. */
export default function BodyBandOverlay({
  bodies,
  lithoLayers,
  placedColumns,
  formationColorById,
  levelToScreen,
  plotTop,
  plotBottom,
}: Props): JSX.Element {
  const { bands, columnScreenByInv, allAlongs } = useMemo(() => {
    const columnsByInv = new Map<string, BandColumn>()
    const screenByInv = new Map<string, ColumnScreen>()
    const alongs: number[] = []
    for (const col of placedColumns) {
      const elev = col.proj.item.elevation_m
      if (elev === null || elev === undefined) continue
      const halfW = col.width / 2
      columnsByInv.set(col.proj.item.id, {
        investigationId: col.proj.item.id,
        along: col.proj.along,
        surfaceElevM: elev,
      })
      screenByInv.set(col.proj.item.id, {
        rightX: col.nudgedX + halfW,
        leftX: col.nudgedX - halfW,
      })
      alongs.push(col.proj.along)
    }
    alongs.sort((p, q) => p - q)
    return {
      bands: computeBodyBands(bodies, lithoLayers, columnsByInv),
      columnScreenByInv: screenByInv,
      allAlongs: alongs,
    }
  }, [bodies, lithoLayers, placedColumns])

  // A gap is fillable only when the two members are on ADJACENT section columns
  // (no other column sits between them). When the unit is absent on an
  // intermediate column the band must NOT paint across it — that's a pinch-out,
  // the cap's job, not a continuous fill (dogfeed 2026-06-03).
  const columnsBetween = (loA: number, hiA: number): boolean =>
    allAlongs.some(v => v > loA + 1e-6 && v < hiA - 1e-6)

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  return (
    <g data-testid="body-band-overlay" style={{ pointerEvents: 'none' }}>
      {bands.flatMap(band => {
        const color = formationColorById.get(band.formationId) ?? '#888888'
        const segments: JSX.Element[] = []
        for (let i = 0; i < band.members.length - 1; i += 1) {
          const a = band.members[i] // left column
          const b = band.members[i + 1] // right column
          const colA = columnScreenByInv.get(a.investigationId)
          const colB = columnScreenByInv.get(b.investigationId)
          if (!colA || !colB) continue
          // Skip when a column sits between the two members — the unit is
          // absent there, so it pinches out rather than continuing.
          if (columnsBetween(a.along, b.along)) continue
          const leftX = colA.rightX
          const rightX = colB.leftX
          // No visible gap (overlapping / same column) → nothing to fill.
          if (rightX <= leftX) continue
          const aTop = clampY(levelToScreen(a.topElev))
          const aBase = clampY(levelToScreen(a.baseElev))
          const bTop = clampY(levelToScreen(b.topElev))
          const bBase = clampY(levelToScreen(b.baseElev))
          // Top edge = top correlation line; base edge = base correlation line.
          const d =
            `M ${leftX.toFixed(2)},${aTop.toFixed(2)} ` +
            `L ${rightX.toFixed(2)},${bTop.toFixed(2)} ` +
            `L ${rightX.toFixed(2)},${bBase.toFixed(2)} ` +
            `L ${leftX.toFixed(2)},${aBase.toFixed(2)} Z`
          segments.push(
            <path
              key={`body-band-${band.bodyId}-${i}`}
              data-testid={`body-band-${band.bodyId}-${i}`}
              d={d}
              fill={color}
              fillOpacity={FILL_OPACITY}
              stroke="none"
            />,
          )
        }
        return segments
      })}
    </g>
  )
}
