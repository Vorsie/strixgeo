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
  /**
   * Right-click a wedge body → dissolve the lens.  Receives the three defining
   * contact ids; the caller deletes the two correlation edges (above↔target,
   * below↔target) so the detector no longer reconstructs the body.  Absent =
   * no delete affordance (read-only).
   */
  onDeleteLens?: (aboveContactId: string, belowContactId: string, targetContactId: string) => void
}

interface ResolvedLens {
  lensId: string
  /** Stable per-wedge id (a lens with bilateral closure renders multiple
   *  wedges — one per pinch-out target). The primary wedge's key equals
   *  the lensId; secondaries append their target contact id. */
  wedgeKey: string
  /** ``true`` for the primary (one-target) wedge that carries the stored
   *  ``LithoLensShapeOrm`` boundary nodes + supports node-drag editing.
   *  Secondary wedges (other pinch-out targets discovered from the edge
   *  graph) render as straight pinches with no user-editable shape — the
   *  underlying data model only stores one boundary set per lens until
   *  two-sided lens authoring lands in Phase 5. */
  isPrimary: boolean
  style: LensRenderStyle
  upperNodes: LensBoundaryNode[]
  lowerNodes: LensBoundaryNode[]
  /** World anchors: the pinch point + the full-thickness source contacts.
   *  ``pinch`` and ``topSource`` / ``baseSource`` carry an ``along_m`` set
   *  to the column's EDGE FACING THE OTHER END (not the column centre),
   *  so the wedge starts flush with the source column and tapers into the
   *  target column's near edge. */
  pinch: WorldPt
  topSource: WorldPt
  baseSource: WorldPt
  /** Defining contact ids — the two correlation edges (above↔target,
   *  below↔target) are what make this body a lens; deleting them dissolves
   *  it (the metadata-only DELETE endpoint would leave the body in the graph
   *  and the detector would re-create it). */
  aboveId: string
  belowId: string
  targetId: string
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
  onDeleteLens,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<NodeDrag | null>(null)

  // --- world-coordinate lookups (contact id → depth + investigation; ----------
  //     investigation id → along + surface elevation + screen width) -----------
  const contactById = new Map(contacts.map(c => [c.id, c]))
  const colByInv = new Map<
    string,
    { along: number; surfaceElevM: number; nudgedX: number; width: number }
  >()
  for (const col of placedColumns) {
    const elev = col.proj.item.elevation_m
    if (elev !== null && elev !== undefined) {
      colByInv.set(col.proj.item.id, {
        along: col.proj.along,
        surfaceElevM: elev,
        nudgedX: col.nudgedX,
        width: col.width,
      })
    }
  }
  const anchorIdOf = (c: FormationContactResponse): string | null =>
    c.cpt_id ?? c.borehole_id ?? null
  const depthByContact = new Map<string, number>(contacts.map(c => [c.id, c.depth_top_m]))
  // Investigation id of each contact (used to detect "same column" + to
  // gate secondary targets to a DIFFERENT investigation than the primary).
  const invByContact = new Map<string, string>()
  for (const c of contacts) {
    const inv = anchorIdOf(c)
    if (inv !== null) invByContact.set(c.id, inv)
  }

  /** Column-CENTRE world point for a contact (legacy behaviour). */
  function worldPtCentre(contactId: string): WorldPt | null {
    const c = contactById.get(contactId)
    if (!c) return null
    const inv = anchorIdOf(c)
    if (inv === null) return null
    const col = colByInv.get(inv)
    if (!col) return null
    return { along_m: col.along, elevation_m: col.surfaceElevM - c.depth_top_m }
  }

  /**
   * Column-EDGE world point — same elevation as ``worldPtCentre`` but with
   * ``along_m`` shifted to the column edge FACING ``otherSideAlong``. The
   * facing edge is the one closer to the other end of the wedge, so the
   * wedge starts flush with the column's edge and tapers from there.
   *
   * The screen-edge X is converted back to world ``along_m`` via the
   * warp-aware inverse so spacing != 100% renders cleanly (dogfeed
   * 2026-05-31 — the lens was floating off the columns at any other
   * spacing before the warp wiring landed).
   */
  function worldPtEdge(contactId: string, otherSideAlong: number): WorldPt | null {
    const c = contactById.get(contactId)
    if (!c) return null
    const inv = anchorIdOf(c)
    if (inv === null) return null
    const col = colByInv.get(inv)
    if (!col) return null
    // ``otherSideAlong > col.along`` → other end is to the RIGHT, so the
    // facing edge is the column's RIGHT edge (positive halfWidth offset).
    const halfW = col.width / 2
    const edgeX = col.nudgedX + (otherSideAlong > col.along ? +halfW : -halfW)
    return { along_m: screenXToAlong(edgeX), elevation_m: col.surfaceElevM - c.depth_top_m }
  }

  // Resolve each lens to its world anchors + every detected pinch-out
  // closure (one primary wedge + optional secondary wedges for bilateral
  // bodies — the new bilateral-closure rule guarantees ≥1 secondary
  // exists for every detected lens).
  const edgePairs = contactEdges.map(e => ({ a: e.contact_a_id, b: e.contact_b_id }))
  // Build per-contact neighbour set (across approved edges) — used to find
  // all common targets of the (above, below) source pair.
  const neighboursByContact = new Map<string, Set<string>>()
  for (const e of contactEdges) {
    if (!neighboursByContact.has(e.contact_a_id)) {
      neighboursByContact.set(e.contact_a_id, new Set())
    }
    if (!neighboursByContact.has(e.contact_b_id)) {
      neighboursByContact.set(e.contact_b_id, new Set())
    }
    neighboursByContact.get(e.contact_a_id)!.add(e.contact_b_id)
    neighboursByContact.get(e.contact_b_id)!.add(e.contact_a_id)
  }
  const resolved: ResolvedLens[] = []
  for (const lens of lenses) {
    const ids = parseContentKey(lens.content_key)
    if (ids.length !== 3) continue
    // Only render lenses whose three contacts are all on this section.
    if (!ids.every(id => contactById.has(id))) continue
    const roles = resolveLensRoles(ids, edgePairs, depthByContact)
    if (roles === null) continue

    const sourceInvId = invByContact.get(roles.aboveId)
    const primaryTargetInv = invByContact.get(roles.targetId)
    if (sourceInvId === undefined || primaryTargetInv === undefined) continue
    const sourceCol = colByInv.get(sourceInvId)
    if (!sourceCol) continue

    // Common targets of (above, below) — every contact X where BOTH the
    // above and below source contacts have an approved edge to X. Each
    // such X on a DIFFERENT investigation than the source is a pinch-out
    // closure of this body.
    const aboveNeigh = neighboursByContact.get(roles.aboveId) ?? new Set<string>()
    const belowNeigh = neighboursByContact.get(roles.belowId) ?? new Set<string>()
    const commonTargets: string[] = []
    for (const candidate of aboveNeigh) {
      if (!belowNeigh.has(candidate)) continue
      const candInv = invByContact.get(candidate)
      if (candInv === undefined || candInv === sourceInvId) continue
      commonTargets.push(candidate)
    }
    // Stable, deterministic order — primary first, secondaries by id.
    const orderedTargets = [
      roles.targetId,
      ...commonTargets
        .filter(t => t !== roles.targetId)
        .sort(),
    ]

    const boundary = boundariesByLensId.get(lens.id)
    const style: LensRenderStyle = boundary?.render_style ?? 'straight'

    for (const targetId of orderedTargets) {
      const isPrimary = targetId === roles.targetId
      const targetCol = colByInv.get(invByContact.get(targetId)!)
      if (!targetCol) continue
      // Anchor the source endpoints at the column EDGE facing THIS
      // target (each secondary wedge faces its own target's side).
      const topSource = worldPtEdge(roles.aboveId, targetCol.along)
      const baseSource = worldPtEdge(roles.belowId, targetCol.along)
      // Anchor the pinch at the target column's edge facing the source.
      const pinch = worldPtEdge(targetId, sourceCol.along)
      if (!topSource || !baseSource || !pinch) continue
      resolved.push({
        lensId: lens.id,
        wedgeKey: isPrimary ? lens.id : `${lens.id}::${targetId}`,
        isPrimary,
        style,
        // Stored shape nodes apply to the PRIMARY wedge only — the data
        // model carries one boundary set per lens.  Secondary wedges
        // render as straight pinches until two-sided lens authoring
        // lands in Phase 5.
        upperNodes: isPrimary ? (boundary?.upper_nodes ?? []) : [],
        lowerNodes: isPrimary ? (boundary?.lower_nodes ?? []) : [],
        pinch,
        topSource,
        baseSource,
        aboveId: roles.aboveId,
        belowId: roles.belowId,
        targetId,
      })
    }
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
        // Live-preview the dragged boundary's nodes (drag is gated to
        // primary wedges, so the match also requires ``isPrimary``).
        const dragMatches = drag?.lensId === lens.lensId && lens.isPrimary
        const upperNodes =
          dragMatches && drag!.boundary === 'upper' ? drag!.upperNodes : lens.upperNodes
        const lowerNodes =
          dragMatches && drag!.boundary === 'lower' ? drag!.lowerNodes : lens.lowerNodes

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

        // Secondary wedges (bilateral closure render) don't accept node-
        // drag editing — the data model only stores one boundary set per
        // lens.  They still support right-click → dissolve so the gesture
        // is symmetric on both sides of the body.
        const canEditShape = lens.isPrimary && Boolean(onSaveLensShape)

        return (
          <g key={`lens-wedge-${lens.wedgeKey}`} data-testid={`lens-wedge-${lens.wedgeKey}`}>
            {fillD && (
              <path
                data-testid={`lens-wedge-fill-${lens.wedgeKey}`}
                d={fillD}
                fill={FILL_COLOR}
                fillOpacity={FILL_OPACITY}
                stroke="none"
                style={{
                  pointerEvents: onDeleteLens ? 'auto' : 'none',
                  cursor: onDeleteLens ? 'context-menu' : undefined,
                }}
                onContextMenu={
                  onDeleteLens
                    ? e => {
                        e.preventDefault()
                        e.stopPropagation()
                        onDeleteLens(lens.aboveId, lens.belowId, lens.targetId)
                      }
                    : undefined
                }
              />
            )}
            {/* Boundary hit-bands: mousedown adds + drags a node (the
                "click the band and drag" gesture).  Primary wedge only —
                secondary wedges render as fixed straight pinches. */}
            {canEditShape && (['upper', 'lower'] as const).map(b => {
              const screenPts = b === 'upper' ? upperScreen : lowerScreen
              return (
                <path
                  key={`hit-${b}`}
                  data-testid={`lens-boundary-hit-${lens.wedgeKey}-${b}`}
                  d={pathFn(screenPts)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={HIT_STROKE}
                  style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
                  onMouseDown={e => startAddNode(lens, b, e)}
                />
              )
            })}
            {/* Visible boundary lines. */}
            <path
              data-testid={`lens-boundary-upper-${lens.wedgeKey}`}
              d={pathFn(upperScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            <path
              data-testid={`lens-boundary-lower-${lens.wedgeKey}`}
              d={pathFn(lowerScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            {/* Draggable ghost nodes (hollow circles).  Primary wedge only. */}
            {canEditShape && (['upper', 'lower'] as const).map(b => {
              const nodes = b === 'upper' ? upperNodes : lowerNodes
              return nodes.map((n, i) => {
                const s = toScreen(n)
                return (
                  <circle
                    key={`node-${b}-${i}`}
                    data-testid={`lens-node-${lens.wedgeKey}-${b}-${i}`}
                    cx={s.x}
                    cy={s.y}
                    r={NODE_R}
                    fill="#0f172a"
                    stroke={FILL_COLOR}
                    strokeWidth={2.2}
                    style={{ pointerEvents: 'auto', cursor: 'grab' }}
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
