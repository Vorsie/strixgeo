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

import { countSpanningRegions } from '../../utils/countSpanningRegions'
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
import { buildApexOverridesForGaps, detectPersistedLensBodies } from './apexOverrideWiring'
import { fillIdentityOf } from './sectionFillIdentity'
import { computeSectionSeamStrokes } from './sectionSeamStrokeElements'
import { buildColumnStripFills } from './columnStripFills'
import UnitStatisticsPortalMenu, { type UnitStatsMenuState } from './UnitStatisticsPortalMenu'
import { buildFillGroups, type FillGroupElement } from './sectionFillGroups'
import {
  computeSectionFillActive,
  computeSectionFillActiveWithDiagnostics,
  usePartitionEngineV2,
} from '../../utils/partitionEngineSelect'
import { topologyKey, usePartitionGhostHandles } from './usePartitionGhostHandles'
import type { TieConflict } from '../../utils/partitionFillV2'
import { nearerLensEdge } from '../../utils/lensEdgePick'
import {
  applyReachFloorOnSegment,
  nearestAddStripWithinTolerance,
  projectClickToCandidate,
  routeAddStripByEdgeProximity,
  type AddStripCandidate,
} from './partitionAddStripRouter'
import { assemblePlacedPartitionColumns } from './assemblePlacedPartitionColumns'
import {
  selectLithoFallbackRegions,
  type FallbackPackingBand,
} from '../../utils/geotechFillFallback'
import { computeHierarchicalGeotechFill } from '../../utils/geotechHierarchicalFill'
import { lithoOutlineEdges } from '../../utils/lithoOutlineEdges'
import {
  frameAlignedColumns,
  frameGapRuns,
  rebaseApexOverrides,
  shiftGapIndexed,
  shiftRegionGaps,
} from '../../utils/frameAlignedPartition'
import {
  UNBANDED_HATCH_INK,
  UNBANDED_HATCH_LABEL,
  UNBANDED_HATCH_PATTERN_ID,
  UNBANDED_HATCH_ROTATION_DEG,
  UNBANDED_HATCH_SPACING_PX,
  UNBANDED_HATCH_STROKE_OPACITY,
  UNBANDED_HATCH_STROKE_WIDTH,
  selectUnbandedHatchFills,
  type HatchCandidateFill,
} from '../../utils/unbandedGeotechHatch'
import type { PlacedColumn } from './utils'
import CrossingTieWarningChip from './CrossingTieWarningChip'
import { nextVisitIndex } from './tieVisitNav'
import ReviewFlagLayer, { type ReviewFlagMarker } from './ReviewFlagLayer'
import { reviewFlagId } from '../../utils/reviewFlagPrefs'
import { type ReviewFlag } from '../../utils/partitionFillV2'
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
import {
  type EditableTargetIdentity,
  handleColorForTarget,
  isDragRejected,
  type OverrideStatus,
  sameEditableTarget,
  shouldPersistDrag,
} from './unsafeDragUX'
import {
  type OnlapInterveningGrab,
  boundaryDragIsConsumable,
  pendingContactTieForDrag,
  routeGrabbedBoundary,
  twoBandExtentScreenY,
} from './correlateOnDrag'
import { dragCrossedThreshold } from './dragThreshold'
import {
  SECTION_FILL_OPACITY,
  SECTION_LENS_FILL_OPACITY,
} from '../../utils/sectionFillOpacity'

/**
 * The LITHO frame drawn over the geotech axis's own partition.
 *
 * OWNER RULING 2026-08-13. The geotech axis no longer refines the litho
 * partition by NAD class — it runs the SAME partition engine over the GEOTECH
 * model's columns and its own approved packing ties ("we don't need to invent
 * the fill bands engine, it is built for the litho stage — we only have more
 * classes"), which is byte-for-byte the computation the 3-D build arm already
 * performs. ``lithoLayers`` + ``contactEdges`` therefore carry the GEOTECH
 * model's rows on that axis.
 *
 * Litho geometry stays visually authoritative, and that is what this bundle is
 * for: the litho partition is built a second time from the rows here and drawn
 * as (a) dark region-envelope OUTLINES over the packing fills, and (b)
 * litho-colour FALLBACK fills beneath them, wherever the geotech model has no
 * bands for a litho region.
 *
 * Present ⇒ the geotech axis, which is VIEW-ONLY: no lens / boundary / body
 * gestures and no per-body labels (those live on the column strips).
 */
export interface GeotechLithoFrame {
  /** LITHO-model ``litho_layer`` rows — the outline + fallback partition. */
  lithoLayers: readonly LithoLayerResponse[]
  /**
   * The LITHO model's contact-correlation edges for this section. Only the
   * approved ones frame the outline partition, exactly as on the litho axis, so
   * the envelopes drawn here are the envelopes the litho axis draws.
   */
  lithoEdges?: readonly LithoContactCorrelationEdge[]
  /**
   * Litho formation id → lithology colour, for the fallback fills. The parent's
   * ``formationColorById`` only knows GEOTECH formation ids on this axis.
   */
  lithoFormationColorById: ReadonlyMap<string, string>
  /** Litho formation id → main soil code (the fallback's soil guard). */
  lithoSoilByFormationId: ReadonlyMap<string, string | null>
  /** Geotech formation id → main soil code (what a packing band covers). */
  geotechSoilByFormationId: ReadonlyMap<string, string | null>
  /**
   * Geotech formation id → canonical class key (``buildPackingClassOf``). The
   * fill compares masses by CLASS, so the duplicate formation rows the model
   * keeps per geological parent read as one mass (owner 2026-08-21: *"one mass
   * one body"*).
   */
  packingClassByFormationId: ReadonlyMap<string, string>
}

/**
 * Props for the partition fill overlay. Self-contained since the retirement
 * of ``MorphFillOverlay`` (2026-06-05) — this overlay is the sole owner of the
 * section litho fill + its pinch / lens shaping.
 */
export interface Props {
  /**
   * Accepted layers carrying ``body_id`` + the unit's depth interval — the rows
   * the partition columns are assembled from.
   *
   * MODEL-RELATIVE since 2026-08-13: the LITHO model's layers on the litho
   * axis, the GEOTECH model's packing bands on the geotech axis (see
   * ``partitionLayerSource``). The prop name is historical.
   */
  lithoLayers: readonly LithoLayerResponse[]
  /**
   * Contact correlation edges (each links two ``litho_layer`` ids). The fill
   * BANDS two units iff an APPROVED edge connects them — the trustworthy
   * correlation signal, vs the resolver's over-lumped ``body_id``. Geometry only
   * fills the uncorrelated remainder. Absent → no explicit bands (all geometry).
   *
   * Moves WITH ``lithoLayers``: the edges reference layer ids, so both name the
   * same model on every axis (``partitionEdgeSource``).
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
   * S103 CORRELATE-ON-DRAG persist (owner 2026-07-24): when a drag on an UN-correlated two-band
   * boundary is released, this creates the REAL, section-scoped correlation the live drag
   * synthesized — tying the two upper-band litho layers (base-base). Reuses the accepted-auto-
   * correlation path (``api.geology.createContactCorrelation``). Called with the two upper-band
   * ``litho_layer`` ids the tie connects; absent = the drag bends live but the tie does not persist
   * (read-only fallback — the fill snaps back to un-correlated on the next model refetch).
   */
  onCorrelateBoundary?: (leftLayerId: string, rightLayerId: string) => void
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
   * The LITHO frame over the geotech axis's own partition (owner ruling
   * 2026-08-13). Present ⇒ the geotech axis: litho envelopes draw as dark
   * outlines on top, unpacked litho regions paint in lithology colour beneath,
   * and every gesture surface is suppressed (view-only). Absent → the plain
   * single-model render. See {@link GeotechLithoFrame}.
   */
  lithoFrame?: GeotechLithoFrame
  /**
   * Current section axis. The REVIEW-FLAG markers (uncorrelated same-litho neighbours the
   * safe-default repair re-emitted) render on the LITHO axis only — hidden on geology / geotech.
   */
  axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /** Dismissed review-flag ids (``reviewFlagId``) from ``project.view_state.review_flags``. */
  dismissedReviewFlags?: ReadonlySet<string>
  /** "Keep separate": dismiss a review flag (persisted in the bundle). Absent = markers read-only. */
  onDismissReviewFlag?: (flagId: string) => void
  /**
   * "Correlate": create the correlation between the flooded unit and its facing same-litho neighbour
   * (→ they band next build). Distinct from ``onCorrelateBoundary`` (a free-draw drag persist gated
   * on FREEDRAW_EDIT_ENABLED) — this action is always available. Absent = the Correlate row is inert.
   */
  onCorrelateReviewFlag?: (flagLayerId: string, facingLayerId: string) => void
  /**
   * Centre the gap holding the next crossing-tie conflict (owner ask
   * 2026-08-23: *"make that clickable so it zooms to the first one, and then
   * when it is resolved it takes the second one"*).
   *
   * Absent leaves the warning chip PASSIVE, exactly as it shipped — only a
   * caller that can actually pan supplies this, so the chip never advertises an
   * affordance it cannot honour.
   *
   * Carries a resolved SCREEN X, not the conflict's ``gapIndex``, deliberately.
   * On the geotech axis the fill's gap axis is the LITHO FRAME's column list
   * (``lithoFramePartition.lithoValid``), which is not the caller's visible-column
   * list — handing the index across that boundary would silently centre the
   * wrong gap whenever the two differ. The overlay owns that axis, so it does
   * the lookup through its own ``gapXs``.
   */
  onJumpToConflictGap?: (screenX: number) => void
  /**
   * Report which ties are currently in a crossing conflict, as order-invariant
   * ``edgeKey``s (owner ruling 2026-08-26: *"mark the crossing ties"*).
   *
   * The fill engine is the only thing that knows two ties cross — it is what suspends
   * them — so the tie overlay is told rather than left to work it out. Fires only when
   * the SET changes, not on every re-partition.
   *
   * Unlike ``onJumpToConflictGap`` this carries keys, not a screen X: the receiver draws
   * the ties themselves and matches on identity, so no axis translation is involved.
   */
  onConflictEdgeKeysChange?: (keys: ReadonlySet<string>) => void
  /**
   * "Unit statistics…" for a fill region BETWEEN columns on the geotech axis
   * (owner ruling R2, 2026-08-27: "it only works if you press on a column,
   * make it so that i can press a unit in the spaces between too").
   *
   * Reports the region's ``formationId`` — a geotech formation row, the same
   * id space the on-column band menu reports. GEOTECH AXIS ONLY: the litho
   * axis has its own handler below. Absent → the regions stay inert on the
   * geotech axis exactly as before.
   */
  onShowGeotechUnitStatistics?: (unitId: string) => void
  /**
   * "Unit statistics…" for a computed fill region on the LITHO axis (owner
   * ruling S7b, 2026-08-27: "in the litho stage i should be able to click
   * the litho fill too").
   *
   * Reports the region's ``formationId`` — a litho formation row; the caller
   * stamps the litho scope kind. Serves ONLY regions the body menu does not
   * claim: a region that resolves to a body in ``bodies`` keeps its body
   * context menu, which carries its own statistics item. LITHO AXIS ONLY —
   * on the geotech axis the litho frame is deliberately inert (S7a: "Litho
   * fill shouldn't be accesible in the geotech stage").
   */
  onShowLithoUnitStatistics?: (unitId: string) => void
}

// Shared with the per-column band stack, so the fill in the gaps and the fill
// over a column card are the SAME number by construction (owner: "same
// transparency everywhere"). See utils/sectionFillOpacity.ts.
const FILL_OPACITY = SECTION_FILL_OPACITY
const LENS_OPACITY = SECTION_LENS_FILL_OPACITY
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
// Minimum GRAB radius in raw px (S76). The visible dot (``lensR``) is allowed to shrink with
// ``handleScale`` so a compressed section is not crowded, but the INVISIBLE hit target must never
// drop below a comfortably grabbable size — otherwise a near-miss click slips past the handle and
// the SVG-root pan handler fires instead ("the pan fights the gesture", owner dogfeed 2026-07-22).
// 9 px keeps the grab target ≥ the ~8 px Fitts-law floor even at ``HANDLE_MIN_SCALE`` (which would
// otherwise floor the hit radius at 11×0.5 = 5.5 px). Safe now that the handles are live (S75) — a
// larger radius no longer risks making a DEAD grab easier to hit.
const LENS_HIT_MIN_PX = 9
// UNIFIED HANDLE (S98): ``LENS_COLOR`` (amber-400) is RETIRED. Every litho-transition
// edge — contact AND lens alike — renders the ONE ``BOUNDARY_COLOR`` teal handle so the
// user can't tell a lens edge from a contact. The rejected-drag frame still reddens via
// ``REJECT_COLOR`` (``handleColorForTarget``).
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

// Shared frozen empty partition — a STABLE reference for the deferred ghost probe's
// base when v1 / < 2 columns (a fresh ``[]`` each render would defeat the hook's
// content-key memoisation). Never mutated.
const EMPTY_REGIONS: readonly SectionRegion[] = Object.freeze([])

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
  onCorrelateBoundary,
  openExtentLengthM,
  bodies,
  onBodyContextMenu,
  correlateMode = false,
  selectedBodyId,
  lithoFrame,
  axisMode,
  dismissedReviewFlags,
  onDismissReviewFlag,
  onCorrelateReviewFlag,
  onJumpToConflictGap,
  onConflictEdgeKeysChange,
  onShowGeotechUnitStatistics,
  onShowLithoUnitStatistics,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  // Which crossing-tie conflict the chip last centred. A REF, not state: the
  // pan happens outside this component, so advancing must not re-render — and
  // declared HERE, beside the other refs at the top of the body, so no hook is
  // added below an early return (the #201 hook-order trap).
  const conflictVisitRef = useRef<number | null>(null)
  // The geotech axis is VIEW-ONLY: no body / lens / boundary gesture is wired
  // there (geotech editing lives in GeotechBandEditOverlay), so every
  // interactive surface below is suppressed. Keyed on the AXIS, not on
  // ``lithoFrame`` — the "Show litho fill" toggle withholds the frame while the
  // axis is still geotech, and a view-only axis must stay view-only either way.
  const viewOnly = axisMode === 'geotechnical'
  // Active partition engine (v2 default / v1 old fallback), device-local dev
  // pref. Read as a hook so a flip in Settings re-renders the overlay live; it
  // feeds the sectionFillData memo's dep array so the partition recomputes.
  const partitionEngineV2 = usePartitionEngineV2()
  // In correlate mode every interactive partition element drops its pointer
  // events so the correlate gesture targets beneath receive the click. Use
  // this in place of the literal ``'auto'`` at every interactive site.
  const interactivePtr: 'auto' | 'none' = correlateMode ? 'none' : 'auto'
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDrag | null>(null)
  const [lensDrag, setLensDrag] = useState<LensDrag | null>(null)
  // R2 / S7b (2026-08-27) — the "Unit statistics…" region menu: geotech
  // regions on the geotech axis, body-less litho regions on the litho axis.
  // Declared beside the other state at the top of the body so no hook lands
  // below an early return (the #201 hook-order trap). Dismissal (wheel/Esc)
  // lives inside ``UnitStatisticsPortalMenu``.
  const [unitStatsMenu, setUnitStatsMenu] = useState<UnitStatsMenuState | null>(null)
  // The handler the ACTIVE axis jumps through — the geotech one on the
  // view-only geotech axis, the litho one otherwise. The caller passes at
  // most one of them, each stamped with its own scope kind.
  const unitStatsHandlerForAxis = viewOnly
    ? onShowGeotechUnitStatistics
    : onShowLithoUnitStatistics
  // S103 correlate-on-drag: the boundary-drag ``mouseup`` (defined ABOVE the ``sectionFillData`` /
  // ``partitionTopology`` memos in the module body) resolves + POSTs the synthetic tie from the gap
  // columns + already-approved edges. A ref carries those (updated after the memos below) so the
  // release reads them without a forward reference / declaration-order TDZ.
  const contactTieContextRef = useRef<{
    orderedColumns: readonly PartitionColumn[]
    approvedEdges: readonly CorrelationEdge[]
  }>({ orderedColumns: [], approvedEdges: [] })
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
      // FREEDRAW DEV TRACE (§105) — the boundary/correlate path was invisible (only the lens
      // path printed [freedraw]). BDRAG mirrors the lens DRAG trace so the owner's next
      // dogfeed of a boundary drag is legible: the body pair, gap, whether the threshold was
      // crossed yet (⇒ whether the correlate-on-drag tie is injected this frame), cursor el.
      // S105 sticky: once the cursor crosses DRAG_THRESHOLD it STAYS a deliberate drag,
      // even if it later returns near the origin (moving out and back is still a drag).
      const crossed = boundaryDrag.crossedThreshold || dragCrossedThreshold(boundaryDrag, { x: clampedX, y: clampedY })
      // HONEST TRACE (§107): ``tieInjected`` prints the ACTUAL synthesis result — whether
      // ``pendingContactTieForDrag`` returned a tie (``!= null``) that IS injected this frame — not
      // the old ``isNew && crossed`` PROXY (which lied when the boundary was already correlated OR
      // not a clean two-full-band boundary, e.g. the S106 onlap-intervening grab that resolves to
      // null). A tie is injected only when the drag is a deliberate ``isNew`` drag AND a tie resolves.
      // S110: an ``onlapIntervening`` drag NEVER injects a banding tie (the §106 hazard) — the trace
      // must report that honestly (tieInjected=false, a bend-without-tie was dispatched).
      const dctx = contactTieContextRef.current
      const dtie =
        boundaryDrag.isNew && crossed && !boundaryDrag.onlapIntervening
          ? pendingContactTieForDrag(
              dctx.orderedColumns,
              boundaryDrag.gapIndex,
              boundaryDrag.upperBodyId,
              boundaryDrag.lowerBodyId,
              dctx.approvedEdges,
            )
          : null
      // ``reclassified`` (§107): the (upper/lower) pair the grab resolved to, or ``null`` when the
      // grab did NOT resolve to a clean two-full-band boundary (S106 onlap-intervening → no tie).
      const dreclass = dtie != null ? `${boundaryDrag.upperBodyId.slice(-6)}/${boundaryDrag.lowerBodyId.slice(-6)}` : 'null'
      // eslint-disable-next-line no-console
      console.info(
        `[freedraw] BDRAG upper=${boundaryDrag.upperBodyId.slice(-6)} lower=${boundaryDrag.lowerBodyId.slice(-6)} ` +
          `gap=${boundaryDrag.gapIndex} node=${boundaryDrag.nodeIndex} isNew=${boundaryDrag.isNew === true} ` +
          `crossedThreshold=${crossed} tieInjected=${dtie != null} reclassified=${dreclass} ` +
          `onlapIntervening=${boundaryDrag.onlapIntervening === true} ` +
          `${boundaryDrag.onlapIntervening ? 'dispatch=bend-WITHOUT-tie ' : ''}` +
          `${screenToLevel ? `el=${screenToLevel(clampedY).toFixed(2)}` : ''}`,
      )
      setBoundaryDrag({
        ...boundaryDrag,
        x: clampedX,
        y: clampedY,
        crossedThreshold: crossed,
      })
    }
    const up = (): void => {
      // S105 CLICK-VS-DRAG GATE on release: an ``isNew`` boundary drag that never moved past
      // DRAG_THRESHOLD is a CLICK, not a drag — do NOT persist the node and do NOT POST the
      // correlation. Otherwise a bare click on a boundary would append a zero-length node +
      // create a tie (the "clay quad out of nowhere"). Below the threshold we bail here,
      // clearing the drag → the fill returns to exactly its pre-click state. An existing-node
      // drag (``isNew`` absent) has no click ambiguity and always follows the persist path.
      const crossedThreshold =
        boundaryDrag.crossedThreshold || dragCrossedThreshold(boundaryDrag, { x: boundaryDrag.x, y: boundaryDrag.y })
      // FREEDRAW DEV TRACE (§105) — the boundary/correlate path was previously INVISIBLE (only
      // the lens path printed [freedraw]); this made the S105 click-reshape bug a mystery.
      // BRELEASE mirrors the lens RELEASE: body pair, gap, whether the threshold was crossed,
      // whether a tie will be created, cursor-el vs stored-el.
      const relElev = screenToLevel ? screenToLevel(boundaryDrag.y) : null
      // HONEST TRACE (§107): ``tieInjected`` is the ACTUAL synthesis result — whether a tie will be
      // created + POSTed on this release (``pendingContactTieForDrag != null``), not the old
      // ``isNew && crossed`` proxy. ``reclassified`` prints the resolved (upper/lower) pair, or null
      // when the grab did not resolve to a clean two-full-band boundary (S106 onlap-intervening).
      // S110: an ``onlapIntervening`` release NEVER creates the banding tie (the §106 hazard) — the
      // trace reports tieInjected=false + the bend-without-tie dispatch.
      const rctx = contactTieContextRef.current
      const rtie =
        boundaryDrag.isNew && crossedThreshold && !boundaryDrag.onlapIntervening
          ? pendingContactTieForDrag(
              rctx.orderedColumns,
              boundaryDrag.gapIndex,
              boundaryDrag.upperBodyId,
              boundaryDrag.lowerBodyId,
              rctx.approvedEdges,
            )
          : null
      const rreclass = rtie != null ? `${boundaryDrag.upperBodyId.slice(-6)}/${boundaryDrag.lowerBodyId.slice(-6)}` : 'null'
      // eslint-disable-next-line no-console
      console.info(
        `[freedraw] BRELEASE upper=${boundaryDrag.upperBodyId.slice(-6)} lower=${boundaryDrag.lowerBodyId.slice(-6)} ` +
          `gap=${boundaryDrag.gapIndex} node=${boundaryDrag.nodeIndex} isNew=${boundaryDrag.isNew === true} ` +
          `crossedThreshold=${crossedThreshold} tieInjected=${rtie != null} reclassified=${rreclass} ` +
          `onlapIntervening=${boundaryDrag.onlapIntervening === true} ` +
          `${boundaryDrag.onlapIntervening ? 'dispatch=bend-WITHOUT-tie ' : ''}` +
          `${relElev !== null ? `el=${relElev.toFixed(2)} ` : ''}` +
          `${boundaryDrag.isNew && !crossedThreshold ? 'action=CLICK (no persist, no correlate)' : 'action=drag persist'}`,
      )
      if (boundaryDrag.isNew && !crossedThreshold) {
        setBoundaryDrag(null)
        return
      }
      // SNAP BACK (owner S80): a boundary drag that ended on a REFUSED reach (this EXACT contact node's
      // live outcome is ``rejected-unsafe`` at release) is discarded — do NOT persist. Clearing
      // ``boundaryDrag`` returns the handle to the last safe contact the base fill already renders. §87:
      // match the EXACT dragged node (upper+lower body, gap, nodeIndex), not just the upper body, so a
      // rejected release of one node cannot suppress the save of another. See the lens ``up``.
      const rejected = sameEditableTarget(rejectedDragTargetRef.current, {
        kind: 'boundary',
        upperBodyId: boundaryDrag.upperBodyId,
        lowerBodyId: boundaryDrag.lowerBodyId,
        gapIndex: boundaryDrag.gapIndex,
        nodeIndex: boundaryDrag.nodeIndex,
      })
      // S111 UN-CONSUMABLE FALLBACK NO-OP (owner standing rule 2026-07-25: a build must NEVER eat a
      // band). If an ``isNew`` grab resolved to NEITHER an onlap-intervening bend NOR a genuine
      // two-full-band contact the engine can consume (e.g. a resolver miss let an onlap-straddling
      // boundary through), persisting a contact node here would flood/absorb the band away (the clay-
      // eating bug). Bail to a pure NO-OP — persist nothing — so a routing miss can never destroy a
      // band. A consumable two-band grab (already tied, or one the synthetic tie will band) and an
      // ``onlapIntervening`` drag (consumable by its own riding-onlap tie) both pass through.
      if (
        boundaryDrag.isNew &&
        !boundaryDrag.onlapIntervening &&
        !boundaryDragIsConsumable(
          contactTieContextRef.current.orderedColumns,
          boundaryDrag.gapIndex,
          boundaryDrag.upperBodyId,
          boundaryDrag.lowerBodyId,
        )
      ) {
        // eslint-disable-next-line no-console
        console.info(
          `[freedraw] BRELEASE upper=${boundaryDrag.upperBodyId.slice(-6)} ` +
            `lower=${boundaryDrag.lowerBodyId.slice(-6)} gap=${boundaryDrag.gapIndex} ` +
            `persist=NO-OP (un-consumable un-tied boundary — no band eaten, S111 safety net)`,
        )
        setBoundaryDrag(null)
        return
      }
      if (
        shouldPersistDrag(rejected ? 'rejected-unsafe' : 'applied') &&
        onSaveBoundary &&
        screenXToAlong &&
        screenToLevel
      ) {
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

        // S86 PRESS-TO-GRAB: a new contact node (created on the add-strip mousedown,
        // ``isNew``) is APPENDED to this gap's in-gap nodes; an existing-handle drag was
        // handled by the overwrite ``.map`` above (its index is < length, so append does
        // not fire). ``nodeIndex`` was set to the in-gap length on press, so this new node
        // is not matched by the overwrite map and must be added explicitly.
        // ``screenXToAlong`` / ``screenToLevel`` are already narrowed truthy by the guard above.
        const finalInGap = boundaryDrag.isNew
          ? [
              ...inGapNodes,
              { along_m: screenXToAlong(boundaryDrag.x), elevation_m: screenToLevel(boundaryDrag.y) },
            ]
          : inGapNodes

        onSaveBoundary(
          boundaryDrag.upperBodyId,
          existing?.upper_nodes ?? [],
          [...otherGapNodes, ...finalInGap],
          'straight',
        )

        // S103 CORRELATE-ON-DRAG persist: if this drag targeted an UN-correlated two-band boundary
        // (``isNew`` grab, no existing tie), CREATE the real, section-scoped correlation the live
        // drag synthesized — matching the current fill (upper band base-base, no flip). The tie is
        // resolved from the SAME helper the live-edge injection used, so the persisted correlation
        // reproduces exactly the wedge→band snap the user just saw. Already-correlated boundaries
        // return null here (nothing to create — just the bend persists). Reuses the accepted-auto-
        // correlation path in the parent (``api.geology.createContactCorrelation``).
        // S110: an ``onlapIntervening`` drag persists the CONTACT BEND (the ``onSaveBoundary`` node
        // above) but NEVER POSTs the A/C banding tie — that tie is the §106 re-absorb hazard the
        // owner walled off. The riding onlap keeps its own onlap tie; the persisted bend re-rides it
        // on the next rebuild (the same ``contact:A|C`` override the live drag used).
        if (boundaryDrag.isNew && !boundaryDrag.onlapIntervening && onCorrelateBoundary) {
          const ctx = contactTieContextRef.current
          const tie = pendingContactTieForDrag(
            ctx.orderedColumns,
            boundaryDrag.gapIndex,
            boundaryDrag.upperBodyId,
            boundaryDrag.lowerBodyId,
            ctx.approvedEdges,
          )
          if (tie) onCorrelateBoundary(tie.leftLayerId, tie.rightLayerId)
        }
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
    // S103 correlate-on-drag persist: the release resolves + POSTs the synthetic tie via
    // ``pendingContactTieForDrag``, reading the gap columns + approved edges from
    // ``contactTieContextRef`` (updated after the memos below) — no forward memo reference.
    onCorrelateBoundary,
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
      // S105 sticky: mark the drag deliberate once it crosses DRAG_THRESHOLD (see the
      // boundary move handler). A press-to-grab lens node persists ONLY after a real drag.
      const crossed = lensDrag.crossedThreshold || dragCrossedThreshold(lensDrag, { x: cx, y: cy })
      setLensDrag({ ...lensDrag, x: cx, y: cy, crossedThreshold: crossed })
    }
    const up = (): void => {
      // S105 CLICK-VS-DRAG GATE on release: an ``isNew`` lens drag (press-to-grab) that never
      // moved past DRAG_THRESHOLD is a CLICK, not a drag — do NOT persist a zero-length apex
      // node. Below the threshold, bail here; clearing ``lensDrag`` returns the fill to its
      // pre-click state (the new node was never injected — see the gated ``buildApexOverrides``
      // call). An existing-node drag (``isNew`` absent) starts ON the node → no click ambiguity.
      const lensCrossedThreshold =
        lensDrag.crossedThreshold || dragCrossedThreshold(lensDrag, { x: lensDrag.x, y: lensDrag.y })
      if (lensDrag.isNew && !lensCrossedThreshold) {
        // eslint-disable-next-line no-console
        console.info(
          `[freedraw] RELEASE body=${lensDrag.bodyId.slice(-6)} gap=${lensDrag.gapIndex} edge=${lensDrag.edge} ` +
            `node=${lensDrag.nodeIndex} isNew=true onSaveBoundary=SKIPPED persist=CLICK (below threshold, no-op)`,
        )
        setLensDrag(null)
        return
      }
      // SNAP BACK (owner S80): if the drag ended on a reach the engine REFUSED (this EXACT node's live
      // outcome is ``rejected-unsafe`` at release), discard the unsafe node — do NOT persist. The base
      // fill already renders the last SAFE shape, so clearing ``lensDrag`` snaps the handle back onto
      // it. A safe release persists as before. §87: match the EXACT dragged node (body, gap, edge,
      // nodeIndex), not just the bodyId, so a rejected release of one edge cannot suppress the save of
      // another node of the same body. Read the CURRENT rejection via the ref (the outcome is recomputed
      // per drag frame; this closure was captured once at drag start).
      const rejected = sameEditableTarget(rejectedDragTargetRef.current, {
        kind: 'lens',
        bodyId: lensDrag.bodyId,
        gapIndex: lensDrag.gapIndex,
        edge: lensDrag.edge,
        nodeIndex: lensDrag.nodeIndex,
      })
      const willPersist = shouldPersistDrag(rejected ? 'rejected-unsafe' : 'applied')
      if (willPersist && onSaveBoundary && screenXToAlong && screenToLevel) {
        const existing = boundariesByBodyId?.get(lensDrag.bodyId)
        const newNode: BodyBoundaryNode = {
          along_m: screenXToAlong(lensDrag.x),
          elevation_m: screenToLevel(lensDrag.y),
        }

        const upperArr = (existing?.upper_nodes ?? []).slice()
        const lowerArr = (existing?.lower_nodes ?? []).slice()

        // S86 PRESS-TO-GRAB: a new node (created on the add-strip mousedown, ``isNew``)
        // is APPENDED to its edge; an existing-handle drag OVERWRITES at its index. The
        // press-to-grab ``nodeIndex`` was set to the edge's stored length, so append and
        // overwrite land at the same slot — but append is explicit so a stale length
        // (mid-drag refetch) can never overwrite a real neighbour.
        const targetArr = lensDrag.edge === 'upper' ? upperArr : lowerArr
        if (lensDrag.isNew) {
          targetArr.push(newNode)
        } else {
          targetArr[lensDrag.nodeIndex] = newNode
        }

        // FREEDRAW DEV TRACE v3 (§91, 2026-07-23) — the RELEASE analogue of the [freedraw]
        // DRAG trace (~797). Prints whether onSaveBoundary fired + the saved node, so the
        // owner's console shows the persist actually happened. The post-rebuild routing
        // (does the persisted node reshape or snap back) is measured by the RED→GREEN
        // ``lensPersistRouting.rules.test.ts`` on real CS1 — the DevTools DRAG trace still
        // shows the live outcome; both traces stay until the owner confirms the reshape
        // sticks. §92 extends it with ``isNew`` so the owner's log confirms the press-to-
        // grab new-node path fired. Kept minimal (no engine re-run here).
        // eslint-disable-next-line no-console
        console.info(
          `[freedraw] RELEASE body=${lensDrag.bodyId.slice(-6)} gap=${lensDrag.gapIndex} edge=${lensDrag.edge} ` +
            `node=${lensDrag.nodeIndex} isNew=${lensDrag.isNew === true} ` +
            `saved=(along ${newNode.along_m.toFixed(1)}, el ${newNode.elevation_m.toFixed(2)}) ` +
            `onSaveBoundary=fired persist=applied`,
        )

        onSaveBoundary(lensDrag.bodyId, upperArr, lowerArr, 'straight')
      } else {
        // S97: report the EXACT rejection kind so the owner's dogfeed confirms an over-reach collapse
        // (``rejected-collapse``) distinctly from an unsafe reach (``rejected-unsafe``). Both snap back.
        const rejectKind = rejected ? (overrideStatusRef.current ?? 'rejected-unsafe') : null
        // eslint-disable-next-line no-console
        console.info(
          `[freedraw] RELEASE body=${lensDrag.bodyId.slice(-6)} gap=${lensDrag.gapIndex} edge=${lensDrag.edge} ` +
            `node=${lensDrag.nodeIndex} isNew=${lensDrag.isNew === true} ` +
            `onSaveBoundary=SKIPPED persist=${rejectKind ? `${rejectKind} (snapback by design)` : 'no-save-wired'}`,
        )
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
  // the screen x-edge derivation from ``placedColumns`` stays overlay-local, and
  // that pairing now lives in ``assemblePlacedPartitionColumns`` because the
  // geotech axis runs it twice (packing model here, litho frame below).
  const { orderedInvs, colByInv, screenByInv } = useMemo(
    () => assemblePlacedPartitionColumns(lithoLayers, placedColumns),
    [lithoLayers, placedColumns],
  )

  // The fill paints THROUGH the column cards (owner 2026-08-14: "same
  // transparency everywhere"): each column's own stack becomes card-wide
  // quads dissolved into the SAME fill layer as the gap regions, so the fill
  // cannot change tone at a card edge. On the geotech axis a column the
  // subdivision has not reached falls back to its litho stack (coloured with
  // the litho map below), mirroring the gap fill's litho-fallback rule.
  const columnStrips = useMemo(() => {
    if (!showBands) return []
    const fallbackAssembly = lithoFrame
      ? assemblePlacedPartitionColumns(lithoFrame.lithoLayers, placedColumns)
      : null
    return buildColumnStripFills(
      { orderedInvs, colByInv, screenByInv },
      fallbackAssembly,
      levelToScreen,
      plotTop,
      plotBottom,
    )
    // reason: orderedInvs/colByInv/screenByInv are products of the memo above
    // and change identity together with lithoLayers/placedColumns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBands, lithoFrame, placedColumns, orderedInvs, colByInv, screenByInv, levelToScreen, plotTop, plotBottom])

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
  // The HIT radius floors at ``LENS_HIT_MIN_PX`` (S76) so a near-miss click never slips past the
  // handle into the pan handler, even on a compressed section where ``handleScale`` is at its min.
  const lensHitR = Math.max(LENS_HIT_MIN_PX, LENS_HIT_R * handleScale)

  // ---- PARTITION TOPOLOGY: the drag-independent partition inputs. ----------
  //
  // The ordered columns, approved edges, and true along-metres a partition is
  // built from. These change ONLY on a model / section change — NOT on a live
  // drag (``lensDrag`` is deliberately absent). Both the ``sectionFillData`` memo
  // (which layers the drag overrides on top) and the ghost-handle probe (§83,
  // which must NOT re-run per drag frame) consume this so the topology is derived
  // once, referentially stable across drags. Empty when bands are off / < 2 cols.
  const partitionTopology = useMemo((): {
    orderedColumns: PartitionColumn[]
    edges: CorrelationEdge[]
    alongM: number[]
  } => {
    if (!showBands) return { orderedColumns: [], edges: [], alongM: [] }
    const valid = orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    const orderedColumns = valid.map((id) => colByInv.get(id) as PartitionColumn)
    if (orderedColumns.length < 2) return { orderedColumns, edges: [], alongM: [] }
    const edges: CorrelationEdge[] = (contactEdges ?? [])
      .filter((e) => e.user_approved)
      .map((e) => ({ a: e.layer_a_id, b: e.layer_b_id, aSide: e.layer_a_side, bSide: e.layer_b_side }))
    const alongM = valid.map((id) => (screenByInv.get(id) as ColumnScreen).along)
    return { orderedColumns, edges, alongM }
  }, [orderedInvs, colByInv, screenByInv, contactEdges, showBands])

  // S103 correlate-on-drag: keep the boundary-drag release's tie context fresh. The ``mouseup``
  // closure (declared ABOVE this memo) reads the gap columns + already-approved edges from this
  // ref to resolve + POST the synthetic tie without a forward memo reference (declaration-order
  // TDZ). Updated per partition-topology change; the release reads the current value. (S2 window:
  // if a model refetch resolves mid-drag, the ref may lag one frame at release; the resulting
  // re-POST is harmless — ``createContactCorrelation`` is idempotent on a duplicate edge.)
  useEffect(() => {
    contactTieContextRef.current = {
      orderedColumns: partitionTopology.orderedColumns,
      approvedEdges: partitionTopology.edges,
    }
  }, [partitionTopology])

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
  //
  // Last engine result, keyed on the four arguments that fully determine it. Declared
  // HERE, above the memo that reads it: a ref declared after the useMemo would be in the
  // temporal dead zone when the memo callback runs, which tsc does not catch and which
  // crashes only on first render.
  const engineResultRef = useRef<{
    key: string
    // The hierarchical arm adds ``lithoFallback`` (the un-classed litho cover);
    // the litho arm has no such field, hence the optional.
    value: ReturnType<typeof computeSectionFillActiveWithDiagnostics> & {
      lithoFallback?: SectionRegion[]
    }
  } | null>(null)
  // The LITHO frame partition, computed ABOVE the fill memo so the clip can
  // consume it (owner ruling 2026-08-14: "keep exactly the litho model and
  // only subdivide bodies"). A column may carry litho layers and no packing
  // bands (an undivided borehole), so its column order, gap indices and
  // screen gap extents are derived from the litho rows. Ref-cached on the
  // same content key ``sectionFillData`` uses, so a pan/zoom reprojects
  // without re-partitioning.
  const lithoFrameEngineRef = useRef<{ key: string; value: SectionRegion[] } | null>(null)
  const lithoFramePartition = useMemo(() => {
    const empty = {
      lithoRegions: [] as SectionRegion[],
      lithoValid: [] as string[],
      lithoColumns: [] as PartitionColumn[],
      lithoAlongM: [] as number[],
      lithoEdges: [] as CorrelationEdge[],
      lithoScreenByInv: new Map<string, ColumnScreen>(),
    }
    if (!lithoFrame || !showBands) return empty
    const litho = assemblePlacedPartitionColumns(lithoFrame.lithoLayers, placedColumns)
    const lithoValid = litho.orderedInvs.filter(
      (id) => litho.colByInv.get(id) && litho.screenByInv.get(id),
    )
    const lithoColumns = lithoValid.map((id) => litho.colByInv.get(id) as PartitionColumn)
    if (lithoColumns.length < 2) return empty
    const lithoAlongM = lithoValid.map(
      (id) => (litho.screenByInv.get(id) as ColumnScreen).along,
    )
    // Approved edges only — identical filter to the primary partition, so the
    // envelopes drawn from this frame are the ones the litho axis draws.
    const lithoEdges: CorrelationEdge[] = (lithoFrame.lithoEdges ?? [])
      .filter((e) => e.user_approved)
      .map((e) => ({
        a: e.layer_a_id,
        b: e.layer_b_id,
        aSide: e.layer_a_side,
        bSide: e.layer_b_side,
      }))
    // No apex overrides: the stored body boundaries are keyed by LITHO body id
    // and the frame is view-only, so a hand-drawn shape would bend an outline
    // the engineer cannot grab. Matches the build arm, which derives its
    // overrides from the boundaries of the model it is building.
    const engineKey = topologyKey(lithoColumns, lithoEdges, lithoAlongM, partitionEngineV2)
    const cached = lithoFrameEngineRef.current
    const lithoRegions =
      cached && cached.key === engineKey
        ? cached.value
        : computeSectionFillActive(lithoColumns, lithoEdges, undefined, lithoAlongM)
    lithoFrameEngineRef.current = { key: engineKey, value: lithoRegions }
    return {
      lithoRegions,
      lithoValid,
      lithoColumns,
      lithoAlongM,
      // Re-exposed for the hierarchical fill: the families it groups the frame
      // into are the chains these edges make, so it must read the SAME list the
      // frame partition ran on rather than re-deriving it.
      lithoEdges,
      lithoScreenByInv: litho.screenByInv,
    }
  }, [lithoFrame, showBands, placedColumns, partitionEngineV2])

  const sectionFillData = useMemo((): {
    sectionRegions: SectionRegion[]
    orderedColumns: PartitionColumn[]
    // Screen edges 1:1 with ``orderedColumns``. Exposed (rather than re-derived
    // by each consumer) because the geotech axis builds the partition on the
    // LITHO FRAME's column set, so a consumer re-deriving from ``orderedInvs``
    // would index a DIFFERENT list than the one the regions belong to.
    columnScreens: ColumnScreen[]
    gapXs: Array<{ leftX: number; rightX: number }>
    // True along-section metres 1:1 with orderedColumns — the SAME array the
    // engine ran on, re-exposed so downstream passes measure in the
    // partition's own spacing.
    alongM: number[]
    // Keyed lens apex overrides so the screen memo can skip the legacy path.
    apexOverrides: Map<string, LensApexOverride>
    // ``gapIndex:upperBodyId`` set whose shared contact the engine re-partitioned
    // (S68) — the POST-BEND off-engine reshape is skipped for these.
    contactOverriddenBodies: Set<string>
    // ``gapIndex:bodyId`` set whose tip override the engine did NOT consume
    // (flooded to a band) — the un-routable class (§77); grab handle suppressed.
    unroutableBodies: Set<string>
    // Bodies whose member layers are TOP-side endpoints of an approved edge —
    // their band-top seam is TIE-OWNED. The v1 post-bend must never bend a
    // tie-owned seam from a stored node (owner demo defect 2026-08-05: a stale
    // July-27 node painted a KLEI wedge ABOVE an accepted tie; v2 refuses via
    // §77, v1 bent it off-engine).
    tieOwnedTopBodies: Set<string>
    // Same for BASE-side endpoints (bottom-ties): the band-base seam is owned.
    tieOwnedBaseBodies: Set<string>
    // v2 crossing-tie conflicts (owner §8 Q4) — drives the amber warning chip.
    conflicts: TieConflict[]
    // Uncorrelated same-litho neighbours the safe-default repair re-emitted (owner 2026-07-26) —
    // drives the amber review-flag markers. v1 always reports none.
    reviewFlags: ReviewFlag[]
    // The EXACT editable target currently being dragged whose live override outcome this frame is
    // ``rejected-unsafe`` (the engine refused the reach → rendered the un-reshaped base fill).
    // ``null`` when the drag is safe / absent. Drives the RED handle + the snap-back-on-release
    // (owner S80 "red handle and snapback"). §87 BUG #1: this is the EXACT node identity (lens edge +
    // nodeIndex, or the boundary contact), NOT a bodyId — so only the dragged handle reddens, never
    // every sibling handle of the same body. Read from the SAME engine pass — no extra run.
    rejectedDragTarget: EditableTargetIdentity | null
    // The raw override outcome status this frame (``applied`` | ``rejected-unsafe`` |
    // ``rejected-collapse`` | ``unsupported``). Mirrored into a ref so the RELEASE trace reports the
    // EXACT rejection kind on snapback (S97 — the owner's dogfeed distinguishes an unsafe reach from
    // an over-reach collapse). ``null`` when bands are hidden / the section is degenerate.
    overrideStatus: OverrideStatus | null
    // Litho-frame clip fallback faces (owner ruling 2026-08-14) — the litho
    // regions whose soil has no packing class anywhere in them, rendered
    // litho-coloured. ``null`` = the clip did not run (no frame, or the
    // geotech and litho column sets differ — an undivided borehole mid-
    // pipeline) and the whole-region fallback heuristic applies instead.
    lithoFallbackRegions: SectionRegion[] | null
  } => {
    if (!showBands)
      return {
        sectionRegions: [],
        orderedColumns: [],
        columnScreens: [],
        gapXs: [],
        alongM: [],
        apexOverrides: new Map(),
        contactOverriddenBodies: new Set(),
        unroutableBodies: new Set(),
        tieOwnedTopBodies: new Set(),
        tieOwnedBaseBodies: new Set(),
        conflicts: [],
        reviewFlags: [],
        rejectedDragTarget: null,
        overrideStatus: null,
        lithoFallbackRegions: null,
      }

    // ---- THE COLUMN AXIS (owner dogfeed 2026-08-15). ------------------------
    //
    // On the geotech axis the partition is assembled over the LITHO FRAME's
    // column set, not its own: an undivided borehole carries litho layers and
    // no packing bands, and the shared assembly drops a bandless column — so
    // the packing engine used to see one wide test-to-test gap straight over
    // the borehole ("what are those weird polygons between the boreholes?")
    // and the two gap axes stopped lining up, which skipped the litho-frame
    // clip and left the un-banded areas unmarked. Taking the frame's axis
    // makes the clip apply ALWAYS and confines every packing region to a gap
    // the packing model actually classified. Off the geotech axis
    // (``lithoFrame`` absent) this is exactly the previous derivation.
    const framed = lithoFrame != null && lithoFramePartition.lithoColumns.length >= 2
    const valid = framed
      ? lithoFramePartition.lithoValid
      : orderedInvs.filter((id) => colByInv.get(id) && screenByInv.get(id))
    const screenOf = framed ? lithoFramePartition.lithoScreenByInv : screenByInv
    const orderedColumns = framed
      ? frameAlignedColumns(lithoFramePartition.lithoColumns, colByInv)
      : valid.map((id) => colByInv.get(id) as PartitionColumn)
    if (orderedColumns.length < 2)
      return {
        sectionRegions: [],
        orderedColumns,
        columnScreens: [],
        gapXs: [],
        alongM: [],
        apexOverrides: new Map(),
        contactOverriddenBodies: new Set(),
        unroutableBodies: new Set(),
        tieOwnedTopBodies: new Set(),
        tieOwnedBaseBodies: new Set(),
        conflicts: [],
        reviewFlags: [],
        rejectedDragTarget: null,
        overrideStatus: null,
        lithoFallbackRegions: null,
      }

    // Pre-compute gap x-extents from screenByInv so both memos share the same
    // values without re-reading the map independently.
    const gapXs = Array.from({ length: orderedColumns.length - 1 }, (_, i) => ({
      leftX: (screenOf.get(valid[i]) as ColumnScreen).rightX,
      rightX: (screenOf.get(valid[i + 1]) as ColumnScreen).leftX,
    }))
    // Screen edges 1:1 with ``orderedColumns`` — the under-column substrate
    // indexes its output by column, and deriving that list a second time is how
    // it would drift from the axis the partition was actually built on.
    const columnScreens = valid.map((id) => screenOf.get(id) as ColumnScreen)

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

    // S103 CORRELATE-ON-DRAG (owner 2026-07-24, "ANY BOUNDARY BENDS TO THE CURSOR"): a LIVE drag
    // on an UN-correlated two-full-band boundary CREATES the tie that makes it bendable, matching
    // the current fill lithos (no flip). An un-tied contact override is ENGINE-INERT (S100/S101);
    // the proven fix is to synthesize the tie (upper band base-base — S101 "base-base → PERFECT
    // clean bend") and inject it here so the boundary bands+bends on the SAME press-drag. The wedge
    // SNAPS to a flat band (owner-accepted). Gated on an ACTIVE ``isNew`` boundary drag, so no drag
    // ⇒ no injection ⇒ the static fill (SHAPE_AUDIT / HOLES / cs1 gates) is byte-identical BY
    // CONSTRUCTION. On release the overlay POSTs the real correlation via ``onCorrelateBoundary``.
    // S105 CLICK-VS-DRAG GATE (owner 2026-07-24, "i click on the marker and this weird clay
    // quad appears out of nowhere"): the correlate-on-drag (synthetic-tie injection) fires
    // ONLY once the cursor has moved past DRAG_THRESHOLD from the mousedown origin. A pure
    // click (press-release with no travel) injects NOTHING, so a pinched-out clay is never
    // snapped to a band by an accidental click — the fill stays byte-identical to the un-tied
    // pinch. A real drag crosses the tiny threshold almost instantly (press-to-grab feel kept).
    // S110 ONLAP-INTERVENING drag: NEVER synthesize the A/C banding tie (``onlapIntervening``). The
    // §106 absorb came from that tie; §109 proved the ``contact:A|C`` bend alone (built below by
    // ``collectContactOverridesForGap``) makes the onlap ride WITHOUT it — the onlap keeps its own
    // tie, so bending the shared contact never absorbs it. The plain two-band drag (no flag) KEEPS
    // its correlate-then-bend tie injection.
    if (
      boundaryDrag?.isNew &&
      !boundaryDrag.onlapIntervening &&
      (boundaryDrag.crossedThreshold || dragCrossedThreshold(boundaryDrag, { x: boundaryDrag.x, y: boundaryDrag.y }))
    ) {
      const tie = pendingContactTieForDrag(
        orderedColumns,
        boundaryDrag.gapIndex,
        boundaryDrag.upperBodyId,
        boundaryDrag.lowerBodyId,
        edges,
      )
      if (tie) edges.push(tie.edge)
    }

    // True along-section position (metres) per column, 1:1 with orderedColumns
    // (both derive from `valid` in the same order). Passing it lets the deep-to-deep
    // substrate pass slice each gap's deep band at the real column spacing instead of
    // the uniform fallback. In along-METRES (the slice math is metre-based); the
    // screen projection downstream is unchanged, so no raw-vs-warped mismatch.
    const alongM = valid.map((id) => (screenOf.get(id) as ColumnScreen).along)

    // ---- §91 PERSISTED-LENS ROUTING (fixes "safe lens drag reshapes live then snaps
    // back on release"). A two-sided body's persisted node is stored on the same
    // ``lower_nodes`` array whether it shapes a lens tip OR a shared contact, so its
    // KIND is lost. On the memo rebuild after a lens mouseup (``lensDrag = null``) the
    // node would route through the un-routable contact path → flood → snapback. Recover
    // the KIND from ENGINE TRUTH: a no-override base pass tells which two-sided bodies
    // own an apex-shapeable lens tip whose span contains the stored node. Those route
    // through the LENS path so the persisted shape matches the live drag. Skipped when
    // there is no stored boundary (the common no-override render — no extra work). ----
    // The runs the engine can actually partition: maximal stretches of
    // CONSECUTIVE banded columns on the frame axis. Off the geotech axis (and
    // on it once every borehole is divided) this is ONE run covering every
    // column at offset 0, and every call below is literally today's call.
    const runs = frameGapRuns(orderedColumns, alongM)
    const singleFullRun = runs.length === 1 && runs[0].columns.length === orderedColumns.length
    /** Frame-axis regions from a no-override pass — the ghost/persisted probes' base. */
    const baseRegionsOnFrameAxis = (): SectionRegion[] =>
      singleFullRun
        ? computeSectionFillActive(orderedColumns, edges, undefined, alongM)
        : runs.flatMap((run) =>
            shiftRegionGaps(
              computeSectionFillActive(run.columns, edges, undefined, run.alongM),
              run.offset,
            ),
          )
    const persistedLensBodies =
      boundariesByBodyId && boundariesByBodyId.size > 0
        ? detectPersistedLensBodies(
            baseRegionsOnFrameAxis(),
            orderedColumns,
            boundariesByBodyId,
            alongToScreenX,
            gapXs,
          )
        : undefined

    // Lens + two-band contact overrides, keyed PER (body, gap). The whole
    // override-building path — the ``setShape`` gate + the two XOR loops + the §88
    // two-sided-lens-tip fix + the §91 persisted-lens routing + the contact
    // disentangle — lives in the pure, unit-testable ``buildApexOverridesForGaps``
    // (see apexOverrideWiring.ts). It was extracted from this memo (S88) because the
    // reshape tests fed overrides DIRECTLY to the engine, bypassing this gate — which
    // is why the "manual reshape does nothing" bug (a two-sided band's lens tip
    // skipped by the XOR gate → override NONE) hid behind green tests. Now the gate is
    // testable in isolation.
    // S105 CLICK-VS-DRAG GATE for the ``isNew`` press-to-grab injection: a NEW lens/apex
    // node (``isNew``) is INJECTED live by ``buildApexOverridesForGaps`` (the ``injectNew`` /
    // ``isNewHere`` paths). A pure click must NOT spawn a zero-length node, so below the
    // threshold we strip ``isNew`` — the injection paths self-filter (no stored node + not
    // isNew → no override), leaving the fill unchanged. Past the threshold the drag passes
    // through verbatim (press-to-grab intact). An EXISTING-node drag (``isNew`` absent) is
    // untouched: moving a stored node has no click-vs-drag ambiguity (it starts on the node).
    const lensDragged =
      !!lensDrag && (lensDrag.crossedThreshold || dragCrossedThreshold(lensDrag, { x: lensDrag.x, y: lensDrag.y }))
    const boundaryDragged =
      !!boundaryDrag &&
      (boundaryDrag.crossedThreshold || dragCrossedThreshold(boundaryDrag, { x: boundaryDrag.x, y: boundaryDrag.y }))
    const gatedLensDrag = lensDrag && lensDrag.isNew && !lensDragged ? { ...lensDrag, isNew: false } : lensDrag
    const gatedBoundaryDrag =
      boundaryDrag && boundaryDrag.isNew && !boundaryDragged ? { ...boundaryDrag, isNew: false } : boundaryDrag
    const { apexOverrides, contactOverriddenBodies } = buildApexOverridesForGaps({
      orderedColumns,
      gapXs,
      boundariesByBodyId,
      alongToScreenX,
      screenToLevel,
      lensDrag: gatedLensDrag,
      boundaryDrag: gatedBoundaryDrag,
      partitionEngineV2,
      persistedLensBodies,
    })

    // WHOLE-SECTION resolve: reduce each column ONCE against BOTH its neighbours
    // (not per gap, which drifts and breaks a body's continuity through a shared
    // column — the dogfeed peat-discontinuity bug). Regions carry ``gapIndex``.
    // The partition is built from ONE model per axis (owner ruling 2026-08-13):
    // the litho model's columns + edges on the litho axis, the geotech model's
    // on the geotech axis. The litho envelopes the geotech axis also draws are a
    // SECOND, independent partition (see the ``lithoFrame`` prop + its memo).
    // The engine call's arguments are EXACTLY (orderedColumns, edges, apexOverrides,
    // alongM), so a key over those four is a complete description of its output. This
    // memo's deps include the viewport transforms — they are needed to build
    // ``apexOverrides``, whose conversion goes through screen pixels — so a pan or zoom
    // re-runs the memo on every frame in both axes. The cheap half must re-run; the
    // engine must not. Keying the call itself means no assumption about whether the
    // pixel round-trip is viewport-invariant: if the overrides come out identical the
    // engine is skipped, and if they genuinely changed it runs.
    // Tie-owned seams: any layer named as a TOP-side endpoint of an approved
    // edge owns its band-top seam; BASE-side endpoints own the band-base. The
    // v1 post-bend consults these so a stored node can never repaint across an
    // accepted tie (owner demo defect 2026-08-05).
    const bodyByLayerId = new Map<string, string>()
    for (const col of orderedColumns)
      for (const u of col.units) if (u.bodyId) bodyByLayerId.set(u.layerId, u.bodyId)
    const tieOwnedTopBodies = new Set<string>()
    const tieOwnedBaseBodies = new Set<string>()
    for (const e of edges) {
      const aBody = bodyByLayerId.get(e.a)
      const bBody = bodyByLayerId.get(e.b)
      if ((e.aSide ?? 'top') === 'top' && aBody) tieOwnedTopBodies.add(aBody)
      else if (aBody) tieOwnedBaseBodies.add(aBody)
      if ((e.bSide ?? 'top') === 'top' && bBody) tieOwnedTopBodies.add(bBody)
      else if (bBody) tieOwnedBaseBodies.add(bBody)
    }

    // The hierarchical arm's answer also depends on the LITHO frame (its
    // families and its cover), so the frame's own topology joins the key —
    // without it, editing a litho contact would leave the geotech axis showing
    // the fill of the previous frame.
    const engineKey = `${topologyKey(orderedColumns, edges, alongM, partitionEngineV2)}|${[
      ...apexOverrides.entries(),
    ]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v.fraction.toFixed(9)},${v.elevation.toFixed(6)}`)
      .join(';')}|${
      lithoFramePartition.lithoColumns.length >= 2
        ? topologyKey(
            lithoFramePartition.lithoColumns,
            lithoFramePartition.lithoEdges,
            lithoFramePartition.lithoAlongM,
            partitionEngineV2,
          )
        : ''
    }`
    const cachedEngine = engineResultRef.current
    /**
     * Partition each run and put its output back on the FRAME's gap axis. A
     * gap that touches a column the model never classified belongs to no run,
     * so it receives nothing — which is the truth the clip then renders as
     * bare ground.
     */
    const partitionRuns = (): ReturnType<typeof computeSectionFillActiveWithDiagnostics> => {
      if (singleFullRun) {
        return computeSectionFillActiveWithDiagnostics(orderedColumns, edges, apexOverrides, alongM)
      }
      const regions: SectionRegion[] = []
      const runConflicts: TieConflict[] = []
      const runReviewFlags: ReviewFlag[] = []
      let status: OverrideStatus = 'unsupported'
      for (const run of runs) {
        const out = computeSectionFillActiveWithDiagnostics(
          run.columns,
          edges,
          rebaseApexOverrides(apexOverrides, run),
          run.alongM,
        )
        regions.push(...shiftRegionGaps(out.regions, run.offset))
        runConflicts.push(...shiftGapIndexed(out.conflicts, run.offset))
        runReviewFlags.push(...shiftGapIndexed(out.reviewFlags, run.offset))
        // A refusal anywhere is a refusal: the drag lives in exactly one run,
        // so the first non-``unsupported`` status IS that run's verdict.
        if (status === 'unsupported') status = out.overrideStatus
      }
      return { regions, conflicts: runConflicts, reviewFlags: runReviewFlags, overrideStatus: status }
    }
    // THE HIERARCHICAL FILL — densities WITHIN lithos (owner ruling 2026-08-18:
    // "it's the same basic rules only with densities on top of lithos"). On the
    // geotech axis the partition is NOT one whole-section run that a post-hoc
    // pass then repairs: the litho frame is split into families (one litho body
    // as it appears here), the SAME engine runs once per family over that
    // family's bands and ties alone, and each run is clipped to its own family's
    // litho regions. A packing class can then never paint outside the litho soil
    // it subdivides, and a vacancy can never read a foreign soil — by
    // construction, not by repair. Off the geotech axis (no ``lithoFrame``) this
    // is untouched: the litho axis keeps its own whole-section run.
    const { lithoRegions } = lithoFramePartition
    const hierarchical = framed && lithoRegions.length > 0
    const engineResult =
      cachedEngine && cachedEngine.key === engineKey
        ? cachedEngine.value
        : hierarchical
          ? ((): ReturnType<typeof computeSectionFillActiveWithDiagnostics> & {
              lithoFallback: SectionRegion[]
            } => {
              const out = computeHierarchicalGeotechFill({
                lithoColumns: lithoFramePartition.lithoColumns,
                lithoEdges: lithoFramePartition.lithoEdges,
                lithoRegions,
                geotechColumns: orderedColumns,
                geotechEdges: edges,
                alongM,
                // Mass identity by CLASS: the duplicate formation rows the
                // model keeps per geological parent are one mass (owner
                // 2026-08-21). Invalidation rides the topology key — a class
                // change re-points the layer to another formation row, which
                // changes the columns.
                packingClassOf: lithoFrame?.packingClassByFormationId,
              })
              // Live-fill probe (owner ask 2026-08-21): stash the EXACT inputs
              // and outputs of this compute so `__GEOFILL_SAVE()` in DevTools
              // downloads them for an offline diff against the dump-script
              // render — the diagnostic for "the canvas disagrees with the
              // engine on identical inputs". Dev builds only; keyed per
              // section so several open panels do not clobber each other.
              if (!import.meta.env.PROD) {
                const w = window as unknown as Record<string, unknown>
                const all = (w.__GEOFILL_ALL ?? (w.__GEOFILL_ALL = {})) as Record<string, unknown>
                const key = `${orderedColumns[0]?.investigationId ?? '?'}|${orderedColumns.length}cols`
                all[key] = {
                  at: Date.now(),
                  inputs: {
                    lithoColumns: lithoFramePartition.lithoColumns,
                    lithoEdges: lithoFramePartition.lithoEdges,
                    lithoRegions,
                    geotechColumns: orderedColumns,
                    geotechEdges: edges,
                    alongM,
                    // A Map JSON-serialises to {}, so dump it as entries.
                    packingClassOf: [...(lithoFrame?.packingClassByFormationId ?? [])],
                  },
                  regions: out.regions,
                  diagnostics: out.diagnostics,
                }
                w.__GEOFILL_SAVE = (): string[] => {
                  const blob = new Blob([JSON.stringify(w.__GEOFILL_ALL)], {
                    type: 'application/json',
                  })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = 'geofill_live_dump.json'
                  a.click()
                  URL.revokeObjectURL(a.href)
                  return Object.keys((w.__GEOFILL_ALL ?? {}) as Record<string, unknown>)
                }
              }
              log.info(
                'partition',
                `hierarchical geotech fill: ${out.diagnostics.families} litho families, ` +
                  `${out.diagnostics.bands} bands → ${out.regions.length} classed faces, ` +
                  `${out.lithoFallback.length} un-classed; ` +
                  `${out.diagnostics.tiesCrossingFamilies} cross-family tie(s) (kept — counted at their in-family contacts), ` +
                  `${out.diagnostics.bandsStraddling} band(s) straddling a litho contact`,
              )
              return {
                regions: out.regions,
                conflicts: out.conflicts,
                // Review flags mark uncorrelated same-litho LITHO neighbours; the
                // markers render on the litho axis only, so a per-family packing
                // run has none to report.
                reviewFlags: [],
                // Free-draw editing is off on this axis, so no drag can be
                // refused — the override machinery is not consulted at all.
                overrideStatus: 'unsupported' as const,
                lithoFallback: out.lithoFallback,
              }
            })()
          : partitionRuns()
    engineResultRef.current = { key: engineKey, value: engineResult }
    const {
      regions: engineRegions,
      conflicts,
      reviewFlags,
      overrideStatus,
    } = engineResult

    const sectionRegions = engineRegions
    const lithoFallbackRegions: SectionRegion[] | null =
      'lithoFallback' in engineResult ? (engineResult.lithoFallback as SectionRegion[]) : null

    // Mirror of the line ``buildVoxelRequest`` logs per payload section, so the
    // RENDERED partition and the BUILT one can be compared field for field in one
    // console. Added 2026-07-30: a clay banded on screen was absent from the built
    // model, and the two paths are documented to assemble identical columns through
    // the same util — so whichever field differs here is the whole answer.
    log.info(
      'partition',
      `rendered section: ${orderedColumns.length} cols, ${sectionRegions.length} regions ` +
        `(${countSpanningRegions(sectionRegions)} span their gap), ${edges.length} edges, ` +
        `overrides=${apexOverrides.size}`,
    )

    // ---- UNSAFE-DRAG outcome (owner S80 "red handle and snapback"). ----------
    // The engine keeps "never a gap or overlap" by rendering the un-reshaped base fill on a
    // rejected frame (S79); ``overrideStatus === 'rejected-unsafe'`` is the explicit signal that the
    // in-progress drag reached a refused position. §87 BUG #1: tie it to the EXACT node being dragged
    // (lens edge + nodeIndex, or the boundary contact), NOT the bodyId — a rendered body carries many
    // handles (its two lens edges, several stacked tips across gaps, its shared-boundary contact when
    // it is a full-width band; measured 9 sibling handles on real CS1), and a body-level match reddens
    // ALL of them at once. The exact identity reddens only the dragged handle and snaps back only it.
    // Read from the SAME engine pass above (no extra run).
    const draggedTarget: EditableTargetIdentity | null = lensDrag
      ? { kind: 'lens', bodyId: lensDrag.bodyId, gapIndex: lensDrag.gapIndex, edge: lensDrag.edge, nodeIndex: lensDrag.nodeIndex }
      : boundaryDrag
        ? {
            kind: 'boundary',
            upperBodyId: boundaryDrag.upperBodyId,
            lowerBodyId: boundaryDrag.lowerBodyId,
            gapIndex: boundaryDrag.gapIndex,
            nodeIndex: boundaryDrag.nodeIndex,
          }
        : null
    // Both ``rejected-unsafe`` (would gap/overlap) and ``rejected-collapse`` (over-reach + full-width
    // flood, owner-locked 2026-07-23) drive the red handle + snap-back; ``isDragRejected`` covers both.
    const rejectedDragTarget = draggedTarget != null && isDragRejected(overrideStatus) ? draggedTarget : null
    // FREEDRAW DEV TRACE v2 (2026-07-23, re-added after S83 — kept until the owner confirms reshape).
    if (draggedTarget != null && lensDrag) {
      const ov = apexOverrides.get(lensApexOverrideKey(lensDrag.bodyId, lensDrag.gapIndex))
      const dRegions = sectionRegions.filter((r) => r.bodyId === lensDrag.bodyId && r.gapIndex === lensDrag.gapIndex)
      const shape = dRegions
        .map((r) => `${r.kind}[${r.polygon.map((p) => `${p.fraction.toFixed(2)},${p.elevation.toFixed(2)}`).join(' ')}]`)
        .join(' / ')
      // eslint-disable-next-line no-console
      console.info(
        `[freedraw] DRAG body=${lensDrag.bodyId.slice(-6)} gap=${lensDrag.gapIndex} edge=${lensDrag.edge} node=${lensDrag.nodeIndex} ` +
          `override=${ov ? `frac${ov.fraction?.toFixed(3)}${ov.rawApexFraction !== undefined ? ` raw${ov.rawApexFraction.toFixed(3)}${ov.rawApexFraction < 0 || ov.rawApexFraction > 1 ? '(over-reach)' : ''}` : ''} el${ov.elevation?.toFixed(2)}` : 'NONE (setShape skipped)'} ` +
          `outcome=${overrideStatus} regions=${dRegions.length} shape=${shape || 'NONE'}`,
      )
    }
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
      columnScreens,
      gapXs,
      alongM,
      apexOverrides,
      contactOverriddenBodies,
      unroutableBodies,
      tieOwnedTopBodies,
      tieOwnedBaseBodies,
      conflicts,
      reviewFlags,
      rejectedDragTarget,
      overrideStatus,
      lithoFallbackRegions,
    }
  }, [
    lithoFramePartition,
    lithoFrame,
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

  // Publish the conflicting ties' keys so the tie overlay drawn beside this one can MARK
  // them (owner ruling 2026-08-26). They leave from the same list the chip counts, so the
  // mark and the count cannot name different ties.
  //
  // Guarded on a CONTENT signature rather than array identity: the fill memo returns a
  // fresh array on every recompute, and handing the parent a new Set each time would
  // re-render the whole panel — and the tie overlay with it — for a conflict set that
  // never changed.
  const conflictKeysSigRef = useRef<string | null>(null)
  useEffect(() => {
    if (onConflictEdgeKeysChange === undefined) return
    const keys = Array.from(new Set(conflicts.flatMap(c => c.edgeKeys))).sort()
    const signature = keys.join('|')
    if (signature === conflictKeysSigRef.current) return
    conflictKeysSigRef.current = signature
    onConflictEdgeKeysChange(new Set(keys))
  }, [conflicts, onConflictEdgeKeysChange])

  // REVIEW-FLAG markers (owner 2026-07-26; design §10). The safe-default repair re-emits the onlap
  // for an uncorrelated same-litho neighbour that would otherwise render a foreign litho; each such
  // drilled unit gets an amber marker inviting an OPTIONAL correlation. LITHO axis only. Positioned
  // at the unit's gap-facing column edge, at its mid-elevation; the facing same-formation unit is the
  // correlate target. Dismissed flags are filtered out. Elevation → screen-y (``levelToScreen``) is
  // intentionally a dep here (unlike the fill memo) since these markers are pure projection.
  const reviewFlagMarkers = useMemo((): ReviewFlagMarker[] => {
    if (axisMode !== undefined && axisMode !== 'lithostratigraphic') return []
    const { orderedColumns } = sectionFillData
    // Defensive: a partial test mock of the selector may omit reviewFlags (the real engine always
    // returns it). Default to [] so a mock never crashes the overlay.
    const reviewFlags = sectionFillData.reviewFlags ?? []
    if (reviewFlags.length === 0) return []
    const dismissed = dismissedReviewFlags ?? new Set<string>()
    const out: ReviewFlagMarker[] = []
    for (const f of reviewFlags) {
      const id = reviewFlagId(f)
      if (dismissed.has(id)) continue
      const colIdx = f.side === 'left' ? f.gapIndex : f.gapIndex + 1
      const facingIdx = f.side === 'left' ? f.gapIndex + 1 : f.gapIndex
      const col = orderedColumns[colIdx]
      if (!col) continue
      const unit = col.units.find((u) => u.layerId === f.layerId)
      const scr = screenByInv.get(col.investigationId)
      if (!unit || !scr) continue
      const topElev = col.surfaceElevM - unit.topDepthM
      const baseElev = col.surfaceElevM - unit.baseDepthM
      // Marker at the gap-facing edge of the drilled column (where the re-emitted onlap sits).
      const x = f.side === 'left' ? scr.rightX : scr.leftX
      const y = levelToScreen((topElev + baseElev) / 2)
      // Correlate target: the same-formation unit on the facing column overlapping this band.
      let facingLayerId: string | null = null
      const facingCol = orderedColumns[facingIdx]
      if (facingCol) {
        for (const fu of facingCol.units) {
          if (fu.formationId !== unit.formationId) continue
          const fTop = facingCol.surfaceElevM - fu.topDepthM
          const fBase = facingCol.surfaceElevM - fu.baseDepthM
          if (Math.min(fTop, topElev) - Math.max(fBase, baseElev) > 1e-6) {
            facingLayerId = fu.layerId
            break
          }
        }
      }
      out.push({ id, x, y, flagLayerId: f.layerId, facingLayerId })
    }
    return out
  }, [axisMode, sectionFillData, dismissedReviewFlags, screenByInv, levelToScreen])

  // ---- UNSAFE-DRAG UX (owner S80 "red handle and snapback"; §87 exact identity). ------------
  // The EXACT editable target whose in-progress drag reached a REFUSED reach this frame (engine
  // ``rejected-unsafe``). Drives the RED handle in the render — reddening ONLY the dragged node, never
  // every sibling handle of the same body (§87 BUG #1). A ref mirrors it so the drag ``mouseup``
  // closures (captured once per drag, not per frame) read the CURRENT rejection at release without a
  // stale closure — a rejected release snaps back (skips ``onSaveBoundary``) instead of persisting the
  // unsafe node. The gap-proof invariant holds: a rejected drag never persists → never a stored gap.
  const rejectedDragTarget = sectionFillData.rejectedDragTarget
  const rejectedDragTargetRef = useRef<EditableTargetIdentity | null>(null)
  useEffect(() => {
    rejectedDragTargetRef.current = rejectedDragTarget
  }, [rejectedDragTarget])

  // S97: mirror the raw override STATUS into a ref too so the RELEASE trace reports the EXACT rejection
  // kind (``rejected-unsafe`` vs ``rejected-collapse``) — the owner's dogfeed distinguishes an unsafe
  // reach from an over-reach collapse. Captured-once mouseup closures read the current status here.
  const overrideStatusRef = useRef<OverrideStatus | null>(null)
  useEffect(() => {
    overrideStatusRef.current = sectionFillData.overrideStatus
  }, [sectionFillData.overrideStatus])

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

  // ---- GHOST-CONTACT handle suppression (§83, v2 only; S78 DEFERRED). ------
  //
  // Owner ruling (2026-07-22): the residual DEAD apex handles (S76 measured 24
  // across all 14 sections) are GHOST CONTACTS — interior convergence tips of a
  // CONTINUOUS same-litho band (merge-welded then engine-suppressed by ruling 8m).
  // They have no geological meaning; every handle the tool renders MUST reshape.
  //
  // The DETECTION is the same S77 oracle (``detectDeadHandleBodies``): for every
  // apex-shapeable region, feed a moderate single-body override the way ``setShape``
  // does and re-partition; a ghost tip's footprint is byte-static → suppress its
  // handle. §77's ``unroutableBodies`` only caught bodies with a STORED node at rest
  // (it reads ``apexOverrides.keys()``); this probe covers the common fresh first-grab.
  //
  // S78 PERF (owner dogfeed 2026-07-23 — "the app rubberbands after clicking fill
  // bands"): the S77 probe ran that re-partition-per-region (CS1: 69 × ~38 ms ≈
  // 2.6 s) inside a plain ``useMemo`` on the RENDER path, memoised on
  // ``partitionTopology`` — whose object identity churns on every pan/zoom
  // (``screenByInv`` rebuilds each column's ``nudgedX``). So a pan re-ran the 2.6 s
  // probe on the main thread → the repeated ``[Violation] handler took 5024 ms`` →
  // rubberbanding. ``usePartitionGhostHandles`` fixes BOTH faults: it re-runs the
  // probe ONLY when a CONTENT KEY over the drag-independent topology (unit stacks /
  // edges / along-metres / engine) changes — a pan/zoom keeps the key, so the cached
  // DEAD set is reused with zero recompute — and it runs the probe OFF the paint path
  // in small idle chunks (empty set for the first beat, then the ghosts drop), so no
  // frame is ever held. The resolved set is byte-identical to the S77 oracle.
  // ``ghostBase`` was memoised on partitionTopology's OBJECT IDENTITY while its
  // consumer was already on the content key, so S78 fixed the 2.6 s probe but left its
  // input on the identity path: a pan or zoom rebuilds each column's ``nudgedX``, the
  // object changes, and a FULL engine pass ran every frame. Keying it on the same
  // content key closes that half of the fault.
  //
  // NOT RUN on the view-only geotech axis (2026-08-15). Every consumer of the
  // resolved set is a grab surface, and none of those render there — while the
  // probe's gap indices come from ``partitionTopology``, which is the GEOTECH
  // model's own column set, whereas the partition drawn on that axis is built
  // on the LITHO FRAME's. Running it would spend the section's most expensive
  // pass to produce indices that address a different axis.
  const ghostTopoKey = viewOnly
    ? ''
    : topologyKey(
        partitionTopology.orderedColumns,
        partitionTopology.edges,
        partitionTopology.alongM,
        partitionEngineV2,
      )
  const ghostTopoRef = useRef(partitionTopology)
  ghostTopoRef.current = partitionTopology
  const ghostBase = useMemo(
    () =>
      !viewOnly && ghostTopoRef.current.orderedColumns.length >= 2 && partitionEngineV2
        ? computeSectionFillActive(
            ghostTopoRef.current.orderedColumns,
            ghostTopoRef.current.edges,
            undefined,
            ghostTopoRef.current.alongM,
          )
        : EMPTY_REGIONS,
    // reason: the engine output depends only on the topology CONTENT, which
    // ``ghostTopoKey`` captures in full (unit stacks / edges / along-metres / engine).
    // The inputs are read through a ref so the memo sees current values without
    // depending on an identity that churns with the viewport — the same technique
    // ``usePartitionGhostHandles`` already uses for the probe itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ghostTopoKey, partitionEngineV2, viewOnly],
  )
  const deadHandleBodies = usePartitionGhostHandles(
    ghostBase,
    partitionTopology.orderedColumns,
    partitionTopology.edges,
    partitionTopology.alongM,
    computeSectionFillActive,
    partitionEngineV2 && !viewOnly,
  )

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
    const {
      sectionRegions,
      orderedColumns,
      gapXs,
      apexOverrides,
      contactOverriddenBodies,
      tieOwnedTopBodies,
      tieOwnedBaseBodies,
    } = sectionFillData
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

        // TIE-OWNED seam (owner demo defect 2026-08-05): the boundary this pair
        // shares is the lower band's TOP (= the upper band's base). When an
        // accepted tie owns it, the correlation — not a stored reshape node —
        // decides where the seam runs: bending it here painted a KLEI wedge
        // ABOVE the tie from a stale July-27 node. v2 refuses such nodes via
        // §77 (un-routable → no-op); v1 must refuse identically.
        if (tieOwnedTopBodies.has(lId) || tieOwnedBaseBodies.has(uId)) continue

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
    const { sectionRegions, orderedColumns, columnScreens } = sectionFillData
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
      const sc = columnScreens[f.columnIndex]
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
  //
  // Runs on the geotech axis too since 2026-08-13: the packing fill is emitted
  // through this same path, so it inherits the hairline closure for free.
  //
  // The CARD strips are in the classifier's element list since 2026-08-15: the
  // fill paints through the cards, so a gap region's card edge is no longer
  // "unfilled space" and stroking it left a darker rim (0.62 over 0.62) down
  // the gap side of every card boundary — the tone step the owner still saw
  // after the veil went to 0. They classify only; they carry no stroke.
  // ONE MASS, ONE IDENTITY (owner dogfeed 2026-08-22, the vertical line down
  // B3's right edge): on the geotech axis one packing class lives under
  // several formation ROWS (one per litho/geological parent — provenance by
  // design), so comparing raw row ids drew a seam through a mass the fill had
  // already welded. See ``sectionFillIdentity``.
  const packingClassByFormationId = lithoFrame?.packingClassByFormationId
  const identityOf = useCallback(
    (formationId: string): string => fillIdentityOf(formationId, packingClassByFormationId),
    [packingClassByFormationId],
  )

  const seamStrokes = useMemo(
    (): { undercol: string[]; regions: string[] } =>
      computeSectionSeamStrokes(
        underColumnFills.map((f) => ({ points: f.pts, formationId: identityOf(f.formationId) })),
        screenRegions.map((sr) => ({
          points: sr.points,
          formationId: identityOf(sr.region.formationId),
        })),
        columnStrips.map((s) => ({ points: s.pts, formationId: identityOf(s.formationId) })),
      ),
    [underColumnFills, screenRegions, columnStrips, identityOf],
  )

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
    if (screenRegions.length + underColumnFills.length + columnStrips.length === 0) return []
    // The selected body's lithology — under-column fills carry formationId (not
    // bodyId), so S1 fades them by matching lithology (mirrors the render below).
    const selFormId = selectedBodyId
      ? (screenRegions.find((sr) => sr.region.bodyId === selectedBodyId)?.region.formationId ?? null)
      : null
    const elements: FillGroupElement[] = []
    // Card-covering strips first — same opacity, same dissolve identity, so a
    // band continues across its column at exactly the gap fill's tone.
    for (const s of columnStrips) {
      const color =
        s.source === 'primary'
          ? (formationColorById.get(s.formationId) ?? FALLBACK_COLOR)
          : (lithoFrame?.lithoFormationColorById.get(s.formationId) ?? FALLBACK_COLOR)
      const opacity =
        selectedBodyId && selFormId !== null && s.formationId !== selFormId ? 0.25 : FILL_OPACITY
      elements.push({
        points: s.pts,
        formationId: identityOf(s.formationId),
        color,
        opacityBucket: String(opacity),
        opacity,
      })
    }
    for (const f of underColumnFills) {
      const opacity =
        selectedBodyId && selFormId !== null && f.formationId !== selFormId ? 0.25 : FILL_OPACITY
      elements.push({
        points: f.pts,
        formationId: identityOf(f.formationId),
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
        formationId: identityOf(sr.region.formationId),
        color: formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR,
        opacityBucket: String(opacity),
        opacity,
      })
    }
    return buildFillGroups(elements)
  }, [underColumnFills, screenRegions, columnStrips, selectedBodyId, formationColorById, lithoFrame, identityOf])

  // ---- LITHO FRAME over the geotech partition (owner ruling 2026-08-13). ----
  //
  // The geotech axis paints its OWN partition through everything above (the
  // props carry the geotech model's rows there). What it still owes the
  // engineer is the LITHO geometry, which stays visually authoritative:
  //
  //   * OUTLINES — the litho partition's non-lens region envelopes, drawn dark
  //     over the packing fills so a packing boundary is never mistaken for a
  //     lithology boundary.
  //   * FALLBACK FILLS — litho regions the geotech model has no bands for,
  //     painted in LITHOLOGY colour BENEATH the packing fills, so an
  //     un-subdivided interval reads as un-subdivided ground and not as a hole.
  //
  // The litho partition is assembled independently: a column may carry litho
  // layers and no packing bands (an undivided borehole), so its column order,
  // gap indices and screen gap extents are NOT the geotech ones and must be
  // derived from the litho rows. The engine call is cached on the same content
  // key ``sectionFillData`` uses, so a pan/zoom (which churns ``placedColumns``
  // identity through ``nudgedX``) reprojects without re-partitioning.
  const lithoFrameScreen = useMemo(() => {
    const empty = {
      fallbackPolys: [] as { key: string; d: string; color: string }[],
      outlines: [] as { key: string; d: string }[],
    }
    if (!lithoFrame || !showBands) return empty

    // --- the LITHO partition, hoisted above the fill memo for the clip. -----
    const {
      lithoRegions,
      lithoValid: valid,
      lithoScreenByInv,
      lithoAlongM,
    } = lithoFramePartition
    if (lithoRegions.length === 0 || valid.length < 2) return empty
    const lithoGapXs = Array.from({ length: valid.length - 1 }, (_, i) => ({
      leftX: (lithoScreenByInv.get(valid[i]) as ColumnScreen).rightX,
      rightX: (lithoScreenByInv.get(valid[i + 1]) as ColumnScreen).leftX,
    }))

    // --- which litho regions the packing partition leaves bare. -------------
    // Read off the ASSEMBLED geotech columns (``colByInv``), not the raw layer
    // rows: those are what the primary partition actually paints from, so a
    // dropped column (no accepted bands, or no collar elevation) correctly
    // counts as unpacked here too.
    const packingBandsByInv = new Map<string, FallbackPackingBand[]>()
    for (const [inv, col] of colByInv) {
      packingBandsByInv.set(
        inv,
        col.units.map((u) => ({
          topElevM: col.surfaceElevM - u.topDepthM,
          baseElevM: col.surfaceElevM - u.baseDepthM,
          soilCode: lithoFrame.geotechSoilByFormationId.get(u.formationId) ?? null,
        })),
      )
    }
    // The clip's per-face fallback is exact (owner ruling 2026-08-14) and
    // supersedes the whole-region heuristic whenever the clip ran; the
    // heuristic stays for the columns-differ case (undivided borehole).
    const fallbackRegions =
      sectionFillData.lithoFallbackRegions ??
      selectLithoFallbackRegions(
        lithoRegions,
        valid,
        packingBandsByInv,
        lithoFrame.lithoSoilByFormationId,
      )

    // --- project both passes. ----------------------------------------------
    const pathFor = (
      gapIndex: number,
      polygon: readonly { fraction: number; elevation: number }[],
    ): string | null => {
      const g = lithoGapXs[gapIndex]
      if (!g || g.rightX - g.leftX < 1) return null // degenerate-gap guard (mirror-spill)
      return (
        polygon
          .map((q, j) => {
            const x = g.leftX + q.fraction * (g.rightX - g.leftX)
            const y = clampY(levelToScreen(q.elevation))
            return `${j === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
          })
          .join(' ') + ' Z'
      )
    }
    const fallbackPolys: { key: string; d: string; color: string }[] = []
    let bi = 0
    for (const r of fallbackRegions) {
      const d = pathFor(r.gapIndex, r.polygon)
      if (!d) continue
      fallbackPolys.push({
        key: `lf-${bi++}`,
        d,
        color: lithoFrame.lithoFormationColorById.get(r.formationId) ?? FALLBACK_COLOR,
      })
    }
    // Soil-level dissolve (owner dogfeed 2026-08-18: "weird ass horizontal
    // black lines without meaning to the user"): only edges where the SOIL
    // changes — or the frame's outer envelope — draw; internal seams between
    // touching same-soil litho units dissolve. One path per gap.
    const segsByGap = new Map<number, string[]>()
    // The outline's column-line guard is METRIC (see lithoOutlineEdges), so it
    // needs each gap's true along-section width, not its screen width — the
    // offset it absorbs is the arrangement's 1 mm snap in metres.
    const gapWidthM = (gapIndex: number): number =>
      Math.abs((lithoAlongM[gapIndex + 1] ?? NaN) - (lithoAlongM[gapIndex] ?? NaN))
    for (const s of lithoOutlineEdges(
      lithoRegions,
      lithoFrame.lithoSoilByFormationId,
      gapWidthM,
    )) {
      const g = lithoGapXs[s.gapIndex]
      if (!g || g.rightX - g.leftX < 1) continue // degenerate-gap guard (mirror-spill)
      const px = (q: { fraction: number; elevation: number }): string => {
        const x = g.leftX + q.fraction * (g.rightX - g.leftX)
        const y = clampY(levelToScreen(q.elevation))
        return `${x.toFixed(2)},${y.toFixed(2)}`
      }
      const list = segsByGap.get(s.gapIndex) ?? []
      list.push(`M ${px(s.a)} L ${px(s.b)}`)
      segsByGap.set(s.gapIndex, list)
    }
    const outlines: { key: string; d: string }[] = []
    for (const [gap, parts] of segsByGap) {
      outlines.push({ key: `lo-${gap}`, d: parts.join(' ') })
    }
    return { fallbackPolys, outlines }
  }, [
    lithoFrame,
    showBands,
    lithoFramePartition,
    sectionFillData.lithoFallbackRegions,
    colByInv,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // ---- "CORRELATE ME" — the geotech axis's UN-BANDED ground. ---------------
  //
  // OWNER RULING 2026-08-14, verbatim: "sure read as correlate me on the extra
  // ruling is fine". A litho area the packing model has no bands for used to
  // paint as flat lithology colour, so the same clay met itself in two tones at
  // a card edge — a classified KLEI NAD 23 band beside plain KLEI — and the
  // tone difference read as a lithology difference. It now carries a texture
  // that reads as unfinished work instead of impersonating a class. Both truths
  // survive: the classified band keeps its class, the bare ground keeps its
  // lithology hue underneath.
  //
  // The rule is handed EVERY fill about to be painted, packing fills included,
  // so the discrimination lives in one place: a regression that textures
  // classified ground is a change to ``selectUnbandedHatchFills``, not a silent
  // render drift. It self-clears with no invalidation of its own — the
  // candidates come from ``lithoFrameScreen.fallbackPolys``, which shrink as the
  // packing partition (recomputed from the accepted ties) grows over them.
  const unbandedHatchFills = useMemo(() => {
    const candidates: HatchCandidateFill[] = [
      ...fillGroups.map((g) => ({ key: `pf-group-${g.key}`, d: g.d, kind: 'packed' as const })),
      ...lithoFrameScreen.fallbackPolys.map((p) => ({
        key: p.key,
        d: p.d,
        kind: 'unbanded' as const,
      })),
    ]
    return selectUnbandedHatchFills({
      axisMode,
      geotechPartitionFramed: lithoFrame != null,
      candidates,
    })
  }, [axisMode, lithoFrame, fillGroups, lithoFrameScreen])

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

    // UNIFIED HANDLE — SINGLE SURFACE BY CONSTRUCTION (S98): the retired
    // ``sharedBoundariesForRender`` referee post-filtered nodes that ``screenLenses``
    // also drew. Instead of a second pass, this pass NEVER emits a contact-bend node
    // for a body that owns an apex-shapeable (lens / pinch) tip in the same gap — that
    // body's nodes belong to the LENS surface. The gate mirrors ``screenLenses`` exactly
    // (``isApexShapeable`` minus the un-routable / dead-handle suppressions) so a node is
    // drawn by exactly ONE surface with no referee. Keyed ``gapKey:bodyId``.
    const lensOwningBodyByGap = new Set<string>()
    for (const sr of screenRegions) {
      const bId = sr.region.bodyId
      if (!bId) continue
      if (!isApexShapeable(sr.region)) continue
      const gk = `${sr.region.gapIndex}:${bId}`
      if (sectionFillData.unroutableBodies.has(gk)) continue
      if (deadHandleBodies.has(gk)) continue
      if (!resolveSourceCorners(sr.region.polygon)) continue
      lensOwningBodyByGap.add(`${sr.leftX}:${sr.rightX}:${bId}`)
    }

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
        // BY-CONSTRUCTION SINGLE SURFACE (S98): if THIS upper body owns a lens/pinch tip
        // in this gap, the LENS surface renders its nodes — the contact pass emits none,
        // so no node is drawn twice (the retired referee's job, done here at the source).
        const emitNodes =
          !nodesEmittedFor.has(nodesKey) && !lensOwningBodyByGap.has(`${gapKey}:${uId}`)
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
    // S98 single-surface gate: the same suppression sets ``screenLenses`` reads, so the
    // contact pass and the lens pass agree on which bodies own a lens tip.
    sectionFillData.unroutableBodies,
    deadHandleBodies,
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
      // GHOST-CONTACT tip (§83): a shapeable tip on a fresh grab (no stored node)
      // whose single-body override the engine does NOT consume — the residual DEAD
      // handles S76 measured (interior convergence seams of a CONTINUOUS same-litho
      // band, ruling-8m-suppressed). Owner ruling: these are modelling artefacts
      // (merge-then-delete ghost contacts) with no geological meaning → NO grab
      // handle. Unlike ``unroutableBodies`` (stored-node only), this per-topology
      // probe covers the common first-grab path. Every handle that survives reshapes.
      if (deadHandleBodies.has(`${sr.region.gapIndex}:${bodyId}`)) continue

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
        gapIndex: sr.region.gapIndex,
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
    // Suppress the grab handle for ghost-contact tips (§83, fresh-grab path).
    deadHandleBodies,
  ])

  // S98: the ``sharedBoundariesForRender`` referee is DELETED. It existed only to stop a
  // stored node being drawn as BOTH a contact handle and a lens handle ("three dots"). That
  // dedup is now enforced BY CONSTRUCTION inside ``sharedBoundaries`` (``lensOwningBodyByGap``:
  // a body that owns a lens/pinch tip in a gap emits no contact-bend nodes there), so the
  // render maps ``sharedBoundaries`` directly — one uniform handle owns each edge.

  // ---- Add-node handlers ---------------------------------------------------

  // S86 press-to-grab: the add-node ``handle*AddNode`` persist helpers are RETIRED — the
  // add-strip mousedown now starts an ``isNew`` drag (``routeAddStripClick`` → the dispatch
  // thunks) that both creates and grabs the node, and the drag ``mouseup`` APPENDS + persists
  // (see the lens/boundary drag effects above). Only the REMOVE helpers stay (right-click).

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

  /**
   * Start an ``onlapIntervening`` boundary drag from a resolved onlap-intervening grab (S110/S111).
   *
   * Shared by BOTH add-strip dispatch sites (the shared-boundary strip AND the lens strip) so the
   * bend-without-tie drag is constructed identically — the owner's clay-base grab lands on the
   * shared-boundary strip (clay & matrix adjacent on the grab column), the sand-onlap grab lands on
   * the lens strip. The drag carries ``onlapIntervening: true`` which GATES OFF the banding-tie path
   * (no §106 re-absorb): the riding onlap keeps its own onlap tie, so ``collectContactBends`` bends
   * the shared contact and the onlap RIDES it (§109), while the clay SURVIVES.
   */
  const startOnlapInterveningDrag = (args: {
    grab: OnlapInterveningGrab
    gapLeft: PartitionColumn
    gapRight: PartitionColumn
    gapIndex: number
    leftX: number
    rightX: number
  }): void => {
    const { grab, gapLeft, gapRight, gapIndex, leftX, rightX } = args
    const clampedX = Math.max(leftX + 1, Math.min(rightX - 1, lastClick.current.x))
    const bandExtentY = twoBandExtentScreenY(gapLeft, gapRight, grab.upperBodyId, grab.lowerBodyId, levelToScreen)
    const existing = boundariesByBodyId?.get(grab.upperBodyId)
    const inGapCount = (existing?.lower_nodes ?? []).filter((n) => {
      if (!alongToScreenX) return false
      const nx = alongToScreenX(n.along_m)
      return nx >= leftX && nx <= rightX
    }).length
    // eslint-disable-next-line no-console
    console.info(
      `[freedraw] BGRAB onlap-intervening upper=${grab.upperBodyId.slice(-6)} ` +
        `lower=${grab.lowerBodyId.slice(-6)} gap=${gapIndex} ` +
        `ridingOnlaps=[${grab.ridingOnlaps.map((o) => o.slice(-6)).join(',')}] ` +
        `dispatch=contact-bend-WITHOUT-tie (no re-absorb)`,
    )
    setBoundaryDrag({
      upperBodyId: grab.upperBodyId,
      lowerBodyId: grab.lowerBodyId,
      gapIndex,
      nodeIndex: inGapCount,
      x: clampedX,
      y: lastClick.current.y,
      minY: bandExtentY?.minY ?? lastClick.current.y,
      maxY: bandExtentY?.maxY ?? lastClick.current.y,
      leftX,
      rightX,
      isNew: true,
      // S110: emit the contact bend but NEVER synthesize/POST the A/C banding tie (the §106
      // re-absorb hazard). The riding onlap keeps its own tie, so the engine bends the shared
      // contact (collectContactBends) without absorbing the onlap.
      onlapIntervening: true,
      x0: lastClick.current.x,
      y0: lastClick.current.y,
    })
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
      const upperRegion = screenRegions[sb.upperIdx]
      // Hit segments = consecutive pairs of the base-contact polyline, so a click on
      // any part of a BENT contact grabs it (and the grab tolerance rides the visible
      // marker, not a straight chord that drifts above the bend). S104.
      const segs: [{ x: number; y: number }, { x: number; y: number }][] = []
      for (let i = 0; i < sb.naturalEdge.length - 1; i += 1) {
        segs.push([sb.naturalEdge[i], sb.naturalEdge[i + 1]])
      }
      cands.push({
        segments: segs,
        regionPolygon: upperRegion?.points,
        // PROJECT the click onto the contact edge (S72): a click deep inside the
        // upper band must drop the node ON the shared contact at the cursor x, not
        // float at the raw interior y (the "point without grabbing a boundary" +
        // the tie-bounded-base "can't grab it" dogfeed). The S86 press-to-grab dispatch
        // starts an ``isNew`` boundary drag at that on-edge (along, elevation); S68's
        // contact-override re-partitions BOTH bands through the engine, so a tie-bounded
        // base bends gap/overlap-free.
        dispatch: () => {
          const p =
            projectClickToCandidate(lastClick.current, { segments: segs, dispatch: null }) ??
            lastClick.current
          // S111 ONLAP-INTERVENING routing on the SHARED-BOUNDARY strip (owner dogfeed 2026-07-25:
          // "dragged the sand onlap and the clay band disappeared"). The owner's clay-base grab lands
          // HERE, not on the lens strip, because the clay & matrix ARE adjacent on the grab column so
          // the A/C contact renders as a shared boundary. Before S111 this dispatch always started a
          // PLAIN un-tied ``isNew`` boundaryDrag — which persisted an engine-inert node that flooded
          // the clay away (``onlapIntervening=false`` in the live trace). Route through the SHARED
          // ``routeGrabbedBoundary`` decision so an intervening onlap is caught here too: dispatch the
          // ``onlapIntervening`` bend-without-tie instead of the destructive plain grab.
          const gapLeft = sectionFillData.orderedColumns[sb.gapIndex]
          const gapRight = sectionFillData.orderedColumns[sb.gapIndex + 1]
          const clickElev = screenToLevel ? screenToLevel(lastClick.current.y) : 0
          // §113 POSITION-AWARENESS: the grab's gap fraction (0 = left column, 1 = right) decides
          // whether an intervening onlap RIDES (grab on the onlap's side of its pinch) or is a WALL
          // (grab on the flush side — the clay bends locally, the onlap holds). Screen-space fraction
          // from the two gap column x's + the raw click x.
          const grabFraction =
            sb.rightX > sb.leftX ? (lastClick.current.x - sb.leftX) / (sb.rightX - sb.leftX) : 0.5
          const route =
            gapLeft && gapRight
              ? routeGrabbedBoundary(gapLeft, gapRight, sb.upperBodyId, sb.lowerBodyId, clickElev, grabFraction)
              : ({ kind: 'lens' } as const)
          // Both onlap-intervening (ride) and flush-contact (local bend, onlap held) dispatch the SAME
          // bend-WITHOUT-tie boundaryDrag — the onlap keeps its own tie (no §106 re-absorb). The ENGINE
          // confines the bend to the flush segment when the apex fraction is on the flush side of the
          // onlap's pinch (§113 ``collectContactBends``), so the onlap is a wall for a flush grab and
          // rides for an onlap-side grab. The route kind only names the case for telemetry.
          if (route.kind === 'onlap-intervening' || route.kind === 'flush-contact') {
            startOnlapInterveningDrag({
              grab: route.grab,
              gapLeft: gapLeft!,
              gapRight: gapRight!,
              gapIndex: sb.gapIndex,
              leftX: sb.leftX,
              rightX: sb.rightX,
            })
            return
          }
          // S86 PRESS-TO-GRAB: create AND grab the contact node in this SAME mousedown.
          // Rather than persist here (the old ``handleBoundaryAddNode`` two-step), START
          // a boundary drag flagged ``isNew`` at the projected on-contact position. The
          // node lives on the upper body's ``lower_nodes``; ``nodeIndex`` is the would-be
          // new IN-GAP index (matches ``sharedBoundaries`` / ``contactOverrideWiring``,
          // which treat the first in-gap node as index 0). The live contact override
          // synthesizes this node so it reshapes as the cursor moves; mouseup APPENDS +
          // persists it as a contact bend.
          const existing = boundariesByBodyId?.get(sb.upperBodyId)
          const inGapCount = (existing?.lower_nodes ?? []).filter((n) => {
            if (!alongToScreenX) return false
            const nx = alongToScreenX(n.along_m)
            return nx >= sb.leftX && nx <= sb.rightX
          }).length
          setBoundaryDrag({
            upperBodyId: sb.upperBodyId,
            lowerBodyId: sb.lowerBodyId,
            gapIndex: sb.gapIndex,
            nodeIndex: inGapCount,
            x: p.x,
            y: p.y,
            minY: sb.minY,
            maxY: sb.maxY,
            leftX: sb.leftX,
            rightX: sb.rightX,
            isNew: true,
            // S105 drag-threshold origin = the raw mousedown cursor. The correlate-on-drag
            // (live tie injection + release persist) fires ONLY once the cursor moves past
            // DRAG_THRESHOLD from here, so a pure click reshapes nothing.
            x0: lastClick.current.x,
            y0: lastClick.current.y,
          })
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
          // S103 RECLASSIFY (fix the ``isApexShapeable``→lens hijack): an UN-correlated two-full-
          // band boundary renders its lower band as a PINCH (0 corr → LENS), so this grab looks like
          // a lens. But if the grabbed body is FULL-WIDTH across the gap it is a stacked BAND, not a
          // real lens — its base is a two-band contact that must route as a CONTACT drag so the
          // correlate-then-bend mechanism fires (the injected tie snaps the wedge to a band + bends
          // to the cursor). Reclassify to a ``boundaryDrag`` here; a genuine lens (one-sided body)
          // falls through to the lens drag below unchanged.
          const gapLeft = sectionFillData.orderedColumns[sl.gapIndex]
          const gapRight = sectionFillData.orderedColumns[sl.gapIndex + 1]
          // Resolve the grab elevation so the reclassify picks the boundary (top vs base of the
          // grabbed band) nearest the cursor — the grabbed band may be the UPPER or LOWER band.
          const clickElev = screenToLevel ? screenToLevel(lastClick.current.y) : 0
          // S110/S111 ONLAP-INTERVENING grab (owner 2026-07-24/25, "grabbing the boundary of the clay
          // and the sand is disappearing — it needs to reshape together with the dragged boundary").
          // Route through the SHARED ``routeGrabbedBoundary`` decision (the same one the shared-boundary
          // strip uses) so an intervening onlap is caught identically at BOTH entry points. It resolves
          // the onlap-intervening grab FIRST (a ``contact:A|C`` bend WITHOUT the A/C banding tie makes
          // the onlap RIDE the bent clay base and SURVIVE — §109), else falls to the plain stacked-band
          // reclassify (S103 correlate-then-bend), else a genuine lens (keep the lens drag below).
          // §113 POSITION-AWARENESS: the grab's gap fraction routes a flush-side grab (onlap held) vs
          // an onlap-side grab (onlap rides) — see the shared-boundary dispatch.
          const grabFraction =
            sl.rightX > sl.leftX ? (lastClick.current.x - sl.leftX) / (sl.rightX - sl.leftX) : 0.5
          const route =
            gapLeft && gapRight
              ? routeGrabbedBoundary(gapLeft, gapRight, sl.bodyId, null, clickElev, grabFraction)
              : ({ kind: 'lens' } as const)
          // Onlap-intervening (ride) and flush-contact (local bend, onlap held) both dispatch the same
          // bend-WITHOUT-tie drag; the engine confines the flush case (§113).
          if (route.kind === 'onlap-intervening' || route.kind === 'flush-contact') {
            startOnlapInterveningDrag({
              grab: route.grab,
              gapLeft: gapLeft!,
              gapRight: gapRight!,
              gapIndex: sl.gapIndex,
              leftX: sl.leftX,
              rightX: sl.rightX,
            })
            return
          }
          const stacked = route.kind === 'plain-boundary' ? route : null
          if (stacked) {
            const clampedX = Math.max(sl.leftX + 1, Math.min(sl.rightX - 1, lastClick.current.x))
            // Gap-free clamp = the FULL two-band extent (owner "cannot cross the neighbour above/
            // below"): the upper band's own TOP → the lower band's own BASE, in screen y. The
            // grabbed lens region's own extent (``sl.lensTopY/BaseY``) covers only one band, which
            // would trap the bend inside it — read the two bodies' true extents from the columns.
            const bandExtentY = twoBandExtentScreenY(
              gapLeft!,
              gapRight!,
              stacked.upperBodyId,
              stacked.lowerBodyId,
              levelToScreen,
            )
            // B2: the would-be new IN-GAP index = the count of the upper body's already-stored
            // in-gap contact nodes (matches the non-reclassified contact dispatch above). Hard-
            // coding 0 would OVERWRITE the first persisted node on a second drag of this boundary.
            const existing = boundariesByBodyId?.get(stacked.upperBodyId)
            const inGapCount = (existing?.lower_nodes ?? []).filter((n) => {
              if (!alongToScreenX) return false
              const nx = alongToScreenX(n.along_m)
              return nx >= sl.leftX && nx <= sl.rightX
            }).length
            setBoundaryDrag({
              upperBodyId: stacked.upperBodyId,
              lowerBodyId: stacked.lowerBodyId,
              gapIndex: sl.gapIndex,
              nodeIndex: inGapCount,
              x: clampedX,
              y: lastClick.current.y,
              minY: bandExtentY?.minY ?? sl.lensTopY,
              maxY: bandExtentY?.maxY ?? sl.lensBaseY,
              leftX: sl.leftX,
              rightX: sl.rightX,
              isNew: true,
              // S105 drag-threshold origin (see the contact dispatch above).
              x0: lastClick.current.x,
              y0: lastClick.current.y,
            })
            return
          }
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
          //
          // Fact-A REPAIR (owner 2026-07-23): clamp the along-x AND re-read the segment
          // y at the clamped x so the stored node stays ON the (possibly sloping) edge —
          // the old code kept the projected y after moving x, which on a slope dropped
          // the node in free space (the floating blue handle). ``applyReachFloorOnSegment``
          // never returns raw cursor coords: an out-of-span clamp snaps to the nearest
          // segment endpoint, still on the boundary.
          const gapW = sl.rightX - sl.leftX
          const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
          const node = applyReachFloorOnSegment(p, seg, sl.side, sl.leftX, sl.rightX, floorPx)
          // S86 PRESS-TO-GRAB: create AND grab the node in this SAME mousedown. Rather
          // than persist here (the old ``handleLensAddNode`` two-step), START a lens
          // drag flagged ``isNew`` at the projected on-edge position. ``nodeIndex`` is
          // the would-be new index = the dragged edge's current stored length (the
          // mouseup APPENDS at that index). The live override injects this new node so
          // it reshapes as the cursor moves; mouseup persists it routed as a lens.
          const existing = boundariesByBodyId?.get(sl.bodyId)
          const edgeLen = (edge === 'upper' ? existing?.upper_nodes : existing?.lower_nodes)?.length ?? 0
          setLensDrag({
            bodyId: sl.bodyId,
            regionIdx: sl.regionIdx,
            gapIndex: sl.gapIndex,
            side: sl.side,
            edge,
            nodeIndex: edgeLen,
            x: node.x,
            y: node.y,
            leftX: sl.leftX,
            rightX: sl.rightX,
            lensTopY: sl.lensTopY,
            lensBaseY: sl.lensBaseY,
            isNew: true,
            // S105 drag-threshold origin: a pure click on a lens edge must NOT spawn+persist
            // a zero-length apex node either. The isNew injection + release persist fire only
            // past DRAG_THRESHOLD from this mousedown cursor.
            x0: lastClick.current.x,
            y0: lastClick.current.y,
          })
        },
      })
    }
    return cands
  }, [
    sharedBoundaries,
    screenLenses,
    screenRegions,
    onSaveBoundary,
    // The S86 press-to-grab dispatch thunks read ``boundariesByBodyId`` (for the
    // dragged edge's current length → the would-be new nodeIndex) + ``alongToScreenX``
    // (in-gap node count for the contact path) and start a drag via the stable setters.
    // Re-deriving the candidate list on each of these keeps the thunks fresh. The
    // screen transforms below are carried for parity with the drag effects that consume
    // them on mouseup (an over-inclusive dep never mis-fires the reshape).
    boundariesByBodyId,
    alongToScreenX,
    screenXToAlong,
    screenToLevel,
    // S103 reclassify: the lens dispatch reads the gap's columns to detect a stacked full-band
    // grab (route it as a contact drag) + ``levelToScreen`` for the full two-band clamp extent.
    // ``orderedColumns`` is stable across pan/zoom.
    sectionFillData.orderedColumns,
    levelToScreen,
  ])

  // The GHOST barrier regions + the squared hit tolerance shared by the grab and
  // the hover preview (both must use the SAME edge-within-tolerance test so the
  // teal dot shows exactly where a click would grab). Barriers = the suppressed
  // ghost regions (§83); a press/hover inside one is inert. Tolerance = the strip's
  // half-width in px, squared (``candidateDistSq`` returns squared distance).
  const edgeToleranceSq = (ADDSTRIP_HIT_W / 2) * (ADDSTRIP_HIT_W / 2)
  const ghostBarrierRegions = useMemo(
    () =>
      screenRegions
        .filter(
          (sr) => sr.region.bodyId && deadHandleBodies.has(`${sr.region.gapIndex}:${sr.region.bodyId}`),
        )
        .map((sr) => sr.points),
    [screenRegions, deadHandleBodies],
  )

  /**
   * Route an add-strip click to the litho edge nearest the cursor — EDGE-ONLY (S99):
   * an interior click (far from every edge) is a NO-OP.
   *
   * @param cx Cursor x in SVG coordinates.
   * @param cy Cursor y in SVG coordinates.
   */
  const routeAddStripClick = (cx: number, cy: number): void => {
    lastClick.current = { x: cx, y: cy }
    // EDGE-ONLY targeting (S99, owner dogfeed 2026-07-24): only the visible litho
    // line between two fills is grabbable. The click routes to the candidate whose
    // EDGE is nearest the cursor, but ONLY when that edge is within the strip's
    // half-width (``ADDSTRIP_HIT_W / 2``) — a click in open band INTERIOR (farther
    // than the tolerance from every edge) is a NO-OP, never a grab. This retires the
    // S71 region-containment grab, which let a click in the middle of a band drop a
    // node. The distant-diagonal steal S71 fixed cannot recur: an interior click is
    // now inert, not a grab of the region it's inside.
    const dispatch = routeAddStripByEdgeProximity(
      { x: cx, y: cy },
      addStripCandidates,
      edgeToleranceSq,
      ghostBarrierRegions,
    )
    if (dispatch) dispatch()
  }

  /**
   * Show the teal add-node preview dot ON the nearest litho edge — but ONLY when the
   * cursor is within the hit tolerance of one (S99). In the open band interior the
   * dot HIDES (``setAddNodePreview(null)``), so the preview telegraphs exactly where
   * a click would grab: the visible line, never free interior space. The dot is
   * placed at the PROJECTED on-edge point (``projectClickToCandidate``), not the raw
   * cursor, so it rides the boundary line the same way a stored node would.
   *
   * @param cx Cursor x in SVG coordinates.
   * @param cy Cursor y in SVG coordinates.
   */
  const previewAddNode = (cx: number, cy: number): void => {
    const cand = nearestAddStripWithinTolerance(
      { x: cx, y: cy },
      addStripCandidates,
      edgeToleranceSq,
      ghostBarrierRegions,
    )
    if (!cand) {
      setAddNodePreview(null)
      return
    }
    const p = projectClickToCandidate({ x: cx, y: cy }, cand) ?? { x: cx, y: cy }
    setAddNodePreview({ x: p.x, y: p.y, color: BOUNDARY_COLOR })
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
        onJump={
          onJumpToConflictGap
            ? () => {
                const next = nextVisitIndex(conflictVisitRef.current, conflicts.length)
                if (next === null) return
                conflictVisitRef.current = next
                // Resolve the gap on the fill's OWN axis (see the prop's doc):
                // gapXs is built from the same ordered column list the conflict
                // indexes, so this cannot drift from what was actually drawn.
                const gap = sectionFillData.gapXs[conflicts[next].gapIndex]
                if (gap === undefined) return
                onJumpToConflictGap((gap.leftX + gap.rightX) / 2)
              }
            : undefined
        }
      />
      {/* LITHO FALLBACK FILLS (geotech axis, owner ruling 2026-08-13): the
          litho regions the packing model has no bands for, painted in their
          LITHOLOGY colour. Emitted FIRST so the packing fills below composite
          over them — a region that IS packed is never in this list, so the two
          layers do not actually overlap; the order simply keeps unpacked ground
          visually subordinate. Same opacity + self-colour seam stroke as every
          other fill so it reads as part of the same surface. */}
      {lithoFrame && lithoFrameScreen.fallbackPolys.length > 0 && (
        <g data-testid="partition-litho-fallback-layer">
          {lithoFrameScreen.fallbackPolys.map((p) => (
            <path
              key={p.key}
              data-testid="partition-litho-fallback"
              d={p.d}
              fill={p.color}
              fillOpacity={FILL_OPACITY}
              // Self-colour seam stroke at the fill opacity (2026-07-13) — closes
              // the antialiasing hairline between adjacent fills. Matches
              // fillOpacity so it never reads as a darker outline.
              stroke={p.color}
              strokeOpacity={FILL_OPACITY}
              strokeWidth={0.75}
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
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
      {fillGroups.map((g) => (
        <path
          key={`pf-group-${g.key}`}
          data-testid={`partition-fill-group-${g.key}`}
          d={g.d}
          fill={g.color}
          fillOpacity={g.opacity}
          style={{ pointerEvents: 'none' }}
        />
      ))}

      {/* "CORRELATE ME" TEXTURE (geotech axis, owner ruling 2026-08-14): the
          areas the packing model has no bands for, hatched OVER their lithology
          colour so they read as unfinished ground rather than as a second shade
          of the same soil. Drawn after the fills so the hue stays recognisable
          beneath it, and before the litho outlines so the envelopes still win.
          Back-slash, wide and light — every other hatch on this canvas (litho
          pending ghosts, borehole packing previews, the DOV clay pattern) is a
          black forward-slash at 3-6 px, and "not committed yet" must not be
          confusable with "not correlated yet". Inert: the geotech axis is
          view-only and the correlate gesture targets live beneath these areas,
          so the layer never takes a pointer event. */}
      {unbandedHatchFills.length > 0 && (
        <g data-testid="partition-unbanded-hatch-layer" aria-label={UNBANDED_HATCH_LABEL}>
          <defs>
            <pattern
              id={UNBANDED_HATCH_PATTERN_ID}
              patternUnits="userSpaceOnUse"
              width={UNBANDED_HATCH_SPACING_PX}
              height={UNBANDED_HATCH_SPACING_PX}
              patternTransform={`rotate(${UNBANDED_HATCH_ROTATION_DEG})`}
            >
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={UNBANDED_HATCH_SPACING_PX}
                stroke={UNBANDED_HATCH_INK}
                strokeOpacity={UNBANDED_HATCH_STROKE_OPACITY}
                strokeWidth={UNBANDED_HATCH_STROKE_WIDTH}
              />
            </pattern>
          </defs>
          {unbandedHatchFills.map((f) => (
            <path
              key={`uh-${f.key}`}
              data-testid="partition-unbanded-hatch"
              d={f.d}
              fill={`url(#${UNBANDED_HATCH_PATTERN_ID})`}
              style={{ pointerEvents: 'none' }}
            >
              <title>{UNBANDED_HATCH_LABEL}</title>
            </path>
          ))}
        </g>
      )}

      {/* Under-column substrate seam strokes: the FILL is now dissolved into the
          groups above; only the seam-aware hairline-closing stroke stays
          per-quad (kept ONLY on edges NOT shared with a same-litho fill, S60
          Stage B — a same-litho seam carries no line). */}
      {underColumnFills.map((f, fi) => {
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

      {/* Per-region hit path + seam stroke. Rendered on EVERY axis: on the
          geotech axis ``bodies`` is empty, so ``interactive`` is false and only
          the stroke paints — the fill's hairline closure the packing bands
          need, with none of the body gestures the axis does not have. */}
      {screenRegions.map((sr, i) => {
        const color = formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR
        const d = `${sr.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`
        const body = sr.region.bodyId ? bodyById.get(sr.region.bodyId) : undefined
        const interactive = Boolean(onBodyContextMenu && body) && !viewOnly
        // R2 / S7b (2026-08-27): a fill region answers right-click with
        // "Unit statistics…" for its unit — on the geotech axis for every
        // region (the axis stays view-only for every edit; this navigates),
        // on the litho axis only where the body menu does not already claim
        // the region (a body's menu carries its own statistics item). Gated
        // on the axis's handler so an unwired axis is byte-identical.
        const statsInteractive = unitStatsHandlerForAxis !== undefined && !interactive
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
              style={
                interactive || statsInteractive
                  ? { pointerEvents: interactivePtr, cursor: 'context-menu' }
                  : { pointerEvents: 'none' }
              }
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
                  : statsInteractive
                    ? (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setUnitStatsMenu({
                          clientX: e.clientX,
                          clientY: e.clientY,
                          formationId: sr.region.formationId,
                        })
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

      {/* LITHO OUTLINES (geotech axis, owner ruling 2026-08-13): "litho
          boundaries persist". Drawn AFTER every fill + seam stroke so the
          dark line sits on top of the packing bands, and before the
          labels/handles so it never covers a control. Soil-level dissolve
          (owner 2026-08-18): only edges where the soil changes draw — a
          same-soil internal seam or a lens inside its own soil is machine
          partition anatomy, not a lithology boundary. */}
      {lithoFrame && lithoFrameScreen.outlines.length > 0 && (
        <g data-testid="partition-litho-outline-layer">
          {lithoFrameScreen.outlines.map((p) => (
            <path
              key={p.key}
              data-testid="partition-litho-outline"
              d={p.d}
              fill="none"
              stroke="#0d1117"
              strokeOpacity={0.85}
              strokeWidth={0.8}
              style={{ pointerEvents: 'none' }}
            />
          ))}
        </g>
      )}

      {/* Per-body labels stay LITHO-side: on the geotech axis the class labels
          live on the column strips (the owner-accepted render), so a second set
          over the fill would double them. */}
      {!viewOnly && labels.map((l) => (
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
      {!viewOnly && sharedBoundaries.map((sb) => {
        // The add-strip (grab box) rides the base-contact POLYLINE — following the
        // fill's visible lower boundary, bends included — so the 14px hit tolerance is
        // centred on the marker, not on a straight chord that drifts above a bend
        // (owner S104 "the grab box seems to be ABOVE the marker").
        const addStripPoints = sb.naturalEdge.map((p) => `${p.x},${p.y}`).join(' ')
        return (
          // Key by per-gap-unique region indices, NOT the body-pair: the same
          // (upper, lower) body-pair boundary recurs in every gap the bodies
          // span, so a `${upper}-${lower}` key collides across gaps (debt #2).
          <g key={`pf-bnd-${sb.upperIdx}-${sb.lowerIdx}`}>
            {/* Add-strip: transparent polyline along the boundary contact.
                Hover shows a preview dot ON the nearest litho edge — hidden in the
                open interior (S99 edge-only; owner directive 2026-06-05 declutter). */}
            <polyline
              data-testid={`partition-boundary-addstrip-${sb.upperBodyId}-${sb.lowerBodyId}`}
              points={addStripPoints}
              fill="none"
              stroke="transparent"
              strokeWidth={ADDSTRIP_HIT_W}
              style={{ pointerEvents: interactivePtr, cursor: 'copy' }}
              onMouseMove={(e) => {
                // EDGE-ONLY preview (S99): drive the dot from the SAME nearest-edge-
                // within-tolerance test as the grab, so it rides the litho line and
                // hides in the interior — telegraphing exactly where a click grabs.
                const { x, y } = svgCoordsFromEvent(e)
                previewAddNode(x, y)
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              // S86 PRESS-TO-GRAB: mousedown (not click) so the add-strip press CREATES
              // and GRABS the node in one gesture (``routeAddStripClick`` now starts an
              // ``isNew`` drag rather than persisting). ``preventDefault`` + ``stopPropagation``
              // keep the press off the pan handler, exactly as the existing handle onMouseDown does.
              onMouseDown={(e) => {
                // LEFT-BUTTON-ONLY (S98): the add-strip press CREATES + grabs a node. Gating to
                // ``button === 0`` stops a RIGHT-click from spawning a marker (the owner's bug —
                // the add-strip fired for any button). Right-click routes to onContextMenu-remove.
                if (e.button !== 0) return
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
                    // LEFT-BUTTON-ONLY (S98): grab only on the left button; a right-click on the
                    // handle removes via onContextMenu, it must not also start a drag.
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    setBoundaryDrag({
                      upperBodyId: sb.upperBodyId,
                      lowerBodyId: sb.lowerBodyId,
                      gapIndex: sb.gapIndex,
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
                  // RED while THIS EXACT contact node's drag is refused (owner S80; §87 exact identity);
                  // a sibling contact node or lens handle of the same body stays sky-blue.
                  fill={handleColorForTarget(
                    { kind: 'boundary', upperBodyId: sb.upperBodyId, lowerBodyId: sb.lowerBodyId, gapIndex: sb.gapIndex, nodeIndex },
                    rejectedDragTarget,
                    BOUNDARY_COLOR,
                  )}
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
      {!viewOnly && screenLenses.map((sl) => {
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
                // UNIFIED HANDLE (S98): the preview dot on a lens edge is the SAME teal
                // as a contact edge. EDGE-ONLY (S99): drive it from the nearest-edge-
                // within-tolerance test so it rides the line and hides in the interior.
                const { x, y } = svgCoordsFromEvent(e)
                previewAddNode(x, y)
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              // S86 PRESS-TO-GRAB: mousedown (not click) so the add-strip press CREATES
              // and GRABS the node in one gesture (``routeAddStripClick`` now starts an
              // ``isNew`` drag rather than persisting). ``preventDefault`` + ``stopPropagation``
              // keep the press off the pan handler, exactly as the existing handle onMouseDown does.
              onMouseDown={(e) => {
                // LEFT-BUTTON-ONLY (S98): the add-strip press CREATES + grabs a node. Gating to
                // ``button === 0`` stops a RIGHT-click from spawning a marker (the owner's bug —
                // the add-strip fired for any button). Right-click routes to onContextMenu-remove.
                if (e.button !== 0) return
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
            {/* Lower-edge add-strip. Hover shows a preview dot ON the nearest edge. */}
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
                // UNIFIED HANDLE (S98): the preview dot on a lens edge is the SAME teal
                // as a contact edge. EDGE-ONLY (S99): drive it from the nearest-edge-
                // within-tolerance test so it rides the line and hides in the interior.
                const { x, y } = svgCoordsFromEvent(e)
                previewAddNode(x, y)
              }}
              onMouseLeave={() => setAddNodePreview(null)}
              // S86 PRESS-TO-GRAB: mousedown (not click) so the add-strip press CREATES
              // and GRABS the node in one gesture (``routeAddStripClick`` now starts an
              // ``isNew`` drag rather than persisting). ``preventDefault`` + ``stopPropagation``
              // keep the press off the pan handler, exactly as the existing handle onMouseDown does.
              onMouseDown={(e) => {
                // LEFT-BUTTON-ONLY (S98): the add-strip press CREATES + grabs a node. Gating to
                // ``button === 0`` stops a RIGHT-click from spawning a marker (the owner's bug —
                // the add-strip fired for any button). Right-click routes to onContextMenu-remove.
                if (e.button !== 0) return
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
                    // LEFT-BUTTON-ONLY (S98): grab only on the left button; a right-click on the
                    // handle removes via onContextMenu, it must not also start a drag.
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    setLensDrag({
                      bodyId: sl.bodyId,
                      regionIdx: sl.regionIdx,
                      gapIndex: sl.gapIndex,
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
                  // RED while THIS EXACT lens node's drag is refused (owner S80; §87 exact identity);
                  // the body's OTHER edge / other-gap tip / boundary handle stays amber.
                  fill={handleColorForTarget(
                    { kind: 'lens', bodyId: sl.bodyId, gapIndex: sl.gapIndex, edge: 'upper', nodeIndex },
                    rejectedDragTarget,
                    // UNIFIED HANDLE (S98): a lens edge is the SAME litho-transition line as a
                    // contact — one teal handle colour, not the retired amber. The rejected-drag
                    // frame still reddens via ``handleColorForTarget``.
                    BOUNDARY_COLOR,
                  )}
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
                    // LEFT-BUTTON-ONLY (S98): grab only on the left button; a right-click on the
                    // handle removes via onContextMenu, it must not also start a drag.
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    setLensDrag({
                      bodyId: sl.bodyId,
                      regionIdx: sl.regionIdx,
                      gapIndex: sl.gapIndex,
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
                  // RED while THIS EXACT lens node's drag is refused (owner S80; §87 exact identity);
                  // the body's OTHER edge / other-gap tip / boundary handle stays amber.
                  fill={handleColorForTarget(
                    { kind: 'lens', bodyId: sl.bodyId, gapIndex: sl.gapIndex, edge: 'lower', nodeIndex },
                    rejectedDragTarget,
                    // UNIFIED HANDLE (S98): one teal colour for the lens edge, see the upper edge.
                    BOUNDARY_COLOR,
                  )}
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

      {/* REVIEW-FLAG markers (owner 2026-07-26; design §10): amber "correlate me?" markers over the
          uncorrelated same-litho neighbours the safe-default repair re-emitted. Litho axis only
          (gated in ``reviewFlagMarkers``); "Correlate" reuses the drag-correlate persist path, "Keep
          separate" dismisses via ``onDismissReviewFlag`` (persisted in the bundle). Mounts only when
          the dismiss handler is wired (read-only otherwise). */}
      {onDismissReviewFlag && (
        <ReviewFlagLayer
          markers={reviewFlagMarkers}
          onCorrelate={(a, b) => onCorrelateReviewFlag?.(a, b)}
          onDismiss={onDismissReviewFlag}
          interactivePtr={interactivePtr}
        />
      )}

      {/* R2 / S7b — the fill-region statistics menu, shared with the model
          fill (``UnitStatisticsPortalMenu``): portalled to document.body so
          it sits above all section chrome; ONE item, the shared statistics
          jump, through the ACTIVE axis's handler. */}
      <UnitStatisticsPortalMenu
        menu={unitStatsMenu}
        onShow={unitStatsHandlerForAxis}
        onClose={() => setUnitStatsMenu(null)}
        menuTestid="partition-region-menu"
        itemTestid="partition-region-menu-unit-statistics"
      />
    </g>
  )
}
