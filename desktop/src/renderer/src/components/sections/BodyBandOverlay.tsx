/**
 * SVG overlay that fills each body's closed loop with its lithology colour —
 * the "colour the closed loop with one internal lithology" render.
 *
 * For every body that spans ≥2 on-section columns, draws the filled polygon
 * bounded by the member units' top-depth chain (over) and base-depth chain
 * (under). A continuous unit reads as a band; a unit that thins to a point on
 * a column reads as a wedge — both fall out of the same member geometry.
 *
 * Read-only fill. Lateral end-caps (pinch / open extents) and interaction
 * (select / name / dissolve) stay in ``BodyExtentOverlay``, which renders on
 * top of this fill.
 */

import { useMemo } from 'react'

import type { BodyListItem, LithoLayerResponse } from '../../api/client'
import { computeBodyBands, type BandColumn } from '../../utils/bodyBands'
import type { PlacedColumn } from './utils'

// Fill opacity: strong enough to read the unit's colour across the gap, light
// enough that the qc curves + per-column glyphs underneath stay legible.
const FILL_OPACITY = 0.4

export interface Props {
  /** Bodies on the active litho model. */
  bodies: readonly BodyListItem[]
  /** Accepted litho layers carrying ``body_id`` + the unit's depth interval. */
  lithoLayers: readonly LithoLayerResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation). */
  placedColumns: readonly PlacedColumn[]
  /** formation_id → lithology colour for the fill. */
  formationColorById: ReadonlyMap<string, string>
  /** Warped along_m → screen x (the spacing-aware transform). */
  alongToScreenX: (along: number) => number
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /** Top / bottom of the plot area in screen px (clamp). */
  plotTop: number
  plotBottom: number
}

/** Render filled body bands beneath the wedge / extent overlay. */
export default function BodyBandOverlay({
  bodies,
  lithoLayers,
  placedColumns,
  formationColorById,
  alongToScreenX,
  levelToScreen,
  plotTop,
  plotBottom,
}: Props): JSX.Element {
  const bands = useMemo(() => {
    const columnsByInv = new Map<string, BandColumn>()
    for (const col of placedColumns) {
      const elev = col.proj.item.elevation_m
      if (elev === null || elev === undefined) continue
      columnsByInv.set(col.proj.item.id, {
        investigationId: col.proj.item.id,
        along: col.proj.along,
        surfaceElevM: elev,
      })
    }
    return computeBodyBands(bodies, lithoLayers, columnsByInv)
  }, [bodies, lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))
  const pt = (along: number, elev: number): string =>
    `${alongToScreenX(along).toFixed(2)},${clampY(levelToScreen(elev)).toFixed(2)}`

  return (
    <g data-testid="body-band-overlay" style={{ pointerEvents: 'none' }}>
      {bands.map(band => {
        // Polygon: top boundary left → right, then base boundary right → left.
        const topPts = band.top.map(p => pt(p.along, p.elev))
        const basePts = [...band.base].reverse().map(p => pt(p.along, p.elev))
        const d = `M ${topPts.join(' L ')} L ${basePts.join(' L ')} Z`
        const color = formationColorById.get(band.formationId) ?? '#888888'
        return (
          <path
            key={`body-band-${band.bodyId}`}
            data-testid={`body-band-${band.bodyId}`}
            d={d}
            fill={color}
            fillOpacity={FILL_OPACITY}
            stroke="none"
          />
        )
      })}
    </g>
  )
}
