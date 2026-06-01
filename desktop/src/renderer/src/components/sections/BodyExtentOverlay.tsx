/**
 * SVG overlay that renders detected bodies as shapeable wedges, open bands,
 * or dip-extrapolated wedges based on per-side extent metadata (#163f Slice 6).
 *
 * Replaces LensWedgeOverlay. Each body carries four ``extent_<side>_*``
 * fields that control how each lateral side is drawn:
 *
 *   ``to_target``         — wedge tapering to a known target contact's column.
 *   ``pinch_out_halfway`` — wedge tapering to the midpoint between source and
 *                           a neighbour investigation.
 *   ``extrapolated``      — wedge to a dip-extrapolated endpoint + dip-arrow
 *                           glyph.
 *   ``open``              — parallel-sided band from the source column's edge
 *                           to the section endpoint (no taper).
 *   null                  — render nothing on that side.
 *
 * The render logic is bilateral: both sides share the source investigation's
 * anchor contacts, but taper independently to their respective endpoints.
 * Boundary node dragging and right-click dissolve are carried forward from
 * the previous LensWedgeOverlay; node drag applies to the primary boundary
 * set (stored per body) and is limited to wedge-kind sides.
 */

import { useEffect, useRef, useState } from 'react'

import type {
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  BodyRenderStyle,
  FormationContactResponse,
  LithoContactCorrelationEdge,
  PinchOutCandidate,
} from '../../api/client'
import {
  bodyBoundaryPolyline,
  isExtentKind,
  parseContentKey,
  resolveLensRoles,
} from '../../utils/bodyExtent'
import { computeDipExtrapolationEndpoint } from '../../utils/dipExtrapolationFrontend'
import type { PlacedColumn } from './utils'

const BOUNDARY_COLOR = '#10b981' // emerald — matches correlation-edge colour
const FILL_COLOR = '#38bdf8' // sky — body fill
const FILL_OPACITY = 0.22
const NODE_R = 5
const HIT_STROKE = 12 // transparent click-band width along each boundary

// Ghost candidate styling — amber dashed wedge, 30% fill opacity.
const GHOST_STROKE_COLOR = '#f59e0b' // amber-400
const GHOST_FILL_OPACITY = 0.18
const GHOST_STROKE_DASH = '6 3'

// Arrow-head half-angle in degrees; drawn at the dip-extrapolation endpoint.
const DIP_ARROW_SIZE = 7

interface WorldPt {
  along_m: number
  elevation_m: number
}

/**
 * Convert a Catmull-Rom spline through ``pts`` to an SVG path ``d`` string.
 * Used for the ``rounded`` render style.
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

/** Build an SVG triangle marker pointing in the direction of ``dx`` (left=-1, right=+1). */
function dipArrowPath(tip: { x: number; y: number }, directionSign: number): string {
  const size = DIP_ARROW_SIZE
  const bx = tip.x - directionSign * size
  return [
    `M ${tip.x},${tip.y}`,
    `L ${bx},${tip.y - size * 0.6}`,
    `L ${bx},${tip.y + size * 0.6}`,
    'Z',
  ].join(' ')
}

export interface Props {
  /** Body list for the active litho model (carry ``extent_*`` fields). */
  bodies: readonly BodyListItem[]
  /** Stored boundary shape per body id (style + control nodes). */
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse>
  /** Section-filtered litho contacts (for anchor depths). */
  contacts: readonly FormationContactResponse[]
  /** Placed columns (carry ``proj.along`` + surface elevation). */
  placedColumns: readonly PlacedColumn[]
  /** Approved correlation edges — drives the pinch/top/base role resolution
   *  for legacy ``content_key``-based lenses. */
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
   * Screen x of the section's left end — used to compute the ``open``
   * extent endpoint on the left side.
   */
  sectionStartScreenX: number
  /**
   * Screen x of the section's right end — used to compute the ``open``
   * extent endpoint on the right side.
   */
  sectionEndScreenX: number
  /**
   * Fired on mouse-up after a node drag/add — the full replacement node set
   * for the body (both boundaries) + the render style. Absent = read-only.
   */
  onSaveLensShape?: (
    bodyId: string,
    upperNodes: BodyBoundaryNode[],
    lowerNodes: BodyBoundaryNode[],
    style: BodyRenderStyle,
  ) => void
  /**
   * Right-click a wedge body → dissolve the lens. Receives the three defining
   * contact ids; the caller deletes the two correlation edges so the detector
   * no longer reconstructs the body. Absent = no delete affordance.
   *
   * @deprecated Use ``onBodyContextMenu`` instead. Kept for legacy
   *   ``content_key``-based bodies until all callers migrate.
   */
  onDeleteLens?: (aboveContactId: string, belowContactId: string, targetContactId: string) => void
  /**
   * Right-click a body wedge or fill area → open the body context menu.
   * Receives the full ``BodyListItem`` plus SVG-canvas screen coordinates of
   * the pointer (relative to the SVG element, for the ContextMenu anchor).
   * When present, takes precedence over ``onDeleteLens`` for all bodies that
   * have a matching ``BodyListItem`` in the ``bodies`` prop.
   */
  onBodyContextMenu?: (body: BodyListItem, svgX: number, svgY: number) => void
  /**
   * Auto-suggest pinch-out candidates (from the "Suggest pinch-outs" toolbar
   * verb). Each candidate is rendered as a dashed amber ghost wedge at the
   * halfway midpoint between the source and suggested-neighbour columns.
   * Absent or empty = no ghost overlay.
   */
  ghostCandidates?: readonly PinchOutCandidate[]
  /**
   * Fired when the user clicks a ghost candidate wedge — signals that the
   * user accepts this suggested pinch-out; the parent should call
   * ``claimBodyExtent`` with the candidate's fields.
   */
  onClaimGhostCandidate?: (candidate: PinchOutCandidate) => void
}

// ---------------------------------------------------------------------------
// Resolved body descriptor (output of the pre-render resolve pass)
// ---------------------------------------------------------------------------

/** One rendered wedge or band. A bilateral body can produce two of these. */
interface ResolvedBody {
  bodyId: string
  wedgeKey: string
  /** True for the primary wedge (the one that carries stored boundary nodes). */
  isPrimary: boolean
  style: BodyRenderStyle
  upperNodes: BodyBoundaryNode[]
  lowerNodes: BodyBoundaryNode[]
  /** Source column's upper-boundary endpoint (facing this side). */
  topSource: WorldPt
  /** Source column's lower-boundary endpoint (facing this side). */
  baseSource: WorldPt
  /** Far endpoint — the "pinch" for wedge-kinds or the section edge for ``open``. */
  farPoint: WorldPt
  /** Whether the far side tapers to a single point (wedge) or remains open (band). */
  isOpen: boolean
  /** True if the far point came from dip-extrapolation → render dip-arrow glyph. */
  isExtrapolated: boolean
  /** Direction sign (+1 right, -1 left) for the dip-arrow glyph. */
  extrapolationDirectionSign: number
  /** Defining contact ids for the right-click dissolve gesture (lens bodies only). */
  aboveId: string
  belowId: string
  targetId: string
}

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

interface NodeDrag {
  bodyId: string
  boundary: 'upper' | 'lower'
  nodeIndex: number
  upperNodes: BodyBoundaryNode[]
  lowerNodes: BodyBoundaryNode[]
  style: BodyRenderStyle
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render detected bodies as shapeable wedges, open bands, or dip-extrapolated
 * wedges with draggable boundary nodes.
 */
export default function BodyExtentOverlay({
  bodies,
  boundariesByBodyId,
  contacts,
  placedColumns,
  contactEdges,
  alongToScreenX,
  levelToScreen,
  screenXToAlong,
  screenToLevel,
  plotTop,
  plotBottom,
  sectionStartScreenX,
  sectionEndScreenX,
  onSaveLensShape,
  onDeleteLens,
  onBodyContextMenu,
  ghostCandidates,
  onClaimGhostCandidate,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<NodeDrag | null>(null)

  // --- world-coordinate lookup maps ----------------------------------------
  const bodyById = new Map(bodies.map(b => [b.id, b]))
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

  const invByContact = new Map<string, string>()
  for (const c of contacts) {
    const inv = anchorIdOf(c)
    if (inv !== null) invByContact.set(c.id, inv)
  }

  /**
   * Column-edge world point — elevation is derived from the contact's
   * depth below the surface; along_m is the column's EDGE FACING
   * ``otherSideAlong`` (warp-aware inverse so spacing != 100% works).
   */
  function worldPtEdge(contactId: string, otherSideAlong: number): WorldPt | null {
    const c = contactById.get(contactId)
    if (!c) return null
    const inv = anchorIdOf(c)
    if (inv === null) return null
    const col = colByInv.get(inv)
    if (!col) return null
    const halfW = col.width / 2
    // The facing edge is the one closer to the other side of the wedge.
    const edgeX = col.nudgedX + (otherSideAlong > col.along ? +halfW : -halfW)
    return { along_m: screenXToAlong(edgeX), elevation_m: col.surfaceElevM - c.depth_top_m }
  }

  /**
   * Column-edge world point for the source side facing a given neighbour
   * along, returning both the top-contact and base-contact elevations.
   */
  function sourcePair(
    aboveContactId: string,
    belowContactId: string,
    towardAlong: number,
  ): { topSource: WorldPt; baseSource: WorldPt } | null {
    const topSource = worldPtEdge(aboveContactId, towardAlong)
    const baseSource = worldPtEdge(belowContactId, towardAlong)
    if (!topSource || !baseSource) return null
    return { topSource, baseSource }
  }

  // --- Build per-body neighbour map (approved edges) -----------------------
  const edgePairs = contactEdges.map(e => ({ a: e.contact_a_id, b: e.contact_b_id }))
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

  // --- Resolve each body to its rendered wedge descriptors -----------------
  const resolved: ResolvedBody[] = []

  for (const body of bodies) {
    const sourceCol = colByInv.get(body.source_investigation_id)
    if (!sourceCol) continue // source not on this section

    const boundary = boundariesByBodyId.get(body.id)
    const style: BodyRenderStyle = boundary?.render_style ?? 'straight'
    const storedUpperNodes = boundary?.upper_nodes ?? []
    const storedLowerNodes = boundary?.lower_nodes ?? []

    // Helper to resolve one side (left or right).
    // ``col`` is the resolved source column (already validated non-null by the caller).
    function resolveSide(
      side: 'left' | 'right',
      col: { along: number; surfaceElevM: number; nudgedX: number; width: number },
      aboveContactId: string | null,
      belowContactId: string | null,
      extentKindRaw: string | null,
      targetContactId: string | null,
      neighbourInvId: string | null,
      isPrimary: boolean,
    ): ResolvedBody | null {
      if (!isExtentKind(extentKindRaw)) return null
      if (!aboveContactId || !belowContactId) return null

      const aboveContact = contactById.get(aboveContactId)
      const belowContact = contactById.get(belowContactId)
      if (!aboveContact || !belowContact) return null

      // Determine the along direction for this side.
      // "left" means the endpoint is to the LEFT of the source column;
      // "right" means to the RIGHT. The neighbour/target column gives us
      // the definitive along; for ``open`` we use the section endpoint.
      let towardAlong: number

      switch (extentKindRaw) {
        case 'to_target': {
          if (!targetContactId) return null
          const targetInv = invByContact.get(targetContactId)
          if (!targetInv) return null
          const targetCol = colByInv.get(targetInv)
          if (!targetCol) return null
          towardAlong = targetCol.along
          break
        }
        case 'pinch_out_halfway': {
          if (!neighbourInvId) return null
          const neighbourCol = colByInv.get(neighbourInvId)
          if (!neighbourCol) return null
          towardAlong = neighbourCol.along
          break
        }
        case 'extrapolated': {
          if (!neighbourInvId) return null
          const neighbourCol = colByInv.get(neighbourInvId)
          if (!neighbourCol) return null
          towardAlong = neighbourCol.along
          break
        }
        case 'open': {
          // For open extents, the endpoint is at the section boundary.
          // Convert section-boundary screen X back to along via the
          // warp-aware inverse, choosing the correct end.
          towardAlong = side === 'left'
            ? screenXToAlong(sectionStartScreenX)
            : screenXToAlong(sectionEndScreenX)
          break
        }
        default:
          return null
      }

      const pair = sourcePair(aboveContactId, belowContactId, towardAlong)
      if (!pair) return null
      const { topSource, baseSource } = pair

      // Compute the far endpoint based on kind.
      let farPoint: WorldPt
      let isOpen = false
      let isExtrapolated = false

      switch (extentKindRaw) {
        case 'to_target': {
          const targetInv = invByContact.get(targetContactId!)!
          // Pinch at the target column's edge facing the source.
          const pinch = worldPtEdge(targetContactId!, col.along)
          if (!pinch) return null
          farPoint = pinch
          break
        }
        case 'pinch_out_halfway': {
          const neighbourCol = colByInv.get(neighbourInvId!)!
          const midAlong = (col.along + neighbourCol.along) / 2
          const midElev = (topSource.elevation_m + baseSource.elevation_m) / 2
          farPoint = { along_m: midAlong, elevation_m: midElev }
          break
        }
        case 'extrapolated': {
          const neighbourCol = colByInv.get(neighbourInvId!)!
          const result = computeDipExtrapolationEndpoint({
            sourceAboveAlong: col.along,
            sourceAboveElevation: topSource.elevation_m,
            sourceBelowAlong: col.along,
            sourceBelowElevation: baseSource.elevation_m,
            neighbourAlong: neighbourCol.along,
            neighbourSurfaceElevation: neighbourCol.surfaceElevM,
          })
          if (result === null) {
            // Degenerate — fall back to halfway like pinch_out_halfway.
            console.warn(
              `[BodyExtentOverlay] Dip extrapolation degenerate for body ${body.id} ` +
              `side ${side} — falling back to halfway midpoint.`,
            )
            const midAlong = (col.along + neighbourCol.along) / 2
            const midElev = (topSource.elevation_m + baseSource.elevation_m) / 2
            farPoint = { along_m: midAlong, elevation_m: midElev }
          } else {
            farPoint = { along_m: result.along, elevation_m: result.elevation }
            isExtrapolated = true
          }
          break
        }
        case 'open': {
          // Parallel-sided band — far point is at section edge, body mid-elevation.
          const midElev = (topSource.elevation_m + baseSource.elevation_m) / 2
          farPoint = { along_m: towardAlong, elevation_m: midElev }
          isOpen = true
          break
        }
        default:
          return null
      }

      // Direction sign for dip arrow: +1 if endpoint is to the right, -1 if left.
      const extrapolationDirectionSign = farPoint.along_m > col.along ? 1 : -1

      // For the dissolve gesture we need the lens roles; use the content_key
      // when available (legacy lens bodies); otherwise derive from edge graph.
      let aboveId = aboveContactId
      let belowId = belowContactId
      let targetId = targetContactId ?? aboveContactId // fallback — won't be used for non-target kinds

      if (extentKindRaw === 'to_target' && targetContactId) {
        targetId = targetContactId
      } else if (body.content_key) {
        const ids = parseContentKey(body.content_key)
        const roles = resolveLensRoles(ids, edgePairs, depthByContact)
        if (roles) {
          aboveId = roles.aboveId
          belowId = roles.belowId
          targetId = roles.targetId
        }
      }

      return {
        bodyId: body.id,
        wedgeKey: isPrimary ? body.id : `${body.id}::${side}`,
        isPrimary,
        style,
        upperNodes: isPrimary ? storedUpperNodes : [],
        lowerNodes: isPrimary ? storedLowerNodes : [],
        topSource,
        baseSource,
        farPoint,
        isOpen,
        isExtrapolated,
        extrapolationDirectionSign,
        aboveId,
        belowId,
        targetId,
      }
    }

    // --- Try the new extent_<side>_kind fields first ----------------------
    // A body with extent fields set uses the per-side dispatch.
    const hasExtentFields =
      isExtentKind(body.extent_left_kind) || isExtentKind(body.extent_right_kind)

    if (hasExtentFields) {
      // Find the framing contacts. For extent-based bodies, the framing
      // contacts are the contacts on the source investigation that form
      // the body's top and base. We derive them from the correlation graph.
      //
      // Collect contacts on the source investigation.
      const sourceContacts = contacts.filter(c => {
        const inv = anchorIdOf(c)
        return inv === body.source_investigation_id
      })
      if (sourceContacts.length < 2) continue

      // Sort by depth ascending to get top (shallow) and base (deep).
      const sortedByDepth = sourceContacts
        .slice()
        .sort((a, b) => a.depth_top_m - b.depth_top_m)
      // Use the content_key if available to get the two source contacts;
      // otherwise use the two shallowest/deepest contacts on the source.
      let aboveContactId: string | null = null
      let belowContactId: string | null = null

      if (body.content_key) {
        const ids = parseContentKey(body.content_key)
        const roles = resolveLensRoles(ids, edgePairs, depthByContact)
        if (roles) {
          // Verify both source contacts are on the source investigation.
          const aboveInv = invByContact.get(roles.aboveId)
          const belowInv = invByContact.get(roles.belowId)
          if (
            aboveInv === body.source_investigation_id &&
            belowInv === body.source_investigation_id
          ) {
            aboveContactId = roles.aboveId
            belowContactId = roles.belowId
          }
        }
      }

      // Fall back to using the shallow+deep contacts on the source investigation.
      if (aboveContactId === null || belowContactId === null) {
        aboveContactId = sortedByDepth[0]?.id ?? null
        belowContactId = sortedByDepth[sortedByDepth.length - 1]?.id ?? null
      }

      if (!aboveContactId || !belowContactId) continue

      // Resolve left side.
      if (isExtentKind(body.extent_left_kind)) {
        const leftResolved = resolveSide(
          'left',
          sourceCol,
          aboveContactId,
          belowContactId,
          body.extent_left_kind,
          body.extent_left_target_contact_id,
          body.extent_left_neighbour_inv_id,
          true, // left side = primary for edge-anchoring purposes
        )
        if (leftResolved) resolved.push(leftResolved)
      }

      // Resolve right side.
      if (isExtentKind(body.extent_right_kind)) {
        const rightResolved = resolveSide(
          'right',
          sourceCol,
          aboveContactId,
          belowContactId,
          body.extent_right_kind,
          body.extent_right_target_contact_id,
          body.extent_right_neighbour_inv_id,
          !isExtentKind(body.extent_left_kind), // only primary if no left side
        )
        if (rightResolved) resolved.push(rightResolved)
      }
      continue
    }

    // --- Legacy content_key path (pre-extent bodies) ----------------------
    // This mirrors the original LensWedgeOverlay logic exactly.
    if (!body.content_key) continue
    const ids = parseContentKey(body.content_key)
    if (ids.length !== 3) continue
    if (!ids.every(id => contactById.has(id))) continue
    const roles = resolveLensRoles(ids, edgePairs, depthByContact)
    if (roles === null) continue

    const sourceInvId = invByContact.get(roles.aboveId)
    const primaryTargetInv = invByContact.get(roles.targetId)
    if (sourceInvId === undefined || primaryTargetInv === undefined) continue
    const legacySourceCol = colByInv.get(sourceInvId)
    if (!legacySourceCol) continue

    // Find all common targets (bilateral closure).
    const aboveNeigh = neighboursByContact.get(roles.aboveId) ?? new Set<string>()
    const belowNeigh = neighboursByContact.get(roles.belowId) ?? new Set<string>()
    const commonTargets: string[] = []
    for (const candidate of aboveNeigh) {
      if (!belowNeigh.has(candidate)) continue
      const candInv = invByContact.get(candidate)
      if (candInv === undefined || candInv === sourceInvId) continue
      commonTargets.push(candidate)
    }
    const orderedTargets = [
      roles.targetId,
      ...commonTargets.filter(t => t !== roles.targetId).sort(),
    ]

    for (const targetId of orderedTargets) {
      const isPrimary = targetId === roles.targetId
      const targetCol = colByInv.get(invByContact.get(targetId)!)
      if (!targetCol) continue

      const topSource = worldPtEdge(roles.aboveId, targetCol.along)
      const baseSource = worldPtEdge(roles.belowId, targetCol.along)
      const pinch = worldPtEdge(targetId, legacySourceCol.along)
      if (!topSource || !baseSource || !pinch) continue

      resolved.push({
        bodyId: body.id,
        wedgeKey: isPrimary ? body.id : `${body.id}::${targetId}`,
        isPrimary,
        style,
        upperNodes: isPrimary ? storedUpperNodes : [],
        lowerNodes: isPrimary ? storedLowerNodes : [],
        topSource,
        baseSource,
        farPoint: pinch,
        isOpen: false,
        isExtrapolated: false,
        extrapolationDirectionSign: 1,
        aboveId: roles.aboveId,
        belowId: roles.belowId,
        targetId,
      })
    }
  }

  // --- Drag lifecycle -------------------------------------------------------
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
          const sortAlong = (ns: BodyBoundaryNode[]): BodyBoundaryNode[] =>
            ns.slice().sort((p, q) => p.along_m - q.along_m)
          onSaveLensShape(d.bodyId, sortAlong(d.upperNodes), sortAlong(d.lowerNodes), d.style)
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
    body: ResolvedBody,
    boundary: 'upper' | 'lower',
    e: React.MouseEvent,
  ): void {
    if (!onSaveLensShape) return
    e.stopPropagation()
    e.preventDefault()
    const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
    const along = screenXToAlong(e.clientX - (rect?.left ?? 0))
    const elev = screenToLevel(e.clientY - (rect?.top ?? 0))
    const existing = boundary === 'upper' ? body.upperNodes : body.lowerNodes
    const nextNodes = [...existing, { along_m: along, elevation_m: elev }]
    const newIndex = nextNodes.length - 1
    setDrag({
      bodyId: body.bodyId,
      boundary,
      nodeIndex: newIndex,
      upperNodes: boundary === 'upper' ? nextNodes : body.upperNodes,
      lowerNodes: boundary === 'lower' ? nextNodes : body.lowerNodes,
      style: body.style,
    })
  }

  function startNodeDrag(
    body: ResolvedBody,
    boundary: 'upper' | 'lower',
    nodeIndex: number,
    e: React.MouseEvent,
  ): void {
    if (!onSaveLensShape) return
    e.stopPropagation()
    e.preventDefault()
    setDrag({
      bodyId: body.bodyId,
      boundary,
      nodeIndex,
      upperNodes: body.upperNodes.slice(),
      lowerNodes: body.lowerNodes.slice(),
      style: body.style,
    })
  }

  // --- Resolve ghost candidates into screen-space wedge geometry --------------
  // Each candidate is a pinch_out_halfway wedge from the source column to the
  // midpoint between source and suggested neighbour. Only candidates whose
  // source AND neighbour investigations are placed on this section are shown.
  interface GhostWedge {
    candidate: PinchOutCandidate
    testId: string
    upperScreen: { x: number; y: number }[]
    lowerScreen: { x: number; y: number }[]
    fillD: string
  }
  const ghostWedges: GhostWedge[] = []
  if (ghostCandidates) {
    for (const candidate of ghostCandidates) {
      const sourceCol = colByInv.get(candidate.source_investigation_id)
      const neighbourCol = colByInv.get(candidate.suggested_neighbour_investigation_id)
      if (!sourceCol || !neighbourCol) continue

      const aboveC = contactById.get(candidate.above_contact_id)
      const belowC = contactById.get(candidate.below_contact_id)
      if (!aboveC || !belowC) continue

      // Source edge facing the neighbour.
      const towardAlong = neighbourCol.along
      const topSource = worldPtEdge(candidate.above_contact_id, towardAlong)
      const baseSource = worldPtEdge(candidate.below_contact_id, towardAlong)
      if (!topSource || !baseSource) continue

      // Halfway midpoint (pinch_out_halfway geometry).
      const midAlong = (sourceCol.along + neighbourCol.along) / 2
      const midElev = (topSource.elevation_m + baseSource.elevation_m) / 2
      const farPoint: WorldPt = { along_m: midAlong, elevation_m: midElev }

      const topSrc = toScreen(topSource)
      const baseSrc = toScreen(baseSource)
      const far = toScreen(farPoint)

      const upperScreen = [far, topSrc]
      const lowerScreen = [far, baseSrc]
      const fillPts = [...upperScreen, ...lowerScreen.slice().reverse()]
      const fillD = fillPts.length >= 3 ? `${polylinePath(fillPts)} Z` : ''

      ghostWedges.push({
        candidate,
        testId: `body-ghost-fill-${candidate.source_investigation_id}-${candidate.side}`,
        upperScreen,
        lowerScreen,
        fillD,
      })
    }
  }

  return (
    <g ref={rootRef} data-testid="body-extent-overlay" style={{ pointerEvents: 'none' }}>
      {resolved.map(body => {
        const dragMatches = drag?.bodyId === body.bodyId && body.isPrimary
        const upperNodes =
          dragMatches && drag!.boundary === 'upper' ? drag!.upperNodes : body.upperNodes
        const lowerNodes =
          dragMatches && drag!.boundary === 'lower' ? drag!.lowerNodes : body.lowerNodes

        let upperWorld: WorldPt[]
        let lowerWorld: WorldPt[]

        if (body.isOpen) {
          // Open band: parallel sides — upper edge at topSource elevation,
          // lower edge at baseSource elevation. No taper.
          // The upper boundary goes from the source edge to the section endpoint.
          const topFar: WorldPt = { along_m: body.farPoint.along_m, elevation_m: body.topSource.elevation_m }
          const baseFar: WorldPt = { along_m: body.farPoint.along_m, elevation_m: body.baseSource.elevation_m }
          upperWorld = bodyBoundaryPolyline([body.topSource, topFar], upperNodes, body.style)
          lowerWorld = bodyBoundaryPolyline([body.baseSource, baseFar], lowerNodes, body.style)
        } else {
          // Wedge: taper from source endpoints to a single far point.
          upperWorld = bodyBoundaryPolyline([body.farPoint, body.topSource], upperNodes, body.style)
          lowerWorld = bodyBoundaryPolyline([body.farPoint, body.baseSource], lowerNodes, body.style)
        }

        const upperScreen = upperWorld.map(toScreen)
        const lowerScreen = lowerWorld.map(toScreen)
        const pathFn = body.style === 'rounded' ? catmullRomPath : polylinePath

        // Fill polygon = upper boundary forward + lower boundary reversed.
        const fillPts = [...upperScreen, ...lowerScreen.slice().reverse()]
        const fillD = fillPts.length >= 3 ? `${polylinePath(fillPts)} Z` : ''

        // Secondary wedges don't accept node-drag editing.
        const canEditShape = body.isPrimary && !body.isOpen && Boolean(onSaveLensShape)

        // Dip-arrow glyph (extrapolated kind only).
        const dipArrowScreen = body.isExtrapolated ? toScreen(body.farPoint) : null
        const dipArrowD =
          dipArrowScreen !== null
            ? dipArrowPath(dipArrowScreen, body.extrapolationDirectionSign)
            : ''

        return (
          <g key={`body-extent-${body.wedgeKey}`} data-testid={`body-extent-${body.wedgeKey}`}>
            {fillD && (
              <path
                data-testid={`body-extent-fill-${body.wedgeKey}`}
                d={fillD}
                fill={FILL_COLOR}
                fillOpacity={FILL_OPACITY}
                stroke="none"
                style={{
                  pointerEvents: (onBodyContextMenu ?? onDeleteLens) ? 'auto' : 'none',
                  cursor: (onBodyContextMenu ?? onDeleteLens) ? 'context-menu' : undefined,
                }}
                onContextMenu={
                  onBodyContextMenu
                    ? e => {
                        e.preventDefault()
                        e.stopPropagation()
                        const svgRect =
                          rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                        const svgX = e.clientX - (svgRect?.left ?? 0)
                        const svgY = e.clientY - (svgRect?.top ?? 0)
                        const bodyItem = bodyById.get(body.bodyId)
                        if (bodyItem !== undefined) {
                          onBodyContextMenu(bodyItem, svgX, svgY)
                        } else if (onDeleteLens) {
                          // Fallback for legacy content_key bodies not in the
                          // bodies list (should not happen in practice, but
                          // defensive fallback keeps old behaviour intact).
                          onDeleteLens(body.aboveId, body.belowId, body.targetId)
                        }
                      }
                    : onDeleteLens
                      ? e => {
                          e.preventDefault()
                          e.stopPropagation()
                          onDeleteLens(body.aboveId, body.belowId, body.targetId)
                        }
                      : undefined
                }
              />
            )}
            {/* Boundary hit-bands: mousedown adds + drags a node. */}
            {canEditShape &&
              (['upper', 'lower'] as const).map(b => {
                const screenPts = b === 'upper' ? upperScreen : lowerScreen
                return (
                  <path
                    key={`hit-${b}`}
                    data-testid={`body-boundary-hit-${body.wedgeKey}-${b}`}
                    d={pathFn(screenPts)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={HIT_STROKE}
                    style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
                    onMouseDown={e => startAddNode(body, b, e)}
                  />
                )
              })}
            {/* Visible boundary lines. */}
            <path
              data-testid={`body-boundary-upper-${body.wedgeKey}`}
              d={pathFn(upperScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            <path
              data-testid={`body-boundary-lower-${body.wedgeKey}`}
              d={pathFn(lowerScreen)}
              fill="none"
              stroke={BOUNDARY_COLOR}
              strokeWidth={1.6}
              pointerEvents="none"
            />
            {/* Dip-arrow glyph for extrapolated extents. */}
            {dipArrowD && (
              <path
                data-testid={`body-dip-arrow-${body.wedgeKey}`}
                d={dipArrowD}
                fill={BOUNDARY_COLOR}
                stroke="none"
                pointerEvents="none"
              />
            )}
            {/* Draggable ghost nodes (hollow circles). Primary non-open wedge only. */}
            {canEditShape &&
              (['upper', 'lower'] as const).map(b => {
                const nodes = b === 'upper' ? upperNodes : lowerNodes
                return nodes.map((n, i) => {
                  const s = toScreen(n)
                  return (
                    <circle
                      key={`node-${b}-${i}`}
                      data-testid={`body-node-${body.wedgeKey}-${b}-${i}`}
                      cx={s.x}
                      cy={s.y}
                      r={NODE_R}
                      fill="#0f172a"
                      stroke={FILL_COLOR}
                      strokeWidth={2.2}
                      style={{ pointerEvents: 'auto', cursor: 'grab' }}
                      onMouseDown={e => startNodeDrag(body, b, i, e)}
                    />
                  )
                })
              })}
          </g>
        )
      })}
      {/* Ghost pinch-out candidates — dashed amber wedges. */}
      {ghostWedges.map(ghost => (
        <g key={`ghost-${ghost.candidate.source_investigation_id}-${ghost.candidate.side}`}>
          {ghost.fillD && (
            <path
              data-testid={ghost.testId}
              d={ghost.fillD}
              fill={GHOST_STROKE_COLOR}
              fillOpacity={GHOST_FILL_OPACITY}
              stroke={GHOST_STROKE_COLOR}
              strokeWidth={1.4}
              strokeDasharray={GHOST_STROKE_DASH}
              style={{
                pointerEvents: onClaimGhostCandidate ? 'auto' : 'none',
                cursor: onClaimGhostCandidate ? 'pointer' : undefined,
              }}
              onClick={
                onClaimGhostCandidate
                  ? e => {
                      e.stopPropagation()
                      onClaimGhostCandidate(ghost.candidate)
                    }
                  : undefined
              }
            />
          )}
          <path
            d={polylinePath(ghost.upperScreen)}
            fill="none"
            stroke={GHOST_STROKE_COLOR}
            strokeWidth={1.4}
            strokeDasharray={GHOST_STROKE_DASH}
            pointerEvents="none"
          />
          <path
            d={polylinePath(ghost.lowerScreen)}
            fill="none"
            stroke={GHOST_STROKE_COLOR}
            strokeWidth={1.4}
            strokeDasharray={GHOST_STROKE_DASH}
            pointerEvents="none"
          />
        </g>
      ))}
    </g>
  )
}
