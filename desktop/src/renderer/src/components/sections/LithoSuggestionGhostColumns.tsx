/**
 * Interactive "ghost" column overlay showing lithostratigraphic layer
 * suggestions from the Robertson-2015/borehole segmenter for one
 * investigation at a time.  Each suggested layer renders as a coloured,
 * semi-transparent rectangle beside the investigation's data band.
 *
 * Per-layer interaction: clicking a layer toggles accept/reject.  The
 * caller owns the Set state (``acceptedIndices`` / ``rejectedIndices``)
 * and the ``onAccept`` / ``onReject`` callbacks so the state machine
 * lives in the hook, not here.  The component is a pure SVG renderer.
 *
 * Visual identity mirrors the VirtueleBoringGhostColumns opacity so the
 * two overlays are visually consistent when both are active.
 *
 * Layout: to the **left** of the investigation band (opposite side from
 * the VirtueleBoringGhostColumns which are on the right) to avoid
 * collision with existing overlays.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { GeologicalFormationResponse, LithoLayerSuggestion } from '../../api/client'
import { useClickDebounce } from '../../hooks/useClickDebounce'
import { formatLithoDisplayName } from '../../utils/lithoLabels'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import CopyCompositionConfirmDialog from './CopyCompositionConfirmDialog'
import MergeConfirmDialog from './MergeConfirmDialog'
import type { PlacedColumn } from './utils'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
} from '../../utils/lithoConstants'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Width of the suggestion ghost column in pixels. */
/**
 * Width retained for backwards-compat with external imports (none in
 * the current tree). The ghost column now uses ``bandHalfWidth * 2``
 * to match the focused investigation's data band; this constant is
 * the historical default that was used before the overlay change.
 */
export const LITHO_GHOST_COLUMN_WIDTH_PX = 48
/** Gap between the data band and the ghost column. */
export const LITHO_GHOST_GAP_FROM_BAND_PX = 6

const GHOST_OPACITY_DEFAULT = 0.55
const GHOST_OPACITY_ACCEPTED = 0.85
const GHOST_OPACITY_REJECTED = 0.2
const LABEL_FONT_SIZE = 9
const HEADER_FONT_SIZE = 8

function lithoFill(lithology: string): string {
  return LITHOLOGY_COLORS[lithology] ?? LITHOLOGY_FALLBACK_COLOR
}


/**
 * Find the nearest index strictly above (smaller than) ``idx`` that
 * is still a PENDING layer (not accepted, not rejected).  Used by
 * the shared-boundary drag commit + the live drag preview so that
 * rejected / accepted layers don't get treated as adjacency partners
 * — dogfeed bug 2026-05-20: rejecting a middle layer let the
 * two surrounding pending layers be dragged independently into
 * overlap because the propagation was hardwired to ``drag.idx-1``.
 *
 * Returns ``null`` when no pending layer exists above ``idx`` (the
 * dragged layer is the topmost pending one — outer edge case).
 */
function nearestPendingIndexAbove(
  idx: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (!acceptedIndices.has(i) && !rejectedIndices.has(i)) return i
  }
  return null
}

/** Mirror of ``nearestPendingIndexAbove`` for the other direction. */
function nearestPendingIndexBelow(
  idx: number,
  total: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx + 1; i < total; i++) {
    if (!acceptedIndices.has(i) && !rejectedIndices.has(i)) return i
  }
  return null
}

/**
 * Find the nearest VISIBLE neighbour (pending OR accepted) above
 * ``idx`` — only REJECTED layers are skipped. Used by the drag CLAMP
 * (debt #83 v1.1, dogfeed 2026-05-20 correction): the dragged edge
 * physically stops at the next visible layer's near edge. Accepted
 * layers are visible barriers (their committed contact says "this
 * boundary exists, you can't pass through"); rejected layers are
 * crossed out so the drag treats them as gone.
 *
 * Differs from ``nearestPendingIndexAbove`` which is used by the
 * shared-boundary COMMIT — that one skips both accepted AND rejected
 * because accepted layers' edits must not be mutated (their depth
 * is the committed contact, not the edits map).
 */
function nearestVisibleIndexAbove(
  idx: number,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (!rejectedIndices.has(i)) return i
  }
  return null
}

/** Mirror of ``nearestVisibleIndexAbove`` for the other direction. */
function nearestVisibleIndexBelow(
  idx: number,
  total: number,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx + 1; i < total; i++) {
    if (!rejectedIndices.has(i)) return i
  }
  return null
}

/**
 * Look up the first visible neighbour in one direction and the
 * topology between it and the dragged layer. Used by the drag clamp
 * (debt #83 v1.2 — three regimes depending on what's between):
 *
 *   - PENDING immediately adjacent (no rejected between): standard
 *     resize gesture. Clamp at the neighbour's FAR edge; snap there
 *     auto-collapses the neighbour (the original #83 v1 behaviour
 *     for the typical case).
 *   - PENDING with rejected between (the dogfeed gap-fill scenario):
 *     clamp at the neighbour's NEAR edge; no auto-collapse — the
 *     drag fills the rejected gap and the next-pending stays put.
 *   - ACCEPTED (immediate or via rejected): clamp at the accepted's
 *     NEAR edge; no auto-collapse, no commit propagation past it
 *     (its committed contact is the source of truth).
 *   - No visible neighbour (outer edge): outer ground / open below.
 */
interface VisibleNeighbour {
  idx: number
  kind: 'pending' | 'accepted'
  crossedRejected: boolean
}

function findVisibleNeighbourAbove(
  idx: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): VisibleNeighbour | null {
  let crossedRejected = false
  for (let i = idx - 1; i >= 0; i--) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    return {
      idx: i,
      kind: acceptedIndices.has(i) ? 'accepted' : 'pending',
      crossedRejected,
    }
  }
  return null
}

function findVisibleNeighbourBelow(
  idx: number,
  total: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): VisibleNeighbour | null {
  let crossedRejected = false
  for (let i = idx + 1; i < total; i++) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    return {
      idx: i,
      kind: acceptedIndices.has(i) ? 'accepted' : 'pending',
      crossedRejected,
    }
  }
  return null
}

/**
 * Cascade chain — debt #83 (cascade) + #84 (merge prompt).
 *
 * Walks through consecutive pending neighbours of the same geological
 * parent (same ``parent_formation_id`` AND ``spans_boundary === false``).
 * Returns:
 *
 * * ``chain`` — the indices of pending layers that would be fully
 *   absorbed if the drag snaps at the FAR edge of the LAST chain entry.
 *   Empty when no cascade is possible:
 *
 *     - first visible above/below is accepted (barrier — no walk)
 *     - first visible is pending-via-rejected-gap (gap-fill regime —
 *       single neighbour, no cascade through it)
 *     - first visible pending has different parent / spans boundary
 *       (geological barrier — clamp at its near edge, chain empty)
 *
 * * ``barrier`` — the visible layer that stopped the cascade (the
 *   accepted/different-parent/spans_boundary one), or ``null`` when
 *   the walk reached the outer edge of the suggestion list.
 *
 * * ``crossedRejected`` — whether any rejected layers were between
 *   ``idx`` and the first chain entry. Carried through so the existing
 *   gap-fill regime (#83 v1.2) keeps its semantics.
 *
 * The dragged layer's own parent + spans_boundary drive the eligibility
 * check — every chain entry must agree.
 */
export interface CascadeResult {
  chain: number[]
  barrier: VisibleNeighbour | null
  crossedRejected: boolean
}

function _isSameParent(
  draggedLayer: LithoLayerSuggestion,
  candidate: LithoLayerSuggestion,
): boolean {
  // A suggestion that already crosses a geological boundary cannot join
  // the cascade — by definition it straddles two parents. Refuse it
  // even if its `parent_formation_id` happens to match the dragged
  // layer (the segmenter assigned the upper parent to a straddler).
  if (draggedLayer.spans_boundary || candidate.spans_boundary) return false
  return draggedLayer.parent_formation_id === candidate.parent_formation_id
}

function findCascadeChainAbove(
  idx: number,
  suggestions: readonly LithoLayerSuggestion[],
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): CascadeResult {
  const dragged = suggestions[idx]
  const chain: number[] = []
  let crossedRejected = false
  let firstHit = true
  for (let i = idx - 1; i >= 0; i--) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    if (acceptedIndices.has(i)) {
      return { chain, barrier: { idx: i, kind: 'accepted', crossedRejected }, crossedRejected }
    }
    // Pending: gap-fill rule (crossedRejected on the FIRST hit) wins —
    // no cascade, single neighbour as barrier with its NEAR edge as the
    // clamp.
    if (firstHit && crossedRejected) {
      return { chain, barrier: { idx: i, kind: 'pending', crossedRejected }, crossedRejected }
    }
    // Geological barrier: different parent OR spans_boundary on either
    // side — clamp at this layer's near edge, no cascade.
    if (!_isSameParent(dragged, suggestions[i])) {
      return { chain, barrier: { idx: i, kind: 'pending', crossedRejected }, crossedRejected }
    }
    chain.push(i)
    firstHit = false
  }
  return { chain, barrier: null, crossedRejected }
}

function findCascadeChainBelow(
  idx: number,
  suggestions: readonly LithoLayerSuggestion[],
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): CascadeResult {
  const dragged = suggestions[idx]
  const chain: number[] = []
  let crossedRejected = false
  let firstHit = true
  for (let i = idx + 1; i < suggestions.length; i++) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    if (acceptedIndices.has(i)) {
      return { chain, barrier: { idx: i, kind: 'accepted', crossedRejected }, crossedRejected }
    }
    if (firstHit && crossedRejected) {
      return { chain, barrier: { idx: i, kind: 'pending', crossedRejected }, crossedRejected }
    }
    if (!_isSameParent(dragged, suggestions[i])) {
      return { chain, barrier: { idx: i, kind: 'pending', crossedRejected }, crossedRejected }
    }
    chain.push(i)
    firstHit = false
  }
  return { chain, barrier: null, crossedRejected }
}

/**
 * Resolve the effective top/base of a suggestion — committed edits
 * win over the raw segmenter output. Used to compute drag bounds
 * from the live state of the neighbouring layers (debt #83 v1).
 */
function effectiveDepths(
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  idx: number,
): { topM: number; baseM: number } {
  const raw = suggestions[idx]
  const committed = edits?.get(idx)
  return {
    topM: committed?.depth_top_m ?? raw.depth_top_m,
    baseM: committed?.depth_base_m ?? raw.depth_base_m,
  }
}

/**
 * Compute the hard-clamp bounds + collapse targets for a drag at
 * mousedown. The dragged edge cannot cross either bound; if the
 * user releases at one of them and the matching ``collapseIdx*`` is
 * non-null, that layer is auto-rejected on mouseup (only fires for
 * the own-opposite-edge snap — the #81 self-collapse).
 *
 * Two distinct topology rules apply (dogfeed 2026-05-20 correction
 * to the original #83 v1):
 *
 *   - **CLAMP toward a NEIGHBOUR** uses ``nearestVisibleIndex*``
 *     (skips only rejected; accepted is a visible barrier) and stops
 *     at the neighbour's NEAR edge — the immediate shared boundary
 *     with the dragged layer. The drag cannot pass through any
 *     visible layer. ``collapseIdx*`` is ``null`` for this side, so
 *     mouseup never auto-rejects the neighbour. To extend through a
 *     visible neighbour, the user must reject it first; this is the
 *     explicit workflow the owner asked for ("if i reject silt
 *     between two clay layers, drag down the top clay's base to the
 *     bottom clay's top — no drag-overs").
 *
 *   - **CLAMP toward OWN OPPOSITE EDGE** keeps the #81 self-collapse:
 *     dragging own top to own base (or own base to own top) snaps
 *     and auto-rejects the dragged layer on release. ``collapseIdx*``
 *     equals ``idx`` for that side.
 *
 * For a TOP-edge drag of layer ``idx``:
 *   - boundsAboveM = nearest-visible-above's BASE (the shared
 *     boundary), or 0 = ground when no neighbour. No auto-collapse.
 *   - boundsBelowM = own BASE (#81). Auto-collapse self on snap.
 *
 * For a BASE-edge drag of layer ``idx``:
 *   - boundsAboveM = own TOP (#81). Auto-collapse self on snap.
 *   - boundsBelowM = nearest-visible-below's TOP (the shared
 *     boundary), or +Infinity = open below. No auto-collapse.
 *
 * Rejected neighbours are skipped (the user has marked them gone);
 * accepted neighbours form barriers (their committed contact says
 * "this boundary is real"). Two adjacent PENDING layers also barrier
 * each other (their shared boundary is the current depth → drag is
 * effectively a no-op until one is rejected).
 */
export interface DragBoundsResult {
  boundsAboveM: number
  boundsBelowM: number
  /**
   * Pending-layer indices fully absorbed when the drag snaps at
   * ``boundsAboveM``. The dragged layer itself (``idx``) appears here
   * for the #81 self-collapse path (snap to own opposite edge). Cascade
   * neighbours appear in walk order (closest-first). Empty = no
   * collapse target on this side.
   */
  collapseChainAbove: number[]
  /** Mirror of ``collapseChainAbove`` for the BELOW direction. */
  collapseChainBelow: number[]
}

export function computeDragBounds(
  edge: 'top' | 'base',
  idx: number,
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): DragBoundsResult {
  const own = effectiveDepths(suggestions, edits, idx)
  if (edge === 'top') {
    const cascade = findCascadeChainAbove(idx, suggestions, acceptedIndices, rejectedIndices)
    let boundsAboveM = 0
    let collapseChainAbove: number[] = []
    if (cascade.chain.length > 0) {
      // Standard resize / cascade: clamp at the FAR edge of the LAST
      // chain entry (the one furthest from the dragged layer). Snap
      // there absorbs every chain entry.
      const farthest = cascade.chain[cascade.chain.length - 1]
      boundsAboveM = effectiveDepths(suggestions, edits, farthest).topM
      collapseChainAbove = cascade.chain
    } else if (cascade.barrier !== null) {
      // No cascade — barrier blocked the walk. Clamp at the barrier's
      // NEAR edge (its BASE for an above-walk) with no auto-collapse.
      // Covers: accepted barrier, gap-fill via rejected, geological
      // boundary (different parent OR spans_boundary).
      boundsAboveM = effectiveDepths(suggestions, edits, cascade.barrier.idx).baseM
    }
    return {
      boundsAboveM,
      boundsBelowM: own.baseM,
      collapseChainAbove,
      collapseChainBelow: [idx],
    }
  }
  // edge === 'base'
  const cascade = findCascadeChainBelow(idx, suggestions, acceptedIndices, rejectedIndices)
  let boundsBelowM = Number.POSITIVE_INFINITY
  let collapseChainBelow: number[] = []
  if (cascade.chain.length > 0) {
    const farthest = cascade.chain[cascade.chain.length - 1]
    boundsBelowM = effectiveDepths(suggestions, edits, farthest).baseM
    collapseChainBelow = cascade.chain
  } else if (cascade.barrier !== null) {
    boundsBelowM = effectiveDepths(suggestions, edits, cascade.barrier.idx).topM
  }
  return {
    boundsAboveM: own.topM,
    boundsBelowM,
    collapseChainAbove: [idx],
    collapseChainBelow,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LithoSuggestionGhostColumnsProps {
  /**
   * All placed columns in the section — used to find the column for
   * ``investigationId``.  No-op when the investigation is not in the list.
   */
  columns: readonly PlacedColumn[]
  /** Id of the CPT or borehole whose suggestions are shown. */
  investigationId: string
  /** Suggestions ordered top to bottom from the segmenter. */
  suggestions: readonly LithoLayerSuggestion[]
  /** mTAW elevation → screen Y. */
  levelToScreen: (level: number) => number
  /** mTAW surface elevation for the investigation (used to convert depth). */
  surfaceElevationM: number | null
  /** Visible plot Y bounds — layers outside are clipped. */
  plotTop: number
  plotBottom: number
  /** Half-width of each investigation's data band (the band this column flanks). */
  bandHalfWidth: number
  /** Layer indices the user has accepted (contact was created). */
  acceptedIndices: ReadonlySet<number>
  /** Layer indices the user has rejected (explicitly dismissed). */
  rejectedIndices: ReadonlySet<number>
  /** Fire when the user clicks an unaccepted, unrejected layer. */
  onAccept: (idx: number) => void
  /** Fire when the user right-clicks or shift-clicks to reject a layer. */
  onReject: (idx: number) => void
  /**
   * Fire when the user clicks the ↻ undo icon on a rejected layer to
   * restore it to pending (debt #80). Optional — when absent, the icon
   * is not rendered (zero regression for callers that haven't opted in).
   */
  onUnreject?: (idx: number) => void
  /**
   * Formations in the active litho model — used to resolve the parent
   * formation name from ``suggestion.parent_formation_id`` for the tooltip.
   * Optional: tooltip shows the raw id when absent.
   */
  formations?: readonly GeologicalFormationResponse[]
  /**
   * Phase-2 drag-resize edits. Map from suggestion index to the
   * user's depth overrides on its top / base edges. When present,
   * the rect renders at the edited depth so the user sees their
   * drag live. Independent edges: dragging only one edge composes
   * with a previously-dragged other edge.
   */
  edits?: ReadonlyMap<number, {
    depth_top_m?: number
    depth_base_m?: number
    suggested_lithology?: string
    suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
  }>
  /**
   * Commit a drag-resize edit. The parent state owner merges it into
   * the edits Map; the next render reflects the new depth. Called
   * exactly once per mouseup (the live drag preview stays local to
   * this component until commit).
   */
  onEdit?: (idx: number, edit: {
    depth_top_m?: number
    depth_base_m?: number
    suggested_lithology?: string
    suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
  }) => void
  /**
   * Debt #86: copy composition to a different anchor (cross-column
   * Alt-drag drop).  Same-column drops use ``onEdit`` directly; this
   * callback is only fired when the drop target's anchor differs from
   * this component's ``investigationId``.  The owner of the bulk-ghost
   * Map (``useGeologicalModel.handleEditBulkLitho``) routes the edit
   * to the right anchor.  Optional — when absent, cross-column drops
   * are a no-op (zero regression for callers that haven't opted in).
   */
  onCrossColumnPaste?: (
    targetAnchorId: string,
    targetIdx: number,
    edit: {
      suggested_lithology: string
      suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
    },
  ) => void
}

/**
 * SVG overlay of lithostratigraphic suggestions for one investigation.
 *
 * Parameters
 * ----------
 * columns
 *     All placed columns — finds the column for ``investigationId``.
 * investigationId
 *     The CPT/borehole whose suggestions are displayed.
 * suggestions
 *     Layer list from the segmenter, ordered top→bottom.
 * levelToScreen
 *     Maps mTAW elevation → SVG Y coordinate.
 * surfaceElevationM
 *     Investigation surface elevation in mTAW (used to convert depth_top_m
 *     to absolute mTAW: ``elevation - depth``).  When null, rendering is
 *     skipped (no elevation → cannot place layers on the level axis).
 * plotTop / plotBottom
 *     SVG Y bounds for clipping.
 * bandHalfWidth
 *     Half-width of the data band; the ghost column is placed to its left.
 * acceptedIndices
 *     Layer indices already accepted (contact created).
 * rejectedIndices
 *     Layer indices explicitly rejected.
 * onAccept
 *     Callback when the user left-clicks a pending layer.
 * onReject
 *     Callback when the user right-clicks or Shift-clicks a pending layer.
 * formations
 *     Active model's formation list for parent-formation name lookup.
 *     Optional — tooltip shows the raw id when absent.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     SVG group with the ghost column, or null when no column is found
 *     or no suggestions exist.
 */
export default function LithoSuggestionGhostColumns({
  columns,
  investigationId,
  suggestions,
  levelToScreen,
  surfaceElevationM,
  plotTop,
  plotBottom,
  bandHalfWidth,
  acceptedIndices,
  rejectedIndices,
  onAccept,
  onReject,
  onUnreject,
  formations = [],
  edits,
  onEdit,
  onCrossColumnPaste,
}: LithoSuggestionGhostColumnsProps): JSX.Element | null {
  // Live drag preview state. Set on mousedown on an edge handle;
  // updated on document mousemove; cleared on mouseup which fires
  // ``onEdit`` once with the final depth. Pre-commit edit lives only
  // in this local state — committed edits are echoed back via the
  // ``edits`` prop on the next render.
  //
  // Hooks live ABOVE all early returns (suggestions.length === 0 /
  // !surfaceElevationM / !col) so the hook count is invariant —
  // CLAUDE.md "Temporal Dead Zone after reordering React component
  // bodies" / Rules of Hooks. The drag state is cheap (one ref +
  // one effect) so paying it on every render is free.
  const [drag, setDrag] = useState<{
    idx: number
    edge: 'top' | 'base'
    initialClientY: number
    initialDepthM: number
    currentDepthM: number
    /**
     * Hard clamp on the shallow side (smaller depth). The dragged
     * edge cannot cross this — captures collision with the next
     * pending neighbour above (its top) OR with own opposite edge
     * for a base-drag. ``0`` when the dragged edge is the outermost
     * top with no pending layer above (= ground surface).
     *
     * Snap-to-collide UX (dogfeed 2026-05-20): the drag stops at
     * a colliding boundary; if the user releases at that snap, the
     * shared-boundary commit + auto-reject collapse one layer
     * (own or the neighbour, depending which bound was hit).
     */
    boundsAboveM: number
    /**
     * Hard clamp on the deep side. Mirrors ``boundsAboveM`` for the
     * other direction — own opposite edge for a top-drag, or the
     * next pending neighbour below's base for a base-drag. Capped
     * by the plot bottom (no infinite drag past the last layer).
     */
    boundsBelowM: number
    /**
     * Indices of pending layers absorbed when the drag snaps at
     * ``boundsAboveM``. Single-element ``[idx]`` for the #81
     * self-collapse path (snap to own opposite edge); multi-element
     * for a cascade through same-parent neighbours (debt #83); empty
     * when no collapse target on this side (ground surface, accepted
     * barrier, geological boundary).
     */
    collapseChainAbove: number[]
    /** Mirror of ``collapseChainAbove`` for ``boundsBelowM``. */
    collapseChainBelow: number[]
    /**
     * Whether the current drag position is snapped to either bound.
     * Drives the visible snap indicator + the on-mouseup auto-reject /
     * merge-confirm prompt.
     */
    snapped: boolean
    /**
     * Depth the current snap is bound to — equals ``boundsAboveM``
     * when snapped at the shallow side, ``boundsBelowM`` when at the
     * deep side, ``null`` when not snapped. Used by the indicator
     * to render the amber dashed line at the correct depth.
     */
    snapTargetM: number | null
    /**
     * Chain of layers to auto-reject on mouseup when ``snapped`` is
     * true. The dialog (debt #84) only opens when this chain contains
     * a NEIGHBOUR (#83 cascade or #83 v1 single-neighbour); the #81
     * self-collapse path (chain == [own idx]) skips the dialog and
     * auto-rejects directly — that gesture is the user's explicit
     * "fold this layer into its opposite edge" intent and asking is
     * friction.
     */
    collapseChainOnRelease: number[]
  } | null>(null)

  // Debt #83 cascade + #84 merge prompt. When mouseup snaps with a
  // non-self collapse chain, defer the commit and open a confirm
  // dialog. ``pendingCommit`` carries the would-be edit + the chain
  // so Confirm can fire onEdit + onReject(...), and Cancel can drop
  // the whole gesture without touching anything.
  const [pendingCommit, setPendingCommit] = useState<{
    idx: number
    edge: 'top' | 'base'
    finalDepthM: number
    chain: number[]
    propagateIdx: number | null
  } | null>(null)

  // Composition editor (debt #72). Tracks which suggestion index is
  // open for edit; null when closed. Lives in this parent component
  // so it can survive across LithoSuggestionLayer remounts and so
  // the Save handler can call onEdit at the same level the click
  // handlers are wired.
  const [editIdx, setEditIdx] = useState<number | null>(null)

  // Debt #86: Alt-drag copy-composition gesture. Carries the source
  // layer's composition + the cursor's current screen position so a
  // floating chip can be rendered as a drag preview. Cleared on
  // mouseup (whether the drop succeeds or not). null = no copy-drag
  // in progress.
  const [copyDrag, setCopyDrag] = useState<{
    sourceIdx: number
    clientX: number
    clientY: number
    /** Resolved target on mousemove via document.elementsFromPoint —
     *  drives the amber outline on the hovered drop target. */
    hoverTarget: { anchorId: string; idx: number } | null
  } | null>(null)
  // Suppress the click event that fires after a copy-drag mouseup —
  // the body rect's onClick would otherwise fire onAccept. Reset on
  // the next mousedown.
  const copyDragJustEndedRef = useRef(false)

  // Pending overwrite confirmation when the copy-drag drop lands on a
  // target that already has an edit (debt #86 owner directive: Confirm
  // on overwrite). null = dialog closed.
  const [pendingCopy, setPendingCopy] = useState<{
    sourceLayer: LithoLayerSuggestion
    targetAnchorId: string
    targetIdx: number
    /** Pre-resolved target label (so the dialog can name it without
     *  re-routing through the cross-anchor formations list). */
    targetLabel: string
  } | null>(null)

  // Per-layer context menu (dogfeed 2026-05-20). Right-click on a
  // pending layer opens a small floating menu with [Edit composition,
  // Reject layer]. Replaces the prior direct-right-click-rejects
  // gesture, which surprised users who expected a menu.
  const [contextMenu, setContextMenu] = useState<
    { idx: number; x: number; y: number } | null
  >(null)

  // Dismiss the context menu on Esc / outside click. document-level
  // listeners attached only while the menu is open.
  useEffect(() => {
    if (!contextMenu) return
    function handleClickAway(): void {
      setContextMenu(null)
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setContextMenu(null)
    }
    // mousedown not click — closes the menu BEFORE the click that
    // opened the next thing (e.g. another right-click reopens
    // immediately without flashing).
    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // pxPerM derived from levelToScreen (a linear transform — sample
  // two points). Guards against zero when the section is too narrow
  // to render the band. Lifted before the early returns so the ref
  // stays stable; the inner JSX guards on surfaceElevationM anyway.
  const surfaceY = surfaceElevationM != null ? levelToScreen(surfaceElevationM) : 0
  const pxPerM =
    surfaceElevationM != null
      ? levelToScreen(surfaceElevationM - 1) - surfaceY
      : 0

  // Document-level mousemove + mouseup while a drag is active. The
  // hit-zones are SVG rects but the mouse can leave them during a
  // drag; attaching to document keeps the gesture coherent. Final
  // depth fires through ``onEdit`` exactly once on mouseup.
  useEffect(() => {
    if (!drag) return
    // Snap threshold in metres — 4 screen-px translated to depth via
    // pxPerM. Wide enough to be discoverable, tight enough that small
    // resize moves near the opposite edge don't auto-collapse.
    const SNAP_PX = 4
    const snapThresholdM = pxPerM > 0 ? SNAP_PX / pxPerM : 0
    function handleMove(e: MouseEvent): void {
      if (!drag) return
      const pixelDelta = e.clientY - drag.initialClientY
      const depthDelta = pxPerM !== 0 ? pixelDelta / pxPerM : 0
      // Cursor-derived depth, clamped to non-negative (top can't sit
      // above ground; base can't either).
      const raw = Math.max(0, drag.initialDepthM + depthDelta)
      // Hard-clamp to the bounds set at mousedown — the dragged edge
      // physically cannot cross any other layer's boundary (debt #83
      // v1 / dogfeed 2026-05-20: "if it collides it should just snap
      // and attach to the boundary it collides with"). The clamp +
      // snap together produce a satisfying "stick" against any wall.
      const clamped = Math.max(
        drag.boundsAboveM,
        Math.min(drag.boundsBelowM, raw),
      )
      // Snap-to-collide: when the clamped depth lands within the
      // pixel threshold of either bound, the gesture is "snapped".
      // Snap-to-own-opposite (#81) and snap-to-neighbour-far-edge
      // (#83 v1) go through the same code path — the only difference
      // is which idx gets auto-rejected on mouseup.
      const snappedAtAbove =
        snapThresholdM > 0 &&
        drag.collapseChainAbove.length > 0 &&
        Math.abs(clamped - drag.boundsAboveM) <= snapThresholdM
      const snappedAtBelow =
        snapThresholdM > 0 &&
        drag.collapseChainBelow.length > 0 &&
        Math.abs(clamped - drag.boundsBelowM) <= snapThresholdM
      // If both bounds are within threshold simultaneously (a layer
      // narrower than 2 * snapThresholdM), prefer the one closer to
      // the cursor — keeps the snap intuitive when the layer is thin.
      let snapTargetM: number | null = null
      let collapseChainOnRelease: number[] = []
      if (snappedAtAbove && snappedAtBelow) {
        const aboveDist = Math.abs(clamped - drag.boundsAboveM)
        const belowDist = Math.abs(clamped - drag.boundsBelowM)
        if (aboveDist <= belowDist) {
          snapTargetM = drag.boundsAboveM
          collapseChainOnRelease = drag.collapseChainAbove
        } else {
          snapTargetM = drag.boundsBelowM
          collapseChainOnRelease = drag.collapseChainBelow
        }
      } else if (snappedAtAbove) {
        snapTargetM = drag.boundsAboveM
        collapseChainOnRelease = drag.collapseChainAbove
      } else if (snappedAtBelow) {
        snapTargetM = drag.boundsBelowM
        collapseChainOnRelease = drag.collapseChainBelow
      }
      const next = snapTargetM !== null ? snapTargetM : clamped
      setDrag(d =>
        d !== null
          ? {
              ...d,
              currentDepthM: next,
              snapped: snapTargetM !== null,
              snapTargetM,
              collapseChainOnRelease,
            }
          : null,
      )
    }
    function handleUp(): void {
      if (!drag) return
      const final = drag.currentDepthM
      // Cascade gate (debt #83 + #84). When the snap chain contains
      // any NEIGHBOUR (chain != [drag.idx]), defer everything to the
      // MergeConfirmDialog: no onEdit, no onReject. The dialog's
      // Confirm/Cancel decides whether to commit. The #81 self-collapse
      // path (chain == [drag.idx]) skips the dialog — that's the user's
      // explicit "fold this layer" intent and asking is friction.
      const chain = drag.snapped ? drag.collapseChainOnRelease : []
      const isSelfCollapseOnly = chain.length === 1 && chain[0] === drag.idx
      if (chain.length > 0 && !isSelfCollapseOnly) {
        // Defer — open dialog. The visible-neighbour propagation idx
        // is resolved now (before clearing the drag state) so Confirm
        // can fire it without recomputing.
        const propagateIdx =
          drag.edge === 'top'
            ? nearestVisibleIndexAbove(drag.idx, rejectedIndices)
            : nearestVisibleIndexBelow(drag.idx, suggestions.length, rejectedIndices)
        setPendingCommit({
          idx: drag.idx,
          edge: drag.edge,
          finalDepthM: final,
          chain,
          propagateIdx:
            propagateIdx !== null && !acceptedIndices.has(propagateIdx) ? propagateIdx : null,
        })
        setDrag(null)
        return
      }
      // Normal commit path — no neighbour cascade. Either no snap, or
      // a self-collapse-only snap (#81).
      //
      // Shared-boundary commit (owner directive 2026-05-20 reversal of
      // the earlier "independent edges" design). A boundary BETWEEN
      // two adjacent layers is one boundary, not two — moving it slides
      // both the layer above's base AND the layer below's top to the
      // same depth.
      //
      // Adjacency skips REJECTED and ACCEPTED layers (dogfeed bug
      // 2026-05-20): rejected layers are hidden so propagating to them
      // doesn't move what the user sees, leaving A.base and C.top out
      // of sync across the gap; accepted layers' depths are committed
      // contacts and mutating their stored top/base via the edits map
      // visually distorts the green-tick ghost rect without changing
      // the actual contact in the DB.
      if (drag.edge === 'top') {
        if (onEdit) onEdit(drag.idx, { depth_top_m: final })
        const visible = nearestVisibleIndexAbove(drag.idx, rejectedIndices)
        if (visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_base_m: final })
        }
      } else {
        if (onEdit) onEdit(drag.idx, { depth_base_m: final })
        const visible = nearestVisibleIndexBelow(drag.idx, suggestions.length, rejectedIndices)
        if (visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_top_m: final })
        }
      }
      // #81 self-collapse auto-reject.
      if (isSelfCollapseOnly) onReject(drag.idx)
      setDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [drag, pxPerM, onEdit, onReject, suggestions.length, acceptedIndices, rejectedIndices])

  // Debt #86: document-level mousemove + mouseup while a copy-drag is
  // active. Uses ``document.elementsFromPoint`` to find a drop target
  // by its ``data-litho-anchor-id`` + ``data-litho-idx`` attributes —
  // works across sibling LithoSuggestionGhostColumns instances so the
  // gesture supports cross-investigation drops.
  useEffect(() => {
    if (copyDrag === null) return
    function resolveTarget(
      clientX: number,
      clientY: number,
    ): { anchorId: string; idx: number } | null {
      // JSDOM's elementsFromPoint may be unavailable; guard so tests
      // can render without it (and so the gesture degrades gracefully
      // if a future host lacks it).
      if (typeof document.elementsFromPoint !== 'function') return null
      const els = document.elementsFromPoint(clientX, clientY)
      for (const el of els) {
        const anchorId = el.getAttribute?.('data-litho-anchor-id')
        const idxStr = el.getAttribute?.('data-litho-idx')
        if (anchorId && idxStr !== null && idxStr !== undefined) {
          const idx = Number(idxStr)
          if (Number.isFinite(idx)) {
            // Reject self (the source layer is its own valid target
            // would be a no-op — drop on a different layer required).
            if (anchorId === investigationId && idx === copyDrag?.sourceIdx) {
              return null
            }
            return { anchorId, idx }
          }
        }
      }
      return null
    }
    function handleMove(e: MouseEvent): void {
      const target = resolveTarget(e.clientX, e.clientY)
      setCopyDrag(d =>
        d !== null
          ? { ...d, clientX: e.clientX, clientY: e.clientY, hoverTarget: target }
          : null,
      )
    }
    function handleUp(e: MouseEvent): void {
      const target = resolveTarget(e.clientX, e.clientY)
      // Mark the click event that may follow this mouseup as "from a
      // copy-drag" so the body rect's onClick (onAccept) is a no-op.
      copyDragJustEndedRef.current = true
      // Schedule reset after the click event has had a chance to fire.
      setTimeout(() => {
        copyDragJustEndedRef.current = false
      }, 0)
      if (target === null || copyDrag === null) {
        setCopyDrag(null)
        return
      }
      const sourceLayer = suggestions[copyDrag.sourceIdx]
      // Pre-resolve target's effective composition to decide whether
      // an overwrite confirm is needed. Same-anchor targets read from
      // the local edits Map + raw suggestions; cross-anchor targets
      // are conservatively treated as "no existing edit" (the bulk
      // edit map is not visible from this component instance; the
      // parent's onCrossColumnPaste owns the conflict resolution if
      // it wants to add one). Owner-pragmatic: cross-column overwrite
      // confirm is deferred — same-column is the common case where
      // the user just changed a composition and wants to paste it.
      const targetIsSameAnchor = target.anchorId === investigationId
      const targetExistingEdit = targetIsSameAnchor
        ? edits?.get(target.idx)
        : undefined
      const hasExistingComposition =
        targetExistingEdit?.suggested_lithology !== undefined ||
        (targetExistingEdit?.suggested_admixtures?.length ?? 0) > 0
      if (hasExistingComposition) {
        // Defer to the confirm dialog.
        const tgtRaw = targetIsSameAnchor ? suggestions[target.idx] : null
        const tgtEffectiveLitho =
          targetExistingEdit?.suggested_lithology ?? tgtRaw?.suggested_lithology ?? '?'
        const tgtEffectiveAdmix =
          targetExistingEdit?.suggested_admixtures ?? tgtRaw?.suggested_admixtures ?? []
        setPendingCopy({
          sourceLayer,
          targetAnchorId: target.anchorId,
          targetIdx: target.idx,
          targetLabel: formatLithoDisplayName(tgtEffectiveLitho, tgtEffectiveAdmix),
        })
        setCopyDrag(null)
        return
      }
      // Silent commit — no existing edit, no prompt.
      const edit = {
        suggested_lithology: sourceLayer.suggested_lithology,
        suggested_admixtures: sourceLayer.suggested_admixtures,
      }
      if (targetIsSameAnchor) {
        if (onEdit) onEdit(target.idx, edit)
      } else {
        if (onCrossColumnPaste) onCrossColumnPaste(target.anchorId, target.idx, edit)
      }
      setCopyDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [copyDrag, edits, investigationId, onCrossColumnPaste, onEdit, suggestions])

  if (suggestions.length === 0 || surfaceElevationM === null) return null

  const col = columns.find(c => c.proj.item.id === investigationId)
  if (!col) return null

  // Build a name-by-id map so each layer can resolve its parent formation name.
  const formationNameById = new Map(formations.map(f => [f.id, f.name]))

  // Always OVERLAY the ghost column on top of the focused
  // investigation's data band (owner directive 2026-05-20). Previously
  // the ghost was placed to the LEFT of the band with a fixed gap; at
  // dense column spacing it overlapped the neighbouring test. Overlay
  // never collides with neighbours and visually anchors the preview to
  // the test it was generated from. The qc / Ic trace shows through
  // at the ghost's 0.55 default opacity. Width matches the data band
  // (``bandHalfWidth * 2``) so the ghost spans the same area the CPT
  // plot occupies — same horizontal real estate, no neighbour overlap.
  const left = col.nudgedX - bandHalfWidth
  const ghostWidth = bandHalfWidth * 2

  // Resolve the composition seed for the editor (debt #72). Looks up
  // the current effective composition for ``editIdx`` so the editor
  // opens populated with the user's already-applied edits (drag-resize
  // doesn't touch composition, but a previous composition edit would).
  const editingLayer = editIdx !== null ? suggestions[editIdx] : null
  const editingCommitted = editIdx !== null ? edits?.get(editIdx) : undefined
  const editorOpen = editingLayer !== null

  return (
    <>
    <g data-testid="litho-suggestion-ghosts">
      {/* Column header — "Litho" label above the plot top. */}
      <text
        x={left + ghostWidth / 2}
        y={plotTop - 3}
        textAnchor="middle"
        fontSize={HEADER_FONT_SIZE}
        fill="#6b7280"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        Litho
      </text>

      {suggestions.map((rawLayer, idx) => {
        // Resolve effective depths: committed edits → live drag override.
        // Shared-boundary preview: if the user is dragging an adjacent
        // layer's matching edge, this layer's opposite edge follows
        // live so the user sees the join move together.
        const committed = edits?.get(idx)
        let topM = committed?.depth_top_m ?? rawLayer.depth_top_m
        let baseM = committed?.depth_base_m ?? rawLayer.depth_base_m
        if (drag) {
          // This layer's own edge is being dragged.
          if (drag.idx === idx) {
            if (drag.edge === 'top') topM = drag.currentDepthM
            else baseM = drag.currentDepthM
          }
          // Shared-boundary live preview: when the user is dragging
          // another layer's edge, follow it on this layer's edge IFF
          // this layer is the NEAREST PENDING neighbour in that
          // direction (skipping rejected/accepted layers). Hardwired
          // ±1 here would visually link the wrong pair of layers when
          // a rejected/accepted layer sits between, leaving gaps /
          // overlaps that contradict the commit topology (dogfeed
          // 2026-05-20 bug — drag commit fix above this).
          //
          // Only check the link when this layer is itself pending —
          // accepted/rejected layers don't render their edits as a
          // live preview either (their rect is frozen).
          if (
            !acceptedIndices.has(idx) &&
            !rejectedIndices.has(idx)
          ) {
            // Match the commit's propagation topology: nearestVisible
            // (skip only rejected), then gate-out if accepted. Preview
            // follows the drag iff this layer is the next PENDING in
            // the drag direction with no accepted barrier between.
            if (
              drag.edge === 'base' &&
              nearestVisibleIndexBelow(
                drag.idx,
                suggestions.length,
                rejectedIndices,
              ) === idx
            ) {
              topM = drag.currentDepthM
            }
            if (
              drag.edge === 'top' &&
              nearestVisibleIndexAbove(drag.idx, rejectedIndices) === idx
            ) {
              baseM = drag.currentDepthM
            }
          }
        }
        // Composition overrides from the LithoGhostCompositionEditor
        // (debt #72) — when the user edits a layer's main soil or
        // admixture list, the dialog's onSave stashes the new values
        // in the edits Map alongside any depth edits. The render must
        // read them or the dialog appears to "do nothing" (dogfeed
        // bug 2026-05-20): the layer label / fill / admixture
        // indicator would stay at the segmenter's raw value while
        // the user clearly saw their edit in the modal. Spread order
        // matters: rawLayer first, then committed-composition over
        // it, then computed depths last.
        const effective: LithoLayerSuggestion = {
          ...rawLayer,
          suggested_lithology:
            committed?.suggested_lithology ?? rawLayer.suggested_lithology,
          suggested_admixtures: (committed?.suggested_admixtures ??
            rawLayer.suggested_admixtures) as LithoLayerSuggestion['suggested_admixtures'],
          depth_top_m: topM,
          depth_base_m: baseM,
        }
        // Compute hit-zone Y positions from effective depths so the
        // handles track the drag preview live.
        const topY = Math.max(
          plotTop,
          Math.min(plotBottom, levelToScreen(surfaceElevationM - topM)),
        )
        const baseY = Math.max(
          plotTop,
          Math.min(plotBottom, levelToScreen(surfaceElevationM - baseM)),
        )
        const accepted = acceptedIndices.has(idx)
        const rejected = rejectedIndices.has(idx)
        // Drag handles only when onEdit is wired AND the layer is
        // still pending. Accepted/rejected layers are frozen.
        const dragHandlesEnabled = onEdit !== undefined && !accepted && !rejected
        return (
          <g key={`${idx}-${rawLayer.suggested_lithology}-${rawLayer.depth_top_m}`}>
            <LithoSuggestionLayer
              layer={effective}
              idx={idx}
              anchorId={investigationId}
              left={left}
              width={ghostWidth}
              surfaceElevationM={surfaceElevationM}
              levelToScreen={levelToScreen}
              plotTop={plotTop}
              plotBottom={plotBottom}
              accepted={accepted}
              rejected={rejected}
              onAccept={onAccept}
              onReject={onReject}
              onUnreject={onUnreject}
              onRequestEdit={onEdit ? setEditIdx : undefined}
              onRequestContextMenu={(layerIdx, x, y) =>
                setContextMenu({ idx: layerIdx, x, y })
              }
              onCopyMouseDown={
                onEdit !== undefined
                  ? (layerIdx, x, y) => {
                      setCopyDrag({
                        sourceIdx: layerIdx,
                        clientX: x,
                        clientY: y,
                        hoverTarget: null,
                      })
                    }
                  : undefined
              }
              isCopyHoverTarget={
                copyDrag?.hoverTarget?.anchorId === investigationId &&
                copyDrag?.hoverTarget?.idx === idx
              }
              formationNameById={formationNameById}
            />
            {dragHandlesEnabled && (
              <>
                {/* Top-edge handle — drag moves only this layer's TOP.
                    6 px tall hit zone centred on the top edge. */}
                <rect
                  x={left}
                  y={topY - 3}
                  width={ghostWidth}
                  height={6}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  data-testid={`litho-drag-top-${idx}`}
                  onMouseDown={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    const bounds = computeDragBounds(
                      'top',
                      idx,
                      suggestions,
                      edits,
                      acceptedIndices,
                      rejectedIndices,
                    )
                    setDrag({
                      idx,
                      edge: 'top',
                      initialClientY: e.clientY,
                      initialDepthM: topM,
                      currentDepthM: topM,
                      ...bounds,
                      snapped: false,
                      snapTargetM: null,
                      collapseChainOnRelease: [],
                    })
                  }}
                />
                {/* Base-edge handle — drag moves only this layer's BASE. */}
                <rect
                  x={left}
                  y={baseY - 3}
                  width={ghostWidth}
                  height={6}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  data-testid={`litho-drag-base-${idx}`}
                  onMouseDown={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    const bounds = computeDragBounds(
                      'base',
                      idx,
                      suggestions,
                      edits,
                      acceptedIndices,
                      rejectedIndices,
                    )
                    setDrag({
                      idx,
                      edge: 'base',
                      initialClientY: e.clientY,
                      initialDepthM: baseM,
                      currentDepthM: baseM,
                      ...bounds,
                      snapped: false,
                      snapTargetM: null,
                      collapseChainOnRelease: [],
                    })
                  }}
                />
              </>
            )}
          </g>
        )
      })}
      {/* Snap-to-collapse indicator (debt #81). A short amber dashed
          line at the snap target depth, drawn across the ghost column,
          plus a "merge" hint label. Visible only while the drag is
          snapped to the opposite edge; the dragged-layer rect's own
          rendering already collapses to zero height when this fires,
          so the indicator gives the user a "release to collapse" cue. */}
      {drag?.snapped && drag.snapTargetM !== null && (
        <g data-testid="litho-snap-indicator" style={{ pointerEvents: 'none' }}>
          {(() => {
            const y = Math.max(
              plotTop,
              Math.min(
                plotBottom,
                levelToScreen(surfaceElevationM - drag.snapTargetM),
              ),
            )
            return (
              <>
                <line
                  x1={left - 2}
                  y1={y}
                  x2={left + ghostWidth + 2}
                  y2={y}
                  stroke="#d97706"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                <text
                  x={left + ghostWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#d97706"
                  style={{ userSelect: 'none' }}
                >
                  release to merge
                </text>
              </>
            )
          })()}
        </g>
      )}
    </g>
    {/* Composition editor (debt #72). Lives in a sibling Modal that
        renders via createPortal, so its JSX legally co-exists with
        the SVG <g> above in the same Fragment. Closed unless the
        user dbl-clicked a pending layer. */}
    {editorOpen && editingLayer !== null && (
      <LithoGhostCompositionEditor
        open
        // Seed initial values from the COMMITTED edit first, then
        // fall back to the raw segmenter values. This way the editor
        // reopens with whatever the user previously saved.
        initialMainSoilCode={
          editingCommitted?.suggested_lithology ?? editingLayer.suggested_lithology
        }
        initialAdmixtures={
          (editingCommitted?.suggested_admixtures ??
            editingLayer.suggested_admixtures).map(a => ({
            soil_code: a.soil_code,
            amount: a.amount,
            locally: a.locally,
          }))
        }
        onSave={(mainCode, admix) => {
          if (onEdit && editIdx !== null) {
            onEdit(editIdx, {
              suggested_lithology: mainCode,
              suggested_admixtures: admix,
            })
          }
          setEditIdx(null)
        }}
        onCancel={() => setEditIdx(null)}
      />
    )}
    {/* Right-click context menu (dogfeed 2026-05-20). Rendered via
        a portal at clientX/Y so it doesn't have to live inside the
        SVG coordinate space. Esc + outside-click dismiss are wired
        in the effect above. */}
    {contextMenu !== null &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 10000,
          }}
          // Stop the document mousedown handler from immediately
          // closing the menu when the user clicks an item.
          onMouseDown={e => e.stopPropagation()}
          className="bg-surface-overlay border border-border-default rounded shadow-lg py-1 min-w-[10rem] text-xs"
          role="menu"
          aria-label="Ghost layer actions"
        >
          {onEdit && (
            <button
              type="button"
              className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
              onClick={() => {
                setEditIdx(contextMenu.idx)
                setContextMenu(null)
              }}
            >
              Edit composition…
            </button>
          )}
          <button
            type="button"
            className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
            onClick={() => {
              onReject(contextMenu.idx)
              setContextMenu(null)
            }}
          >
            Reject layer
          </button>
        </div>,
        document.body,
      )}
    {/* Debt #86: Alt-drag preview chip (floating, follows the cursor).
        Rendered via createPortal at fixed clientX/Y so it doesn't have
        to live inside the SVG coordinate space. Cleared on mouseup. */}
    {copyDrag !== null &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            left: copyDrag.clientX + 12,
            top: copyDrag.clientY + 12,
            zIndex: 10000,
            pointerEvents: 'none',
          }}
          className="bg-amber-500 text-white text-xs font-medium px-2 py-1 rounded shadow"
          data-testid="copy-composition-preview-chip"
        >
          Copy {formatLithoDisplayName(
            suggestions[copyDrag.sourceIdx]?.suggested_lithology ?? '?',
            suggestions[copyDrag.sourceIdx]?.suggested_admixtures ?? [],
          )}
        </div>,
        document.body,
      )}
    {/* Debt #86 overwrite confirm — opens when the drop target already
        has an edit. Confirm fires the deferred onEdit / onCrossColumnPaste;
        Cancel drops the gesture. */}
    <CopyCompositionConfirmDialog
      open={pendingCopy !== null}
      sourceLayer={pendingCopy?.sourceLayer ?? null}
      targetLabel={pendingCopy?.targetLabel ?? ''}
      onConfirm={() => {
        if (pendingCopy === null) return
        const { sourceLayer, targetAnchorId, targetIdx } = pendingCopy
        const edit = {
          suggested_lithology: sourceLayer.suggested_lithology,
          suggested_admixtures: sourceLayer.suggested_admixtures,
        }
        if (targetAnchorId === investigationId) {
          if (onEdit) onEdit(targetIdx, edit)
        } else {
          if (onCrossColumnPaste) onCrossColumnPaste(targetAnchorId, targetIdx, edit)
        }
        setPendingCopy(null)
      }}
      onCancel={() => setPendingCopy(null)}
    />
    {/* Drag-cascade merge confirm dialog (debt #83 + #84). Opens when
        mouseup snaps with one or more NEIGHBOUR layers absorbed.
        Confirm commits both the depth edit AND the chain rejections;
        Cancel drops the whole gesture. */}
    <MergeConfirmDialog
      open={pendingCommit !== null}
      chainLayers={pendingCommit?.chain.map(i => suggestions[i]) ?? []}
      draggedLayer={pendingCommit !== null ? suggestions[pendingCommit.idx] : null}
      onConfirm={() => {
        if (pendingCommit === null) return
        const { idx, edge, finalDepthM, chain, propagateIdx } = pendingCommit
        if (edge === 'top') {
          if (onEdit) onEdit(idx, { depth_top_m: finalDepthM })
          if (propagateIdx !== null && onEdit) {
            onEdit(propagateIdx, { depth_base_m: finalDepthM })
          }
        } else {
          if (onEdit) onEdit(idx, { depth_base_m: finalDepthM })
          if (propagateIdx !== null && onEdit) {
            onEdit(propagateIdx, { depth_top_m: finalDepthM })
          }
        }
        for (const collapseIdx of chain) onReject(collapseIdx)
        setPendingCommit(null)
      }}
      onCancel={() => setPendingCommit(null)}
    />
    </>
  )
}

// ---------------------------------------------------------------------------
// Per-layer rectangle
// ---------------------------------------------------------------------------

function LithoSuggestionLayer({
  layer,
  idx,
  anchorId,
  left,
  width,
  surfaceElevationM,
  levelToScreen,
  plotTop,
  plotBottom,
  accepted,
  rejected,
  onAccept,
  onReject,
  onUnreject,
  onRequestEdit,
  onRequestContextMenu,
  onCopyMouseDown,
  isCopyHoverTarget,
  formationNameById,
}: {
  layer: LithoLayerSuggestion
  idx: number
  /** Investigation id (CPT or borehole) this column belongs to.
   *  Stamped on the rect as ``data-litho-anchor-id`` so cross-column
   *  Alt-drag hit-tests via document.elementsFromPoint can resolve
   *  which anchor the target rect belongs to (debt #86). */
  anchorId: string
  left: number
  width: number
  surfaceElevationM: number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  accepted: boolean
  rejected: boolean
  onAccept: (idx: number) => void
  onReject: (idx: number) => void
  /** Restore a rejected layer to pending (debt #80). */
  onUnreject?: (idx: number) => void
  /**
   * Fired on dbl-click. Opens the parent's composition editor seeded
   * with this layer's current composition (debt #72). Omitted by
   * read-only mounts; when missing dbl-click is inert + accept fires
   * twice as the default browser behaviour.
   */
  onRequestEdit?: (idx: number) => void
  /**
   * Fired on right-click of a pending layer. Replaces the direct
   * right-click-rejects gesture from earlier iterations — the parent
   * now opens a context menu at (clientX, clientY) with multiple
   * options (Edit composition / Reject). Dogfeed 2026-05-20: users
   * expect right-click to open a menu, not destroy.
   */
  onRequestContextMenu?: (idx: number, clientX: number, clientY: number) => void
  /**
   * Debt #86: fired on mousedown when the Alt key is held — arms the
   * copy-composition drag gesture in the parent component.  The
   * default click/accept path is suppressed for this gesture via the
   * parent's ``copyDragJustEndedRef``.
   */
  onCopyMouseDown?: (idx: number, clientX: number, clientY: number) => void
  /** True when a copy-drag is hovering this rect — renders an amber
   *  outline so the user sees a valid drop target. */
  isCopyHoverTarget?: boolean
  formationNameById: ReadonlyMap<string, string>
}): JSX.Element | null {
  // Click-debounce gate — without it, the first click of a dbl-click
  // sequence fires onAccept before the dbl-click handler runs, which
  // would commit a contact at the OLD composition and only THEN open
  // the editor. Hook lives ABOVE the early-return so the hook count
  // is invariant (Rules of Hooks; CLAUDE.md "Temporal Dead Zone
  // after reordering React component bodies").
  const clickDebounce = useClickDebounce()

  // Convert depth-below-surface to mTAW using the investigation's elevation.
  const topMTaw = surfaceElevationM - layer.depth_top_m
  const baseMTaw = surfaceElevationM - layer.depth_base_m

  const topY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(topMTaw)))
  const baseY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(baseMTaw)))
  const height = baseY - topY
  if (height <= 0.5) return null

  const fill = lithoFill(layer.suggested_lithology)
  // Rich Dutch label includes the admixture qualifier (e.g.
  // "Zwak siltig zand" instead of plain "Zand"). Mirrors the
  // composition picker's live preview so the user sees the same
  // text in the dialog and the ghost rect (dogfeed bug 2026-05-20:
  // editing the composition produced no visible change because the
  // label was just the base lithology). Falls back to base name
  // when there are no admixtures.
  const labelText = formatLithoDisplayName(
    layer.suggested_lithology,
    layer.suggested_admixtures ?? [],
  )
  const opacity = accepted
    ? GHOST_OPACITY_ACCEPTED
    : rejected
      ? GHOST_OPACITY_REJECTED
      : GHOST_OPACITY_DEFAULT

  // Resolve the parent formation name from the id (passed from the outer
  // component's formations lookup).  Falls back to the raw id when the
  // formation is not in the active model (edge case: stale suggestion while
  // the model is being edited).
  const parentName =
    layer.parent_formation_id != null
      ? (formationNameById.get(layer.parent_formation_id) ?? layer.parent_formation_id)
      : null

  // spans_boundary: this suggestion interval crosses a geological formation
  // boundary.  The backend auto-splits it into two contacts at acceptance,
  // but the ghost still covers the full original interval — amber border
  // signals "straddles two formations, will be split on accept".
  const straddleNote = layer.spans_boundary
    ? ' ⚠ straddles formation boundary — will be split on accept'
    : ''
  const parentNote = parentName != null ? ` | parent: ${parentName}` : ''

  // Build the tooltip with all segmenter metadata.
  const nadNote = layer.suggested_nad_class != null ? ` · NAD ${layer.suggested_nad_class}` : ''
  const qcNote = layer.mean_qc_mpa != null ? ` · qc ${layer.mean_qc_mpa.toFixed(2)} MPa` : ''
  const drNote = layer.dr_pct != null ? ` · Dr ${layer.dr_pct.toFixed(0)}%` : ''
  const statusNote = accepted ? ' ✓ accepted' : rejected ? ' ✗ rejected' : ' (click to accept)'
  const tooltip =
    `${labelText}${nadNote}: ${layer.depth_top_m.toFixed(2)} → ${layer.depth_base_m.toFixed(2)} m` +
    ` [${layer.confidence}${qcNote}${drNote}]${parentNote}${straddleNote}${statusNote}`

  const maxLines = maxLinesForHeight(height, LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(labelText, maxCharsForWidth(width, LABEL_FONT_SIZE), maxLines)
    : []

  // Interaction:
  //   left-click  → accept (debounced 250 ms so a dbl-click can cancel)
  //   dbl-click   → open the composition editor (cancels the queued accept)
  //   right-click → reject (also Shift+click for keyboard parity)
  //   accepted / rejected layers ignore all of the above (already-decided)
  function handleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    if (e.shiftKey) {
      onReject(idx)
      return
    }
    clickDebounce.schedule(() => onAccept(idx))
  }

  function handleDoubleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    clickDebounce.cancel()
    if (onRequestEdit) onRequestEdit(idx)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    // Accepted / rejected layers are frozen — no context menu for
    // them. (Pending layers open the layer context menu via the
    // onRequestContextMenu callback below; the menu offers Edit
    // composition + Reject, which previously was the only right-click
    // action — the menu is more discoverable per dogfeed 2026-05-20.)
    if (accepted || rejected) return
    if (onRequestContextMenu) {
      onRequestContextMenu(idx, e.clientX, e.clientY)
    }
  }

  // Visual markers:
  //   accepted     → dark-green hairline stroke
  //   spans_boundary (pending) → amber stroke (1.5px dashed) to warn "will be split"
  //   rejected     → grey stroke
  //   default      → matching fill stroke (subtle boundary)
  const strokeColor = accepted
    ? '#065f46'
    : layer.spans_boundary && !rejected
      ? '#d97706'  // amber-600 — straddle warning
      : rejected
        ? '#9ca3af'
        : fill
  const strokeWidth = accepted || (layer.spans_boundary && !rejected) ? 1.5 : 0.5
  const strokeDasharray = layer.spans_boundary && !accepted && !rejected ? '4 2' : undefined

  // Debt #86: drop-target highlight — amber outline over the existing
  // stroke when a copy-drag is hovering this layer.
  const effectiveStroke = isCopyHoverTarget ? '#f59e0b' : strokeColor
  const effectiveStrokeWidth = isCopyHoverTarget ? 2 : strokeWidth

  return (
    <g>
      <rect
        x={left}
        y={topY}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke={effectiveStroke}
        strokeOpacity={accepted ? 0.9 : 0.7}
        strokeWidth={effectiveStrokeWidth}
        strokeDasharray={strokeDasharray}
        // Accepted / rejected layers let clicks pass through to the
        // ContactPickBar underneath so the user can place a NEW
        // contact at a different depth without first dismissing the
        // accepted ghost (dogfeed bug 2026-05-20). Pending layers
        // keep cursor=pointer + click handler so accept/reject still
        // works.
        style={
          accepted || rejected
            ? { cursor: 'default', pointerEvents: 'none' }
            : { cursor: 'pointer' }
        }
        // Debt #86: pending-layer rects stamp anchor+idx so cross-column
        // Alt-drag hit-tests via document.elementsFromPoint can resolve
        // the drop target. Stamped even when onCopyMouseDown is not
        // wired so a hosting component instance still receives a drop
        // FROM a sibling instance.
        data-litho-anchor-id={accepted || rejected ? undefined : anchorId}
        data-litho-idx={accepted || rejected ? undefined : idx}
        onMouseDown={
          onCopyMouseDown !== undefined && !accepted && !rejected
            ? e => {
                if (!e.altKey) return
                e.preventDefault()
                e.stopPropagation()
                onCopyMouseDown(idx, e.clientX, e.clientY)
              }
            : undefined
        }
        onClick={accepted || rejected ? undefined : handleClick}
        onDoubleClick={accepted || rejected ? undefined : handleDoubleClick}
        onContextMenu={accepted || rejected ? undefined : handleContextMenu}
      >
        <title>{tooltip}</title>
      </rect>

      {/* Diagonal cross-out on rejected layers. */}
      {rejected && (
        <line
          x1={left}
          y1={topY}
          x2={left + width}
          y2={baseY}
          stroke="#9ca3af"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Undo (↻) icon on rejected layers — debt #80. The rect itself
          has pointer-events:none so clicks pass through to the
          ContactPickBar; this small handle re-enables pointer-events
          on just the icon so the user can restore a mistaken reject
          without having to re-run the segmenter. Hidden when:
          - onUnreject prop absent (caller opt-in)
          - layer too short to fit the icon comfortably (< 14 px)
          - layer too narrow to fit the icon (< 14 px) */}
      {rejected && onUnreject && height >= 14 && width >= 14 && (
        <g
          data-testid={`litho-unreject-${idx}`}
          style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          onClick={e => {
            e.stopPropagation()
            onUnreject(idx)
          }}
        >
          <circle
            cx={left + width - 8}
            cy={topY + 8}
            r={6}
            fill="#ffffff"
            fillOpacity={0.85}
            stroke="#6b7280"
            strokeWidth={0.75}
          />
          <text
            x={left + width - 8}
            y={topY + 11}
            textAnchor="middle"
            fontSize={9}
            fill="#374151"
            style={{ userSelect: 'none' }}
          >
            ↻
          </text>
          <title>Undo reject — restore layer to pending</title>
        </g>
      )}

      {/* Accepted tick mark in top-right corner. */}
      {accepted && (
        <text
          x={left + width - 3}
          y={topY + 9}
          textAnchor="end"
          fontSize={9}
          fill="#065f46"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          ✓
        </text>
      )}

      {/* Inline label when the rect is tall enough. */}
      {lines.length > 0 && (
        <MultiLineLabel
          lines={lines}
          centerX={left + width / 2}
          rectTopY={topY}
          rectHeight={height}
          fontSize={LABEL_FONT_SIZE}
          tooltip={tooltip}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        />
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Multi-line label helper (mirrors VirtueleBoringGhostColumns)
// ---------------------------------------------------------------------------

function MultiLineLabel({
  lines,
  centerX,
  rectTopY,
  rectHeight,
  fontSize,
  tooltip,
  onClick,
  onContextMenu,
}: {
  lines: readonly string[]
  centerX: number
  rectTopY: number
  rectHeight: number
  fontSize: number
  tooltip: string
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const lineHeight = fontSize * 1.15
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    rectTopY + rectHeight / 2 - blockHeight / 2 + fontSize * 0.8
  return (
    <text
      x={centerX}
      y={firstBaselineY}
      textAnchor="middle"
      fontSize={fontSize}
      fill="#111827"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
      <title>{tooltip}</title>
    </text>
  )
}
