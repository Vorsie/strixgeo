/**
 * SVG overlay that fills the litho section as a TRUE PARTITION between adjacent
 * columns (``utils/partitionFill``) — every point belongs to exactly one body,
 * with NO overlaps and NO empty spaces (owner directive 2026-06-05: the 2D
 * section defines the 3D model, so an overlap/gap in 2D becomes one in 3D).
 *
 * Replaces ``MorphFillOverlay`` (which painted per-body envelope bands then
 * overpainted pinch triangles with z-order — a visual fake-partition whose
 * envelopes overlapped and whose pinch/band mismatches left gaps). Here each
 * adjacent gap is tiled by ``computePartitionFill``: a monotonic alignment of
 * the two columns' unit stacks emits regions bounded by SHARED interfaces, so
 * an interrupted body renders as its real pieces (a matched quad + a separate
 * pinch) and the tiling is structurally hole-free + overlap-free.
 *
 * Render-only for now: labels, off-section open-end stubs and the body context
 * menu carry over from the morph overlay. The move-shared-boundary drag (which
 * replaces the old apex drag and bakes in the cross-body guard) lands next; the
 * drag-related props are accepted for call-site compatibility but unused here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BodyBoundaryNode, BodyListItem, LithoLayerResponse } from '../../api/client'
import {
  computePartitionFill,
  type LensApexOverride,
  type MorphColumn,
  type MorphUnit,
  type PartitionRegion,
} from '../../utils/partitionFill'
import type { Props } from './MorphFillOverlay'
import type { PlacedColumn } from './utils'

const FILL_OPACITY = 0.62
// A lens (one-test body enclosed in a matrix) is drawn a touch more solid so it
// reads as a unit CUT OUT of the continuous matrix it sits on, not a faint wash.
const LENS_OPACITY = 0.85
const STROKE_OPACITY = 0.45
const FALLBACK_COLOR = '#888888'
const EDGE_STUB_PX = 64
const OPEN_END_M = 5
/** Minimum on-screen region height (px) to carry a label legibly. */
const LABEL_MIN_H = 14
// Lens-apex drag handle radius + its transparent hit halo.
const APEX_R = 5
const APEX_HIT_R = 11

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

interface ColumnScreen {
  rightX: number
  leftX: number
  along: number
}

/** A live lens-apex drag. ``side`` 'left' = lens on the left column (wedges
 *  right, stored in upper_nodes); 'right' = lens on the right column. */
interface ApexDrag {
  bodyId: string
  side: 'left' | 'right'
  x: number
  y: number
}

/** A region already mapped to screen polygon points, tagged with its gap edges. */
interface ScreenRegion {
  region: PartitionRegion
  points: { x: number; y: number }[]
  leftX: number
  rightX: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Render the partition fill (+ labels, open-end stubs, context menu). */
export default function PartitionFillOverlay({
  lithoLayers,
  placedColumns,
  formationColorById,
  formationLabelById,
  showBands,
  levelToScreen,
  plotTop,
  plotBottom,
  plotLeft,
  plotRight,
  alongToScreenX,
  screenXToAlong,
  screenToLevel,
  boundariesByBodyId,
  onSaveBoundary,
  bodies,
  onBodyContextMenu,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<ApexDrag | null>(null)
  const bodyById = useMemo(() => new Map((bodies ?? []).map((b) => [b.id, b])), [bodies])

  // Lens-apex drag: live-track the apex, persist the shape on mouse-up. The
  // apex is stored on the body's boundary (upper_nodes = right-wedging / left
  // lens, lower_nodes = left-wedging / right lens), reusing the same store the
  // morph apex used so a shaped lens survives a reload.
  useEffect(() => {
    if (!drag) return
    const svg = rootRef.current?.ownerSVGElement
    const move = (e: MouseEvent): void => {
      const rect = svg?.getBoundingClientRect()
      setDrag({
        bodyId: drag.bodyId,
        side: drag.side,
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      })
    }
    const up = (): void => {
      if (onSaveBoundary && screenXToAlong && screenToLevel) {
        const apex: BodyBoundaryNode = {
          along_m: screenXToAlong(drag.x),
          elevation_m: screenToLevel(drag.y),
        }
        const existing = boundariesByBodyId?.get(drag.bodyId)
        const upper = drag.side === 'left' ? [apex] : (existing?.upper_nodes ?? [])
        const lower = drag.side === 'right' ? [apex] : (existing?.lower_nodes ?? [])
        onSaveBoundary(drag.bodyId, upper, lower, 'straight')
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag, onSaveBoundary, screenXToAlong, screenToLevel, boundariesByBodyId])

  // Build each column's gap-free unit stack + its screen x-edges (identical to
  // the morph overlay — the partition consumes the same MorphColumn input).
  const { orderedInvs, colByInv, screenByInv } = useMemo(() => {
    const unitsByInv = new Map<string, MorphUnit[]>()
    for (const layer of lithoLayers) {
      if (layer.status !== 'accepted') continue
      const inv = layer.cpt_id ?? layer.borehole_id
      if (!inv) continue
      const unit: MorphUnit = {
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
      }
      const bucket = unitsByInv.get(inv)
      if (bucket) bucket.push(unit)
      else unitsByInv.set(inv, [unit])
    }

    const cols = new Map<string, MorphColumn>()
    const screen = new Map<string, ColumnScreen>()
    const ordered: string[] = []
    for (const col of placedColumns as readonly PlacedColumn[]) {
      const elev = col.proj.item.elevation_m
      if (elev === null || elev === undefined) continue
      const id = col.proj.item.id
      const units = (unitsByInv.get(id) ?? []).slice().sort((a, b) => a.topDepthM - b.topDepthM)
      if (units.length === 0) continue
      const halfW = col.width / 2
      cols.set(id, { investigationId: id, surfaceElevM: elev, units })
      screen.set(id, {
        rightX: col.nudgedX + halfW,
        leftX: col.nudgedX - halfW,
        along: col.proj.along,
      })
      ordered.push(id)
    }
    ordered.sort((a, b) => (screen.get(a)?.along ?? 0) - (screen.get(b)?.along ?? 0))
    return { orderedInvs: ordered, colByInv: cols, screenByInv: screen }
  }, [lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  // Open-end stub length: ~5 m of section (dogfeed 2026-06-05), derived from the
  // horizontal scale so it stays 5 m through zoom; clamped so it never vanishes.
  const openEndPx = alongToScreenX
    ? Math.max(8, OPEN_END_M * Math.abs(alongToScreenX(1) - alongToScreenX(0)))
    : EDGE_STUB_PX

  // ---- Compute every gap's partition once, mapped to screen polygons. ------
  // (fraction 0..1 → x between the two columns' facing edges; elevation → y.)
  const screenRegions = useMemo(() => {
    if (!showBands) return [] as ScreenRegion[]
    const out: ScreenRegion[] = []
    for (let i = 0; i < orderedInvs.length - 1; i += 1) {
      const leftId = orderedInvs[i]
      const rightId = orderedInvs[i + 1]
      const left = colByInv.get(leftId)
      const right = colByInv.get(rightId)
      const lScreen = screenByInv.get(leftId)
      const rScreen = screenByInv.get(rightId)
      if (!left || !right || !lScreen || !rScreen) continue
      const leftX = lScreen.rightX
      const rightX = rScreen.leftX
      if (rightX <= leftX) continue

      // Lens apex overrides for this gap: a left-column-only body keys its apex
      // in upper_nodes, a right-column-only body in lower_nodes (morph
      // convention). The live drag wins over the stored shape so the lens
      // follows the cursor.
      const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      const overrides = new Map<string, LensApexOverride>()
      const addOverride = (bodyId: string, side: 'left' | 'right'): void => {
        if (drag && drag.bodyId === bodyId && drag.side === side) {
          overrides.set(bodyId, {
            fraction: clamp01((drag.x - leftX) / (rightX - leftX)),
            elevation: screenToLevel ? screenToLevel(drag.y) : 0,
          })
          return
        }
        const b = boundariesByBodyId?.get(bodyId)
        const node = (side === 'left' ? b?.upper_nodes : b?.lower_nodes)?.[0]
        if (node && alongToScreenX) {
          overrides.set(bodyId, {
            fraction: clamp01((alongToScreenX(node.along_m) - leftX) / (rightX - leftX)),
            elevation: node.elevation_m,
          })
        }
      }
      for (const id of leftIds) if (!rightIds.has(id)) addOverride(id, 'left')
      for (const id of rightIds) if (!leftIds.has(id)) addOverride(id, 'right')

      for (const region of computePartitionFill(left, right, overrides)) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        const points = region.polygon.map((p) => {
          const x = leftX + p.fraction * (rightX - leftX)
          // Inline clamp (not the clampY closure) so the memo deps stay the
          // primitives plotTop/plotBottom rather than a per-render function id.
          const y = Math.max(plotTop, Math.min(plotBottom, levelToScreen(p.elevation)))
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          return { x, y }
        })
        out.push({ region, points, leftX, rightX, minX, maxX, minY, maxY })
      }
    }
    return out
  }, [
    orderedInvs,
    colByInv,
    screenByInv,
    showBands,
    levelToScreen,
    plotTop,
    plotBottom,
    drag,
    boundariesByBodyId,
    alongToScreenX,
    screenToLevel,
  ])

  // One label per BODY at its tallest visible region, clamped to the viewport so
  // it survives a zoom onto a single test (dogfeed 2026-06-05).
  const labels = useMemo(() => {
    const bestByBody = new Map<string, ScreenRegion>()
    for (const sr of screenRegions) {
      const id = sr.region.bodyId
      if (!id) continue
      if (sr.maxY - sr.minY < LABEL_MIN_H) continue
      const prev = bestByBody.get(id)
      if (!prev || sr.maxY - sr.minY > prev.maxY - prev.minY) bestByBody.set(id, sr)
    }
    const out: { key: string; x: number; y: number; text: string }[] = []
    for (const [id, sr] of bestByBody) {
      const text = formationLabelById?.get(sr.region.formationId)
      if (!text) continue
      const loX = plotLeft != null ? Math.max(sr.minX, plotLeft) : sr.minX
      const hiX = plotRight != null ? Math.min(sr.maxX, plotRight) : sr.maxX
      if (hiX - loX < 4) continue // not horizontally visible
      out.push({ key: id, x: (loX + hiX) / 2, y: (sr.minY + sr.maxY) / 2, text })
    }
    return out
  }, [screenRegions, formationLabelById, plotLeft, plotRight])

  return (
    <g ref={rootRef} data-testid="partition-fill-overlay" style={{ pointerEvents: 'none' }}>
      {screenRegions.map((sr, i) => {
        const color = formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR
        const d = `${sr.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`
        const body = sr.region.bodyId ? bodyById.get(sr.region.bodyId) : undefined
        const interactive = Boolean(onBodyContextMenu && body)
        // A lens carries a draggable apex (its pinch point = polygon[1]). Side
        // comes from the source corner: fraction 0 → left lens, 1 → right lens.
        const apex = sr.region.kind === 'lens' ? sr.points[1] : undefined
        const side: 'left' | 'right' = sr.region.polygon[0].fraction === 0 ? 'left' : 'right'
        const canShape = Boolean(apex && onSaveBoundary && sr.region.bodyId)
        return [
          <path
            key={`pf-${i}`}
            data-testid={`partition-region-${sr.region.bodyId ?? 'nobody'}`}
            d={d}
            fill={color}
            fillOpacity={sr.region.kind === 'lens' ? LENS_OPACITY : FILL_OPACITY}
            stroke={color}
            strokeOpacity={STROKE_OPACITY}
            strokeWidth={0.75}
            style={interactive ? { pointerEvents: 'auto', cursor: 'context-menu' } : undefined}
            onContextMenu={
              interactive
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                    onBodyContextMenu?.(
                      body as BodyListItem,
                      e.clientX - (rect?.left ?? 0),
                      e.clientY - (rect?.top ?? 0),
                    )
                  }
                : undefined
            }
          />,
          canShape && apex ? (
            <g key={`pf-apex-${i}`}>
              {/* Transparent hit halo so the small handle is easy to grab. */}
              <circle
                data-testid={`partition-lens-apex-hit-${sr.region.bodyId}`}
                cx={apex.x}
                cy={apex.y}
                r={APEX_HIT_R}
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'grab' }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDrag({ bodyId: sr.region.bodyId as string, side, x: apex.x, y: apex.y })
                }}
              />
              <circle
                data-testid={`partition-lens-apex-${sr.region.bodyId}`}
                cx={apex.x}
                cy={apex.y}
                r={APEX_R}
                fill="#f59e0b"
                stroke="#0f172a"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          ) : null,
        ]
      })}

      {labels.map((l) => (
        <text
          key={`pf-label-${l.key}`}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fontWeight={600}
          fill="#e2e8f0"
          stroke="#0f172a"
          strokeWidth={2.5}
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          {l.text}
        </text>
      ))}

      {/* Open-end stubs: the first / last column's PARTITION continues
          off-section as a short ~5 m parallel strip, one rect per unit so the
          edge stays a partition (no envelope overlap). */}
      {showBands &&
        (
          [
            { id: orderedInvs[0], dir: -1 as const },
            { id: orderedInvs[orderedInvs.length - 1], dir: 1 as const },
          ] as const
        ).flatMap(({ id, dir }, edgeIdx) => {
          if (!id) return []
          const col = colByInv.get(id)
          const cScreen = screenByInv.get(id)
          if (!col || !cScreen) return []
          const edgeX = dir < 0 ? cScreen.leftX : cScreen.rightX
          const outerX = dir < 0 ? edgeX - openEndPx : edgeX + openEndPx
          const x0 = Math.min(edgeX, outerX)
          const w = Math.abs(outerX - edgeX)
          if (w <= 0.5) return []
          return col.units.map((u, ui) => {
            const color = formationColorById.get(u.formationId) ?? FALLBACK_COLOR
            const yT = clampY(levelToScreen(col.surfaceElevM - u.topDepthM))
            const yB = clampY(levelToScreen(col.surfaceElevM - u.baseDepthM))
            return (
              <rect
                key={`pf-edge-${edgeIdx}-${ui}`}
                data-testid={`partition-edge-${edgeIdx}-${id}-${ui}`}
                x={x0}
                y={yT}
                width={w}
                height={Math.max(0.5, yB - yT)}
                fill={color}
                fillOpacity={FILL_OPACITY}
                stroke={color}
                strokeOpacity={STROKE_OPACITY}
                strokeWidth={0.5}
              />
            )
          })
        })}
    </g>
  )
}
