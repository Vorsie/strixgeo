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
 * Three independent gesture surfaces live here:
 *
 * 1. **Lens-edge freedraw** (amber handles, ``LensDrag``): shapes the top or
 *    base polyline edge of an enclosed lens. For a left lens the top edge is
 *    stored in ``upper_nodes``, the base edge in ``lower_nodes``. For a right
 *    lens the mapping is reversed. Each edge is an ordered polyline; nodes are
 *    sorted left→right. The lens polygon is reconstructed from the source
 *    corners plus the stored polyline nodes so that zero stored nodes falls
 *    back to the legacy single-apex default (``LENS_PINCH_FRACTION`` at
 *    mid-elevation).
 *
 * 2. **Matched-boundary freedraw** (slate/blue handles, ``BoundaryDrag``):
 *    moves any of the N control points on the shared edge between two
 *    CONSECUTIVE MAIN regions (kind ``'quad'`` or ``'pinch'``, NOT ``'lens'``)
 *    in the same gap. Inserting the SAME point set into BOTH polygons on the
 *    shared edge keeps the fill a true partition after the bend (upper region's
 *    base edge and lower region's top edge remain identical). All N nodes are
 *    stored in ``lower_nodes`` on the UPPER body — safe because an upper body
 *    in a matched pair is a two-column body, never a lens, so its
 *    ``lower_nodes`` are otherwise unused by the lens-edge code path.
 *
 * 3. **Add-strip click**: a transparent hover-sensitive polyline along each
 *    shapeable boundary allows a plain left-click anywhere on the shared edge
 *    (or lens edge) to INSERT a new control point at the cursor position.
 *    Right-clicking an existing handle REMOVES that node. Neither action
 *    interferes with the body context menu: the context menu fires only on the
 *    filled region itself, and the node-remove right-click calls
 *    ``stopPropagation`` so the region's ``onContextMenu`` never sees it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import {
  computeSectionFill,
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionUnit,
  type PartitionRegion,
  LENS_PINCH_FRACTION,
  lensApexOverrideKey,
} from '../../utils/partitionFill'
import { nearerLensEdge } from '../../utils/lensEdgePick'
import type { PlacedColumn } from './utils'

/**
 * Props for the partition fill overlay. Self-contained since the retirement
 * of ``MorphFillOverlay`` (2026-06-05) — this overlay is the sole owner of the
 * section litho fill + its pinch / lens shaping.
 */
export interface Props {
  /** Accepted litho layers carrying ``body_id`` + the unit's depth interval. */
  lithoLayers: readonly LithoLayerResponse[]
  /**
   * Contact correlation edges (each links two ``litho_layer`` ids). The fill
   * BANDS two units iff an APPROVED edge connects them — the trustworthy
   * correlation signal, vs the resolver's over-lumped ``body_id``. Geometry only
   * fills the uncorrelated remainder. Absent → no explicit bands (all geometry).
   */
  contactEdges?: readonly LithoContactCorrelationEdge[]
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
// Matched-boundary node handle radius + transparent hit halo.
const BOUNDARY_R = 3
const BOUNDARY_HIT_R = 10
const BOUNDARY_COLOR = '#38bdf8' // sky-400 (slate/blue)
// Lens-edge node handle radius + hit halo (amber, same family as old apex).
const LENS_R = 5
const LENS_HIT_R = 11
const LENS_COLOR = '#f59e0b' // amber-400
// Zoom reference: at/above this horizontal scale (px per along-metre) the
// handle is FULL size (its zoomed-in size); zooming OUT (fewer px/m) shrinks it
// toward HANDLE_MIN_SCALE so the markers don't crowd a compressed section.
const HANDLE_REF_PX_PER_M = 2.5
const HANDLE_MIN_SCALE = 0.5
// Px tolerance for "this lens node belongs to this gap" (its along-x falls
// within the gap's screen extent). A two-gap lens's apexes live in different
// gaps, so each gap renders + edits only its own node.
const NODE_OWN_EPS = 0.5
// Width (px) of the transparent add-strip polyline hit area along each boundary.
const ADDSTRIP_HIT_W = 14

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

interface ColumnScreen {
  rightX: number
  leftX: number
  along: number
}

// ---------------------------------------------------------------------------
// Drag state types
// ---------------------------------------------------------------------------

/**
 * A live drag of ONE control-point node on a matched boundary.
 *
 * ``nodeIndex`` is the 0-based index of the dragged node in the CURRENT
 * lower_nodes array for this gap (after filtering to this gap's range).
 * ``minY`` / ``maxY`` are the y-clamp bounds derived from the upper body's top
 * and the lower body's base.
 */
interface BoundaryDrag {
  upperBodyId: string
  lowerBodyId: string
  /** Index into the within-gap node array of the node being dragged. */
  nodeIndex: number
  /** Live cursor x (clamped to gap). */
  x: number
  /** Live cursor y (clamped to [minY, maxY]). */
  y: number
  /** Upper body top screen-y (smallest y = highest elevation). */
  minY: number
  /** Lower body base screen-y (largest y = deepest elevation). */
  maxY: number
  /** Gap's facing-edge screen x values for along-range splice on save. */
  leftX: number
  rightX: number
}

/**
 * A live drag of ONE node on a lens edge polyline.
 *
 * ``edge`` identifies which polyline the node belongs to:
 *   - Left lens:  'upper' = top edge (upper_nodes), 'lower' = base edge (lower_nodes).
 *   - Right lens: 'upper' = top edge (upper_nodes), 'lower' = base edge (lower_nodes).
 *
 * The lens body constrains node x to [leftX, rightX] and y to
 * [lensTopY, lensBaseY] so the node stays within the enclosing matrix band.
 */
interface LensDrag {
  bodyId: string
  /**
   * Index of the grabbed lens region in ``screenRegions``. A lens body that
   * pinches into TWO gaps renders two regions with the SAME ``bodyId``; this
   * discriminates which copy is being dragged so the other stays put.
   */
  regionIdx: number
  side: 'left' | 'right'
  edge: 'upper' | 'lower'
  nodeIndex: number
  x: number
  y: number
  /** Gap left/right x — clamp for along_m. */
  leftX: number
  rightX: number
  /** Lens elevation band in screen coords — clamp for elevation_m. */
  lensTopY: number
  lensBaseY: number
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

/**
 * One shared boundary between two consecutive main (non-lens) regions in the
 * same gap. Carries N control points (multi-node freedraw).
 *
 * ``nodes`` is the resolved list of screen-coordinate control points for this
 * gap, sorted left→right. It may be empty (no stored nodes → natural straight
 * edge, no handles rendered).
 */
interface SharedBoundary {
  upperBodyId: string
  lowerBodyId: string
  upperIdx: number
  lowerIdx: number
  /** Resolved handle positions, sorted left→right. Empty = natural straight edge. */
  nodes: { x: number; y: number; nodeIndex: number }[]
  /** Screen-y clamp bounds (upper body top y and lower body base y). */
  minY: number
  maxY: number
  leftX: number
  rightX: number
  /**
   * A polyline through the natural base edge of the upper region, used to
   * position the add-strip. This is [[x0, y0], [x1, y1]] — the two endpoints
   * of the upper polygon's base edge (screen coords).
   */
  naturalEdge: [{ x: number; y: number }, { x: number; y: number }]
}

/**
 * One lens region mapped to screen, augmented with its per-edge node handles
 * and add-strip geometry for the freedraw gesture.
 */
interface ScreenLens {
  /** Index into screenRegions. */
  regionIdx: number
  bodyId: string
  side: 'left' | 'right'
  /**
   * Top-edge polyline nodes OWNED by this gap (upper_nodes on left lens; same
   * for right). ``nodeIndex`` is the index in the body's stored ``upper_nodes``
   * array (preserved through the per-gap ownership filter) so a drag persists to
   * the right slot.
   */
  upperNodes: { x: number; y: number; nodeIndex: number }[]
  /** Base-edge polyline nodes (lower_nodes) owned by this gap. */
  lowerNodes: { x: number; y: number; nodeIndex: number }[]
  /** Source column corner in screen coords (fraction 0 or 1 = column edge). */
  sourceTopPt: { x: number; y: number }
  sourceBasePt: { x: number; y: number }
  /** Gap x-extent for along_m clamping. */
  leftX: number
  rightX: number
  /** Lens elevation band screen-y bounds for clamping. */
  lensTopY: number
  lensBaseY: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a lens polygon from the source corner points + multi-node
 * upper/lower edge polylines.
 *
 * The lens polygon is:
 *   [sourceTop, ...upperNodes sorted left→right, ...lowerNodes reverse-sorted, sourceBase]
 *
 * When both node arrays are empty, falls back to the legacy single-apex
 * default at ``LENS_PINCH_FRACTION`` × mid-elevation.
 *
 * WHY two separate edge polylines: the top taper and base taper of a lens
 * can have independent curvatures — the engineer may want a flat top and a
 * steeply-tapering base, or vice versa. Separating them into upper/lower
 * arrays lets each edge carry its own set of N waypoints.
 */
function buildLensPolygon(
  sourceTopPt: { x: number; y: number },
  sourceBasePt: { x: number; y: number },
  upperNodes: { x: number; y: number }[],
  lowerNodes: { x: number; y: number }[],
  leftX: number,
  rightX: number,
  side: 'left' | 'right',
): { x: number; y: number }[] {
  // With no stored nodes fall back to the legacy single-apex triangle so an
  // un-shaped lens still renders correctly.
  if (upperNodes.length === 0 && lowerNodes.length === 0) {
    const gapW = rightX - leftX
    const apexFraction = side === 'left' ? LENS_PINCH_FRACTION : 1 - LENS_PINCH_FRACTION
    const apexX = leftX + apexFraction * gapW
    const apexY = (sourceTopPt.y + sourceBasePt.y) / 2
    return [sourceTopPt, { x: apexX, y: apexY }, sourceBasePt]
  }

  // Sort upper nodes left→right; lower nodes right→left (reverse) so the
  // polygon winding is correct: top-edge forward, base-edge backward.
  const upSorted = [...upperNodes].sort((a, b) => a.x - b.x)
  const dnReverse = [...lowerNodes].sort((a, b) => b.x - a.x)

  return [sourceTopPt, ...upSorted, ...dnReverse, sourceBasePt]
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * SVG coordinates + colour for the add-strip hover preview dot (Task 2,
 * owner directive 2026-06-05 litho declutter). Stored as state so React
 * re-renders the single preview circle on every mousemove over an add-strip
 * and removes it on mouseleave.
 *
 * ``color`` is the strip's gesture colour: sky-400 (#38bdf8) for a matched-
 * boundary strip, amber-400 (#f59e0b) for a lens strip — mirrors the stored
 * handle colour so the preview telegraphs what the click will produce.
 */
interface AddNodePreview {
  x: number
  y: number
  color: string
}

/** Render the partition fill (+ labels, open-end stubs, context menu). */
export default function PartitionFillOverlay({
  lithoLayers,
  contactEdges,
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
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDrag | null>(null)
  const [lensDrag, setLensDrag] = useState<LensDrag | null>(null)
  // Owner directive 2026-06-05 (litho declutter, Task 2): single dot at the
  // cursor position while hovering an add-strip, cleared on mouseleave.
  // One piece of state suffices — only one add-strip can be hovered at a time.
  const [addNodePreview, setAddNodePreview] = useState<AddNodePreview | null>(null)
  const bodyById = useMemo(() => new Map((bodies ?? []).map((b) => [b.id, b])), [bodies])

  // Helper: compute SVG coords from a React synthetic mouse event.
  // Reads the ownerSVGElement bounding rect at call time (cheap DOM read,
  // same pattern as the click handlers above).
  const svgCoordsFromEvent = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
      return {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      }
    },
    [],
  )

  // -------------------------------------------------------------------------
  // Matched-boundary multi-node drag
  //
  // Dragging one of the N nodes on a matched boundary live-updates its screen
  // position; mouseup persists the full lower_nodes array for this gap (splice
  // by gap along-range so other gaps' nodes are preserved).
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!boundaryDrag) return
    const svg = rootRef.current?.ownerSVGElement
    const move = (e: MouseEvent): void => {
      const rect = svg?.getBoundingClientRect()
      const rawY = e.clientY - (rect?.top ?? 0)
      // 1 px margin on each bound avoids zero-height upper or lower body.
      const clampedY = Math.max(boundaryDrag.minY + 1, Math.min(boundaryDrag.maxY - 1, rawY))
      // Clamp x to THIS gap (left-col right edge → right-col left edge), like the
      // lens drag. Without it the node can be dragged UNDER a column strip (in
      // neither gap), where the fraction clamp then pins it to fraction 1 in the
      // left gap AND 0 in the right gap — so it renders on BOTH sides of the test
      // column instead of staying on the side being dragged.
      const rawX = e.clientX - (rect?.left ?? 0)
      const clampedX = Math.max(boundaryDrag.leftX, Math.min(boundaryDrag.rightX, rawX))
      setBoundaryDrag({
        ...boundaryDrag,
        x: clampedX,
        y: clampedY,
      })
    }
    const up = (): void => {
      if (onSaveBoundary && screenXToAlong && screenToLevel) {
        const existing = boundariesByBodyId?.get(boundaryDrag.upperBodyId)
        // All existing nodes in OTHER gaps (outside this gap's along range).
        const otherGapNodes = (existing?.lower_nodes ?? []).filter((n) => {
          if (!alongToScreenX) return false
          const sx = alongToScreenX(n.along_m)
          return sx < boundaryDrag.leftX || sx > boundaryDrag.rightX
        })
        // Current in-gap nodes (already resolved in screenRegions pass), replacing
        // the one at nodeIndex with the live drag position.
        const inGapNodes = (existing?.lower_nodes ?? [])
          .filter((n) => {
            if (!alongToScreenX) return false
            const sx = alongToScreenX(n.along_m)
            return sx >= boundaryDrag.leftX && sx <= boundaryDrag.rightX
          })
          .map((n, i) => {
            if (i === boundaryDrag.nodeIndex) {
              return {
                along_m: screenXToAlong(boundaryDrag.x),
                elevation_m: screenToLevel(boundaryDrag.y),
              }
            }
            return n
          })

        onSaveBoundary(
          boundaryDrag.upperBodyId,
          existing?.upper_nodes ?? [],
          [...otherGapNodes, ...inGapNodes],
          'straight',
        )
      }
      setBoundaryDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [
    boundaryDrag,
    onSaveBoundary,
    screenXToAlong,
    screenToLevel,
    boundariesByBodyId,
    alongToScreenX,
  ])

  // -------------------------------------------------------------------------
  // Lens-edge multi-node drag
  //
  // Dragging a node on a lens's upper or lower edge polyline live-updates it;
  // mouseup persists both edge arrays (the untouched edge is preserved verbatim).
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lensDrag) return
    const svg = rootRef.current?.ownerSVGElement
    const move = (e: MouseEvent): void => {
      const rect = svg?.getBoundingClientRect()
      const rawX = e.clientX - (rect?.left ?? 0)
      const rawY = e.clientY - (rect?.top ?? 0)
      // Clamp to the gap's x-extent and the lens's elevation band.
      const cx = Math.max(lensDrag.leftX, Math.min(lensDrag.rightX, rawX))
      const cy = Math.max(lensDrag.lensTopY, Math.min(lensDrag.lensBaseY, rawY))
      setLensDrag({ ...lensDrag, x: cx, y: cy })
    }
    const up = (): void => {
      if (onSaveBoundary && screenXToAlong && screenToLevel) {
        const existing = boundariesByBodyId?.get(lensDrag.bodyId)
        const newNode: BodyBoundaryNode = {
          along_m: screenXToAlong(lensDrag.x),
          elevation_m: screenToLevel(lensDrag.y),
        }

        const upperArr = (existing?.upper_nodes ?? []).slice()
        const lowerArr = (existing?.lower_nodes ?? []).slice()

        if (lensDrag.edge === 'upper') {
          upperArr[lensDrag.nodeIndex] = newNode
        } else {
          lowerArr[lensDrag.nodeIndex] = newNode
        }

        onSaveBoundary(lensDrag.bodyId, upperArr, lowerArr, 'straight')
      }
      setLensDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [lensDrag, onSaveBoundary, screenXToAlong, screenToLevel, boundariesByBodyId])

  // Build each column's gap-free unit stack + its screen x-edges (identical to
  // the morph overlay — the partition consumes the same PartitionColumn input).
  const { orderedInvs, colByInv, screenByInv } = useMemo(() => {
    const unitsByInv = new Map<string, PartitionUnit[]>()
    for (const layer of lithoLayers) {
      if (layer.status !== 'accepted') continue
      const inv = layer.cpt_id ?? layer.borehole_id
      if (!inv) continue
      const unit: PartitionUnit = {
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
        layerId: layer.id, // what correlation edges reference (the band signal)
      }
      const bucket = unitsByInv.get(inv)
      if (bucket) bucket.push(unit)
      else unitsByInv.set(inv, [unit])
    }

    const cols = new Map<string, PartitionColumn>()
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

  // Ghost-node handle size shrinks as you zoom OUT (fewer px per metre) so the
  // markers don't crowd a compressed section; at/above the reference scale they
  // stay their full zoomed-in size. Clamped so they never vanish.
  const handleScale = alongToScreenX
    ? Math.max(
        HANDLE_MIN_SCALE,
        Math.min(1, Math.abs(alongToScreenX(1) - alongToScreenX(0)) / HANDLE_REF_PX_PER_M),
      )
    : 1
  const lensR = LENS_R * handleScale
  const lensHitR = LENS_HIT_R * handleScale

  // ---- Compute every gap's partition once, mapped to screen polygons. ------
  // (fraction 0..1 → x between the two columns' facing edges; elevation → y.)
  //
  // After the initial mapping, a POST-BEND pass inserts ALL N control points
  // into each pair of consecutive MAIN (non-lens) regions that share an edge
  // in the same gap.  Inserting the SAME points into BOTH polygons keeps the
  // fill a true partition after the bend: the upper region's base edge and the
  // lower region's top edge remain identical at every control point.
  //
  // Polygon edge conventions (from partitionFill.ts buildQuadPolygon):
  //   Quad:  [topL, topR, baseR, baseL] — BASE = last two verts (idx n-2, n-1).
  //   Pinch: last two verts are also the base.  TOP = first two verts (idx 0, 1).
  //
  // We identify the base edge as polygon[n-2] → polygon[n-1] and the top
  // edge as polygon[0] → polygon[1].  Inserting control points BETWEEN those
  // two verts (in sorted-by-x order) keeps the winding order correct.
  const screenRegions = useMemo(() => {
    if (!showBands) return [] as ScreenRegion[]
    const out: ScreenRegion[] = []

    // Valid columns in along-section order (have both unit data + screen edges).
    const valid = orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    const orderedColumns = valid.map((id) => colByInv.get(id) as PartitionColumn)
    if (orderedColumns.length < 2) return out
    const gapLeftX = (i: number): number => (screenByInv.get(valid[i]) as ColumnScreen).rightX
    const gapRightX = (i: number): number => (screenByInv.get(valid[i + 1]) as ColumnScreen).leftX

    // Lens shape overrides, keyed PER (body, gap). Each gap reads only the
    // boundary nodes it OWNS (their along-position falls inside the gap) and
    // feeds the full freedraw shape (upper + lower edge chains, gap-local
    // fraction/elevation, with the live drag applied to the dragged node) to the
    // DOMAIN. The domain builds AND clips the lens (rides the matrix seam) + cuts
    // a matching notch, so the overlay no longer rebuilds it un-clipped (which let
    // a straddle lens cross into the neighbour). Per-gap keys keep a two-gap
    // lens's apexes independent.
    const apexOverrides = new Map<string, LensApexOverride>()
    for (let i = 0; i < orderedColumns.length - 1; i += 1) {
      const leftX = gapLeftX(i)
      const rightX = gapRightX(i)
      if (rightX <= leftX || !alongToScreenX) continue
      const gapW = rightX - leftX
      const left = orderedColumns[i]
      const right = orderedColumns[i + 1]
      const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      // Owned nodes → gap-local (fraction, elevation); the node being dragged
      // takes the live cursor position so the domain rebuilds the lens in real time.
      const chain = (
        nodes: readonly BodyBoundaryNode[],
        bodyId: string,
        edge: 'upper' | 'lower',
      ): { fraction: number; elevation: number }[] => {
        const out: { fraction: number; elevation: number }[] = []
        nodes.forEach((n, ni) => {
          const x = alongToScreenX!(n.along_m)
          if (x < leftX - NODE_OWN_EPS || x > rightX + NODE_OWN_EPS) return // neighbour gap's node
          const dragging =
            !!lensDrag &&
            lensDrag.bodyId === bodyId &&
            Math.abs(lensDrag.leftX - leftX) < 0.5 &&
            lensDrag.edge === edge &&
            lensDrag.nodeIndex === ni
          if (dragging) {
            out.push({
              fraction: clamp01((lensDrag.x - leftX) / gapW),
              elevation: screenToLevel ? screenToLevel(lensDrag.y) : n.elevation_m,
            })
          } else {
            out.push({ fraction: clamp01((x - leftX) / gapW), elevation: n.elevation_m })
          }
        })
        return out
      }
      const setShape = (bodyId: string): void => {
        const b = boundariesByBodyId?.get(bodyId)
        if (!b) return
        const upper = chain(b.upper_nodes ?? [], bodyId, 'upper')
        const lower = chain(b.lower_nodes ?? [], bodyId, 'lower')
        if (upper.length + lower.length === 0) return // no owned node → domain default apex
        const apex0 = upper[0] ?? lower[0]
        apexOverrides.set(lensApexOverrideKey(bodyId, i), {
          fraction: apex0.fraction,
          elevation: apex0.elevation,
          upper,
          lower,
        })
      }
      for (const id of leftIds) if (!rightIds.has(id)) setShape(id)
      for (const id of rightIds) if (!leftIds.has(id)) setShape(id)
    }

    // Bands come from the APPROVED correlation edges (layer-id pairs) — the
    // trustworthy signal — NOT the over-lumped body_id. Geometry only fills the
    // uncorrelated remainder.
    const edges: CorrelationEdge[] = (contactEdges ?? [])
      .filter((e) => e.user_approved)
      .map((e) => ({ a: e.contact_a_id, b: e.contact_b_id }))

    // WHOLE-SECTION resolve: reduce each column ONCE against BOTH its neighbours
    // (not per gap, which drifts and breaks a body's continuity through a shared
    // column — the dogfeed peat-discontinuity bug). Regions carry ``gapIndex``.
    const sectionRegions = computeSectionFill(orderedColumns, edges, apexOverrides)

    for (let i = 0; i < orderedColumns.length - 1; i += 1) {
      const leftX = gapLeftX(i)
      const rightX = gapRightX(i)
      if (rightX <= leftX) continue

      for (const region of sectionRegions.filter((r) => r.gapIndex === i)) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        const points = region.polygon.map((p) => {
          const x = leftX + p.fraction * (rightX - leftX)
          const y = Math.max(plotTop, Math.min(plotBottom, levelToScreen(p.elevation)))
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          return { x, y }
        })
        out.push({ region, points, leftX, rightX, minX, maxX, minY, maxY })
      }

      // ----- POST-BEND PASS for matched-boundary multi-node control points. -----
      // Within this gap, find consecutive MAIN (non-lens) regions. The partition
      // algorithm emits main regions top→bottom first, lenses last, so we scan
      // the tail of ``out`` for the regions just added.
      //
      // For each consecutive main pair (upper, lower):
      //   • Collect ALL in-gap lower_nodes for the upper body (multi-node).
      //   • Sort them by x position left→right.
      //   • Apply live-drag override to the dragged node's position.
      //   • Insert ALL control points into the BASE edge of the upper polygon
      //     AND the TOP edge of the lower polygon (same points in both → partition
      //     invariant preserved: the shared edge is identical in both polygons).
      const mainIdxInGap: number[] = []
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].leftX !== leftX || out[k].rightX !== rightX) break
        if (out[k].region.kind !== 'lens') mainIdxInGap.unshift(k)
      }

      for (let mi = 0; mi + 1 < mainIdxInGap.length; mi += 1) {
        const upperIdx = mainIdxInGap[mi]
        const lowerIdx = mainIdxInGap[mi + 1]
        const upper = out[upperIdx]
        const lower = out[lowerIdx]
        if (!upper.region.bodyId || !lower.region.bodyId) continue

        const uId = upper.region.bodyId
        const lId = lower.region.bodyId

        // Clamp bounds: upper's top y (minY) and lower's base y (maxY).
        const clampMinY = upper.minY + 1
        const clampMaxY = lower.maxY - 1

        // Collect all in-gap nodes for this upper body from the store.
        const inGapNodes: { x: number; y: number }[] = []

        if (boundariesByBodyId && alongToScreenX && screenToLevel) {
          const storedBnd = boundariesByBodyId.get(uId)
          const stored = (storedBnd?.lower_nodes ?? []).filter((n) => {
            const nx = alongToScreenX(n.along_m)
            return nx >= leftX && nx <= rightX
          })
          for (let ni = 0; ni < stored.length; ni += 1) {
            const n = stored[ni]
            let cx = Math.max(leftX + 1, Math.min(rightX - 1, alongToScreenX(n.along_m)))
            let cy = Math.max(clampMinY, Math.min(clampMaxY, levelToScreen(n.elevation_m)))
            // Apply live drag override if this is the dragged node.
            if (
              boundaryDrag &&
              boundaryDrag.upperBodyId === uId &&
              boundaryDrag.lowerBodyId === lId &&
              boundaryDrag.nodeIndex === ni
            ) {
              cx = Math.max(leftX + 1, Math.min(rightX - 1, boundaryDrag.x))
              cy = boundaryDrag.y // already clamped in the mousemove handler
            }
            inGapNodes.push({ x: cx, y: cy })
          }
        }

        if (inGapNodes.length === 0) continue // no stored nodes → straight edge

        // Sort control points left→right so the polygon winding is preserved.
        inGapNodes.sort((a, b) => a.x - b.x)

        // Insert ALL control points into the upper region's BASE edge
        // (between pts[n-2] and pts[n-1]) and into the lower region's TOP edge
        // (between pts[0] and pts[1]).  Using the SAME array in both polygons
        // ensures the shared edge is identical — the partition invariant holds.
        const uPts = upper.points
        const n = uPts.length
        upper.points = [
          ...uPts.slice(0, n - 1), // [topL, ..., baseR] inclusive
          ...inGapNodes,
          uPts[n - 1], // baseL
        ]

        const lPts = lower.points
        lower.points = [lPts[0], ...inGapNodes, ...lPts.slice(1)]

        // Recompute bounds for both regions after point insertion.
        for (const sr of [upper, lower]) {
          let mxn = Infinity
          let mxx = -Infinity
          let myn = Infinity
          let myx = -Infinity
          for (const pt of sr.points) {
            if (pt.x < mxn) mxn = pt.x
            if (pt.x > mxx) mxx = pt.x
            if (pt.y < myn) myn = pt.y
            if (pt.y > myx) myx = pt.y
          }
          sr.minX = mxn
          sr.maxX = mxx
          sr.minY = myn
          sr.maxY = myx
        }
      }

      // ----- POST-LENS PASS: rebuild lens polygons from multi-node edges. -----
      // For each lens region in this gap, if the body has stored upper_nodes or
      // lower_nodes (the freedraw polyline), replace the legacy triangle polygon
      // with the freedraw polygon built from the source corners + edge nodes.
      //
      // This is done in the overlay (not in partitionFill.ts) because it involves
      // screen coordinates: the source corners come from the polygon's fraction-0
      // or fraction-1 screen points, which are already computed above.
      //
      // WHY upper_nodes / lower_nodes for a lens: the top taper and base taper
      // have independent shapes (unlike a matched boundary where both adjacent
      // regions consume the SAME set of nodes). Separating them preserves
      // per-edge freedom without entangling the two regions.
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].leftX !== leftX || out[k].rightX !== rightX) break
        const sr = out[k]
        if (sr.region.kind !== 'lens') continue
        const bodyId = sr.region.bodyId
        if (!bodyId || !onSaveBoundary) continue // only when saving is wired
        // The domain now owns the freedraw shape (built + clipped + notched) when
        // an override carries this body's chains for this gap — skip the legacy
        // un-clipped rebuild so a straddle lens can't cross the seam.
        if (apexOverrides.has(lensApexOverrideKey(bodyId, i))) continue

        const b = boundariesByBodyId?.get(bodyId)
        const upperStored = b?.upper_nodes ?? []
        const lowerStored = b?.lower_nodes ?? []
        // Only the nodes this gap OWNS (along-x inside the gap) shape its lens — a
        // two-gap lens's other apex lives in the neighbour gap. With no owned
        // node, keep the domain (default-apex) polygon so it matches the notch.
        const ownsNode = (n: BodyBoundaryNode): boolean => {
          if (!alongToScreenX) return false
          const x = alongToScreenX(n.along_m)
          return x >= leftX - NODE_OWN_EPS && x <= rightX + NODE_OWN_EPS
        }
        if (upperStored.filter(ownsNode).length + lowerStored.filter(ownsNode).length === 0) {
          continue
        }

        // Determine lens side from the polygon's first corner fraction.
        const side: 'left' | 'right' = sr.region.polygon[0].fraction === 0 ? 'left' : 'right'

        // Source corners in screen coords: fraction=0 or fraction=1 → column edge.
        const gapW = rightX - leftX
        const srcTop = sr.region.polygon[0]
        const srcBase = sr.region.polygon[sr.region.polygon.length - 1]
        const sourceTopPt = {
          x: leftX + srcTop.fraction * gapW,
          y: Math.max(plotTop, Math.min(plotBottom, levelToScreen(srcTop.elevation))),
        }
        const sourceBasePt = {
          x: leftX + srcBase.fraction * gapW,
          y: Math.max(plotTop, Math.min(plotBottom, levelToScreen(srcBase.elevation))),
        }

        // Map stored nodes to screen coords; apply live drag overrides.
        const toScreen = (
          nodes: readonly BodyBoundaryNode[],
          edge: 'upper' | 'lower',
        ): { x: number; y: number }[] => {
          if (!alongToScreenX || !levelToScreen) return []
          const pts: { x: number; y: number }[] = []
          nodes.forEach((n, ni) => {
            if (!ownsNode(n)) return // node belongs to the neighbour gap
            if (
              lensDrag &&
              lensDrag.regionIdx === k &&
              lensDrag.bodyId === bodyId &&
              lensDrag.edge === edge &&
              lensDrag.nodeIndex === ni
            ) {
              pts.push({ x: lensDrag.x, y: lensDrag.y })
              return
            }
            pts.push({
              x: Math.max(leftX, Math.min(rightX, alongToScreenX!(n.along_m))),
              y: Math.max(plotTop, Math.min(plotBottom, levelToScreen!(n.elevation_m))),
            })
          })
          return pts
        }

        const upperPts = toScreen(upperStored, 'upper')
        const lowerPts = toScreen(lowerStored, 'lower')

        // Rebuild the polygon.
        sr.points = buildLensPolygon(sourceTopPt, sourceBasePt, upperPts, lowerPts, leftX, rightX, side)

        // Recompute bounds.
        let mxn = Infinity; let mxx = -Infinity; let myn = Infinity; let myx = -Infinity
        for (const pt of sr.points) {
          if (pt.x < mxn) mxn = pt.x
          if (pt.x > mxx) mxx = pt.x
          if (pt.y < myn) myn = pt.y
          if (pt.y > myx) myx = pt.y
        }
        sr.minX = mxn; sr.maxX = mxx; sr.minY = myn; sr.maxY = myx
      }
    }
    return out
  }, [
    orderedInvs,
    colByInv,
    screenByInv,
    contactEdges,
    showBands,
    levelToScreen,
    plotTop,
    plotBottom,
    boundaryDrag,
    lensDrag,
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
      if (hiX - loX < 4) continue
      out.push({ key: id, x: (loX + hiX) / 2, y: (sr.minY + sr.maxY) / 2, text })
    }
    return out
  }, [screenRegions, formationLabelById, plotLeft, plotRight])

  // ---- Collect shared boundaries with their multi-node handle arrays. ------
  //
  // Walk screenRegions: within each gap (identified by leftX:rightX), track
  // the last non-lens region.  When the next non-lens arrives in the same gap,
  // emit a SharedBoundary with ALL resolved control-point handles for that edge.
  //
  // Handle resolution for each gap's nodes:
  //   • Pull all lower_nodes for the upper body whose along_m maps into this gap.
  //   • Map each to screen coords via alongToScreenX / levelToScreen.
  //   • Apply the live boundaryDrag override to the dragged node if applicable.
  //   • Sort left→right.
  //
  // The natural edge (no nodes) is available via the upper polygon's last two
  // vertices — used to position the add-strip polyline.
  const sharedBoundaries = useMemo((): SharedBoundary[] => {
    if (!onSaveBoundary) return []
    const out: SharedBoundary[] = []
    const lastMainByGap = new Map<string, number>()

    for (let idx = 0; idx < screenRegions.length; idx += 1) {
      const sr = screenRegions[idx]
      if (sr.region.kind === 'lens') continue
      if (!sr.region.bodyId) continue

      const gapKey = `${sr.leftX}:${sr.rightX}`
      const prevIdx = lastMainByGap.get(gapKey)
      if (prevIdx !== undefined) {
        const upper = screenRegions[prevIdx]
        const lower = sr
        const uId = upper.region.bodyId!
        const lId = lower.region.bodyId!

        // Clamp bounds for the drag.
        const minY = upper.minY + 1
        const maxY = lower.maxY - 1

        // Natural edge endpoints (upper polygon's last two vertices = base edge).
        const uPts = upper.points
        const nu = uPts.length
        const naturalEdge: SharedBoundary['naturalEdge'] = [
          { x: uPts[nu - 2].x, y: uPts[nu - 2].y },
          { x: uPts[nu - 1].x, y: uPts[nu - 1].y },
        ]

        // Resolve per-node handle positions.
        const nodes: SharedBoundary['nodes'] = []
        if (boundariesByBodyId && alongToScreenX && levelToScreen) {
          const storedBnd = boundariesByBodyId.get(uId)
          const inGap = (storedBnd?.lower_nodes ?? []).filter((n) => {
            const nx = alongToScreenX(n.along_m)
            return nx >= sr.leftX && nx <= sr.rightX
          })
          for (let ni = 0; ni < inGap.length; ni += 1) {
            const n = inGap[ni]
            let cx = Math.max(sr.leftX + 1, Math.min(sr.rightX - 1, alongToScreenX(n.along_m)))
            let cy = Math.max(minY, Math.min(maxY, levelToScreen(n.elevation_m)))
            if (
              boundaryDrag &&
              boundaryDrag.upperBodyId === uId &&
              boundaryDrag.lowerBodyId === lId &&
              boundaryDrag.nodeIndex === ni
            ) {
              cx = Math.max(sr.leftX + 1, Math.min(sr.rightX - 1, boundaryDrag.x))
              cy = boundaryDrag.y
            }
            nodes.push({ x: cx, y: cy, nodeIndex: ni })
          }
          nodes.sort((a, b) => a.x - b.x)
        }

        out.push({
          upperBodyId: uId,
          lowerBodyId: lId,
          upperIdx: prevIdx,
          lowerIdx: idx,
          nodes,
          minY,
          maxY,
          leftX: sr.leftX,
          rightX: sr.rightX,
          naturalEdge,
        })
      }
      lastMainByGap.set(gapKey, idx)
    }
    return out
  }, [screenRegions, boundaryDrag, boundariesByBodyId, alongToScreenX, levelToScreen, onSaveBoundary])

  // ---- Collect lens freedraw handle arrays. ---------------------------------
  //
  // For each lens region, build ScreenLens with upper/lower node handle arrays
  // and source corner info so the render pass can draw handles + add-strips.
  // Only rendered when onSaveBoundary is wired.
  const screenLenses = useMemo((): ScreenLens[] => {
    if (!onSaveBoundary) return []
    const out: ScreenLens[] = []
    for (let ri = 0; ri < screenRegions.length; ri += 1) {
      const sr = screenRegions[ri]
      if (sr.region.kind !== 'lens') continue
      const bodyId = sr.region.bodyId
      if (!bodyId) continue

      const side: 'left' | 'right' = sr.region.polygon[0].fraction === 0 ? 'left' : 'right'
      const b = boundariesByBodyId?.get(bodyId)
      const upperStored = b?.upper_nodes ?? []
      const lowerStored = b?.lower_nodes ?? []

      // Source corners (fraction 0 or 1 = column face) in screen coords.
      const gapW = sr.rightX - sr.leftX
      const srcTop = sr.region.polygon[0]
      const srcBase = sr.region.polygon[sr.region.polygon.length - 1]
      const sourceTopPt = {
        x: sr.leftX + srcTop.fraction * gapW,
        y: Math.max(plotTop, Math.min(plotBottom, levelToScreen(srcTop.elevation))),
      }
      const sourceBasePt = {
        x: sr.leftX + srcBase.fraction * gapW,
        y: Math.max(plotTop, Math.min(plotBottom, levelToScreen(srcBase.elevation))),
      }

      const toHandles = (
        nodes: readonly BodyBoundaryNode[],
        edge: 'upper' | 'lower',
      ): { x: number; y: number; nodeIndex: number }[] => {
        if (!alongToScreenX || !levelToScreen) return []
        const out: { x: number; y: number; nodeIndex: number }[] = []
        nodes.forEach((n, ni) => {
          // Render only the nodes this gap OWNS (their along-x is inside the gap),
          // so a two-gap lens's other apex is not cloned + clamped in here.
          const ux = alongToScreenX!(n.along_m)
          if (ux < sr.leftX - NODE_OWN_EPS || ux > sr.rightX + NODE_OWN_EPS) return
          if (
            lensDrag &&
            lensDrag.regionIdx === ri &&
            lensDrag.bodyId === bodyId &&
            lensDrag.edge === edge &&
            lensDrag.nodeIndex === ni
          ) {
            out.push({ x: lensDrag.x, y: lensDrag.y, nodeIndex: ni })
            return
          }
          out.push({
            x: Math.max(sr.leftX, Math.min(sr.rightX, ux)),
            y: Math.max(plotTop, Math.min(plotBottom, levelToScreen!(n.elevation_m))),
            nodeIndex: ni,
          })
        })
        return out
      }

      out.push({
        regionIdx: ri,
        bodyId,
        side,
        upperNodes: toHandles(upperStored, 'upper'),
        lowerNodes: toHandles(lowerStored, 'lower'),
        sourceTopPt,
        sourceBasePt,
        leftX: sr.leftX,
        rightX: sr.rightX,
        lensTopY: sr.minY,
        lensBaseY: sr.maxY,
      })
    }
    return out
  }, [
    screenRegions,
    onSaveBoundary,
    boundariesByBodyId,
    alongToScreenX,
    levelToScreen,
    lensDrag,
    plotTop,
    plotBottom,
  ])

  // ---- Add-node handlers ---------------------------------------------------

  /**
   * Insert a new node into a matched boundary's lower_nodes for a given gap.
   * Called on click of the add-strip. The node is appended (the array is always
   * re-sorted by along_m on next render, so insertion order doesn't matter).
   */
  const handleBoundaryAddNode = (
    upperBodyId: string,
    leftX: number,
    rightX: number,
    svgX: number,
    svgY: number,
  ): void => {
    if (!onSaveBoundary || !screenXToAlong || !screenToLevel) return
    const existing = boundariesByBodyId?.get(upperBodyId)
    const newNode: BodyBoundaryNode = {
      along_m: screenXToAlong(svgX),
      elevation_m: screenToLevel(svgY),
    }
    // Preserve nodes in other gaps.
    const otherGapNodes = (existing?.lower_nodes ?? []).filter((n) => {
      if (!alongToScreenX) return false
      const nx = alongToScreenX(n.along_m)
      return nx < leftX || nx > rightX
    })
    const inGapNodes = (existing?.lower_nodes ?? []).filter((n) => {
      if (!alongToScreenX) return false
      const nx = alongToScreenX(n.along_m)
      return nx >= leftX && nx <= rightX
    })
    onSaveBoundary(
      upperBodyId,
      existing?.upper_nodes ?? [],
      [...otherGapNodes, ...inGapNodes, newNode],
      'straight',
    )
  }

  /**
   * Remove a node from a matched boundary's lower_nodes.
   * Called on right-click of a node handle.
   */
  const handleBoundaryRemoveNode = (
    upperBodyId: string,
    leftX: number,
    rightX: number,
    nodeIndex: number,
  ): void => {
    if (!onSaveBoundary || !alongToScreenX) return
    const existing = boundariesByBodyId?.get(upperBodyId)
    const otherGapNodes = (existing?.lower_nodes ?? []).filter((n) => {
      const nx = alongToScreenX(n.along_m)
      return nx < leftX || nx > rightX
    })
    const inGapNodes = (existing?.lower_nodes ?? []).filter((n) => {
      const nx = alongToScreenX(n.along_m)
      return nx >= leftX && nx <= rightX
    })
    const updated = inGapNodes.filter((_, i) => i !== nodeIndex)
    onSaveBoundary(
      upperBodyId,
      existing?.upper_nodes ?? [],
      [...otherGapNodes, ...updated],
      'straight',
    )
  }

  /**
   * Insert a new node into a lens edge (upper or lower).
   */
  const handleLensAddNode = (
    bodyId: string,
    edge: 'upper' | 'lower',
    svgX: number,
    svgY: number,
  ): void => {
    if (!onSaveBoundary || !screenXToAlong || !screenToLevel) return
    const existing = boundariesByBodyId?.get(bodyId)
    const newNode: BodyBoundaryNode = {
      along_m: screenXToAlong(svgX),
      elevation_m: screenToLevel(svgY),
    }
    const upperArr = [...(existing?.upper_nodes ?? [])]
    const lowerArr = [...(existing?.lower_nodes ?? [])]
    if (edge === 'upper') upperArr.push(newNode)
    else lowerArr.push(newNode)
    onSaveBoundary(bodyId, upperArr, lowerArr, 'straight')
  }

  /**
   * Remove a node from a lens edge.
   */
  const handleLensRemoveNode = (bodyId: string, edge: 'upper' | 'lower', nodeIndex: number): void => {
    if (!onSaveBoundary) return
    const existing = boundariesByBodyId?.get(bodyId)
    const upperArr = [...(existing?.upper_nodes ?? [])]
    const lowerArr = [...(existing?.lower_nodes ?? [])]
    if (edge === 'upper') upperArr.splice(nodeIndex, 1)
    else lowerArr.splice(nodeIndex, 1)
    onSaveBoundary(bodyId, upperArr, lowerArr, 'straight')
  }

  return (
    <g ref={rootRef} data-testid="partition-fill-overlay" style={{ pointerEvents: 'none' }}>
      {screenRegions.map((sr, i) => {
        const color = formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR
        const d = `${sr.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`
        const body = sr.region.bodyId ? bodyById.get(sr.region.bodyId) : undefined
        const interactive = Boolean(onBodyContextMenu && body)
        return (
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
          />
        )
      })}

      {labels.map((l) => (
        <text
          key={`pf-label-${l.key}`}
          data-testid={`partition-label-${l.key}`}
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

      {/* Matched-boundary freedraw handles:
          For each shared edge, render:
            (a) An add-strip — a transparent stroke along the natural edge that
                accepts click events to insert new nodes.
            (b) One draggable handle per stored node, with a hit halo and a
                right-click-to-remove context menu.

          The add-strip uses the natural edge (the two original base-edge
          endpoints of the upper polygon, BEFORE any bend insertions) so the
          strip tracks the current boundary even when no nodes are stored.

          Each handle's testid encodes [upperBodyId]-[lowerBodyId]-[i] so tests
          can assert N handles independently. */}
      {sharedBoundaries.map((sb) => {
        const [ne0, ne1] = sb.naturalEdge
        return (
          // Key by per-gap-unique region indices, NOT the body-pair: the same
          // (upper, lower) body-pair boundary recurs in every gap the bodies
          // span, so a `${upper}-${lower}` key collides across gaps (debt #2).
          <g key={`pf-bnd-${sb.upperIdx}-${sb.lowerIdx}`}>
            {/* Add-strip: transparent line along the boundary edge.
                Hover shows a preview dot at the cursor (owner directive
                2026-06-05 litho declutter, Task 2). */}
            <line
              data-testid={`partition-boundary-addstrip-${sb.upperBodyId}-${sb.lowerBodyId}`}
              x1={ne0.x}
              y1={ne0.y}
              x2={ne1.x}
              y2={ne1.y}
              stroke="transparent"
              strokeWidth={ADDSTRIP_HIT_W}
              style={{ pointerEvents: 'auto', cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: BOUNDARY_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                handleBoundaryAddNode(
                  sb.upperBodyId,
                  sb.leftX,
                  sb.rightX,
                  e.clientX - (rect?.left ?? 0),
                  e.clientY - (rect?.top ?? 0),
                )
              }}
            />
            {/* Per-node draggable handles */}
            {sb.nodes.map(({ x, y, nodeIndex }) => (
              <g key={`pf-bnd-node-${sb.upperBodyId}-${sb.lowerBodyId}-${nodeIndex}`}>
                {/* Hit halo (drag + right-click). Stop propagation so the add-strip
                    click below doesn't also fire when clicking near a handle. */}
                <circle
                  data-testid={`partition-boundary-hit-${sb.upperBodyId}-${sb.lowerBodyId}-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={BOUNDARY_HIT_R}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'ns-resize' }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setBoundaryDrag({
                      upperBodyId: sb.upperBodyId,
                      lowerBodyId: sb.lowerBodyId,
                      nodeIndex,
                      x,
                      y,
                      minY: sb.minY,
                      maxY: sb.maxY,
                      leftX: sb.leftX,
                      rightX: sb.rightX,
                    })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleBoundaryRemoveNode(
                      sb.upperBodyId,
                      sb.leftX,
                      sb.rightX,
                      nodeIndex,
                    )
                  }}
                />
                {/* Visible handle dot */}
                <circle
                  data-testid={`partition-boundary-handle-${sb.upperBodyId}-${sb.lowerBodyId}-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={BOUNDARY_R}
                  fill={BOUNDARY_COLOR}
                  stroke="#0f172a"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ))}
          </g>
        )
      })}

      {/* Lens-edge freedraw handles:
          For each lens region (when onSaveBoundary is wired), render:
            (a) Add-strips along the upper and lower edges of the lens polygon.
            (b) One handle per stored upper_node (top edge) and lower_node
                (base edge).

          The add-strip for the upper edge runs from sourceTopPt to the first
          upper node (or to the virtual apex if no nodes) — simplified here as
          a single line from sourceTopPt to the gap midpoint at the lens's top
          elevation so the strip is always on the correct edge.  In practice the
          strip is transparent; the cursor:copy hint tells the user to click.

          The upper edge strip runs sourceTop → (rightX-ish apex); the lower
          strip runs sourceBase → same apex.  With no stored nodes both strips
          cover the full default triangle edges, giving the engineer a click
          surface to add the first node.

          Handle testid: partition-lens-handle-<bodyId>-<edge>-<i>
          Add-strip testid: partition-lens-addstrip-<bodyId>-<edge> */}
      {screenLenses.map((sl) => {
        // Current polygon points from screenRegions (after post-lens rebuild).
        const sr = screenRegions[sl.regionIdx]
        if (!sr) return null
        const pts = sr.points
        const n = pts.length

        // For the add-strip geometry, use the first segment of each edge:
        //   Upper strip: from sourceTopPt to the next polygon point.
        //   Lower strip: from sourceBasePt back one point (second-to-last).
        // The strips are transparent so the exact geometry is UI-only.
        const upperStripEnd = n >= 2 ? pts[1] : pts[0]
        const lowerStripStart = n >= 2 ? pts[n - 2] : pts[n - 1]

        return (
          // Key by the per-gap-unique region index, NOT the bodyId: an enclosed
          // lens on a middle column is extracted into BOTH flanking gaps, so a
          // `${bodyId}` key collides across gaps (debt #2).
          <g key={`pf-lens-${sl.regionIdx}`}>
            {/* Upper-edge add-strip. Hover shows a preview dot at the cursor
                (owner directive 2026-06-05 litho declutter, Task 2). */}
            <line
              data-testid={`partition-lens-addstrip-${sl.bodyId}-upper`}
              x1={sl.sourceTopPt.x}
              y1={sl.sourceTopPt.y}
              x2={upperStripEnd.x}
              y2={upperStripEnd.y}
              stroke="transparent"
              strokeWidth={ADDSTRIP_HIT_W}
              style={{ pointerEvents: 'auto', cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: LENS_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                const cx = e.clientX - (rect?.left ?? 0)
                const cy = e.clientY - (rect?.top ?? 0)
                // The two add-strips overlap on a thin wedge, so the click could be
                // physically nearer the lower edge even though it landed on the upper
                // strip. Route to the nearest edge instead of trusting which strip the
                // click hit — that is what "grabs the pinchout at both sides" was.
                const edge = nearerLensEdge(
                  { x: cx, y: cy },
                  [sl.sourceTopPt, upperStripEnd],
                  [lowerStripStart, sl.sourceBasePt],
                )
                handleLensAddNode(sl.bodyId, edge, cx, cy)
              }}
            />
            {/* Lower-edge add-strip. Hover shows a preview dot at the cursor. */}
            <line
              data-testid={`partition-lens-addstrip-${sl.bodyId}-lower`}
              x1={lowerStripStart.x}
              y1={lowerStripStart.y}
              x2={sl.sourceBasePt.x}
              y2={sl.sourceBasePt.y}
              stroke="transparent"
              strokeWidth={ADDSTRIP_HIT_W}
              style={{ pointerEvents: 'auto', cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: LENS_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                const cx = e.clientX - (rect?.left ?? 0)
                const cy = e.clientY - (rect?.top ?? 0)
                // See the upper strip's note: route to the nearest edge so an overlap
                // on a thin wedge doesn't force the node onto the lower edge by z-order.
                const edge = nearerLensEdge(
                  { x: cx, y: cy },
                  [sl.sourceTopPt, upperStripEnd],
                  [lowerStripStart, sl.sourceBasePt],
                )
                handleLensAddNode(sl.bodyId, edge, cx, cy)
              }}
            />
            {/* Upper-edge node handles */}
            {sl.upperNodes.map(({ x, y, nodeIndex }) => (
              <g key={`pf-lens-node-upper-${sl.bodyId}-${nodeIndex}`}>
                <circle
                  data-testid={`partition-lens-hit-${sl.bodyId}-upper-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={lensHitR}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'grab' }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setLensDrag({
                      bodyId: sl.bodyId,
                      regionIdx: sl.regionIdx,
                      side: sl.side,
                      edge: 'upper',
                      nodeIndex,
                      x,
                      y,
                      leftX: sl.leftX,
                      rightX: sl.rightX,
                      lensTopY: sl.lensTopY,
                      lensBaseY: sl.lensBaseY,
                    })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleLensRemoveNode(sl.bodyId, 'upper', nodeIndex)
                  }}
                />
                <circle
                  data-testid={`partition-lens-handle-${sl.bodyId}-upper-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={lensR}
                  fill={LENS_COLOR}
                  stroke="#0f172a"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ))}
            {/* Lower-edge node handles */}
            {sl.lowerNodes.map(({ x, y, nodeIndex }) => (
              <g key={`pf-lens-node-lower-${sl.bodyId}-${nodeIndex}`}>
                <circle
                  data-testid={`partition-lens-hit-${sl.bodyId}-lower-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={lensHitR}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'grab' }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setLensDrag({
                      bodyId: sl.bodyId,
                      regionIdx: sl.regionIdx,
                      side: sl.side,
                      edge: 'lower',
                      nodeIndex,
                      x,
                      y,
                      leftX: sl.leftX,
                      rightX: sl.rightX,
                      lensTopY: sl.lensTopY,
                      lensBaseY: sl.lensBaseY,
                    })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleLensRemoveNode(sl.bodyId, 'lower', nodeIndex)
                  }}
                />
                <circle
                  data-testid={`partition-lens-handle-${sl.bodyId}-lower-${nodeIndex}`}
                  cx={x}
                  cy={y}
                  r={lensR}
                  fill={LENS_COLOR}
                  stroke="#0f172a"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ))}
          </g>
        )
      })}

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

      {/* Add-strip hover preview dot (owner directive 2026-06-05 litho
          declutter, Task 2).  Renders ONE small circle at the cursor
          position while the pointer is over any add-strip (boundary or
          lens).  Colour matches the strip's gesture: sky-blue (#38bdf8)
          for a matched-boundary strip, amber (#f59e0b) for a lens strip,
          so the preview telegraphs what the click will produce.
          pointerEvents="none" — the preview must never block the underlying
          add-strip's own pointer events. */}
      {addNodePreview && (
        <circle
          data-testid="partition-addnode-preview"
          cx={addNodePreview.x}
          cy={addNodePreview.y}
          r={3}
          fill={addNodePreview.color}
          stroke="#0f172a"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
}
