/**
 * SVG overlay that renders detected lenses as shapeable wedges (#163f Slice 2).
 *
 * A lens is a litho unit present at one test (bounded by a top + base contact)
 * that pinches out toward another test (where those two boundaries merge into
 * a single contact). This overlay draws, per lens:
 *   - a faint filled wedge between the upper and lower boundary,
 *   - the two boundary polylines (straight / blocky / rounded), and
 *   - draggable ghost control nodes: the user clicks anywhere on a boundary to
 *     add a node and drags it to bend the boundary; existing nodes are
 *     draggable. The shape commits on mouse-up via ``onSaveLensShape``.
 *
 * Geometry lives in section-local world coords ``(along_m, elevation_m)``;
 * the parent threads the warped along↔screen transform + its inverse so render
 * and drag-commit use the SAME mapping. Isolated from CorrelationEdgesOverlay
 * to keep the drag-lock-prone god-component untouched.
 */

import { useEffect, useRef, useState } from 'react'

import type {
  FormationContactResponse,
  LensBoundaryNode,
  LensBoundaryResponse,
  LensRenderStyle,
  LithoContactCorrelationEdge,
  LithoLensListItem,
} from '../../api/client'
import { lensBoundaryPolyline, parseContentKey, resolveLensRoles } from '../../utils/lensBoundary'
import type { PlacedColumn } from './utils'

const BOUNDARY_COLOR = '#10b981' // emerald — matches the correlation-edge colour
const FILL_COLOR = '#38bdf8' // sky — the lens body fill
const FILL_OPACITY = 0.22
const NODE_R = 5
const HIT_STROKE = 12 // transparent click-band width along each boundary

interface WorldPt {
  along_m: number
  elevation_m: number
}

/**
 * Convert a Catmull-Rom spline through ``pts`` to an SVG path ``d`` string.
 * Used for the ``rounded`` render style (no d3 dependency).
 */
function catmullRomPath(pts: readonly { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`
  }
  return d
}

/** Straight / blocky polyline path. */
function polylinePath(pts: readonly { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  return `M ${pts.map(p => `${p.x},${p.y}`).join(' L ')}`
}

interface Props {
  /** Named lens bodies for the active litho model (carry ``content_key``). */
  lenses: readonly LithoLensListItem[]
  /** Stored boundary shape per lens id (style + control nodes). */
  boundariesByLensId: ReadonlyMap<string, LensBoundaryResponse>
  /** Section-filtered litho contacts (for the lens anchor depths). */
  contacts: readonly FormationContactResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation). */
  placedColumns: readonly PlacedColumn[]
  /** Approved correlation edges — drives the pinch/top/base role resolution. */
  contactEdges: readonly LithoContactCorrelationEdge[]
  /** Warped along_m → screen x (same transform the columns use). */
  alongToScreenX: (along: number) => number
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /** Inverse of ``alongToScreenX`` — screen x → along_m (for drag-commit). */
  screenXToAlong: (x: number) => number
  /** Inverse of ``levelToScreen`` — screen y → elevation (for drag-commit). */
  screenToLevel: (y: number) => number
  /** Top / bottom of the plot area in screen px (clamp). */
  plotTop: number
  plotBottom: number
  /**
   * Fired on mouse-up after a node drag/add — the full replacement node set
   * for the lens (both boundaries) + the render style. Absent = read-only.
   */
  onSaveLensShape?: (
    lensId: string,
    upperNodes: LensBoundaryNode[],
    lowerNodes: LensBoundaryNode[],
    style: LensRenderStyle,
  ) => void
}

interface ResolvedLens {
  lensId: string
  style: LensRenderStyle
  upperNodes: LensBoundaryNode[]
  lowerNodes: LensBoundaryNode[]
  /** World anchors: the pinch point + the full-thickness source contacts. */
  pinch: WorldPt
  topSource: WorldPt
  baseSource: WorldPt
}

interface NodeDrag {
  lensId: string
  boundary: 'upper' | 'lower'
  /** Index of the dragged node within that boundary's node array. */
  nodeIndex: number
  /** Working node arrays for both boundaries (the dragged one is live). */
  upperNodes: LensBoundaryNode[]
  lowerNodes: LensBoundaryNode[]
  style: LensRenderStyle
}

/**
 * Render detected lenses as shapeable wedges with draggable boundary nodes.
 */
export default function LensWedgeOverlay({
  lenses,
  boundariesByLensId,
  contacts,
  placedColumns,
  contactEdges,
  alongToScreenX,
  levelToScreen,
  screenXToAlong,
  screenToLevel,
  plotTop,
  plotBottom,
  onSaveLensShape,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<NodeDrag | null>(null)

  // --- world-coordinate lookups (contact id → depth + investigation; ----------
  //     investigation id → along + surface elevation) -------------------------
  const contactById = new Map(contacts.map(c => [c.id, c]))
  const colByInv = new Map<string, { along: number; surfaceElevM: number }>()
  for (const col of placedColumns) {
    const elev = col.proj.item.elevation_m
    if (elev !== null && elev !== undefined) {
      colByInv.set(col.proj.item.id, { along: col.proj.along, surfaceElevM: elev })
    }
  }
  const anchorIdOf = (c: FormationContactResponse): string | null =>
    c.cpt_id ?? c.borehole_id ?? null
  const depthByContact = new Map<string, number>(contacts.map(c => [c.id, c.depth_top_m]))

  function worldPt(contactId: string): WorldPt | null {
    const c = contactById.get(contactId)
    if (!c) return null
    const inv = anchorIdOf(c)
    if (inv === null) return null
    const col = colByInv.get(inv)
    if (!col) return null
    return { along_m: col.along, elevation_m: col.surfaceElevM - c.depth_top_m }
  }

  // Resolve each lens to its three world anchors + stored shape.
  const edgePairs = contactEdges.map(e => ({ a: e.contact_a_id, b: e.contact_b_id }))
  const resolved: ResolvedLens[] = []
  for (const lens of lenses) {
    const ids = parseContentKey(lens.content_key)
    if (ids.length !== 3) continue
    // Only render lenses whose three contacts are all on this section.
    if (!ids.every(id => contactById.has(id))) continue
    const roles = resolveLensRoles(ids, edgePairs, depthByContact)
    if (roles === null) continue
    const pinch = worldPt(roles.targetId)
    const topSource = worldPt(roles.aboveId)
    const baseSource = worldPt(roles.belowId)
    if (!pinch || !topSource || !baseSource) continue
    const boundary = boundariesByLensId.get(lens.id)
    resolved.push({
      lensId: lens.id,
      style: boundary?.render_style ?? 'straight',
      upperNodes: boundary?.upper_nodes ?? [],
      lowerNodes: boundary?.lower_nodes ?? [],
      pinch,
      topSource,
      baseSource,
    })
  }

  // --- drag lifecycle: live preview on move, commit on mouse-up ---------------
  useEffect(() => {
    if (drag === null) return
    function svgPoint(e: MouseEvent): { along: number; elev: number } {
      const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
      const x = e.clientX - (rect?.left ?? 0)
      const y = e.clientY - (rect?.top ?? 0)
      return { along: screenXToAlong(x), elev: screenToLevel(y) }
    }
    function handleMove(e: MouseEvent): void {
      const { along, elev } = svgPoint(e)
      setDrag(d => {
        if (d === null) return d
        const arr = d.boundary === 'upper' ? d.upperNodes : d.lowerNodes
        const next = arr.slice()
        next[d.nodeIndex] = { along_m: along, elevation_m: elev }
        return d.boundary === 'upper'
          ? { ...d, upperNodes: next }
          : { ...d, lowerNodes: next }
      })
    }
    function handleUp(): void {
      setDrag(d => {
        if (d !== null && onSaveLensShape) {
          // Sort each boundary's nodes by along so the server re-index is stable.
          const sortAlong = (ns: LensBoundaryNode[]): LensBoundaryNode[] =>
            ns.slice().sort((p, q) => p.along_m - q.along_m)
          onSaveLensShape(d.lensId, sortAlong(d.upperNodes), sortAlong(d.lowerNodes), d.style)
        }
        return null
      })
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [drag, onSaveLensShape, screenXToAlong, screenToLevel])

  function toScreen(p: WorldPt): { x: number; y: number } {
    return {
      x: alongToScreenX(p.along_m),
      y: Math.max(plotTop, Math.min(plotBottom, levelToScreen(p.elevation_m))),
    }
  }

  function startAddNode(
    lens: ResolvedLens,
    boundary: 'upper' | 'lower',
    e: React.MouseEvent,
  ): void {
    if (!onSaveLensShape) return
    e.stopPropagation()
    e.preventDefault()
    const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
    const along = screenXToAlong(e.clientX - (rect?.left ?? 0))
    const elev = screenToLevel(e.clientY - (rect?.top ?? 0))
    const existing = boundary === 'upper' ? lens.upperNodes : lens.lowerNodes
    const nextNodes = [...existing, { along_m: along, elevation_m: elev }]
    const newIndex = nextNodes.length - 1
    setDrag({
      lensId: lens.lensId,
      boundary,
      nodeIndex: newIndex,
      upperNodes: boundary === 'upper' ? nextNodes : lens.upperNodes,
      lowerNodes: boundary === 'lower' ? nextNodes : lens.lowerNodes,
      style: lens.style,
    })
  }

  function startNodeDrag(
    lens: ResolvedLens,
    boundary: 'upper' | 'lower',
    nodeIndex: number,
    e: React.MouseEvent,
  ): void {
    if (!onSaveLensShape) return
    e.stopPropagation()
    e.preventDefault()
    setDrag({
      lensId: lens.lensId,
      boundary,
      nodeIndex,
      upperNodes: lens.upperNodes.slice(),
      lowerNodes: lens.lowerNodes.slice(),
      style: lens.style,
    })
  }

  return (
    <g ref={rootRef} data-testid="lens-wedge-overlay" style={{ pointerEvents: 'none' }}>
      {resolved.map(lens => {
        // Live-preview the dragged boundary's nodes.
        const upperNodes =
          drag?.lensId === lens.lensId && drag.boundary === 'upper'
            ? drag.upperNodes
            : lens.upperNodes
        const lowerNodes =
          drag?.lensId === lens.lensId && drag.boundary === 'lower'
            ? drag.lowerNodes
            : lens.lowerNodes

        const upperWorld = lensBoundaryPolyline([lens.pinch, lens.topSource], upperNodes, lens.style)
        const lowerWorld = lensBoundaryPolyline(
          [lens.pinch, lens.baseSource],
          lowerNodes,
          lens.style,
        )
        const upperScreen = upperWorld.map(toScreen)
        const lowerScreen = lowerWorld.map(toScreen)
        const pathFn = lens.style === 'rounded' ? catmullRomPath : polylinePath
        // Fill polygon = upper boundary forward + lower boundary reversed.
        const fillPts = [...upperScreen, ...lowerScreen.slice().reverse()]
        const fillD = fillPts.length >= 3 ? `${polylinePath(fillPts)} Z` : ''

        return (
          <g key={`lens-wedge-${lens.lensId}`} data-testid={`lens-wedge-${lens.lensId}`}>
            {fillD && (
              <path d={fillD} fill={FILL_COLOR} fillOpacity={FILL_OPACITY} stroke="none" />
            )}
            {/* Boundary hit-bands: mousedown adds + drags a node (the
                "click the band and drag" gesture). Rendered first/below the
                node circles. */}
            {(['upper', 'lower'] as const).map(b => {
              const screenPts = b === 'upper' ? upperScreen : lowerScreen
              return (
                <path
                  key={`hit-${b}`}
                  data-testid={`lens-boundary-hit-${lens.lensId}-${b}`}
                  d={pathFn(screenPts)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={HIT_STROKE}
                  style={{ pointerEvents: onSaveLensShape ? 'stroke' : 'none', cursor: 'crosshair' }}
                  onMouseDown={e => startAddNode(lens, b, e)}
                />
              )
            })}
            {/* Visible boundary lines. */}
            <path
              data-testid={`lens-boundary-upper-${lens.lensId}`}
              d={pathFn(upperScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            <path
              data-testid={`lens-boundary-lower-${lens.lensId}`}
              d={pathFn(lowerScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            {/* Draggable ghost nodes (hollow circles). */}
            {(['upper', 'lower'] as const).map(b => {
              const nodes = b === 'upper' ? upperNodes : lowerNodes
              return nodes.map((n, i) => {
                const s = toScreen(n)
                return (
                  <circle
                    key={`node-${b}-${i}`}
                    data-testid={`lens-node-${lens.lensId}-${b}-${i}`}
                    cx={s.x}
                    cy={s.y}
                    r={NODE_R}
                    fill="#0f172a"
                    stroke={FILL_COLOR}
                    strokeWidth={2.2}
                    style={{ pointerEvents: onSaveLensShape ? 'auto' : 'none', cursor: 'grab' }}
                    onMouseDown={e => startNodeDrag(lens, b, i, e)}
                  />
                )
              })
            })}
          </g>
        )
      })}
    </g>
  )
}
