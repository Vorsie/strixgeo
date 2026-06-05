/**
 * SVG overlay that fills the section CONTINUOUSLY between adjacent columns via
 * the depth morph (``utils/morphFill``) — the "draw between the correlation
 * bands from test to test, then cut out the pinch-outs" render
 * (owner directive 2026-06-04).
 *
 * For every adjacent column pair it builds each column's gap-free unit stack
 * and paints one shape per body: a body matched on both columns fills a
 * continuous BAND; a left-only body (a lens) is a PINCH triangle to a single
 * apex. The gap tiles surface-to-floor with NO dark holes.
 *
 * Shapeable pinch-outs (owner directive 2026-06-05): each pinch carries a
 * DRAGGABLE apex handle. Dragging it moves where the lens wedges out; on
 * mouse-up the apex is saved as the body's boundary shape (``onSaveBoundary``),
 * and the fill re-reads it from ``boundariesByBodyId`` so the wedge follows the
 * form. The lens has no extent, so ``BodyExtentOverlay`` ignores it — the morph
 * is the sole owner of the lens fill + shaping.
 *
 * Replaces ``BodyBandOverlay`` (which only painted member-to-member trapezoids
 * and left a triangular hole at every pinch-out). Rendered BENEATH
 * ``BodyExtentOverlay`` so a user-CLAIMED cap still paints on top as an override.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  LithoLayerResponse,
} from '../../api/client'
import { computeMorphFill, type MorphColumn, type MorphUnit } from '../../utils/morphFill'
import type { PlacedColumn } from './utils'

const FILL_OPACITY = 0.62
// A pinch (lens) is drawn a touch more solid so it reads as a unit CUT OUT of
// the continuous matrix it sits on top of, not a faint wash over it.
const PINCH_OPACITY = 0.82
const STROKE_OPACITY = 0.5
const FALLBACK_COLOR = '#888888'
// Apex drag-handle radius + its transparent hit halo.
const APEX_R = 5
const APEX_HIT_R = 11
// Length (screen px) the first/last column's units continue OFF-SECTION as a
// parallel stub, so the section's open ends are filled gap-free (every unit
// continues, not only the bodies that carry an explicit 'open' extent).
const EDGE_STUB_PX = 64

export interface Props {
  /** Accepted litho layers carrying ``body_id`` + the unit's depth interval. */
  lithoLayers: readonly LithoLayerResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation + screen x/width). */
  placedColumns: readonly PlacedColumn[]
  /** formation_id → lithology colour for the fill. */
  formationColorById: ReadonlyMap<string, string>
  /** formation_id → display label (e.g. "Sa1") for the per-region label. */
  formationLabelById?: ReadonlyMap<string, string>
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /**
   * When true, paint the continuous matrix BAND fill (matched bodies) + edge
   * stubs + labels. The pinch-out wedges + their draggable apex handles render
   * REGARDLESS, so the user can shape pinch-outs on the clean (bands-off) view
   * and then turn the fill on (owner directive 2026-06-05: "fix the shape of the
   * pinchouts and then fill it").
   */
  showBands: boolean
  /** Top / bottom of the plot area in screen px (clamp). */
  plotTop: number
  plotBottom: number
  /** Left / right of the plot area in screen px — the first/last column's units
   *  fill OUT to these so the section's open ends reach the edge (no gap). When
   *  absent the open-end stub falls back to a fixed length. */
  plotLeft?: number
  plotRight?: number
  /** Stored per-body boundary shapes — a pinch reads its apex override here. */
  boundariesByBodyId?: ReadonlyMap<string, BodyBoundaryResponse>
  /** Warped along_m → screen x (same transform the columns + caps use). */
  alongToScreenX?: (along: number) => number
  /** Inverse of ``alongToScreenX`` (drag-commit). */
  screenXToAlong?: (x: number) => number
  /** Inverse of ``levelToScreen`` (drag-commit). */
  screenToLevel?: (y: number) => number
  /** Persist a dragged apex as the body's boundary shape. Absent = read-only. */
  onSaveBoundary?: (
    bodyId: string,
    upperNodes: BodyBoundaryNode[],
    lowerNodes: BodyBoundaryNode[],
    style: 'straight' | 'blocky' | 'rounded',
  ) => void
  /** Bodies on the model — used to resolve a right-clicked pinch to its body. */
  bodies?: readonly BodyListItem[]
  /** Right-click a pinch (lens) → open the body context menu (Dissolve / Name). */
  onBodyContextMenu?: (body: BodyListItem, svgX: number, svgY: number) => void
}

interface ColumnScreen {
  rightX: number
  leftX: number
  along: number
}

interface ApexDrag {
  bodyId: string
  /** Which wedge side is being dragged ('left' = right-wedging, 'right' = left). */
  side: 'left' | 'right'
  /** Live apex position in screen px while dragging. */
  x: number
  y: number
}

/** Render the continuous morph fill + draggable pinch apexes. */
export default function MorphFillOverlay({
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
  boundariesByBodyId,
  alongToScreenX,
  screenXToAlong,
  screenToLevel,
  onSaveBoundary,
  bodies,
  onBodyContextMenu,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<ApexDrag | null>(null)
  const bodyById = useMemo(() => new Map((bodies ?? []).map((b) => [b.id, b])), [bodies])

  const { orderedInvs, morphColByInv, screenByInv } = useMemo(() => {
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
      screen.set(id, { rightX: col.nudgedX + halfW, leftX: col.nudgedX - halfW, along: col.proj.along })
      ordered.push(id)
    }
    ordered.sort((a, b) => (screen.get(a)?.along ?? 0) - (screen.get(b)?.along ?? 0))
    return { orderedInvs: ordered, morphColByInv: morphCols, screenByInv: screen }
  }, [lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  // Open-end stub length: a fixed ~5 m of section, not all the way to the plot
  // edge (dogfeed 2026-06-05 "don't draw the open ends all the way to the end
  // of the screen, just make a 5 metres or so"). Derived from the section's
  // horizontal scale so it stays 5 m through zoom; clamped so it never vanishes.
  const OPEN_END_M = 5
  const openEndPx = alongToScreenX
    ? Math.max(8, OPEN_END_M * Math.abs(alongToScreenX(1) - alongToScreenX(0)))
    : EDGE_STUB_PX

  // Window drag listeners — live-update the apex, commit + save on mouse-up.
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
        // upper_nodes hold the RIGHT-wedge apex, lower_nodes the LEFT-wedge apex,
        // so a symmetric (bow-tie) lens carries an independent shape per side.
        // The dragged side is written; the other side is preserved.
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

  // A body that spans several gaps must be labelled ONCE, not once per gap
  // (dogfeed 2026-06-05 "double label"). Tracked across the whole render pass;
  // re-seeded on every render (StrictMode re-invokes the component cleanly).
  const labelledBodies = new Set<string>()

  return (
    <g ref={rootRef} data-testid="morph-fill-overlay" style={{ pointerEvents: 'none' }}>
      {orderedInvs.slice(0, -1).flatMap((leftId, gapIndex) => {
        const rightId = orderedInvs[gapIndex + 1]
        const left = morphColByInv.get(leftId)
        const right = morphColByInv.get(rightId)
        const lScreen = screenByInv.get(leftId)
        const rScreen = screenByInv.get(rightId)
        if (!left || !right || !lScreen || !rScreen) return []
        const leftX = lScreen.rightX
        const rightX = rScreen.leftX
        if (rightX <= leftX) return []

        const quads = computeMorphFill(left, right)
        return quads.flatMap((q, i) => {
          const color = formationColorById.get(q.formationId) ?? FALLBACK_COLOR
          const lTop = clampY(levelToScreen(q.leftTopElev))
          const lBase = clampY(levelToScreen(q.leftBaseElev))

          if (q.kind === 'band') {
            // Matrix band fill is the "Fill bands" layer — skip it (and its
            // label) when off, so the bands-off view shows only the shapeable
            // pinch-out wedges.
            if (!showBands) return []
            const rTop = clampY(levelToScreen(q.rightTopElev))
            const rBase = clampY(levelToScreen(q.rightBaseElev))
            const d =
              `M ${leftX.toFixed(2)},${lTop.toFixed(2)} ` +
              `L ${rightX.toFixed(2)},${rTop.toFixed(2)} ` +
              `L ${rightX.toFixed(2)},${rBase.toFixed(2)} ` +
              `L ${leftX.toFixed(2)},${lBase.toFixed(2)} Z`
            const bandEls: JSX.Element[] = [
              <path
                key={`morph-${leftId}-${i}`}
                data-testid={`morph-fill-${leftId}-${i}`}
                d={d}
                fill={color}
                fillOpacity={FILL_OPACITY}
                stroke={color}
                strokeOpacity={STROKE_OPACITY}
                strokeWidth={0.75}
              />,
            ]
            // Per-region label (lithology + rank, e.g. "Sa1") at the band centre
            // — only when the band is tall enough to carry it legibly.
            const bandLabel = formationLabelById?.get(q.formationId)
            const bandMinH = Math.min(Math.abs(lBase - lTop), Math.abs(rBase - rTop))
            const alreadyLabelled = q.bodyId ? labelledBodies.has(q.bodyId) : false
            // Clamp the label to the VISIBLE part of the band so it stays on
            // screen when zoomed onto a single test (dogfeed 2026-06-05); dedupe
            // by first VISIBLE gap, so the surviving label is always one that
            // can actually be seen rather than one parked in an off-screen gap.
            const visL = plotLeft != null ? Math.max(leftX, plotLeft) : leftX
            const visR = plotRight != null ? Math.min(rightX, plotRight) : rightX
            const horizVisible = visR - visL > 4
            if (bandLabel && bandMinH > 14 && !alreadyLabelled && horizVisible) {
              if (q.bodyId) labelledBodies.add(q.bodyId)
              bandEls.push(
                <text
                  key={`morph-label-${leftId}-${i}`}
                  x={(visL + visR) / 2}
                  y={(lTop + lBase + rTop + rBase) / 4}
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
                  {bandLabel}
                </text>,
              )
            }
            return bandEls
          }

          // --- pinch: triangle to a draggable apex --------------------------
          // sourceSide 'left' = body on the left column, wedges RIGHT (apex near
          // the right column); 'right' = body on the right column, wedges LEFT.
          const sourceLeft = q.sourceSide !== 'right'
          const sideKey: 'left' | 'right' = sourceLeft ? 'left' : 'right'
          const srcX = sourceLeft ? leftX : rightX
          const srcTop = clampY(levelToScreen(sourceLeft ? q.leftTopElev : q.rightTopElev))
          const srcBase = clampY(levelToScreen(sourceLeft ? q.leftBaseElev : q.rightBaseElev))
          // Apex: live drag > stored per-side override > default convergence.
          // upper_nodes hold the right-wedge apex, lower_nodes the left-wedge one.
          const boundary = q.bodyId ? boundariesByBodyId?.get(q.bodyId) : undefined
          const stored = (sourceLeft ? boundary?.upper_nodes : boundary?.lower_nodes)?.[0]
          let apexX = sourceLeft ? rightX : leftX
          let apexY = clampY(levelToScreen(sourceLeft ? q.rightTopElev : q.leftTopElev))
          if (stored && alongToScreenX) {
            apexX = alongToScreenX(stored.along_m)
            apexY = clampY(levelToScreen(stored.elevation_m))
          }
          if (drag && drag.bodyId === q.bodyId && drag.side === sideKey) {
            apexX = drag.x
            apexY = drag.y
          }
          const d =
            `M ${srcX.toFixed(2)},${srcTop.toFixed(2)} ` +
            `L ${apexX.toFixed(2)},${apexY.toFixed(2)} ` +
            `L ${srcX.toFixed(2)},${srcBase.toFixed(2)} Z`
          const canDrag = Boolean(q.bodyId && onSaveBoundary)
          return [
            <path
              key={`morph-${leftId}-${i}`}
              data-testid={`morph-fill-${leftId}-${i}`}
              d={d}
              fill={color}
              fillOpacity={PINCH_OPACITY}
              stroke={color}
              strokeOpacity={STROKE_OPACITY}
              strokeWidth={0.75}
              style={
                onBodyContextMenu && q.bodyId
                  ? { pointerEvents: 'auto', cursor: 'context-menu' }
                  : undefined
              }
              onContextMenu={
                onBodyContextMenu && q.bodyId
                  ? (e) => {
                      const body = bodyById.get(q.bodyId as string)
                      if (!body) return
                      e.preventDefault()
                      e.stopPropagation()
                      const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                      onBodyContextMenu(
                        body,
                        e.clientX - (rect?.left ?? 0),
                        e.clientY - (rect?.top ?? 0),
                      )
                    }
                  : undefined
              }
            />,
            canDrag ? (
              <g key={`morph-apex-${leftId}-${i}`}>
                {/* Transparent hit halo so the small handle is easy to grab. */}
                <circle
                  cx={apexX}
                  cy={apexY}
                  r={APEX_HIT_R}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'grab' }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDrag({ bodyId: q.bodyId as string, side: sideKey, x: apexX, y: apexY })
                  }}
                />
                <circle
                  data-testid={`morph-apex-${q.bodyId}-${sideKey}`}
                  cx={apexX}
                  cy={apexY}
                  r={APEX_R}
                  fill="#f59e0b"
                  stroke="#0f172a"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ) : null,
          ]
        })
      })}

      {/* Open-end stubs: every unit of the first / last column continues
          OFF-SECTION as a parallel band, so the section edges fill gap-free
          (dogfeed 2026-06-05 "no gaps in the open ends"). Rendered in BOTH
          views so the engineer can track where the open ends sit while shaping
          (dogfeed 2026-06-05 "where did the open ends go?"): full-width fill
          when Fill bands is on, a short marker-stub when it is off. */}
      {(
          [
            { id: orderedInvs[0], dir: -1 },
            { id: orderedInvs[orderedInvs.length - 1], dir: 1 },
          ] as const
        ).flatMap(({ id, dir }, edgeIdx) => {
        if (!id) return []
        const colMorph = morphColByInv.get(id)
        const colScreen = screenByInv.get(id)
        if (!colMorph || !colScreen) return []
        const edgeX = dir < 0 ? colScreen.leftX : colScreen.rightX
        // Bands ON: fill OUT to the plot edge ("plot whole width") when known.
        // Bands OFF: a short fixed stub — a marker, not a fill — so the shape
        // view stays uncluttered but the open ends are still visible.
        // ~5 m in both views (full-opacity fill when bands on, faded marker
        // when off) — never the full plot width.
        const outerX = dir < 0 ? edgeX - openEndPx : edgeX + openEndPx
        const x0 = Math.min(edgeX, outerX)
        const w = Math.abs(outerX - edgeX)
        if (w <= 0.5) return []
        // Group the edge column's units into per-BODY envelopes so a lithology
        // split by a lens fills as ONE open-end stub (the sand), with the lens
        // painted over it — largest envelope first (owner directive 2026-06-05:
        // "Sa4 and the sand below Si3 are one body → one open end").
        const byBody = new Map<string, { formationId: string; top: number; base: number }>()
        colMorph.units.forEach((u, ui) => {
          const k = u.bodyId ?? `__u${ui}`
          const e = byBody.get(k)
          if (e) {
            e.top = Math.min(e.top, u.topDepthM)
            e.base = Math.max(e.base, u.baseDepthM)
          } else {
            byBody.set(k, { formationId: u.formationId, top: u.topDepthM, base: u.baseDepthM })
          }
        })
        const envs = [...byBody.values()].sort((a, b) => b.base - b.top - (a.base - a.top))
        return envs.map((e, ei) => {
          const color = formationColorById.get(e.formationId) ?? FALLBACK_COLOR
          const yT = clampY(levelToScreen(colMorph.surfaceElevM - e.top))
          const yB = clampY(levelToScreen(colMorph.surfaceElevM - e.base))
          return (
            <rect
              key={`morph-edge-${edgeIdx}-${ei}`}
              data-testid={`morph-edge-${edgeIdx}-${id}-${ei}`}
              x={x0}
              y={yT}
              width={w}
              height={Math.max(0.5, yB - yT)}
              fill={color}
              fillOpacity={showBands ? FILL_OPACITY : FILL_OPACITY * 0.45}
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
