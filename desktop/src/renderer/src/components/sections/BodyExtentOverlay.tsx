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
 *   ``open``              — parallel-sided band a fixed configurable distance
 *                           (default 3 m) past the source column's edge (no taper).
 *   null                  — render nothing on that side.
 *
 * The render logic is bilateral: both sides share the source investigation's
 * anchor contacts, but taper independently to their respective endpoints.
 * Boundary node dragging and right-click dissolve are carried forward from
 * the previous LensWedgeOverlay; node drag applies to the primary boundary
 * set (stored per body) and is limited to wedge-kind sides.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  BodyRenderStyle,
  FormationContactResponse,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
  PinchOutCandidate,
} from '../../api/client'
import {
  bodyBoundaryPolyline,
  isExtentKind,
  parseContentKey,
  resolveLensRoles,
} from '../../utils/bodyExtent'
import { computeDipExtrapolationEndpoint } from '../../utils/dipExtrapolationFrontend'
import { computeDepthStacking, lensDisplayLabel } from '../../utils/lensLabel'
import { log } from '../../utils/log'
import { columnMaxDepthM } from './utils'
import type { PlacedColumn } from './utils'

/**
 * Compute the midpoint ``farPoint`` between the source column and its
 * neighbour, at the vertical midpoint between the top and base contacts.
 * Used by the ``pinch_out_halfway`` extent kind and as the fallback for a
 * degenerate ``extrapolated`` result.
 */
export function halfwayFarPoint(
  col: { along: number },
  neighbourCol: { along: number },
  topSource: { elevation_m: number },
  baseSource: { elevation_m: number },
): { along_m: number; elevation_m: number } {
  return {
    along_m: (col.along + neighbourCol.along) / 2,
    elevation_m: (topSource.elevation_m + baseSource.elevation_m) / 2,
  }
}

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

/**
 * Area centroid of a closed polygon (the lens fill shape) — the true visual
 * centre to anchor the auto-label on, for any shape (wedge, open band,
 * bilateral). Uses the standard signed-area centroid formula so a shared/
 * duplicated tip vertex doesn't bias the result (the plain vertex average
 * would). Falls back to the vertex mean when the polygon is degenerate
 * (near-zero area — a collinear sliver).
 */
function polygonCentroid(
  pts: readonly { x: number; y: number }[],
): { x: number; y: number } {
  const n = pts.length
  if (n === 0) return { x: 0, y: 0 }
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const cross = a.x * b.y - b.x * a.y
    area += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  area *= 0.5
  if (Math.abs(area) < 1e-6) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  return { x: cx / (6 * area), y: cy / (6 * area) }
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
  /**
   * Accepted litho layers for the active model. Each carries ``body_id`` —
   * the link from a layer to the body (instance) it belongs to. Committed
   * bodies are framed from THEIR OWN member layer (the layer whose
   * ``body_id === body.id`` AND whose anchor === ``source_investigation_id``)
   * using the layer's real ``depth_top_m`` / ``depth_base_m``, so two
   * instances that share a formation no longer collapse onto the shallowest
   * occurrence (Bug C "body jump", dogfeed 2026-06-02). Absent / empty falls
   * back to the correlation-graph derivation (``_deriveFramingFromTarget``).
   */
  lithoLayers?: readonly LithoLayerResponse[]
  /**
   * formation_id → lithology label (e.g. ``"ZAND"``) for the auto-name. When a
   * body has no explicit ``name``, its wedge is labelled
   * ``"{lithology} {body_ordinal + 1}"``. Absent / missing entry → the wedge
   * shows the explicit name only (or nothing when also un-named).
   */
  formationLabelById?: ReadonlyMap<string, string>
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
   * Fixed length in along-section metres that an ``open`` extent draws past
   * the source column's edge (configurable via litho-segmenter prefs;
   * default 3 m). Replaces the old "extend to the section endpoint"
   * behaviour, which read as "runs to the DEM edge" (dogfeed 2026-06-02).
   */
  openExtentLengthM: number
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
   * Left-click a ghost candidate wedge — requests a claim (parent opens a
   * confirm dialog before committing). Replaces the old ``onClaimGhostCandidate``
   * direct-claim prop so an accidental click cannot silently write to the DB.
   */
  onRequestClaimGhostCandidate?: (candidate: PinchOutCandidate) => void
  /**
   * Right-click a ghost candidate wedge — opens the ghost context menu at the
   * given SVG canvas coordinates.  Receives the candidate and the pointer
   * position (relative to the SVG element) so the parent can anchor a
   * ``GhostContextMenu`` there.
   */
  onGhostContextMenu?: (candidate: PinchOutCandidate, svgX: number, svgY: number) => void
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
  lithoLayers,
  formationLabelById,
  placedColumns,
  contactEdges,
  alongToScreenX,
  levelToScreen,
  screenXToAlong,
  screenToLevel,
  plotTop,
  plotBottom,
  openExtentLengthM,
  onSaveLensShape,
  onDeleteLens,
  onBodyContextMenu,
  ghostCandidates,
  onRequestClaimGhostCandidate,
  onGhostContextMenu,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<NodeDrag | null>(null)

  // --- world-coordinate lookup maps + resolve pass ----------------------------
  // Memoized so that drag-mousemove renders (which only change ``drag``) do not
  // rebuild all Maps and re-run the O(bodies × contacts) resolve loop on every
  // animation frame.  ``drag`` is included because ``resolveSide`` reads
  // ``storedUpperNodes`` / ``storedLowerNodes`` which are constant, but the
  // live node positions for the dragged body are overridden from ``drag`` in the
  // render section below — the memo itself doesn't need ``drag`` for correctness.
  // However, the ghost-candidate section below does not use ``drag`` at all.
  // The memo deps are all inputs to the resolve pass; none of the screen-space
  // transforms (``alongToScreenX``, ``levelToScreen``) are consumed here —
  // those only apply in the render section.
  const {
    bodyById,
    contactById,
    colByInv,
    resolved,
    worldPtEdge,
    stackingByBodyId,
  } = useMemo(() => {
    const _bodyById = new Map(bodies.map(b => [b.id, b]))
    const _contactById = new Map(contacts.map(c => [c.id, c]))
    const _colByInv = new Map<
      string,
      { along: number; surfaceElevM: number; nudgedX: number; width: number; bottomDepthM: number | null }
    >()
    for (const col of placedColumns) {
      const elev = col.proj.item.elevation_m
      if (elev !== null && elev !== undefined) {
        _colByInv.set(col.proj.item.id, {
          along: col.proj.along,
          surfaceElevM: elev,
          nudgedX: col.nudgedX,
          width: col.width,
          bottomDepthM: columnMaxDepthM(col),
        })
      }
    }

    const _anchorIdOf = (c: FormationContactResponse): string | null =>
      c.cpt_id ?? c.borehole_id ?? null

    const _layerAnchorIdOf = (l: LithoLayerResponse): string | null =>
      l.cpt_id ?? l.borehole_id ?? null

    // body_id → its accepted member layers (the layers the resolver assigned
    // to this body). Committed-body framing reads the member layer on the
    // body's OWN source column to pin the source band at its real depth —
    // see ``_deriveFramingFromMember``. Only layers carrying a body_id and a
    // resolvable anchor are grouped.
    // Every accepted layer by id — the framing FALLBACK when a candidate's
    // contact isn't SEEDED on this section. The explicit-content filter keeps
    // only seeded contacts in ``contacts``, but a candidate's contact id IS a
    // litho layer id (post-A4 FC↔LL identity), so the layer supplies the same
    // depth + anchor. Without this, a ghost / wedge whose framing contact isn't
    // seeded silently fails — e.g. a stacked unit's shared boundary contact,
    // which is exactly what dropped the stacked sand open-ends + the upper
    // pinch (dogfeed 2026-06-03).
    const _layerById = new Map<string, LithoLayerResponse>()
    const _memberLayersByBodyId = new Map<string, LithoLayerResponse[]>()
    for (const layer of lithoLayers ?? []) {
      _layerById.set(layer.id, layer)
      if (!layer.body_id) continue
      const existing = _memberLayersByBodyId.get(layer.body_id)
      if (existing) existing.push(layer)
      else _memberLayersByBodyId.set(layer.body_id, [layer])
    }

    const _depthByContact = new Map<string, number>(contacts.map(c => [c.id, c.depth_top_m]))

    const _invByContact = new Map<string, string>()
    for (const c of contacts) {
      const inv = _anchorIdOf(c)
      if (inv !== null) _invByContact.set(c.id, inv)
    }

    /**
     * Column-edge world point — elevation is derived from the contact's
     * depth below the surface; along_m is the column's EDGE FACING
     * ``otherSideAlong`` (warp-aware inverse so spacing != 100% works).
     */
    function _worldPtEdge(contactId: string, otherSideAlong: number): WorldPt | null {
      // Prefer the seeded contact; fall back to the litho layer (always present
      // for an accepted unit) when the contact isn't seeded on this section.
      const c = _contactById.get(contactId)
      let inv: string | null
      let depthTop: number
      if (c) {
        inv = _anchorIdOf(c)
        depthTop = c.depth_top_m
      } else {
        const layer = _layerById.get(contactId)
        if (!layer) return null
        inv = layer.cpt_id ?? layer.borehole_id
        depthTop = layer.depth_top_m
      }
      if (inv === null) return null
      const col = _colByInv.get(inv)
      if (!col) return null
      const halfW = col.width / 2
      // The facing edge is the one closer to the other side of the wedge.
      const edgeX = col.nudgedX + (otherSideAlong > col.along ? +halfW : -halfW)
      return { along_m: screenXToAlong(edgeX), elevation_m: col.surfaceElevM - depthTop }
    }

    /**
     * Column-edge world point for the source side facing a given neighbour
     * along, returning both the top-contact and base-contact elevations.
     */
    function _sourcePair(
      aboveContactId: string,
      belowContactId: string,
      towardAlong: number,
    ): { topSource: WorldPt; baseSource: WorldPt } | null {
      const topSource = _worldPtEdge(aboveContactId, towardAlong)
      const baseSource = _worldPtEdge(belowContactId, towardAlong)
      if (!topSource || !baseSource) return null
      return { topSource, baseSource }
    }

    // --- Build per-body neighbour map (approved edges) -----------------------
    const _edgePairs = contactEdges.map(e => ({ a: e.contact_a_id, b: e.contact_b_id }))
    const _neighboursByContact = new Map<string, Set<string>>()
    for (const e of contactEdges) {
      if (!_neighboursByContact.has(e.contact_a_id)) {
        _neighboursByContact.set(e.contact_a_id, new Set())
      }
      if (!_neighboursByContact.has(e.contact_b_id)) {
        _neighboursByContact.set(e.contact_b_id, new Set())
      }
      _neighboursByContact.get(e.contact_a_id)!.add(e.contact_b_id)
      _neighboursByContact.get(e.contact_b_id)!.add(e.contact_a_id)
    }

    /**
     * Recover the detector's exact framing pair (``cid_above``, ``cid_below``)
     * for an extent-based body from the correlation graph.
     *
     * ``detect_body_extents`` frames a body by the two source-investigation
     * contacts that are BOTH correlated to a target contact, adjacent in
     * depth, with the shallower one carrying the body's formation. Those
     * contacts are computed at detect time but never stored on the body row,
     * so we re-derive them here. Pinning the framing to the target's correlated
     * contacts (rather than the formation_id alone) keeps the wedge at the
     * RIGHT depth when the same formation appears at several depths on the
     * source — the formation_id-only proxy picked the shallowest occurrence and
     * drew the lens too high (dogfeed 2026-06-01).
     */
    function _deriveFramingFromTarget(
      targetContactId: string | null | undefined,
      sourceInvId: string,
      formationId: string,
    ): [string, string] | null {
      if (!targetContactId) return null
      const neigh = _neighboursByContact.get(targetContactId)
      if (!neigh) return null
      // Source-investigation contacts correlated to this target, top → base.
      const sourceNeigh = [...neigh]
        .map(id => _contactById.get(id))
        .filter(
          (c): c is FormationContactResponse =>
            c !== undefined && _anchorIdOf(c) === sourceInvId,
        )
        .sort((a, b) => a.depth_top_m - b.depth_top_m)
      // The adjacent correlated pair whose shallower contact carries the body's
      // formation is the detector's (cid_above, cid_below).
      for (let i = 0; i < sourceNeigh.length - 1; i += 1) {
        if (sourceNeigh[i].formation_id === formationId) {
          return [sourceNeigh[i].id, sourceNeigh[i + 1].id]
        }
      }
      return null
    }

    /**
     * Frame a committed body from its OWN member layer on the source column.
     *
     * A layer shares its UUID with the contact at its top boundary
     * (``lithoLayerToContact`` — A2.5 UUID-preserving backfill), so the member
     * layer's ``id`` IS the body's ``cid_above``. The base contact is the
     * source-column contact whose ``depth_top_m`` coincides with the member
     * layer's ``depth_base_m`` (adjacent layers share that boundary); if the
     * member layer is the deepest unit on the column there is no base contact,
     * and ``belowContactId`` is null (handled by the open-extent base-from-hole
     * path in ``resolveSide``).
     *
     * This pins the source band at the instance the user actually pinched even
     * when the same formation appears at several depths on the source — the
     * formation_id-only proxy + the correlation-graph derivation both picked
     * the shallowest occurrence, so an accepted body "jumped" up to it (Bug C,
     * dogfeed 2026-06-02).
     *
     * Returns null when no member layer for the body is present on its source
     * column (stale/edge case) → the caller falls back to
     * ``_deriveFramingFromTarget`` + the formation_id proxy.
     */
    function _deriveFramingFromMember(
      body: BodyListItem,
    ): [string, string | null] | null {
      const members = _memberLayersByBodyId.get(body.id)
      if (!members) return null
      const sourceMember = members.find(
        l => _layerAnchorIdOf(l) === body.source_investigation_id,
      )
      if (!sourceMember) return null
      // The member layer's id == the contact id at its top boundary.
      if (!_contactById.has(sourceMember.id)) return null
      const aboveContactId = sourceMember.id
      // Base contact = the source-column contact whose top sits at this layer's
      // base (within a small tolerance — both are derived from the same
      // boundary depth, so they match exactly in practice).
      const baseDepth = sourceMember.depth_base_m
      let belowContactId: string | null = null
      let bestDelta = Number.POSITIVE_INFINITY
      for (const c of contacts) {
        if (_anchorIdOf(c) !== body.source_investigation_id) continue
        if (c.id === aboveContactId) continue
        const delta = Math.abs(c.depth_top_m - baseDepth)
        if (delta < bestDelta) {
          bestDelta = delta
          belowContactId = c.id
        }
      }
      // Only accept a base contact that genuinely coincides with the layer's
      // base boundary (1 cm). Otherwise the formation runs to the hole bottom
      // (deepest unit) → leave belowContactId null for the open base-from-hole
      // path.
      if (belowContactId !== null && bestDelta > 0.01) belowContactId = null
      return [aboveContactId, belowContactId]
    }

    /**
     * The accepted member layer for ``body`` on its OWN source column, or
     * undefined when none is present on this section. Used to (a) bypass the
     * ``< 2 source contacts`` skip guard — a member layer fully frames the
     * source-column band on its own — and (b) supply the band BASE elevation
     * via the layer's ``depth_base_m`` when the source column carries no
     * matching base contact (a single-contact source column, where the
     * instance resolver pinned ``source_investigation_id`` to the body's
     * shallowest member's column). Without this the ≥2-contacts guard dropped
     * the whole body (dogfeed: Section B body "body-extent-fill not found").
     */
    function _sourceMemberOf(body: BodyListItem): LithoLayerResponse | undefined {
      return (_memberLayersByBodyId.get(body.id) ?? []).find(
        l => _layerAnchorIdOf(l) === body.source_investigation_id,
      )
    }

    // --- Resolve each body to its rendered wedge descriptors -----------------
    const _resolved: ResolvedBody[] = []
    // One entry per body for the depth-rank auto-label (shallowest = 1). Depth
    // is the framing top contact's depth-below-surface.
    const _stackingItems: { id: string; label: string; depth: number }[] = []

    for (const body of bodies) {
      const sourceCol = _colByInv.get(body.source_investigation_id)
      if (!sourceCol) continue // source not on this section

      const boundary = boundariesByBodyId.get(body.id)
      const style: BodyRenderStyle = boundary?.render_style ?? 'straight'
      const storedUpperNodes = boundary?.upper_nodes ?? []
      const storedLowerNodes = boundary?.lower_nodes ?? []

      // Helper to resolve one side (left or right).
      // ``col`` is the resolved source column (already validated non-null by the caller).
      function resolveSide(
        side: 'left' | 'right',
        col: { along: number; surfaceElevM: number; nudgedX: number; width: number; bottomDepthM: number | null },
        aboveContactId: string | null,
        belowContactId: string | null,
        extentKindRaw: string | null,
        targetContactId: string | null,
        neighbourInvId: string | null,
        isPrimary: boolean,
        // Member-layer base depth (m below surface) for the body's source
        // column. Supplies the band BASE when the source column has no matching
        // base contact (single-contact source) so the body renders as a bounded
        // band at [member top, member base] instead of being dropped. Null when
        // no member layer is present → the legacy contact-pair / open-to-hole
        // paths apply.
        memberBaseDepthM: number | null = null,
      ): ResolvedBody | null {
        if (!isExtentKind(extentKindRaw)) return null
        if (!aboveContactId) return null
        // A null belowContactId is valid for (a) deepest-formation open extents
        // (base from the hole bottom) and (b) any kind when the member layer
        // supplies a finite base depth (bounded band from the member layer).
        if (!belowContactId && extentKindRaw !== 'open' && memberBaseDepthM === null) return null

        const aboveContact = _contactById.get(aboveContactId)
        if (!aboveContact) return null
        // For non-open kinds a belowContact is required; for open it may be null
        // when the formation runs to the bottom of the hole (no base contact).
        if (belowContactId !== null && !_contactById.has(belowContactId)) return null

        // Determine the along direction for this side.
        // "left" means the endpoint is to the LEFT of the source column;
        // "right" means to the RIGHT. The neighbour/target column gives us
        // the definitive along; for ``open`` we use the section endpoint.
        let towardAlong: number

        switch (extentKindRaw) {
          case 'to_target': {
            if (!targetContactId) return null
            const targetInv = _invByContact.get(targetContactId)
            if (!targetInv) return null
            const targetCol = _colByInv.get(targetInv)
            if (!targetCol) return null
            towardAlong = targetCol.along
            break
          }
          case 'pinch_out_halfway':
          case 'extrapolated': {
            if (!neighbourInvId) return null
            const neighbourCol = _colByInv.get(neighbourInvId)
            if (!neighbourCol) return null
            towardAlong = neighbourCol.along
            break
          }
          case 'open': {
            // Fixed-length stub past the source column edge (configurable;
            // default 3 m), NOT to the section boundary — that read as
            // "extends to the DEM edge" (dogfeed 2026-06-02).
            towardAlong = side === 'left'
              ? col.along - openExtentLengthM
              : col.along + openExtentLengthM
            break
          }
          default:
            return null
        }

        let topSource: WorldPt
        let baseSource: WorldPt
        if (belowContactId === null) {
          const top = _worldPtEdge(aboveContactId, towardAlong)
          if (!top) return null
          topSource = top
          if (memberBaseDepthM !== null) {
            // Bounded band from the member layer: the source column carries no
            // base contact (single-contact source), but the member layer's
            // depth_base_m frames a finite floor. Same surface-relative
            // conversion as the contact-pair / open paths.
            baseSource = {
              along_m: top.along_m,
              elevation_m: col.surfaceElevM - memberBaseDepthM,
            }
          } else {
            // Deepest-formation open extent: no base contact — base is the hole
            // bottom so the wedge aligns with the litho band (which uses
            // columnMaxDepthM as its floor). Falls back to the plotBottom
            // elevation when the column has no recorded depth.
            if (extentKindRaw !== 'open') return null
            baseSource = {
              along_m: top.along_m,
              elevation_m:
                col.bottomDepthM != null
                  ? col.surfaceElevM - col.bottomDepthM
                  : screenToLevel(plotBottom),
            }
          }
        } else {
          const pair = _sourcePair(aboveContactId, belowContactId, towardAlong)
          if (!pair) return null
          topSource = pair.topSource
          baseSource = pair.baseSource
        }

        // Compute the far endpoint based on kind.
        let farPoint: WorldPt
        let isOpen = false
        let isExtrapolated = false

        switch (extentKindRaw) {
          case 'to_target': {
            // Pinch at the target column's edge facing the source.
            const pinch = _worldPtEdge(targetContactId!, col.along)
            if (!pinch) return null
            farPoint = pinch
            break
          }
          case 'pinch_out_halfway': {
            const neighbourCol = _colByInv.get(neighbourInvId!)!
            farPoint = halfwayFarPoint(col, neighbourCol, topSource, baseSource)
            break
          }
          case 'extrapolated': {
            const neighbourCol = _colByInv.get(neighbourInvId!)!
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
              log.warn(
                'body-extent',
                `Dip extrapolation degenerate for body ${body.id} ` +
                `side ${side} — falling back to halfway midpoint.`,
              )
              farPoint = halfwayFarPoint(col, neighbourCol, topSource, baseSource)
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
        // belowContactId is null for deepest-formation open extents (no base contact).
        // Fall back to aboveContactId for the dissolve-gesture ids, which are unused
        // for open-kind bodies (they have no correlation edges to dissolve).
        let belowId: string = belowContactId ?? aboveContactId
        let targetId = targetContactId ?? aboveContactId // fallback — won't be used for non-target kinds

        if (extentKindRaw === 'to_target' && targetContactId) {
          targetId = targetContactId
        } else if (body.content_key) {
          const ids = parseContentKey(body.content_key)
          const roles = resolveLensRoles(ids, _edgePairs, _depthByContact)
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
          const inv = _anchorIdOf(c)
          return inv === body.source_investigation_id
        })
        // A deepest-formation open body may have only the formation's top contact
        // (no base contact below it — the formation runs to the hole bottom).
        // Allow it through with 1 contact when the body has an open-kind side.
        const isOpenBody =
          body.extent_left_kind === 'open' || body.extent_right_kind === 'open'
        // The body's own member layer on its source column, if present. A member
        // layer frames the source-column band on its own (depth_top_m +
        // depth_base_m), so the ``< 2 source contacts`` guard MUST NOT drop a
        // body that has one — the instance resolver can pin
        // ``source_investigation_id`` to the body's shallowest member's column,
        // which may carry only a single contact (dogfeed: Section B body
        // "body-extent-fill not found"). Truly un-framable bodies (no member
        // layer AND < 2 contacts AND not open) are still skipped.
        const sourceMember = _sourceMemberOf(body)
        if (!sourceMember && sourceContacts.length < 2 && !isOpenBody) continue
        if (!sourceMember && sourceContacts.length === 0) continue

        // Sort by depth ascending so the contact list reads top → base.
        const sortedByDepth = sourceContacts
          .slice()
          .sort((a, b) => a.depth_top_m - b.depth_top_m)

        // Frame the body from its OWN member layer (the layer whose body_id ===
        // body.id on the source column). This pins the source band at the
        // instance the user pinched even when the same formation appears at
        // several depths on the source (stacked bodies) — the formation_id-only
        // proxy AND the correlation-graph derivation both picked the shallowest
        // occurrence, so an accepted body "jumped" up to it (Bug C, dogfeed
        // 2026-06-02). The member-layer path is preferred; the target-derived
        // pair and the formation_id proxy stay as fallbacks for stale rows /
        // bodies whose member layer is not on this section.
        let aboveContactId: string | null
        let belowContactId: string | null

        const framing =
          _deriveFramingFromMember(body) ??
          _deriveFramingFromTarget(
            body.extent_left_target_contact_id,
            body.source_investigation_id,
            body.formation_id,
          ) ??
          _deriveFramingFromTarget(
            body.extent_right_target_contact_id,
            body.source_investigation_id,
            body.formation_id,
          )

        if (framing) {
          ;[aboveContactId, belowContactId] = framing
        } else {
          // Fallback — user-claimed bodies (pinch_out_halfway / extrapolated /
          // open) carry no target contact, and detector bodies whose framing
          // edges aren't on this section can't be recovered. Frame by the
          // formation's own layer: its top contact + the next-deeper contact.
          const topIdx = sortedByDepth.findIndex(c => c.formation_id === body.formation_id)
          aboveContactId = topIdx === -1 ? null : sortedByDepth[topIdx].id
          // No deeper contact → the body's formation is the deepest present and
          // has no base contact to taper from; skip rather than draw a wrong
          // full-height wedge.
          belowContactId = topIdx === -1 ? null : (sortedByDepth[topIdx + 1]?.id ?? null)
        }

        if (!aboveContactId) continue
        // The member layer's base depth frames the band floor when the source
        // column carries no matching base contact (single-contact source). Only
        // use it when the framing actually came from the member layer (above
        // contact == member's top contact id) AND there is no resolved base
        // contact, so a normal contact-pair framing is never overridden.
        const memberBaseDepthM =
          sourceMember && belowContactId === null && aboveContactId === sourceMember.id
            ? sourceMember.depth_base_m
            : null
        // A null below contact is allowed for open bodies (deepest formation,
        // base from the hole bottom) AND for bodies whose member layer supplies
        // a finite base depth (bounded band — see resolveSide).
        if (!belowContactId && !isOpenBody && memberBaseDepthM === null) continue

        // Record this body for the depth-rank auto-label. Depth = framing top
        // contact's depth-below-surface; label = parent formation (the caller
        // resolves formationLabelById to parent_formation_name).
        const _stackLabel = formationLabelById?.get(body.formation_id)
        if (_stackLabel) {
          _stackingItems.push({
            id: body.id,
            label: _stackLabel,
            depth: _depthByContact.get(aboveContactId) ?? 0,
          })
        }

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
            memberBaseDepthM,
          )
          if (leftResolved) _resolved.push(leftResolved)
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
            memberBaseDepthM,
          )
          if (rightResolved) _resolved.push(rightResolved)
        }
        continue
      }

      // --- Legacy content_key path (pre-extent bodies) ----------------------
      // This mirrors the original LensWedgeOverlay logic exactly.
      if (!body.content_key) continue
      const ids = parseContentKey(body.content_key)
      if (ids.length !== 3) continue
      if (!ids.every(id => _contactById.has(id))) continue
      const roles = resolveLensRoles(ids, _edgePairs, _depthByContact)
      if (roles === null) continue

      const sourceInvId = _invByContact.get(roles.aboveId)
      const primaryTargetInv = _invByContact.get(roles.targetId)
      if (sourceInvId === undefined || primaryTargetInv === undefined) continue
      const legacySourceCol = _colByInv.get(sourceInvId)
      if (!legacySourceCol) continue

      // Find all common targets (bilateral closure).
      const aboveNeigh = _neighboursByContact.get(roles.aboveId) ?? new Set<string>()
      const belowNeigh = _neighboursByContact.get(roles.belowId) ?? new Set<string>()
      const commonTargets: string[] = []
      for (const candidate of aboveNeigh) {
        if (!belowNeigh.has(candidate)) continue
        const candInv = _invByContact.get(candidate)
        if (candInv === undefined || candInv === sourceInvId) continue
        commonTargets.push(candidate)
      }
      const orderedTargets = [
        roles.targetId,
        ...commonTargets.filter(t => t !== roles.targetId).sort(),
      ]

      for (const targetId of orderedTargets) {
        const isPrimary = targetId === roles.targetId
        const targetCol = _colByInv.get(_invByContact.get(targetId)!)
        if (!targetCol) continue

        const topSource = _worldPtEdge(roles.aboveId, targetCol.along)
        const baseSource = _worldPtEdge(roles.belowId, targetCol.along)
        const pinch = _worldPtEdge(targetId, legacySourceCol.along)
        if (!topSource || !baseSource || !pinch) continue

        _resolved.push({
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

    return {
      bodyById: _bodyById,
      contactById: _contactById,
      colByInv: _colByInv,
      resolved: _resolved,
      worldPtEdge: _worldPtEdge,
      stackingByBodyId: computeDepthStacking(_stackingItems),
    }
  // reason: screenXToAlong + openExtentLengthM + formationLabelById are consumed
  // inside the memo (open-extent towardAlong is now a fixed offset from col.along
  // using openExtentLengthM; the auto-label depth-rank grouping uses
  // formationLabelById). They are stable between drag events and change only when
  // the section line / column spacing / prefs / formation set changes, which also
  // changes the body geometry — so including them is correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, contacts, lithoLayers, placedColumns, contactEdges, boundariesByBodyId,
      screenXToAlong, openExtentLengthM, formationLabelById])

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

  // Base elevation of a deepest-formation open extent: the source column's
  // bottom (matching the litho band, which uses columnMaxDepthM), or the
  // plotBottom elevation when the column has no recorded depth (band fallback).
  function openDeepestBaseElevation(col: {
    surfaceElevM: number
    bottomDepthM: number | null
  }): number {
    return col.bottomDepthM != null
      ? col.surfaceElevM - col.bottomDepthM
      : screenToLevel(plotBottom)
  }

  // Label font scales with the vertical zoom (screen px per metre) so the
  // auto-name shrinks when zoomed out and grows when zoomed in, clamped to a
  // legible range. The upper cap was 24 px but that overwhelmed the section
  // when zoomed in (dogfeed 2026-06-03); 13 px sits just above the 9 px
  // per-unit contact labels so bodies still read as emphasised without
  // dominating. Tunable here if it still feels off.
  const pxPerMeter = Math.abs(levelToScreen(1) - levelToScreen(0))
  const labelFontSize = Math.max(8, Math.min(13, Math.round(pxPerMeter * 0.6)))

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
      if (!sourceCol) continue
      // No direct contactById guards here: the framing contacts may be UNSEEDED
      // on this section (the explicit-content filter), in which case
      // ``worldPtEdge`` resolves them from the litho layer instead. The
      // per-point ``if (!topSource) / if (!baseSource)`` checks below still bail
      // when neither a contact nor a layer resolves.

      let upperScreen: { x: number; y: number }[]
      let lowerScreen: { x: number; y: number }[]

      if (candidate.kind === 'open') {
        // Edge test — open the layer a fixed length past the source column
        // (configurable; default 3 m), not to the section boundary
        // (dogfeed 2026-06-02). No neighbour.
        const towardAlong =
          candidate.side === 'left'
            ? sourceCol.along - openExtentLengthM
            : sourceCol.along + openExtentLengthM
        const topSource = worldPtEdge(candidate.above_contact_id, towardAlong)
        if (!topSource) continue
        // When below_contact_id is null, the formation is the deepest on the
        // column — use the hole bottom so the ghost aligns with the litho band.
        const baseElev =
          candidate.below_contact_id === null
            ? openDeepestBaseElevation(sourceCol)
            : (worldPtEdge(candidate.below_contact_id, towardAlong)?.elevation_m ?? null)
        if (baseElev === null) continue
        const topFar: WorldPt = { along_m: towardAlong, elevation_m: topSource.elevation_m }
        const baseSourcePt: WorldPt = { along_m: topSource.along_m, elevation_m: baseElev }
        const baseFar: WorldPt = { along_m: towardAlong, elevation_m: baseElev }
        upperScreen = [toScreen(topSource), toScreen(topFar)]
        lowerScreen = [toScreen(baseSourcePt), toScreen(baseFar)]
      } else {
        // Interior — pinch out halfway toward the suggested neighbour.
        const neighbourId = candidate.suggested_neighbour_investigation_id
        const neighbourCol = neighbourId ? colByInv.get(neighbourId) : undefined
        if (!neighbourCol) continue
        const towardAlong = neighbourCol.along
        const topSource = worldPtEdge(candidate.above_contact_id, towardAlong)
        // Non-open candidates always carry a below_contact_id (they are interior
        // pinch_out_halfway with a framed top + base). The open block above
        // handles the null case; guard explicitly here rather than assert.
        if (!candidate.below_contact_id) continue
        const baseSource = worldPtEdge(candidate.below_contact_id, towardAlong)
        if (!topSource || !baseSource) continue
        const farPoint: WorldPt = halfwayFarPoint(sourceCol, neighbourCol, topSource, baseSource)
        const far = toScreen(farPoint)
        upperScreen = [far, toScreen(topSource)]
        lowerScreen = [far, toScreen(baseSource)]
      }

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

        // Auto-label (lithology + stacking number), or the explicit name when
        // set. Rendered once per body (primary wedge) at the triangle centroid
        // with a dark halo so it reads over the teal fill.
        const labelBodyItem = bodyById.get(body.bodyId)
        const formationLabel = labelBodyItem
          ? formationLabelById?.get(labelBodyItem.formation_id)
          : undefined
        const depthRank = stackingByBodyId.get(body.bodyId) ?? 1
        const wedgeLabel =
          labelBodyItem && formationLabel
            ? lensDisplayLabel(labelBodyItem.name, formationLabel, depthRank)
            : (labelBodyItem?.name?.trim() ?? '')
        // Centre the label on the lens fill's area centroid (true visual
        // centre for any shape — wedge / band / bilateral). Empty fill → fall
        // back to the source-edge midpoint.
        const labelCentroid =
          fillPts.length >= 3
            ? polygonCentroid(fillPts)
            : {
                x: (toScreen(body.topSource).x + toScreen(body.baseSource).x) / 2,
                y: (toScreen(body.topSource).y + toScreen(body.baseSource).y) / 2,
              }

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
            {/* Auto-name label (lithology + stacking number) — primary wedge
                only, with a dark halo so it reads over the teal fill. */}
            {body.isPrimary && wedgeLabel && (
              <text
                data-testid={`body-label-${body.wedgeKey}`}
                x={labelCentroid.x}
                y={labelCentroid.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={labelFontSize}
                fontWeight={600}
                fill="#e2e8f0"
                stroke="#0f172a"
                strokeWidth={Math.max(2, labelFontSize / 4)}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {wedgeLabel}
              </text>
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
        // Key must include the framing contacts: one column with several units
        // pinching out on the same side produces multiple wedges that share
        // source+side, so source+side alone collides (dogfeed 2026-06-03). This
        // mirrors the canonical candidate identity used by sameGhostCandidate.
        <g
          key={`ghost-${ghost.candidate.source_investigation_id}-${ghost.candidate.side}-${ghost.candidate.above_contact_id}-${ghost.candidate.below_contact_id ?? 'open'}`}
        >
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
                pointerEvents:
                  onRequestClaimGhostCandidate ?? onGhostContextMenu ? 'auto' : 'none',
                cursor:
                  onRequestClaimGhostCandidate ?? onGhostContextMenu ? 'pointer' : undefined,
              }}
              onClick={
                onRequestClaimGhostCandidate
                  ? e => {
                      e.stopPropagation()
                      onRequestClaimGhostCandidate(ghost.candidate)
                    }
                  : undefined
              }
              onContextMenu={
                onGhostContextMenu
                  ? e => {
                      // Prevent the browser context menu AND stop the event
                      // bubbling to the lower-layer "Remove this litho unit"
                      // context menu handler on the column bands.
                      e.preventDefault()
                      e.stopPropagation()
                      const svgRect =
                        rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                      const svgX = e.clientX - (svgRect?.left ?? 0)
                      const svgY = e.clientY - (svgRect?.top ?? 0)
                      onGhostContextMenu(ghost.candidate, svgX, svgY)
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
