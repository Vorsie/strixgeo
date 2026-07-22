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

import { log } from '../../utils/log'
import type {
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import {
  computeUnderColumnSubstrate,
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionRegion,
  type SectionRegion,
  LENS_PINCH_FRACTION,
  lensApexOverrideKey,
} from '../../utils/partitionFill'
import { computeUnderColumnSubstrateForRender } from './underColumnSubstrate'
import { collectContactOverridesForGap } from './contactOverrideWiring'
import { computeSeamStrokePaths, type SeamStrokeElement } from './sectionSeamStrokes'
import { buildFillGroups, type FillGroupElement } from './sectionFillGroups'
import {
  computeSectionFillActiveWithDiagnostics,
  usePartitionEngineV2,
} from '../../utils/partitionEngineSelect'
import type { TieConflict } from '../../utils/partitionFillV2'
import { nearerLensEdge } from '../../utils/lensEdgePick'
import {
  projectClickToCandidate,
  routeAddStripByContainment,
  type AddStripCandidate,
} from './partitionAddStripRouter'
import {
  assembleSectionPartitionInput,
  type FenceLayerInput,
  type FenceProjectedColumn,
} from '../../utils/sectionFenceData'
import {
  clipPolygonToElevBand,
  refineLithoPartition,
  refineSubstrateQuads,
  type GeotechColumn,
  type NadFormationMeta,
} from '../../utils/refineLithoPartition'
import type { PlacedColumn } from './utils'
import CrossingTieWarningChip from './CrossingTieWarningChip'
import {
  baseContactEdge,
  buildLensPolygon,
  isApexShapeable,
  labelAnchor,
  resolveSourceCorners,
  type AddNodePreview,
  type BoundaryDrag,
  type ColumnScreen,
  type LensDrag,
  type ScreenLens,
  type ScreenRegion,
  type SharedBoundary,
} from './partitionFillOverlayHelpers'

/**
 * Geotech fraction-space refinement inputs (owner-locked 2026-07-06). When
 * present (the geotech axis), the overlay renders the LITHO partition REFINED
 * by NAD packing class instead of the raw region fills: the litho partition is
 * built from ``lithoLayers`` + ``contactEdges`` (flipped back to the LITHO
 * model in SectionsCanvas), then ``refineLithoPartition`` subdivides each
 * region by the geotech sub-bands here. Colours come from the parent
 * ``formationColorById`` (geotech formations → NAD colour). Geotech is
 * view-only, so the interactive lens/boundary handles + per-body labels are
 * suppressed in refined mode (labels live on the column strips, matching the
 * owner-accepted rev-8 render).
 */
export interface GeotechRefinement {
  /** Geotech-model ``litho_layer`` rows (the NAD sub-bands), any order. */
  geotechLayers: readonly LithoLayerResponse[]
  /** Geotech formation id → NAD class + soil code. */
  nadMeta: ReadonlyMap<string, NadFormationMeta>
  /** Litho formation id → soil code (the hard soil-code guard). */
  lithoSoilByFormationId: ReadonlyMap<string, string | null>
  /**
   * Litho formation id → lithology colour. Used to colour the ``fallback``
   * refined polygons (a litho region with NO geotech sub-band data on either
   * side — those carry the LITHO formation id) and the no-donor substrate
   * quads, so an unpacked interval renders in its lithology colour rather than
   * the neutral fallback grey (``formationColorById`` on the geotech axis only
   * knows GEOTECH formation ids).
   */
  lithoFormationColorById: ReadonlyMap<string, string>
}

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
  /**
   * Open-end stub length in metres — how far the first/last column's
   * open-ended unit draws past the test when there's no plot edge to fill to.
   * Driven by the "Open extent length" setting; falls back to ``OPEN_END_M``
   * when undefined (audit #19 — the setting was wired 4 layers but never
   * reached this overlay).
   */
  openExtentLengthM?: number
  /** Bodies on the model — used to resolve a right-clicked pinch to its body. */
  bodies?: readonly BodyListItem[]
  /** Right-click a pinch (lens) → open the body context menu (Dissolve / Name). */
  onBodyContextMenu?: (body: BodyListItem, svgX: number, svgY: number) => void
  /**
   * When correlate mode is active, ALL of this overlay's interactive elements
   * (body context menu, boundary add-strips + drag handles) drop to
   * ``pointer-events: none`` so clicks fall through to the correlate gesture
   * targets beneath (the contact hit-rects + the bottom-of-test handles in
   * ``CorrelationEdgesOverlay``, which renders earlier → lower z). Without this
   * the partition fill's floor handles intercepted bottom-marker clicks
   * (dogfeed 2026-06-19: "can't connect two bottom markers"). The fill itself
   * is always display-only (root is ``pointer-events: none``).
   */
  correlateMode?: boolean
  /**
   * When set, non-matching regions fade to 0.25 opacity; the selected body
   * renders at its natural opacity.  Implements S1 (band fill highlights on
   * sample selection — the "soft coupling, demote never remove" precedent).
   * Absent or null → no fade (normal render).
   */
  selectedBodyId?: string | null
  /**
   * Geotech fraction-space refinement (owner-locked 2026-07-06). When present,
   * the overlay renders the litho partition REFINED by NAD packing class
   * instead of the raw region fills. Absent → normal litho/geotech-direct
   * render. See {@link GeotechRefinement}.
   */
  refinement?: GeotechRefinement
}

const FILL_OPACITY = 0.62
// A lens (one-test body enclosed in a matrix) is drawn a touch more solid so it
// reads as a unit CUT OUT of the continuous matrix it sits on, not a faint wash.
const LENS_OPACITY = 0.85
const FALLBACK_COLOR = '#888888'
const EDGE_STUB_PX = 64
const OPEN_END_M = 5
/**
 * Zoom-adaptive label constants.
 *
 * Font size is clamped between MIN and MAX, scaling linearly with the region's
 * on-screen height:  fontSize = clamp(MIN, height * K, MAX).
 *
 * K is chosen so that a comfortably tall band (~72 px, typical at 1:200 on a
 * 4 K monitor) yields a font close to the old fixed 11 px:
 *   72 * 0.15 ≈ 10.8 → rounds to ~11 px.
 * A very short band (< ~53 px) produces a smaller font down to MIN_FONT.
 * An unusually tall band caps at MAX_FONT.
 *
 * Show-if-it-fits gate: the label is only emitted when
 *   height >= fontSize + LABEL_V_MARGIN  (vertical clearance)
 *   AND availableWidth >= text.length * fontSize * LABEL_CHAR_W_RATIO
 */
const LABEL_FONT_MIN = 8
const LABEL_FONT_MAX = 13
const LABEL_FONT_K = 0.15
const LABEL_V_MARGIN = 2
/** Approximate character width as a fraction of font size (monospace estimate). */
const LABEL_CHAR_W_RATIO = 0.55
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

// Minimum VISIBLE apex reach (fraction of the gap) a lens override may request
// (S72). The engine only clamps the apex fraction to its geometric-legality bound
// [0.02, 0.98] — a 2% reach is a hairline sliver that reads as "the lens
// disappeared" (owner 2026-07-22, "i clicked the apex of the silt lens and it
// disappeared"). Clamping the apex fraction symmetrically to [FLOOR, 1−FLOOR]
// keeps a left-anchored lens (reach = fraction) AND a right-anchored lens
// (reach = 1 − fraction) at ≥ FLOOR of the gap, so a click near the source column
// can never pinch the lens to nothing. 0.08 (8 %) is comfortably visible yet well
// below any real shaped lens, so it never fights a deliberate shape.
const MIN_VISIBLE_APEX_FRACTION = 0.08

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** Clamp an apex fraction to the VISIBLE reach floor (symmetric, both sides). */
const clampVisibleApex = (f: number): number =>
  Math.max(MIN_VISIBLE_APEX_FRACTION, Math.min(1 - MIN_VISIBLE_APEX_FRACTION, f))


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
  openExtentLengthM,
  bodies,
  onBodyContextMenu,
  correlateMode = false,
  selectedBodyId,
  refinement,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  // Active partition engine (v1 stable / v2 experimental), device-local dev
  // pref. Read as a hook so a flip in Settings re-renders the overlay live; it
  // feeds the sectionFillData memo's dep array so the partition recomputes.
  const partitionEngineV2 = usePartitionEngineV2()
  // In correlate mode every interactive partition element drops its pointer
  // events so the correlate gesture targets beneath receive the click. Use
  // this in place of the literal ``'auto'`` at every interactive site.
  const interactivePtr: 'auto' | 'none' = correlateMode ? 'none' : 'auto'
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

  // Build each column's gap-free unit stack + its screen x-edges. The unit-
  // stack assembly (accepted-only filter, drop empty / elevation-less columns,
  // along-sort, shallow→deep unit sort) is the SHARED core wired through
  // ``assembleSectionPartitionInput`` (audit FE-UTILS-08) — the same pure util
  // ``buildProjectFence`` and ``buildVoxelRequest`` consume, so the on-screen
  // partition and the 3D fence/voxel builds assemble identical columns. Only
  // the screen x-edge derivation from ``placedColumns`` stays overlay-local.
  const { orderedInvs, colByInv, screenByInv } = useMemo(() => {
    const fenceLayers: FenceLayerInput[] = []
    for (const layer of lithoLayers) {
      const inv = layer.cpt_id ?? layer.borehole_id
      if (!inv) continue
      fenceLayers.push({
        investigationId: inv,
        layerId: layer.id, // what correlation edges reference (the band signal)
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        accepted: layer.status === 'accepted',
      })
    }
    const placedById = new Map<string, PlacedColumn>()
    const projected: FenceProjectedColumn[] = (placedColumns as readonly PlacedColumn[]).map(
      (col) => {
        placedById.set(col.proj.item.id, col)
        return {
          investigationId: col.proj.item.id,
          alongM: col.proj.along,
          surfaceElevM: col.proj.item.elevation_m ?? null,
        }
      },
    )
    const { columns, orderedColumns } = assembleSectionPartitionInput(projected, fenceLayers)

    const cols = new Map<string, PartitionColumn>()
    const screen = new Map<string, ColumnScreen>()
    const ordered: string[] = []
    for (let i = 0; i < columns.length; i += 1) {
      const id = orderedColumns[i].investigationId
      const placed = placedById.get(id)
      if (!placed) continue // unreachable: every assembled column came from placedColumns
      const halfW = placed.width / 2
      cols.set(id, columns[i])
      screen.set(id, {
        rightX: placed.nudgedX + halfW,
        leftX: placed.nudgedX - halfW,
        along: orderedColumns[i].alongM,
      })
      ordered.push(id)
    }
    return { orderedInvs: ordered, colByInv: cols, screenByInv: screen }
  }, [lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  // Open-end stub length in metres — the "Open extent length" setting, falling
  // back to OPEN_END_M when the prop is absent. Derived from the horizontal
  // scale so it stays a fixed number of metres through zoom; clamped so it
  // never vanishes (audit #19 — wire the dead setting through to here).
  const openEndM = openExtentLengthM ?? OPEN_END_M
  const openEndPx = alongToScreenX
    ? Math.max(8, openEndM * Math.abs(alongToScreenX(1) - alongToScreenX(0)))
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

  // ---- DATA MEMO: call computeSectionFill only when partition inputs change. --
  //
  // Split from the screen-projection memo (below) so that pan/zoom events that
  // only change levelToScreen / plotTop / plotBottom do NOT re-run the expensive
  // LCS + polygon engine (debt #209).  This memo owns everything up to and
  // including computeSectionFill; the screen memo owns the pixel projection.
  //
  // Deps that intentionally STAY here (they affect the domain geometry):
  //   orderedInvs / colByInv / screenByInv — column identity + screen x-edges
  //     used to decide node ownership (which gap each stored node belongs to).
  //   contactEdges / showBands — the correlation signal + on/off gate.
  //   boundariesByBodyId / alongToScreenX / screenToLevel / lensDrag — the
  //     apex-override chain: stored nodes are converted from (along_m, elev_m)
  //     to (fraction, elevation) using screenByInv x-edges + alongToScreenX;
  //     lensDrag overrides one node's position during a live drag so the domain
  //     rebuilds the lens shape in real time.
  //
  // Deps intentionally ABSENT (they only affect pixel projection):
  //   levelToScreen, plotTop, plotBottom — elevation → screen-y mapping.
  const sectionFillData = useMemo((): {
    sectionRegions: SectionRegion[]
    orderedColumns: PartitionColumn[]
    gapXs: Array<{ leftX: number; rightX: number }>
    // Keyed lens apex overrides so the screen memo can skip the legacy path.
    apexOverrides: Map<string, LensApexOverride>
    // ``gapIndex:upperBodyId`` set whose shared contact the engine re-partitioned
    // (S68) — the POST-BEND off-engine reshape is skipped for these.
    contactOverriddenBodies: Set<string>
    // ``gapIndex:bodyId`` set whose tip override the engine did NOT consume
    // (flooded to a band) — the un-routable class (§77); grab handle suppressed.
    unroutableBodies: Set<string>
    // v2 crossing-tie conflicts (owner §8 Q4) — drives the amber warning chip.
    conflicts: TieConflict[]
  } => {
    if (!showBands)
      return {
        sectionRegions: [],
        orderedColumns: [],
        gapXs: [],
        apexOverrides: new Map(),
        contactOverriddenBodies: new Set(),
        unroutableBodies: new Set(),
        conflicts: [],
      }

    // Valid columns in along-section order (have both unit data + screen edges).
    const valid = orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    const orderedColumns = valid.map((id) => colByInv.get(id) as PartitionColumn)
    if (orderedColumns.length < 2)
      return {
        sectionRegions: [],
        orderedColumns,
        gapXs: [],
        apexOverrides: new Map(),
        contactOverriddenBodies: new Set(),
        unroutableBodies: new Set(),
        conflicts: [],
      }

    // Pre-compute gap x-extents from screenByInv so both memos share the same
    // values without re-reading the map independently.
    const gapXs = Array.from({ length: orderedColumns.length - 1 }, (_, i) => ({
      leftX: (screenByInv.get(valid[i]) as ColumnScreen).rightX,
      rightX: (screenByInv.get(valid[i + 1]) as ColumnScreen).leftX,
    }))

    // Lens shape overrides, keyed PER (body, gap). Each gap reads only the
    // boundary nodes it OWNS (their along-position falls inside the gap) and
    // feeds the full freedraw shape (upper + lower edge chains, gap-local
    // fraction/elevation, with the live drag applied to the dragged node) to the
    // DOMAIN. The domain builds AND clips the lens (rides the matrix seam) + cuts
    // a matching notch, so the overlay no longer rebuilds it un-clipped (which let
    // a straddle lens cross into the neighbour). Per-gap keys keep a two-gap
    // lens's apexes independent.
    const apexOverrides = new Map<string, LensApexOverride>()
    // ``gapIndex:upperBodyId`` set whose shared contact the ENGINE re-partitions
    // via a ``contact:U|L@g`` override (S68). The POST-BEND off-engine reshape is
    // SKIPPED for these (else it double-reshapes one band → the gap the engine
    // consumer removes). Empty on v1 / no contact node → today's path unchanged.
    const contactOverriddenBodies = new Set<string>()
    for (let i = 0; i < orderedColumns.length - 1; i += 1) {
      const { leftX, rightX } = gapXs[i]
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
        const chainOut: { fraction: number; elevation: number }[] = []
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
            chainOut.push({
              fraction: clamp01((lensDrag.x - leftX) / gapW),
              elevation: screenToLevel ? screenToLevel(lensDrag.y) : n.elevation_m,
            })
          } else {
            chainOut.push({ fraction: clamp01((x - leftX) / gapW), elevation: n.elevation_m })
          }
        })
        return chainOut
      }
      const setShape = (bodyId: string): void => {
        const b = boundariesByBodyId?.get(bodyId)
        if (!b) return
        const upper = chain(b.upper_nodes ?? [], bodyId, 'upper')
        const lower = chain(b.lower_nodes ?? [], bodyId, 'lower')
        if (upper.length + lower.length === 0) return // no owned node → domain default apex
        const apex0 = upper[0] ?? lower[0]
        apexOverrides.set(lensApexOverrideKey(bodyId, i), {
          // Floor the apex reach to a VISIBLE fraction (S72): a click near the source
          // column face drove the apex toward the column → the engine's 2%-legality
          // clamp left a hairline sliver that read as "the lens disappeared". The
          // symmetric visible floor keeps the reach ≥ 8 % of the gap from EITHER
          // anchored side, so a click can never pinch the lens to nothing.
          fraction: clampVisibleApex(apex0.fraction),
          elevation: apex0.elevation,
          upper,
          lower,
        })
      }
      for (const id of leftIds) if (!rightIds.has(id)) setShape(id)
      for (const id of rightIds) if (!leftIds.has(id)) setShape(id)

      // Matched TWO-BAND CONTACT free-draw (S68): a node stored on a full-width
      // (two-sided) band's ``lower_nodes`` shapes the shared contact between it
      // and the band directly below. v2 re-partitions BOTH bands from ONE
      // ``contact:U|L@g`` override (partitionFillV2/contactOverride.ts) so the
      // boundary moves together, never a gap. Only the v2 engine consumes it —
      // under v1 (no consumer) the legacy off-engine POST-BEND path still runs.
      if (partitionEngineV2) {
        const gapOverridden = collectContactOverridesForGap(
          i,
          left,
          right,
          leftX,
          rightX,
          boundariesByBodyId,
          alongToScreenX,
          screenToLevel,
          boundaryDrag,
          apexOverrides,
        )
        for (const id of gapOverridden) contactOverriddenBodies.add(`${i}:${id}`)
      }
    }

    // Bands come from the APPROVED correlation edges (layer-id pairs) — the
    // trustworthy signal — NOT the over-lumped body_id. Geometry only fills the
    // uncorrelated remainder.
    // layer_a_side / layer_b_side are threaded through so computeSectionFill
    // can split bottom-ties (base↔base) from normal top-keyed edges — letting the
    // deepest unit band without a base-tie polluting the topCorr signal.
    const edges: CorrelationEdge[] = (contactEdges ?? [])
      .filter((e) => e.user_approved)
      .map((e) => ({
        a: e.layer_a_id,
        b: e.layer_b_id,
        aSide: e.layer_a_side,
        bSide: e.layer_b_side,
      }))

    // True along-section position (metres) per column, 1:1 with orderedColumns
    // (both derive from `valid` in the same order). Passing it lets the deep-to-deep
    // substrate pass slice each gap's deep band at the real column spacing instead of
    // the uniform fallback. In along-METRES (the slice math is metre-based); the
    // screen projection downstream is unchanged, so no raw-vs-warped mismatch.
    const alongM = valid.map((id) => (screenByInv.get(id) as ColumnScreen).along)

    // WHOLE-SECTION resolve: reduce each column ONCE against BOTH its neighbours
    // (not per gap, which drifts and breaks a body's continuity through a shared
    // column — the dogfeed peat-discontinuity bug). Regions carry ``gapIndex``.
    // The partition itself is built from the LITHO model's columns + edges on
    // BOTH axes now (the geotech partition is the litho partition refined). On
    // the geotech axis the NAD subdivision is a SEPARATE pass over these regions
    // (see the ``refinement`` prop + ``refinedScreen`` memo below); the raw
    // ``sectionRegions`` here stay the litho partition.
    const { regions: sectionRegions, conflicts } = computeSectionFillActiveWithDiagnostics(
      orderedColumns,
      edges,
      apexOverrides,
      alongM,
    )
    log.debug(
      'partition',
      `section fill: ${orderedColumns.length} cols, ${edges.length} edges → ${sectionRegions.length} regions` +
        (conflicts.length ? `, ${conflicts.length} crossing-tie conflicts` : ''),
    )

    // ---- UN-ROUTABLE tip detection (§77, v2 only). --------------------------
    // A shapeable tip whose stored override the engine does NOT consume (it floods
    // the tip to a full-width band-quad — the §71 / S65-Q1 residual class, e.g. an
    // un-bracketed onlap tip) is un-routable: shaping it re-partitions nothing. With
    // the off-engine reshape retired on v2, such a click is a silent no-op — never a
    // gap — but we still SUPPRESS its grab handle (better no handle than a dead grab)
    // and count the class. Signal WITHOUT an engine probe: the app fed an override
    // for (body, gap) yet the resulting region for that body in that gap is NOT
    // apex-shapeable (flooded to a band spanning both columns). Keyed ``gap:bodyId``.
    const unroutableBodies = new Set<string>()
    if (partitionEngineV2) {
      // Region per (gap, bodyId): the shape the engine actually produced.
      const regionByKey = new Map<string, SectionRegion>()
      for (const r of sectionRegions) {
        if (r.bodyId) regionByKey.set(`${r.gapIndex}:${r.bodyId}`, r)
      }
      for (const key of apexOverrides.keys()) {
        // ``lensApexOverrideKey`` is ``<bodyId>@<gapIndex>`` — split on the LAST
        // ``@`` so a bodyId containing ``@`` is still recovered correctly.
        const at = key.lastIndexOf('@')
        if (at < 0) continue
        const bodyId = key.slice(0, at)
        const gapIndex = Number(key.slice(at + 1))
        if (!Number.isFinite(gapIndex)) continue
        const region = regionByKey.get(`${gapIndex}:${bodyId}`)
        // No region, or a region that is no longer a shapeable tip (flooded to a
        // full-width band) → the override was not consumed as a tip reshape.
        if (!region || !isApexShapeable(region)) {
          unroutableBodies.add(`${gapIndex}:${bodyId}`)
        }
      }
      if (unroutableBodies.size > 0) {
        // INFO (survives the default DevTools level filter) so a dogfeed sees the
        // un-routable class + count without a debugger.
        log.info(
          'partition',
          `${unroutableBodies.size} un-routable shapeable tip(s) — override not consumed by the ` +
            `engine (flooded to band); grab handle suppressed on v2: ` +
            Array.from(unroutableBodies).join(', '),
        )
      }
    }

    return {
      sectionRegions,
      orderedColumns,
      gapXs,
      apexOverrides,
      contactOverriddenBodies,
      unroutableBodies,
      conflicts,
    }
  }, [
    orderedInvs,
    colByInv,
    screenByInv,
    contactEdges,
    showBands,
    boundariesByBodyId,
    alongToScreenX,
    screenToLevel,
    lensDrag,
    // Live contact-bend preview: re-partition while dragging a matched contact.
    boundaryDrag,
    // Recompute the partition when the active engine flips (Settings toggle).
    partitionEngineV2,
  ])

  // Crossing-tie conflicts (owner §8 Q4): approved correlation ties that
  // geometrically cross suspend BOTH ties (neither bands) until the user deletes
  // one. Surfaced as a small persistent, non-blocking amber warning chip below
  // (never a dialog / focus steal). v1 always reports none.
  const conflicts = sectionFillData.conflicts

  // Log the conflict list ONCE per change so a dogfeed DevTools console shows the
  // suspended ties without a dialog. console.info (not .debug) so it survives the
  // default DevTools level filter (memory ``feedback_no_guessing_instrument_first``).
  useEffect(() => {
    if (conflicts.length === 0) return
    log.info(
      'partition',
      `${conflicts.length} crossing correlation tie${conflicts.length === 1 ? '' : 's'} — ` +
        `bands suspended until resolved: ` +
        conflicts.map((c) => `gap${c.gapIndex}[${c.tieIds.join(' × ')}]`).join(', '),
    )
  }, [conflicts])

  // ---- SCREEN MEMO: project domain geometry to pixel coords. ---------------
  //
  // Depends on sectionFillData (the partition regions in fraction/elevation
  // space) + the screen-transform props (levelToScreen, plotTop, plotBottom) +
  // the live drag state that mutates already-projected coordinates.
  //
  // NOT in the dependency array: orderedInvs / colByInv / contactEdges / showBands
  // — those are consumed by sectionFillData; this memo only projects the result.
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
    const { sectionRegions, orderedColumns, gapXs, apexOverrides, contactOverriddenBodies } =
      sectionFillData
    if (orderedColumns.length < 2) return [] as ScreenRegion[]
    const out: ScreenRegion[] = []

    for (let i = 0; i < orderedColumns.length - 1; i += 1) {
      const { leftX, rightX } = gapXs[i]
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
      //
      // ENGINE-ONLY RESHAPE ON V2 (§77): this off-engine pass reshapes ONE band's
      // edge from stored nodes without re-partitioning the neighbour — the SOLE gap
      // source (§66/§71). On v2 the engine consumes matched-contact overrides
      // (``contact:U|L@g``, S68) and the live preview re-runs the engine per frame
      // (S65), so the engine is the only geometry source needed. Skipping this pass
      // entirely on v2 makes a gap IMPOSSIBLE BY CONSTRUCTION: a contact the engine
      // did NOT consume renders its truthful (unbent) 0/0 partition — a visual no-op,
      // never a gap. v1 (no engine consumer) keeps the pass → byte-identical.
      if (!partitionEngineV2) {
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

        // ENGINE consumed this contact (S68): the ``contact:U|L@g`` override
        // already re-partitioned BOTH bands. Running the off-engine POST-BEND
        // reshape too would double-move ONE band's edge (the §71 root of the
        // "targets top + gap" dogfeed). Skip it — the engine output is truthful.
        if (contactOverriddenBodies.has(`${i}:${uId}`) || contactOverriddenBodies.has(`${i}:${lId}`))
          continue

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
      } // end !partitionEngineV2 POST-BEND guard (§77)

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
      //
      // ENGINE-ONLY RESHAPE ON V2 (§77): ``buildLensPolygon`` rebuilds a lens
      // wedge OFF-ENGINE from source corners + nodes without knowing the neighbour
      // matrix — so it can gap/overlap it (§66/§71 root). On v2 the engine consumes
      // the lens override (``lensApex@gap``) and the domain builds the clipped +
      // notched shape; a lens the engine consumed was ALREADY skipped by the
      // ``apexOverrides.has`` guard below, so the ONLY lenses reaching this rebuild
      // on v2 are UN-consumed ones — exactly the gap source. Skipping the whole
      // pass on v2 leaves the engine as the sole geometry source → no gap can render
      // (an un-consumed override becomes a visual no-op, not a gap). v1 keeps the
      // rebuild → byte-identical.
      if (!partitionEngineV2)
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].leftX !== leftX || out[k].rightX !== rightX) break
        const sr = out[k]
        // Rebuild the fill polygon for ANY shapeable tip (v2 lens + pinch/onlap tip)
        // that the user has shaped with stored nodes — mirrors the ``screenLenses``
        // handle gate so the coloured fill follows the same freedraw the handles show.
        if (!isApexShapeable(sr.region)) continue
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

        // Source side + corners from the polygon EXTENT (v2 pinch polygons may not
        // start at the column-face vertex — see ``resolveSourceCorners``).
        const corners = resolveSourceCorners(sr.region.polygon)
        if (!corners) continue
        const side = corners.side

        // Source corners in screen coords: fraction=0 or fraction=1 → column edge.
        const gapW = rightX - leftX
        const srcTop = corners.sourceTop
        const srcBase = corners.sourceBase
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
    sectionFillData,
    partitionEngineV2,
    levelToScreen,
    plotTop,
    plotBottom,
    boundaryDrag,
    lensDrag,
    boundariesByBodyId,
    alongToScreenX,
    screenToLevel,
  ])

  // ----- UNDER-COLUMN SUBSTRATE FILL (fix: "gap exactly below a test column") --
  // The gap partition is built EDGE-TO-EDGE (gapXs: left col's RIGHT edge → right
  // col's LEFT edge), and ContactsLayer's per-column litho bands stop at the test's
  // TD. That left the column-width sliver BELOW each test's TD filled by NOTHING —
  // the "gap exactly below a test column" (dogfeed 2026-06-20). Both the void gate
  // and the FILL-DIAG missed it because they only ever sample INSIDE gaps; a
  // column's own x-range was never checked.
  //
  // Fix: continue the adjacent gap's MATRIX stratigraphy flat across the column's
  // own width, below its TD, down to that matrix's deepest base ("colour between
  // the lines"). We sample the gap at the column's edge fraction (≈0 or ≈1) where
  // lens wedges have pinched out, take the non-lens (matrix) intervals, and stack
  // them contiguously from TD downward — closing any vertical gap (a lens spot) by
  // extending the region below it upward, so the result is gapless by construction.
  const underColumnFills = useMemo(() => {
    // ``pts`` carries the ring corners for the seam-aware stroke pass (S60
    // Stage B) — ``points`` stays the prebuilt fill path data.
    type Fill = {
      key: string
      points: string
      color: string
      formationId: string
      pts: { x: number; y: number }[]
    }
    // Fill the strip directly UNDER a shallow test's own column footprint, below its
    // TD — the gap regions run edge→edge between columns, so a shallow test's own
    // width carries no fill and the correlated bands that continue across it leave a
    // VOID there (owner dogfeed 2026-07-10: "underneath every shallow test there are
    // gaps, even though the correlation bands are there"). computeUnderColumnSubstrate
    // samples the adjacent GAP regions at this column's edges and stacks the below-TD
    // bands, so it fills ONLY where correlated bands actually exist (a genuine
    // uncorrelated void stays empty — no gap region to sample) and paints each band
    // in its own lithology, flat across the footprint (verified on CS1: S8 →
    // KLEI/SILT/KLEI/ZAND/KLEI, all flat). The earlier "grey spill" was this clay
    // sitting under a tie drawn CROSSING the silt; the warp-aware tie fix put the
    // edge flat on the silt base, so the under-column clay now sits correctly below it.
    const { sectionRegions, orderedColumns } = sectionFillData
    const valid = orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    // The pure domain pass returns sloped below-TD quads per column; here we
    // only project them to screen. ENGINE-GATED (S60 Stage A): v2 emits a
    // column's own bottom unit as ONE region running continuously through the
    // TD, which the frozen v1 helper's straddle guard rejects — painting the
    // deeper clay from the TD straight down (the B2 phantom gray block). The
    // component-side fork clips straddling slices to the below-TD band instead
    // (owner rule: the partition owns the sub-TD space). v1 keeps the frozen
    // helper so the fallback engine's render is byte-identical.
    const fills = partitionEngineV2
      ? computeUnderColumnSubstrateForRender(orderedColumns, sectionRegions)
      : computeUnderColumnSubstrate(orderedColumns, sectionRegions)
    const out: Fill[] = []
    for (const f of fills) {
      const sc = screenByInv.get(valid[f.columnIndex])
      if (!sc) continue
      const leftX = sc.leftX
      const rightX = sc.rightX
      if (rightX - leftX <= 0.5) continue
      for (let qi = 0; qi < f.quads.length; qi++) {
        const q = f.quads[qi]
        const color = formationColorById.get(q.formationId) ?? FALLBACK_COLOR
        const yTL = clampY(levelToScreen(q.topLeftElev))
        const yTR = clampY(levelToScreen(q.topRightElev))
        const yBL = clampY(levelToScreen(q.baseLeftElev))
        const yBR = clampY(levelToScreen(q.baseRightElev))
        // Skip a quad with no visible height on either edge.
        if (yBL - yTL <= 0.5 && yBR - yTR <= 0.5) continue
        // Ring: topL → topR → baseR → baseL.
        const pts = [
          { x: leftX, y: yTL },
          { x: rightX, y: yTR },
          { x: rightX, y: yBR },
          { x: leftX, y: yBL },
        ]
        const points =
          `M ${leftX.toFixed(2)},${yTL.toFixed(2)} ` +
          `L ${rightX.toFixed(2)},${yTR.toFixed(2)} ` +
          `L ${rightX.toFixed(2)},${yBR.toFixed(2)} ` +
          `L ${leftX.toFixed(2)},${yBL.toFixed(2)} Z`
        out.push({ key: `uc-${f.columnIndex}-${qi}`, points, color, formationId: q.formationId, pts })
      }
    }
    return out
  }, [
    sectionFillData,
    orderedInvs,
    colByInv,
    screenByInv,
    levelToScreen,
    plotTop,
    plotBottom,
    formationColorById,
    partitionEngineV2,
  ])

  // ---- SEAM-AWARE STROKES (S60 Stage B — owner clause 5, merged view). ------
  //
  // The translucent fills carry a self-colour 0.75 px hairline-closing stroke;
  // on an edge SHARED by two same-litho regions both strokes painted, and the
  // doubled stroke read as a diagonal "helper line" inside a merged same-litho
  // body (lens/onlap termination seams in the sand mass). This pass classifies
  // every fill edge (under-column quads + gap regions together, so the sub-TD
  // strip merges seamlessly into same-litho gap regions) and keeps the stroke
  // ONLY where the neighbour differs in lithology or the edge borders unfilled
  // space. Index-aligned: undercol strokes first, then region strokes.
  const seamStrokes = useMemo((): { undercol: string[]; regions: string[] } => {
    if (refinement || screenRegions.length + underColumnFills.length === 0)
      return { undercol: [], regions: [] }
    const elements: SeamStrokeElement[] = [
      ...underColumnFills.map((f) => ({ points: f.pts, formationId: f.formationId })),
      ...screenRegions.map((sr) => ({ points: sr.points, formationId: sr.region.formationId })),
    ]
    const ds = computeSeamStrokePaths(elements)
    return {
      undercol: ds.slice(0, underColumnFills.length),
      regions: ds.slice(underColumnFills.length),
    }
  }, [refinement, underColumnFills, screenRegions])

  // ---- DISSOLVED FILL GROUPS (S61 — owner clause 5, app-render half). --------
  //
  // The visible litho fill is emitted as ONE ``<path>`` per merged same-litho
  // body — every adjacent same-lithology region (gap regions + under-column
  // substrate quads) that paints at the SAME opacity dissolves into a single
  // element. A single translucent element composites its whole coverage once,
  // so a merged body shows NO inter-element antialiasing hairline (the S60b
  // seam-strokes unmasked it) and NO darkened seam (separate 0.62 elements
  // overlapping would stack to ~0.855). The per-region interactive HIT paths
  // (below) and the seam-aware STROKE pass stay per-region — only the fill
  // paint is dissolved. See ``sectionFillGroups.ts``.
  //
  // The opacity BUCKET keeps the S1 selection-fade working per body: a selected
  // body paints at its natural opacity while same-litho siblings demote to 0.25,
  // so they land in different buckets → different elements (each still uniform).
  const fillGroups = useMemo(() => {
    if (refinement || screenRegions.length + underColumnFills.length === 0) return []
    // The selected body's lithology — under-column fills carry formationId (not
    // bodyId), so S1 fades them by matching lithology (mirrors the render below).
    const selFormId = selectedBodyId
      ? (screenRegions.find((sr) => sr.region.bodyId === selectedBodyId)?.region.formationId ?? null)
      : null
    const elements: FillGroupElement[] = []
    for (const f of underColumnFills) {
      const opacity =
        selectedBodyId && selFormId !== null && f.formationId !== selFormId ? 0.25 : FILL_OPACITY
      elements.push({
        points: f.pts,
        formationId: f.formationId,
        color: f.color,
        opacityBucket: String(opacity),
        opacity,
      })
    }
    for (const sr of screenRegions) {
      const naturalOpacity = sr.region.kind === 'lens' ? LENS_OPACITY : FILL_OPACITY
      const opacity =
        selectedBodyId && sr.region.bodyId !== selectedBodyId ? 0.25 : naturalOpacity
      elements.push({
        points: sr.points,
        formationId: sr.region.formationId,
        color: formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR,
        opacityBucket: String(opacity),
        opacity,
      })
    }
    return buildFillGroups(elements)
  }, [refinement, underColumnFills, screenRegions, selectedBodyId, formationColorById])

  // ---- GEOTECH REFINEMENT (fraction-space NAD subdivision, view-only). -------
  //
  // When `refinement` is set (the geotech axis), the litho partition
  // (sectionFillData.sectionRegions, built from the LITHO model) is refined by
  // NAD packing class: each region is subdivided by the geotech sub-bands, the
  // under-TD substrate is class-extrapolated, and the litho envelopes are drawn
  // as dark outlines on top. Geotech is view-only, so this replaces the
  // interactive litho fill + handles. Combined domain+screen memo (no per-frame
  // drag to protect from recompute here — unlike the litho axis's #209 split).
  const refinedScreen = useMemo(() => {
    const empty = {
      fillPolys: [] as { key: string; d: string; color: string }[],
      substratePolys: [] as { key: string; d: string; color: string }[],
      outlines: [] as { key: string; d: string }[],
    }
    if (!refinement || !showBands) return empty
    const { sectionRegions, orderedColumns, gapXs } = sectionFillData
    if (orderedColumns.length < 2) return empty
    const valid = orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    const columnOrder = orderedColumns.map((c) => c.investigationId)

    // Geotech columns keyed by investigation, sharing each litho column's
    // surface elevation (same investigation → same ground surface).
    const geoByInv = new Map<string, GeotechColumn['units'][number][]>()
    for (const l of refinement.geotechLayers) {
      const inv = (l.borehole_id ?? l.cpt_id) as string | null
      if (!inv) continue
      const arr = geoByInv.get(inv) ?? []
      arr.push({
        layerId: l.id,
        topDepthM: l.depth_top_m,
        baseDepthM: l.depth_base_m,
        formationId: l.formation_id,
        bodyId: l.body_id ?? null,
      })
      geoByInv.set(inv, arr)
    }
    const geoColByInv = new Map<string, GeotechColumn>()
    for (const c of orderedColumns) {
      geoColByInv.set(c.investigationId, {
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM,
        units: geoByInv.get(c.investigationId) ?? [],
      })
    }

    const refined = refineLithoPartition(
      sectionRegions,
      columnOrder,
      geoColByInv,
      refinement.nadMeta,
      refinement.lithoSoilByFormationId,
    )

    // Refined region fills + litho outlines (per gap, degenerate gaps skipped).
    const fillPolys: { key: string; d: string; color: string }[] = []
    const outlines: { key: string; d: string }[] = []
    let fi = 0
    for (const p of refined) {
      const g = gapXs[p.gapIndex]
      if (!g || g.rightX - g.leftX < 1) continue // degenerate-gap guard (mirror-spill)
      const d =
        p.points
          .map((q, j) => {
            const x = g.leftX + q.fraction * (g.rightX - g.leftX)
            const y = clampY(levelToScreen(q.elevation))
            return `${j === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
          })
          .join(' ') + ' Z'
      // A `fallback` polygon carries the LITHO formation id (no packing data
      // anywhere at these elevations) → colour it by lithology, not NAD.
      const color =
        p.tag === 'fallback'
          ? (refinement.lithoFormationColorById.get(p.formationId) ?? FALLBACK_COLOR)
          : (formationColorById.get(p.formationId) ?? FALLBACK_COLOR)
      fillPolys.push({ key: `gr-${fi++}`, d, color })
    }
    // Litho region envelopes on top (dark) — "litho boundaries persist".
    let oi = 0
    for (const r of sectionRegions) {
      if (r.kind === 'lens') continue
      const g = gapXs[r.gapIndex]
      if (!g || g.rightX - g.leftX < 1) continue
      const d =
        r.polygon
          .map((q, j) => {
            const x = g.leftX + q.fraction * (g.rightX - g.leftX)
            const y = clampY(levelToScreen(q.elevation))
            return `${j === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
          })
          .join(' ') + ' Z'
      outlines.push({ key: `go-${oi++}`, d })
    }

    // Refined under-TD substrate: class-extrapolated donor slices, strips
    // clipped to the midpoints toward neighbours (rule 6 — coincident-cluster
    // strips otherwise overlap visibly). Engine-gated like the litho path
    // (S60 Stage A) — the geotech axis inherits the corrected sub-TD stack.
    const fills = partitionEngineV2
      ? computeUnderColumnSubstrateForRender(orderedColumns, sectionRegions)
      : computeUnderColumnSubstrate(orderedColumns, sectionRegions)
    const subSlices = refineSubstrateQuads(
      fills,
      columnOrder,
      geoColByInv,
      refinement.nadMeta,
      refinement.lithoSoilByFormationId,
    )
    const sliceByKey = new Map<string, (typeof subSlices)[number]>()
    for (const s of subSlices) sliceByKey.set(`${s.columnIndex}-${s.quadIndex}`, s)
    const centreX = (i: number): number | null => {
      const sc = screenByInv.get(valid[i])
      return sc ? (sc.leftX + sc.rightX) / 2 : null
    }
    const substratePolys: { key: string; d: string; color: string }[] = []
    let si = 0
    for (const f of fills) {
      const sc = screenByInv.get(valid[f.columnIndex])
      if (!sc) continue
      const rawX0 = sc.leftX
      const rawX1 = sc.rightX
      if (rawX1 - rawX0 <= 0.5) continue
      const c = centreX(f.columnIndex)
      const cl = centreX(f.columnIndex - 1)
      const cr = centreX(f.columnIndex + 1)
      const x0 = Math.max(rawX0, cl != null && c != null ? (cl + c) / 2 : -Infinity)
      const x1 = Math.min(rawX1, cr != null && c != null ? (c + cr) / 2 : Infinity)
      if (x1 - x0 < 0.5) continue
      for (let qi = 0; qi < f.quads.length; qi++) {
        const q = f.quads[qi]
        const fx = (xa: number): number => (xa - rawX0) / (rawX1 - rawX0)
        const topAt = (xa: number): number =>
          q.topLeftElev + (q.topRightElev - q.topLeftElev) * fx(xa)
        const baseAt = (xa: number): number =>
          q.baseLeftElev + (q.baseRightElev - q.baseLeftElev) * fx(xa)
        // Quad in (x, elevation) space at the clipped strip range.
        const quadPts = [
          { x: x0, e: topAt(x0) },
          { x: x1, e: topAt(x1) },
          { x: x1, e: baseAt(x1) },
          { x: x0, e: baseAt(x0) },
        ]
        const toPath = (pts: { x: number; e: number }[], color: string): void => {
          if (pts.length < 3) return
          const d =
            pts
              .map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${clampY(levelToScreen(p.e)).toFixed(2)}`)
              .join(' ') + ' Z'
          substratePolys.push({ key: `gs-${si++}`, d, color })
        }
        const rq = sliceByKey.get(`${f.columnIndex}-${qi}`)
        if (!rq || rq.slices == null) {
          // No classified donor anywhere → the quad's LITHO formation colour.
          toPath(quadPts, refinement.lithoFormationColorById.get(q.formationId) ?? FALLBACK_COLOR)
          continue
        }
        for (const sl of rq.slices) {
          toPath(
            clipPolygonToElevBand(quadPts, sl.topElev, sl.baseElev),
            formationColorById.get(sl.formationId) ?? FALLBACK_COLOR,
          )
        }
      }
    }

    return { fillPolys, substratePolys, outlines }
  }, [
    refinement,
    showBands,
    sectionFillData,
    orderedInvs,
    colByInv,
    screenByInv,
    levelToScreen,
    plotTop,
    plotBottom,
    formationColorById,
    partitionEngineV2,
  ])

  // One label per BODY, zoom-adaptive sizing and fit-based visibility.
  //
  // Rules (owner dogfeed, 2026-06-24):
  //  1. PLACEMENT — polygon centroid (Shoelace), with a widest-scanline fallback
  //     when the centroid falls outside the polygon's bounding box. This prevents
  //     a sloped/pinched band's bbox-centre from landing on a neighbouring body.
  //  2. FONT SIZE — proportional to the region's on-screen height so labels shrink
  //     when zoomed out and grow (up to MAX) when zoomed in.
  //  3. SHOW-IF-FITS — a body only gets a label when the scaled font FITS the
  //     region vertically (height >= fontSize + margin) AND horizontally (estimated
  //     text width <= available width). This replaces the old fixed LABEL_MIN_H gate
  //     and the dedupeLabelsByText cross-body collapse.
  //  4. ONE LABEL PER BODY (by bodyId). A body that spans multiple gap segments
  //     picks its TALLEST region as the anchor.
  const labels = useMemo(() => {
    const bestByBody = new Map<string, ScreenRegion>()
    for (const sr of screenRegions) {
      const id = sr.region.bodyId
      if (!id) continue
      const prev = bestByBody.get(id)
      if (!prev || sr.maxY - sr.minY > prev.maxY - prev.minY) bestByBody.set(id, sr)
    }

    const out: { key: string; x: number; y: number; fontSize: number; text: string }[] = []
    for (const [id, sr] of bestByBody) {
      const text = formationLabelById?.get(sr.region.formationId)
      if (!text) continue

      const regionH = sr.maxY - sr.minY
      const fontSize = Math.max(LABEL_FONT_MIN, Math.min(LABEL_FONT_MAX, regionH * LABEL_FONT_K))

      // Show-if-fits gate: vertical clearance + estimated horizontal width.
      if (regionH < fontSize + LABEL_V_MARGIN) continue
      const loX = plotLeft != null ? Math.max(sr.minX, plotLeft) : sr.minX
      const hiX = plotRight != null ? Math.min(sr.maxX, plotRight) : sr.maxX
      const availW = hiX - loX
      if (availW < text.length * fontSize * LABEL_CHAR_W_RATIO) continue

      // Clip the polygon to the visible x band before computing the anchor so
      // the point stays in the VISIBLE portion on zoomed-in views.
      const clampedBounds = {
        minX: loX,
        maxX: hiX,
        minY: sr.minY,
        maxY: sr.maxY,
      }
      const { x, y } = labelAnchor(sr.points, clampedBounds)
      out.push({ key: id, x, y, fontSize, text })
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
    // SINGLE-SURFACE PER STORED NODE (S73): a stored node belongs to EXACTLY ONE
    // gesture surface. A body whose region is an apex-shapeable tip (lens / onlap
    // pinch) here owns its nodes on the LENS surface (``screenLenses``); it must NOT
    // also render them as contact-bend handles, or ONE stored node draws 3-4 dots
    // scattered across the gap (the owner's "three points appear when i click",
    // GEO-23/125-S10). And a body's contact nodes must render for only ONE boundary
    // pair per gap, never once per every pair the body tops (``sand-sand`` +
    // ``sand-silt`` for the same node). This set dedups the node-emitting pairs by
    // ``gapKey:upperBodyId`` so the same body's contact nodes are drawn once.
    const nodesEmittedFor = new Set<string>()

    for (let idx = 0; idx < screenRegions.length; idx += 1) {
      const sr = screenRegions[idx]
      if (sr.region.kind === 'lens') continue
      if (!sr.region.bodyId) continue

      const gapKey = `${sr.leftX}:${sr.rightX}`
      const prevIdx = lastMainByGap.get(gapKey)
      if (prevIdx !== undefined) {
        // Order the pair by GEOMETRY, not emission order: the UPPER band is the
        // one higher on screen (smaller minY). v2 does not emit main regions
        // strictly top→bottom, so the raw ``prevIdx``/``sr`` order put the lower
        // band as ``upper`` — the "targets the top" dogfeed (§71): the add-strip
        // + node then keyed the wrong body and the contact node never matched.
        const prev = screenRegions[prevIdx]
        const upperIsPrev = prev.minY <= sr.minY
        const upper = upperIsPrev ? prev : sr
        const lower = upperIsPrev ? sr : prev
        const upperIdx = upperIsPrev ? prevIdx : idx
        const lowerIdx = upperIsPrev ? idx : prevIdx
        const uId = upper.region.bodyId!
        const lId = lower.region.bodyId!

        // Clamp bounds for the drag.
        const minY = upper.minY + 1
        const maxY = lower.maxY - 1

        // Natural edge = the upper region's BASE contact (its deepest horizontal
        // span). NOT the polygon's last two vertices: a v2 full-width band winds
        // topL→baseL→baseR→topR, so its last two vertices are the RIGHT COLUMN edge
        // — the add-strip then rendered as a vertical stub on the column and the
        // base contact could not be grabbed (owner "can't grab a base-tie-bounded
        // unit", GEO-23/125-S10). ``baseContactEdge`` picks the true base span so
        // the add-strip sits ON the contact and a click projects onto it (S72).
        const uPts = upper.points
        const nu = uPts.length
        const baseEdge = baseContactEdge(uPts)
        const naturalEdge: SharedBoundary['naturalEdge'] = baseEdge ?? [
          { x: uPts[nu - 2].x, y: uPts[nu - 2].y },
          { x: uPts[nu - 1].x, y: uPts[nu - 1].y },
        ]

        // Resolve per-node handle positions. Emit a body's stored contact nodes for
        // only the FIRST pair it tops in this gap (S73): the same body can top two
        // pairs (``sand-sand`` + ``sand-silt``), and rendering the node in both drew
        // one stored node as several scattered dots. The natural-edge add-strip still
        // renders on every pair (a click on either lands on the contact); only the
        // stored-node HANDLES are drawn once.
        const nodesKey = `${gapKey}:${uId}`
        const emitNodes = !nodesEmittedFor.has(nodesKey)
        const nodes: SharedBoundary['nodes'] = []
        if (emitNodes && boundariesByBodyId && alongToScreenX && levelToScreen) {
          nodesEmittedFor.add(nodesKey)
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
          upperIdx,
          lowerIdx,
          gapIndex: upper.region.gapIndex,
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
  }, [
    screenRegions,
    boundaryDrag,
    boundariesByBodyId,
    alongToScreenX,
    levelToScreen,
    onSaveBoundary,
  ])

  // ---- Collect lens freedraw handle arrays. ---------------------------------
  //
  // For each lens region, build ScreenLens with upper/lower node handle arrays
  // and source corner info so the render pass can draw handles + add-strips.
  // Only rendered when onSaveBoundary is wired.
  const screenLenses = useMemo((): ScreenLens[] => {
    if (!onSaveBoundary) return []
    const out: ScreenLens[] = []
    // A shapeable body can be split into several regions in the SAME gap (e.g. an
    // onlap carves the sand matrix into two pinch pieces). Each piece owns the same
    // stored node by along-x, so ONE stored node drew TWO lens handles — part of the
    // owner's "three points appear when i click" (S73). Claim each stored node
    // (``bodyId:edge:nodeIndex``) for the FIRST region that renders it so it draws a
    // single handle. The un-claimed pieces still render their fill + add-strips.
    const claimedLensNodes = new Set<string>()
    for (let ri = 0; ri < screenRegions.length; ri += 1) {
      const sr = screenRegions[ri]
      // Shapeable termination = v2 lens AND lone pinch/onlap tip (engine-agnostic
      // read of the SectionRegion contract). The v1 ``kind==='lens'`` gate silently
      // dropped every v2 pinch tip's apex handle — the "alt-click gesture is gone"
      // dogfeed. ``isApexShapeable`` keeps full-width bands/pinches (no tip) excluded.
      if (!isApexShapeable(sr.region)) continue
      const bodyId = sr.region.bodyId
      if (!bodyId) continue
      // UN-ROUTABLE tip (§77): a shapeable tip whose override the engine floods to a
      // band (does not consume) exposes NO grab handle on v2 — better no handle than
      // a dead grab. Detected in ``sectionFillData`` (region flooded despite the
      // override); with off-engine reshape retired it can't gap, but a dead handle is
      // still confusing, so suppress it.
      if (sectionFillData.unroutableBodies.has(`${sr.region.gapIndex}:${bodyId}`)) continue

      // Derive the anchored side + source corners from the polygon EXTENT, not from
      // ``polygon[0]``: v2 pinch polygons may START at the mid-gap tip (observed
      // ``verts=0.50>1.00>1.00``), so index-0 is not reliably the column-face corner.
      const corners = resolveSourceCorners(sr.region.polygon)
      if (!corners) continue
      const side = corners.side
      const b = boundariesByBodyId?.get(bodyId)
      const upperStored = b?.upper_nodes ?? []
      const lowerStored = b?.lower_nodes ?? []

      // Source corners (fraction 0 or 1 = column face) in screen coords.
      const gapW = sr.rightX - sr.leftX
      const srcTop = corners.sourceTop
      const srcBase = corners.sourceBase
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
          // One stored node → one handle: if an earlier region already claimed this
          // node (same body split into multiple pieces in the gap), skip it here.
          const claimKey = `${bodyId}:${edge}:${ni}`
          if (claimedLensNodes.has(claimKey)) return
          claimedLensNodes.add(claimKey)
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
    // Suppress the grab handle for un-routable tips (§77).
    sectionFillData.unroutableBodies,
  ])

  // ---- SINGLE-SURFACE dedup: one stored node → one draggable dot (S73). --------
  //
  // A body's ``lower_nodes`` node can be BOTH a contact-bend node (``sharedBoundaries``
  // renders it as a boundary handle) AND a lens base-edge node (``screenLenses``
  // renders it as a lens handle) when that body is a shapeable pinch tip in the gap.
  // Rendering both drew ONE stored node as several scattered dots — the owner's
  // "three points appear when i click" (GEO-23/125-S10). ``screenLenses`` is the
  // AUTHORITATIVE owner for any node it actually renders (its gate already resolves
  // shapeability + source corners + un-routable suppression), so drop from the
  // boundary pass exactly those nodes ``screenLenses`` drew. Keyed by the stored
  // ``bodyId:nodeIndex`` on the LOWER edge (the edge ``sharedBoundaries`` reads).
  const sharedBoundariesForRender = useMemo((): SharedBoundary[] => {
    const lensLowerNodeKeys = new Set<string>()
    for (const sl of screenLenses) {
      for (const n of sl.lowerNodes) lensLowerNodeKeys.add(`${sl.bodyId}:${n.nodeIndex}`)
    }
    if (lensLowerNodeKeys.size === 0) return sharedBoundaries
    return sharedBoundaries.map((sb) => {
      const kept = sb.nodes.filter(
        (n) => !lensLowerNodeKeys.has(`${sb.upperBodyId}:${n.nodeIndex}`),
      )
      return kept.length === sb.nodes.length ? sb : { ...sb, nodes: kept }
    })
  }, [sharedBoundaries, screenLenses])

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

  // ---- Global add-strip click router (S70) ---------------------------------
  //
  // Where thin stacked pinch lenses converge (the GEO-10/170-S7 gap5 dogfeed),
  // several bodies' 14px add-strips overlap at one click point. With each strip
  // firing its own onClick, the winner was pure SVG paint order — a click on the
  // sand/silt interface silently grabbed a DISTANT silt lens painted on top, then
  // moving it opened a gap. ``nearerLensEdge`` only arbitrates ONE lens's two
  // edges. This builds ONE candidate list across ALL add-strips (matched-contact
  // boundaries + lens edges) so every click routes to the boundary physically
  // NEAREST the cursor, regardless of which strip element the browser delivered
  // the event to.
  //
  // ``dispatch`` is a thunk closing over the resolved handler args so the router
  // stays a pure geometry pick — it never needs to know boundary vs lens.
  //
  // The cursor position of the in-flight add-strip click, captured before the
  // router runs so the dispatch thunks read the true click (a ref, not state —
  // it must be current synchronously inside the same onClick, with no re-render).
  const lastClick = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const addStripCandidates = useMemo((): AddStripCandidate<() => void>[] => {
    if (!onSaveBoundary) return []
    const cands: AddStripCandidate<() => void>[] = []
    // Matched-contact boundary strips: the natural base edge of the upper region.
    // ``regionPolygon`` = the UPPER band's region ring so a click INSIDE that band
    // targets its base contact (region-containment; §77). A shared-contact click
    // sits inside both incident bands — the router's nearest-edge tiebreak then
    // resolves which one, matching the geometric-upper labelling in the pair.
    for (const sb of sharedBoundaries) {
      const [ne0, ne1] = sb.naturalEdge
      const upperRegion = screenRegions[sb.upperIdx]
      const segs: [{ x: number; y: number }, { x: number; y: number }][] = [[ne0, ne1]]
      cands.push({
        segments: segs,
        regionPolygon: upperRegion?.points,
        // PROJECT the click onto the contact edge (S72): a click deep inside the
        // upper band must drop the node ON the shared contact at the cursor x, not
        // float at the raw interior y (the "point without grabbing a boundary" +
        // the tie-bounded-base "can't grab it" dogfeed). ``handleBoundaryAddNode``
        // then stores the on-edge (along, elevation); S68's contact-override
        // re-partitions BOTH bands through the engine, so a tie-bounded base bends
        // gap/overlap-free.
        dispatch: () => {
          const p =
            projectClickToCandidate(lastClick.current, { segments: segs, dispatch: null }) ??
            lastClick.current
          handleBoundaryAddNode(sb.upperBodyId, sb.leftX, sb.rightX, p.x, p.y)
        },
      })
    }
    // Lens strips: BOTH the upper and the lower edge of each lens are candidates.
    // The winning lens then routes its own node to nearerLensEdge (upper vs lower).
    // ``regionPolygon`` = the lens's OWN region ring: a click inside the thin lens
    // grabs the lens; a click in the sand band below can no longer be stolen by the
    // lens's long diagonal flank passing near the cursor (the owner's 2026-07-22 bug).
    for (const sl of screenLenses) {
      const sr = screenRegions[sl.regionIdx]
      if (!sr) continue
      const pts = sr.points
      const n = pts.length
      const upperEnd = n >= 2 ? pts[1] : pts[0]
      const lowerStart = n >= 2 ? pts[n - 2] : pts[n - 1]
      const upperSeg: [{ x: number; y: number }, { x: number; y: number }] = [sl.sourceTopPt, upperEnd]
      const lowerSeg: [{ x: number; y: number }, { x: number; y: number }] = [lowerStart, sl.sourceBasePt]
      cands.push({
        segments: [upperSeg, lowerSeg],
        regionPolygon: sr.points,
        dispatch: () => {
          const edge = nearerLensEdge({ x: lastClick.current.x, y: lastClick.current.y }, upperSeg, lowerSeg)
          // PROJECT onto the CHOSEN edge (S72): the node rides that lens edge at the
          // cursor x, never floating in the lens interior. Projecting onto the picked
          // edge (not both) keeps the node on the same edge ``nearerLensEdge`` selected.
          const seg = edge === 'upper' ? upperSeg : lowerSeg
          const p =
            projectClickToCandidate(lastClick.current, { segments: [seg], dispatch: null }) ??
            lastClick.current
          // VISIBLE-REACH FLOOR (S72): the engine emits the lens with its apex AT this
          // node, so a node dropped near the anchored column face collapses the lens to
          // a hairline ("clicked the apex → it disappeared"). Push the node's along-x
          // to at least MIN_VISIBLE_APEX_FRACTION of the gap away from the source
          // column so a click can never pinch the lens to nothing. Left-anchored: reach
          // grows with x → floor x; right-anchored: reach grows as x shrinks → cap x.
          const gapW = sl.rightX - sl.leftX
          const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
          const nodeX =
            sl.side === 'left'
              ? Math.max(sl.leftX + floorPx, p.x)
              : Math.min(sl.rightX - floorPx, p.x)
          handleLensAddNode(sl.bodyId, edge, nodeX, p.y)
        },
      })
    }
    return cands
  }, [
    sharedBoundaries,
    screenLenses,
    screenRegions,
    onSaveBoundary,
    // handleBoundaryAddNode / handleLensAddNode close over the same deps the
    // dispatch thunks need; they are stable within a render, so re-deriving the
    // candidate list on each of these inputs keeps the thunks fresh.
    boundariesByBodyId,
    alongToScreenX,
    screenXToAlong,
    screenToLevel,
  ])

  /**
   * Route an add-strip click to the boundary nearest the cursor across ALL bodies.
   *
   * @param cx Cursor x in SVG coordinates.
   * @param cy Cursor y in SVG coordinates.
   */
  const routeAddStripClick = (cx: number, cy: number): void => {
    lastClick.current = { x: cx, y: cy }
    // Region-containment first (grab the body the click is inside), nearest-segment
    // fallback when the click is outside every region ring (§77). Robust where the
    // plain nearest-segment pick was fooled by a distant lens's diagonal flank.
    const dispatch = routeAddStripByContainment({ x: cx, y: cy }, addStripCandidates)
    if (dispatch) dispatch()
  }

  return (
    <g ref={rootRef} data-testid="partition-fill-overlay" style={{ pointerEvents: 'none' }}>
      {/* Crossing-tie HARD-CONFLICT warning (owner §8 Q4): when approved
          correlation ties cross, both are suspended (neither bands) until the
          user deletes one. A small persistent, non-blocking amber chip — never a
          dialog / focus steal. */}
      <CrossingTieWarningChip
        conflictCount={conflicts.length}
        plotLeft={plotLeft ?? 0}
        plotTop={plotTop}
      />
      {/* GEOTECH REFINEMENT (view-only): the litho partition refined by NAD
          packing class. Substrate BENEATH the region fills; litho envelopes as
          dark outlines on top. Replaces the interactive litho fill + handles. */}
      {refinement && (
        <g data-testid="partition-refined">
          {refinedScreen.substratePolys.map((p) => (
            <path
              key={p.key}
              data-testid="partition-refined-substrate"
              d={p.d}
              fill={p.color}
              fillOpacity={FILL_OPACITY}
              // Self-colour seam stroke at the fill opacity (2026-07-13) — closes
              // the antialiasing hairline between adjacent NAD sub-band fills. Matches
              // fillOpacity so it never reads as a darker outline. See region-fill note.
              stroke={p.color}
              strokeOpacity={FILL_OPACITY}
              strokeWidth={0.75}
              strokeLinejoin="round"
            />
          ))}
          {refinedScreen.fillPolys.map((p) => (
            <path
              key={p.key}
              data-testid="partition-refined-fill"
              d={p.d}
              fill={p.color}
              fillOpacity={FILL_OPACITY}
              // Self-colour seam stroke at the fill opacity — see the substrate note.
              stroke={p.color}
              strokeOpacity={FILL_OPACITY}
              strokeWidth={0.75}
              strokeLinejoin="round"
            />
          ))}
          {refinedScreen.outlines.map((p) => (
            <path
              key={p.key}
              data-testid="partition-refined-outline"
              d={p.d}
              fill="none"
              stroke="#0d1117"
              strokeOpacity={0.85}
              strokeWidth={0.8}
            />
          ))}
        </g>
      )}
      {/* DISSOLVED FILL LAYER (S61 — owner clause 5, app-render half): one
          translucent ``<path>`` per merged same-litho body (adjacent gap regions
          + under-column substrate quads at the same opacity, dissolved into one
          element). A single element composites its coverage once, so a merged
          body shows NO inter-element antialiasing hairline (the S60b seam-strokes
          unmasked it) and NO darkened seam (two separate 0.62 elements would
          stack to ~0.855 where they overlap). Painted FIRST (beneath the
          interactive hit paths + seam strokes below); ``pointer-events: none`` —
          the fill is display-only, hit-testing lives on the per-region paths. */}
      {!refinement &&
        fillGroups.map((g) => (
          <path
            key={`pf-group-${g.key}`}
            data-testid={`partition-fill-group-${g.key}`}
            d={g.d}
            fill={g.color}
            fillOpacity={g.opacity}
            style={{ pointerEvents: 'none' }}
          />
        ))}

      {/* Under-column substrate seam strokes: the FILL is now dissolved into the
          groups above; only the seam-aware hairline-closing stroke stays
          per-quad (kept ONLY on edges NOT shared with a same-litho fill, S60
          Stage B — a same-litho seam carries no line). */}
      {!refinement &&
        underColumnFills.map((f, fi) => {
          // Fade the stroke with the same S1 rule the fill group uses (match by
          // lithology, since under-column fills carry formationId not bodyId).
          const selFormId = selectedBodyId
            ? (screenRegions.find((sr) => sr.region.bodyId === selectedBodyId)?.region.formationId ??
              null)
            : null
          const ucOpacity =
            selectedBodyId && selFormId !== null && f.formationId !== selFormId ? 0.25 : FILL_OPACITY
          const strokeD = seamStrokes.undercol[fi]
          if (!strokeD) return null
          return (
            <path
              key={f.key}
              data-testid="partition-undercol-stroke"
              d={strokeD}
              fill="none"
              stroke={f.color}
              strokeOpacity={ucOpacity}
              strokeWidth={0.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

      {!refinement && screenRegions.map((sr, i) => {
        const color = formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR
        const d = `${sr.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`
        const body = sr.region.bodyId ? bodyById.get(sr.region.bodyId) : undefined
        const interactive = Boolean(onBodyContextMenu && body)
        // S1: soft-coupling fade — demote non-matching bodies to 0.25 opacity
        // when a body is selected; the selected body renders at natural opacity
        // ("demote, never remove" precedent — the fill stays visible, just dimmed).
        const naturalOpacity = sr.region.kind === 'lens' ? LENS_OPACITY : FILL_OPACITY
        const regionOpacity = (selectedBodyId && sr.region.bodyId !== selectedBodyId)
          ? 0.25
          : naturalOpacity
        // Seam-aware self-colour stroke (S60 Stage B — owner clause 5): the
        // 2026-07-13 hairline-closing stroke is kept ONLY on edges that border
        // a DIFFERENT lithology or unfilled space. On an edge shared by two
        // same-litho regions (lens/onlap termination seams) both regions used
        // to stroke it, and the doubled self-colour stroke over the translucent
        // fill read as a diagonal "helper line" inside the merged body — those
        // edges now carry no stroke (two identical fills meeting on shared
        // vertices need no hairline closure). Stroke styling notes unchanged:
        // strokeOpacity matches the fill (incl. the 0.25 S1-fade) so it never
        // reads darker; round linejoin avoids miter spikes on pinch tips.
        const strokeD = seamStrokes.regions[i]
        return (
          <g key={`pf-${i}`}>
            {/* Per-region INTERACTIVE HIT path (S61): the visible fill is now the
                dissolved group above; this transparent path keeps the region's
                own body context menu + testid + pointer-events. ``fill`` carries
                the group colour (readable for the S1 fade bucket) but paints
                transparently via ``fillOpacity`` 0 — the visible paint is the
                merged group, so per-region translucent stacking (the seam) is
                gone. */}
            <path
              data-testid={`partition-region-${sr.region.bodyId ?? 'nobody'}`}
              d={d}
              fill={color}
              fillOpacity={0}
              style={interactive ? { pointerEvents: interactivePtr, cursor: 'context-menu' } : { pointerEvents: 'none' }}
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
            {strokeD && (
              <path
                data-testid={`partition-region-stroke-${sr.region.bodyId ?? 'nobody'}`}
                d={strokeD}
                fill="none"
                stroke={color}
                strokeOpacity={regionOpacity}
                strokeWidth={0.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        )
      })}

      {!refinement && labels.map((l) => (
        <text
          key={`pf-label-${l.key}`}
          data-testid={`partition-label-${l.key}`}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={l.fontSize}
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
      {!refinement && sharedBoundariesForRender.map((sb) => {
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
              style={{ pointerEvents: interactivePtr, cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: BOUNDARY_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                // Global nearest-boundary router (S70): where stacked strips
                // overlap, the click routes to the body whose edge is physically
                // nearest the cursor, NOT this strip by z-order.
                routeAddStripClick(e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0))
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
                  style={{ pointerEvents: interactivePtr, cursor: 'ns-resize' }}
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
      {!refinement && screenLenses.map((sl) => {
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
              style={{ pointerEvents: interactivePtr, cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: LENS_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                // Global nearest-boundary router (S70): where stacked lenses' strips
                // overlap, the click routes to the body (and within a lens, the edge)
                // physically nearest the cursor — not this strip by z-order. The old
                // per-strip nearerLensEdge only arbitrated ONE lens's two edges.
                routeAddStripClick(e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0))
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
              style={{ pointerEvents: interactivePtr, cursor: 'copy' }}
              onMouseMove={(e) => {
                const { x, y } = svgCoordsFromEvent(e)
                setAddNodePreview({ x, y, color: LENS_COLOR })
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                // Global nearest-boundary router (S70): see the upper strip's note.
                routeAddStripClick(e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0))
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
                  style={{ pointerEvents: interactivePtr, cursor: 'grab' }}
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
                  style={{ pointerEvents: interactivePtr, cursor: 'grab' }}
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
                // Self-colour seam stroke at the fill opacity (2026-07-13) — closes
                // the antialiasing hairline where the open-end stub abuts the
                // section-edge column. See the region-fill note above.
                stroke={color}
                strokeOpacity={FILL_OPACITY}
                strokeWidth={0.75}
                strokeLinejoin="round"
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
