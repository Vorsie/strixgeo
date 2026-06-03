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
 * One-lithology guard: a segment is drawn (and coloured) by the MEMBER's own
 * lithology, and ONLY when both members share a lithology. A body that the
 * resolver mis-grouped across lithologies (e.g. a SILT-nominal body carrying
 * KLEI members) therefore still renders honestly — clay segments grey, silt
 * green — instead of painting the whole body one colour (dogfeed 2026-06-03:
 * "the bottom one is green but it's a clay layer").
 *
 * Read-only fill; lateral end-caps + interaction stay in ``BodyExtentOverlay``.
 */

import { useMemo } from 'react'

import type { BodyListItem, LithoLayerResponse } from '../../api/client'
import { computeBodyBands, type BandColumn } from '../../utils/bodyBands'
import type { PlacedColumn } from './utils'

// The gap is otherwise empty, so a fairly solid fill reads as a continuous
// unit from column through gap. A thin stroke in the same colour keeps even a
// dark unit (grey clay over the navy background) visible.
const FILL_OPACITY = 0.62
const STROKE_OPACITY = 0.95
const FALLBACK_COLOR = '#888888'

export interface Props {
  /** Bodies on the active litho model. */
  bodies: readonly BodyListItem[]
  /** Accepted litho layers carrying ``body_id`` + the unit's depth interval. */
  lithoLayers: readonly LithoLayerResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation + screen x/width). */
  placedColumns: readonly PlacedColumn[]
  /** formation_id → lithology colour for the fill. */
  formationColorById: ReadonlyMap<string, string>
  /** formation_id → lithology code (e.g. "KLEI") for the one-lithology guard. */
  formationSoilById: ReadonlyMap<string, string>
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
  formationSoilById,
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
  // (no other column sits between them) — otherwise the unit is absent on an
  // intermediate column and must not paint across it (a pinch-out, the cap's
  // job).
  const columnsBetween = (loA: number, hiA: number): boolean =>
    allAlongs.some(v => v > loA + 1e-6 && v < hiA - 1e-6)

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  return (
    <g data-testid="body-band-overlay" style={{ pointerEvents: 'none' }}>
      {bands.flatMap(band => {
        const segments: JSX.Element[] = []
        for (let i = 0; i < band.members.length - 1; i += 1) {
          const a = band.members[i] // left column
          const b = band.members[i + 1] // right column
          // One-lithology guard: never fill across a lithology change. Compare
          // the SOIL code (KLEI / SILT / …), not formation_id — several
          // formation rows can share a lithology and should still join.
          const soilA = formationSoilById.get(a.formationId)
          const soilB = formationSoilById.get(b.formationId)
          if (!soilA || soilA !== soilB) continue
          const colA = columnScreenByInv.get(a.investigationId)
          const colB = columnScreenByInv.get(b.investigationId)
          if (!colA || !colB) continue
          // Skip when a column sits between the two members.
          if (columnsBetween(a.along, b.along)) continue
          const leftX = colA.rightX
          const rightX = colB.leftX
          // No visible gap (overlapping / same column) → nothing to fill.
          if (rightX <= leftX) continue
          const aTop = clampY(levelToScreen(a.topElev))
          const aBase = clampY(levelToScreen(a.baseElev))
          const bTop = clampY(levelToScreen(b.topElev))
          const bBase = clampY(levelToScreen(b.baseElev))
          // Colour by the member's OWN lithology, not the body's nominal one.
          const color = formationColorById.get(a.formationId) ?? FALLBACK_COLOR
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
              stroke={color}
              strokeOpacity={STROKE_OPACITY}
              strokeWidth={1}
            />,
          )
        }
        return segments
      })}
    </g>
  )
}
