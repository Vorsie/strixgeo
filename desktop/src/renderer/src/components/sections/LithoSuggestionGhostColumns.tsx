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
import { formatLithoDisplayName } from '../../utils/lithoLabels'
import { canMergeAt } from '../../utils/lithoLayerMerge'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import CopyCompositionConfirmDialog from './CopyCompositionConfirmDialog'
import HoverReadoutCard from './HoverReadoutCard'
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
 * topology between it and the dragged layer. Used by the drag clamp:
 *
 *   - PENDING immediately adjacent: drag clamp = the neighbour's
 *     NEAR edge (= the current shared boundary). The boundary cannot
 *     be moved without first rejecting one of the two layers. This
 *     is the kill-cascade simplification (dogfeed 2026-05-23 — "snap
 *     to first boundary we encounter"). Use the merge button (#102)
 *     or the × per-layer reject (#103) to collapse / merge before
 *     redrawing the boundary.
 *   - PENDING with rejected between (gap-fill): clamp at the
 *     neighbour's NEAR edge. The drag fills the rejected gap and the
 *     next-pending's facing edge follows via shared-boundary commit.
 *   - ACCEPTED (immediate or via rejected): clamp at the accepted's
 *     NEAR edge; no commit propagation past it (its committed
 *     contact is the source of truth).
 *   - No visible neighbour (outer edge): outer ground above / for
 *     below, the segmenter's deepest output (last suggestion's base
 *     = test's effective bottom — dogfeed 2026-05-23 "or beneath the
 *     bottom of the test" bug).
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
 * user releases at OWN-OPPOSITE-EDGE (the #81 self-collapse direction)
 * with snap, the dragged layer is auto-rejected on mouseup.
 *
 * Cascade-capped-at-1 rule (dogfeed 2026-05-23). The user's complaint
 * was the MULTI-LAYER cascade — drag of layer N passing through
 * several same-parent neighbours' boundaries in one gesture, with
 * the merge-confirm dialog popping up for cases that surprised. The
 * fix caps cascade at ONE neighbour and removes the dialog entirely:
 *
 *   - **TOWARD AN IMMEDIATE PENDING NEIGHBOUR** — clamp at the
 *     neighbour's FAR edge (its base for a below-walk; its top for
 *     an above-walk). The shared boundary CAN be moved across the
 *     neighbour's territory, so G17-class shared-boundary resize
 *     still works. Releasing AT the far edge zero-thickness-collapses
 *     the neighbour (its facing edge follows via the shared-boundary
 *     commit); the layer stays pending with zero thickness — user
 *     can reject it explicitly via the × icon. No auto-reject, no
 *     dialog — the previous "cascade with merge prompt" (#83 + #84)
 *     was confusing because it silently absorbed N layers.
 *
 *   - **TOWARD A REJECTED-GAP NEIGHBOUR** — clamp at the next
 *     visible (non-rejected) neighbour's NEAR edge. The drag fills
 *     the rejected gap and the next-pending's facing edge follows.
 *     Preserves the G29 gap-fill semantics.
 *
 *   - **TOWARD AN ACCEPTED BARRIER** — clamp at the accepted's NEAR
 *     edge. The committed contact is the source of truth; no
 *     propagation past it.
 *
 *   - **TOWARD OWN OPPOSITE EDGE** — the #81 self-collapse. Snap
 *     auto-rejects the dragged layer on release.
 *
 *   - **NO NEIGHBOUR (outer edge)** — for ABOVE: clamp at 0 (ground).
 *     For BELOW: clamp at the LAST suggestion's BASE (the segmenter's
 *     deepest output = test's effective bottom). Replaces the prior
 *     POSITIVE_INFINITY which let drags run off the bottom of the
 *     plot (dogfeed 2026-05-23 "or beneath the bottom of the test").
 *
 * Multi-layer merge happens via the #102 merge button or N successive
 * × rejects (#103). The drag is now predictable: at most one
 * neighbour crossed per gesture.
 */
export interface DragBoundsResult {
  boundsAboveM: number
  boundsBelowM: number
  /**
   * Pending-layer indices auto-rejected when the drag snaps at
   * ``boundsAboveM`` on mouseup. After the kill-cascade refactor
   * (2026-05-23), this only ever contains ``[idx]`` — the #81 self-
   * collapse path (snap to own opposite edge). Neighbour auto-collapse
   * is gone; collapse-by-merge is an explicit user gesture now.
   * Kept as a list (not a single id) so the existing handleUp logic —
   * which gates on ``chain.length === 1 && chain[0] === drag.idx`` —
   * stays unchanged.
   */
  collapseChainAbove: number[]
  /** Mirror of ``collapseChainAbove`` for the BELOW direction. */
  collapseChainBelow: number[]
}

/** Result of the single-step neighbour walk: the bound the dragged
 *  edge is allowed to reach + (when applicable) the neighbour idx to
 *  auto-reject on snap-at-bound. The auto-reject restores the "drag
 *  a bottom layer up to merge it into the layer above" gesture that
 *  the kill-multi-cascade refactor accidentally killed (dogfeed
 *  2026-05-23: "I merged a bottom clay layer into an upper one and
 *  it disappeared"). Without auto-reject the upper layer collapsed
 *  to zero-thickness and stayed pending — invisible zombie. */
interface NeighbourBound {
  boundM: number
  /** Neighbour idx to auto-reject when drag releases AT boundM, or
   *  null when no auto-reject applies (outer edge, accepted barrier,
   *  rejected-gap-fill, or self-collapse direction). */
  autoRejectIdx: number | null
}

function boundFromNeighbour(
  neighbour: VisibleNeighbour | null,
  outerEdgeFallback: number,
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  nearEdgeKey: 'topM' | 'baseM',
  farEdgeKey: 'topM' | 'baseM',
): NeighbourBound {
  if (!neighbour) {
    return { boundM: outerEdgeFallback, autoRejectIdx: null }
  }
  // Accepted = committed contact = hard barrier at NEAR edge. No
  // auto-reject — the committed contact is the source of truth.
  if (neighbour.kind === 'accepted') {
    return {
      boundM: effectiveDepths(suggestions, edits, neighbour.idx)[nearEdgeKey],
      autoRejectIdx: null,
    }
  }
  // Rejected gap-fill: pending neighbour reached past rejected layers.
  // Clamp at the next pending's NEAR edge (G29 semantics preserved).
  // No auto-reject — the user has already rejected what they wanted
  // gone; collapsing the next pending too would be over-eager.
  if (neighbour.crossedRejected) {
    return {
      boundM: effectiveDepths(suggestions, edits, neighbour.idx)[nearEdgeKey],
      autoRejectIdx: null,
    }
  }
  // Immediate pending neighbour — single-step cascade. Clamp at the
  // neighbour's FAR edge so the shared boundary can move across its
  // territory (G17-class resize). Snap-at-bound on release auto-
  // rejects the neighbour — the "merge into next layer" gesture.
  // Multi-step cascade is gone; exactly one neighbour absorbed.
  return {
    boundM: effectiveDepths(suggestions, edits, neighbour.idx)[farEdgeKey],
    autoRejectIdx: neighbour.idx,
  }
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
    const above = findVisibleNeighbourAbove(idx, acceptedIndices, rejectedIndices)
    // Above-walk: nearEdge is the neighbour's BASE (facing the dragged
    // layer); farEdge is its TOP (further from the dragged layer).
    // Outer fallback: 0 = ground.
    const aboveBound = boundFromNeighbour(
      above,
      0,
      suggestions,
      edits,
      'baseM',
      'topM',
    )
    return {
      boundsAboveM: aboveBound.boundM,
      boundsBelowM: own.baseM,
      collapseChainAbove:
        aboveBound.autoRejectIdx !== null ? [aboveBound.autoRejectIdx] : [],
      collapseChainBelow: [idx],
    }
  }
  // edge === 'base'
  const below = findVisibleNeighbourBelow(
    idx,
    suggestions.length,
    acceptedIndices,
    rejectedIndices,
  )
  // Below-walk: nearEdge is the neighbour's TOP; farEdge is its BASE.
  // Outer fallback: the LAST suggestion's BASE (= test's effective
  // bottom). When the dragged layer IS the last, this equals own.baseM
  // → no extension downward (matches "can't drag past the test bottom").
  const lastIdx = suggestions.length - 1
  const outerBelow = effectiveDepths(suggestions, edits, lastIdx).baseM
  const belowBound = boundFromNeighbour(
    below,
    outerBelow,
    suggestions,
    edits,
    'topM',
    'baseM',
  )
  return {
    boundsAboveM: own.topM,
    boundsBelowM: belowBound.boundM,
    collapseChainAbove: [idx],
    collapseChainBelow:
      belowBound.autoRejectIdx !== null ? [belowBound.autoRejectIdx] : [],
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
  /**
   * Debt #85: insert a new pending litho layer at the shared boundary
   * between ``afterIdx`` and ``afterIdx+1``.  Fired when the user
   * right-clicks a shared boundary between two adjacent pending
   * layers and picks "Insert layer here…" from the boundary context
   * menu, then chooses a composition in the picker.
   *
   * Optional — when absent, the boundary hit-strip + context menu are
   * not rendered (zero regression for callers that haven't opted in).
   */
  onInsertLayer?: (
    afterIdx: number,
    composition: {
      suggested_lithology: string
      suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
    },
  ) => void
  /**
   * Debt #98: split a pending layer in two at its midpoint. Wired to
   * the "Split layer" item in the per-layer right-click context menu.
   * Both halves inherit the original layer's effective composition; the
   * user drag-resizes the new shared boundary and edits whichever half
   * differs. Optional — when absent the menu item is not rendered.
   */
  onSplitLayer?: (idx: number) => void
  /**
   * Debt #102: merge two adjacent same-lithology pending layers into
   * one. Wired to the "Merge layers" item on the boundary right-click
   * menu — the item appears ONLY when ``canMergeAt`` returns true for
   * the boundary (both pending, same effective lithology). User-
   * initiated by design: the segmenter's same-lithology splits carry
   * NAD-class signal we don't want to auto-erase.
   */
  onMergeLayers?: (upperIdx: number) => void
  /**
   * Optional CPT depth-series for the dragged investigation. When the
   * investigation is a CPT and this map carries an entry for its id,
   * the live drag readout shows ``qc`` (MPa) and ``Rf`` (%) at the
   * current drag depth alongside ``depth`` + ``mTAW`` (dogfeed
   * 2026-05-23: "the suggestion box on cpt boundary drag has depth
   * and mTAW but not qc and Rf"). Boreholes ignore this. Absent or
   * empty map = readout shows depth + mTAW only (backwards-compatible).
   */
  cptPlotByAnchorId?: ReadonlyMap<
    string,
    {
      depths_m: readonly number[]
      qc_mpa: readonly number[]
      rf_pct: readonly (number | null)[] | null
    }
  >
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
  onInsertLayer,
  onSplitLayer,
  onMergeLayers,
  cptPlotByAnchorId,
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

  // Debt #85: right-click context menu on a shared boundary between
  // two adjacent pending layers. ``afterIdx`` is the UPPER layer's
  // index — the inserted layer arrives at ``afterIdx + 1``. Cleared
  // on Esc / outside click (same effect as the per-layer context menu).
  const [boundaryContextMenu, setBoundaryContextMenu] = useState<
    { afterIdx: number; x: number; y: number } | null
  >(null)
  // Tracks an in-flight "insert layer here" gesture: when set, the
  // composition picker opens with empty initial values; on Save, the
  // parent's onInsertLayer fires with this afterIdx. null = closed.
  const [insertingAfterIdx, setInsertingAfterIdx] = useState<number | null>(null)

  // Per-layer context menu (dogfeed 2026-05-20). Right-click on a
  // pending layer opens a small floating menu with [Edit composition,
  // Reject layer]. Replaces the prior direct-right-click-rejects
  // gesture, which surprised users who expected a menu.
  const [contextMenu, setContextMenu] = useState<
    { idx: number; x: number; y: number } | null
  >(null)

  // Dismiss the context menu on Esc / outside click. document-level
  // listeners attached only while the menu is open. Covers BOTH the
  // per-layer menu (debt #72) and the boundary menu (debt #85).
  useEffect(() => {
    if (!contextMenu && !boundaryContextMenu) return
    function handleClickAway(): void {
      setContextMenu(null)
      setBoundaryContextMenu(null)
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setBoundaryContextMenu(null)
      }
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
  }, [contextMenu, boundaryContextMenu])

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
      // Snap visual — fires ONLY when the user has explicitly OVERSHOT
      // the bound (cursor past the bound by more than the snap threshold).
      // Dogfeed 2026-05-23: the prior "snap when within threshold of
      // the bound" fired the moment the dragged edge touched the
      // neighbour bound, surprising users who just wanted to resize
      // tight against the bound. Requiring deliberate overshoot makes
      // the merge gesture explicit ("push past the wall = absorb") and
      // lets users freely drag right up to / coincident with the bound
      // without triggering the absorb. ``raw`` (cursor depth pre-clamp)
      // is the right signal here, not ``clamped``: clamped is already
      // pinned at the bound, so its distance to the bound is always 0.
      // Use the UN-clamped cursor depth — ``raw`` above was floored to
      // 0 by ``Math.max(0, ...)``, which would falsely report "no
      // overshoot" when the user drags above the ground line (raw < 0).
      // Recompute without the floor so an "I overshot the ground"
      // gesture (e.g. top-drag UP past surface) still registers as a
      // deliberate merge intent on the above-bound.
      const rawUnclamped = drag.initialDepthM + depthDelta
      const snappedAtAbove =
        snapThresholdM > 0 && rawUnclamped < drag.boundsAboveM - snapThresholdM
      const snappedAtBelow =
        snapThresholdM > 0 && rawUnclamped > drag.boundsBelowM + snapThresholdM
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
      // Collapse chain on release. After the kill-multi-cascade
      // refactor, the chain has at most ONE entry per direction:
      //   - ``[idx]`` on the own-opposite-edge side → #81 self-collapse.
      //   - ``[neighbour.idx]`` on the neighbour-direction side →
      //     single-step "merge into next layer" auto-reject (dogfeed
      //     2026-05-23 fix: drag bottom layer up to absorb the upper
      //     layer cleanly, without leaving a zero-thickness zombie).
      //   - ``[]`` when no auto-reject applies (outer edge, accepted
      //     barrier, rejected-gap-fill).
      const chain = drag.snapped ? drag.collapseChainOnRelease : []
      //
      // Shared-boundary commit (owner directive 2026-05-20). A boundary
      // BETWEEN two adjacent layers is one boundary, not two — moving
      // it slides both the layer above's base AND the layer below's
      // top to the same depth.
      //
      // Adjacency skips REJECTED and ACCEPTED layers: rejected layers
      // are hidden so propagating to them leaves the boundary out of
      // sync across the gap; accepted layers' depths are committed
      // contacts and mutating their stored top/base via the edits map
      // distorts the green-tick ghost rect without changing the actual
      // contact in the DB.
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
      // Auto-reject every idx in the chain — covers both the #81
      // self-collapse (chain == [drag.idx]) and the single-step
      // neighbour-merge gesture (chain == [neighbour.idx]).
      for (const i of chain) onReject(i)
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
      // Copy the source's EFFECTIVE composition — raw merged with any
      // edit (a Strip-admixtures edit, an Edit-composition change).
      // Reading raw here pasted admixtures the user had already
      // stripped (dogfeed 2026-05-22).
      const sourceEdit = edits?.get(copyDrag.sourceIdx)
      const sourceLitho =
        sourceEdit?.suggested_lithology ?? sourceLayer.suggested_lithology
      // Spread into a fresh mutable array — the edits Map types
      // suggested_admixtures as readonly.
      const sourceAdmix = [
        ...(sourceEdit?.suggested_admixtures ?? sourceLayer.suggested_admixtures),
      ]
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
          sourceLayer: {
            ...sourceLayer,
            suggested_lithology: sourceLitho,
            suggested_admixtures: sourceAdmix,
          },
          targetAnchorId: target.anchorId,
          targetIdx: target.idx,
          targetLabel: formatLithoDisplayName(tgtEffectiveLitho, tgtEffectiveAdmix),
        })
        setCopyDrag(null)
        return
      }
      // Silent commit — no existing edit, no prompt.
      const edit = {
        suggested_lithology: sourceLitho,
        suggested_admixtures: sourceAdmix,
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
        // Debt #85: render the boundary hit-strip at this layer's BASE
        // only when both this layer AND the next layer are pending,
        // and onInsertLayer is wired. (No strip below the last layer;
        // none above an accepted/rejected next neighbour.)
        const nextIdx = idx + 1
        const boundaryStripEnabled =
          onInsertLayer !== undefined &&
          !accepted &&
          !rejected &&
          nextIdx < suggestions.length &&
          !acceptedIndices.has(nextIdx) &&
          !rejectedIndices.has(nextIdx)
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
            {/* Debt #85 boundary hit-strip — 6 px tall transparent rect
                centred on the shared boundary between this layer and
                the next pending one. Right-click opens the boundary
                context menu with "Insert layer here…". Mousedown does
                NOT arm any other gesture (the edge-resize handle owns
                the resize gesture at the same Y region; the strip is
                explicitly right-click-only so no collision). */}
            {boundaryStripEnabled && (
              <rect
                x={left}
                y={baseY - 3}
                width={ghostWidth}
                height={6}
                fill="transparent"
                style={{ cursor: 'context-menu' }}
                data-testid={`litho-boundary-strip-${idx}`}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setBoundaryContextMenu({
                    afterIdx: idx,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }}
              />
            )}
          </g>
        )
      })}
      {/* Live drag depth readout (debt #103). Shows the boundary's
          depth-down-the-test (``qc reference depth`` in dogfeed
          parlance) + its absolute mTAW elevation, updating live on
          every mousemove. Mirrors the committed-contact drag readout
          in ContactsLayer + the borehole focus-mode hover readout in
          BoreholeColumn so the litho-ghost drag surfaces the same
          two values the user already gets on the other drag surfaces.
          Anchored to the right of the ghost overlay; same y as the
          dragged boundary (HoverReadoutCard clamps to plot bounds). */}
      {drag !== null && surfaceElevationM !== null && (
        (() => {
          const elevation = surfaceElevationM - drag.currentDepthM
          // For a CPT anchor with a depth-series available, look up qc
          // and Rf at the dragged depth. Binary search the depths array
          // (already ascending). Show empty strings when the value is
          // missing — boreholes hit this path with no cptPlot → only
          // depth + mTAW lines render (backwards-compatible).
          const plot =
            col.kind === 'cpt' && cptPlotByAnchorId
              ? cptPlotByAnchorId.get(investigationId) ?? null
              : null
          const readoutLines: { text: string }[] = [
            { text: `depth ${drag.currentDepthM.toFixed(2)} m` },
            { text: `${elevation >= 0 ? '+' : ''}${elevation.toFixed(2)} m TAW` },
          ]
          if (plot !== null && plot.depths_m.length > 0) {
            // Binary search the largest depths_m index with depth <= drag depth.
            let lo = 0
            let hi = plot.depths_m.length - 1
            while (lo < hi) {
              const mid = (lo + hi + 1) >>> 1
              if (plot.depths_m[mid] <= drag.currentDepthM) lo = mid
              else hi = mid - 1
            }
            const idx = lo
            if (
              plot.depths_m[idx] !== undefined &&
              plot.depths_m[idx] <= drag.currentDepthM + 1
            ) {
              const qc = plot.qc_mpa[idx]
              if (qc !== undefined && qc !== null && Number.isFinite(qc)) {
                readoutLines.push({ text: `qc ${qc.toFixed(2)} MPa` })
              }
              const rf = plot.rf_pct?.[idx]
              if (rf !== undefined && rf !== null && Number.isFinite(rf)) {
                readoutLines.push({ text: `Rf ${rf.toFixed(2)} %` })
              }
            }
          }
          return (
            <g pointerEvents="none" data-testid="litho-drag-readout">
              <HoverReadoutCard
                x={left + ghostWidth + 8}
                y={levelToScreen(elevation)}
                plotTop={plotTop}
                plotBottom={plotBottom}
                lines={readoutLines}
              />
            </g>
          )
        })()
      )}
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
          {/* Accept stays reachable from the menu — the primary accept
              gesture is dbl-click (owner directive 2026-05-22), and a
              menu item is the discoverable, deliberate alternative. */}
          <button
            type="button"
            className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
            onClick={() => {
              onAccept(contextMenu.idx)
              setContextMenu(null)
            }}
          >
            Accept layer
          </button>
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
          {/* Debt #98: split the layer in two at its midpoint. Both
              halves inherit the effective composition; the user drag-
              resizes the new shared boundary. Owner directive 2026-05-22:
              "do the right click split option". */}
          {onSplitLayer && (
            <button
              type="button"
              className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
              data-testid="litho-context-split"
              onClick={() => {
                onSplitLayer(contextMenu.idx)
                setContextMenu(null)
              }}
            >
              Split layer
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
    {/* Debt #85: boundary context menu — right-click on a shared
        boundary between two pending layers opens this with the single
        "Insert layer here…" item.  Clicking opens the composition
        picker in insert mode (insertingAfterIdx set). */}
    {boundaryContextMenu !== null &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            left: boundaryContextMenu.x,
            top: boundaryContextMenu.y,
            zIndex: 10000,
          }}
          onMouseDown={e => e.stopPropagation()}
          className="bg-surface-overlay border border-border-default rounded shadow-lg py-1 min-w-[10rem] text-xs"
          role="menu"
          aria-label="Boundary actions"
          data-testid="litho-boundary-menu"
        >
          <button
            type="button"
            className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
            data-testid="litho-boundary-insert"
            onClick={() => {
              setInsertingAfterIdx(boundaryContextMenu.afterIdx)
              setBoundaryContextMenu(null)
            }}
          >
            Insert layer here…
          </button>
          {/* Debt #102: merge two adjacent same-lithology pending layers
              into one. Item appears ONLY when both neighbours are
              pending AND share the same effective lithology — the
              segmenter's same-lithology splits carry NAD-class signal,
              so this is a user-initiated, layer-by-layer choice (owner
              directive 2026-05-22). */}
          {onMergeLayers !== undefined &&
            canMergeAt(
              suggestions,
              edits,
              acceptedIndices,
              rejectedIndices,
              boundaryContextMenu.afterIdx,
            ) && (
              <button
                type="button"
                className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
                data-testid="litho-boundary-merge"
                onClick={() => {
                  onMergeLayers(boundaryContextMenu.afterIdx)
                  setBoundaryContextMenu(null)
                }}
              >
                Merge layers
              </button>
            )}
        </div>,
        document.body,
      )}
    {/* Debt #85: composition picker reused in INSERT mode. Opens with
        blank initial values (owner directive: blank prefill); on Save
        the parent's onInsertLayer fires with the captured afterIdx. */}
    {insertingAfterIdx !== null && (
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode={''}
        initialAdmixtures={[]}
        onSave={(mainCode, admix) => {
          if (onInsertLayer && insertingAfterIdx !== null) {
            onInsertLayer(insertingAfterIdx, {
              suggested_lithology: mainCode,
              suggested_admixtures: admix,
            })
          }
          setInsertingAfterIdx(null)
        }}
        onCancel={() => setInsertingAfterIdx(null)}
      />
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
            edits?.get(copyDrag.sourceIdx)?.suggested_lithology ??
              suggestions[copyDrag.sourceIdx]?.suggested_lithology ??
              '?',
            edits?.get(copyDrag.sourceIdx)?.suggested_admixtures ??
              suggestions[copyDrag.sourceIdx]?.suggested_admixtures ??
              [],
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
  // nad_class_range is present on merged layers (debt #119); fall back to
  // the scalar suggested_nad_class for un-merged / borehole-path layers.
  const nadNote = (() => {
    const range = layer.nad_class_range
    if (range != null) {
      const [lo, hi] = range
      return lo === hi ? ` · NAD ${lo}` : ` · NAD ${lo}–${hi}`
    }
    return layer.suggested_nad_class != null ? ` · NAD ${layer.suggested_nad_class}` : ''
  })()
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

  // Interaction (owner directive 2026-05-22 — accept moved off the
  // single click so a misclick while aiming at a drag handle or a
  // boundary strip can no longer commit a contact):
  //   dbl-click    → accept the suggestion (commit a contact)
  //   shift-click  → reject
  //   right-click  → context menu (Accept / Edit composition / Reject)
  //   single-click → inert
  //   accepted / rejected layers ignore all of the above (already-decided)
  function handleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    // Shift+click stays a quick reject — a deliberate modifier gesture,
    // not a misclick risk. A plain single click is intentionally inert.
    if (e.shiftKey) onReject(idx)
  }

  function handleDoubleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    onAccept(idx)
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

      {/* Reject (×) icon on PENDING layers — debt #103 click-delete.
          Mirrors the ↻ unreject icon below: small circular handle in
          the top-right corner with pointer-events:auto so a single
          click rejects the layer. Owner directive 2026-05-22 keeps
          left-click on the layer BODY inert (misclick safety) — this
          icon is the explicit, discoverable reject affordance. Sized
          + gated identically to the ↻ for visual parity. Mutually
          exclusive with ↻ (rejected) and ✓ (accepted) — only ONE of
          the three renders on any given layer. */}
      {!accepted && !rejected && height >= 14 && width >= 14 && (
        <g
          data-testid={`litho-reject-${idx}`}
          style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          onClick={e => {
            e.stopPropagation()
            onReject(idx)
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
            ×
          </text>
          <title>Reject layer</title>
        </g>
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

      {/* Inline label when the rect is tall enough. Suppressed once the
          layer is accepted: the committed contact band underneath now
          carries the real label, and two overlapping labels read as a
          faint "ghost label behind" the real one (dogfeed 2026-05-22). */}
      {lines.length > 0 && !accepted && (
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
