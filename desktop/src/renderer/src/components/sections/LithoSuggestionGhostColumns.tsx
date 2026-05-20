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

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import type { GeologicalFormationResponse, LithoLayerSuggestion } from '../../api/client'
import { useClickDebounce } from '../../hooks/useClickDebounce'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import type { PlacedColumn } from './utils'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
  LITHOLOGY_LABELS,
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

function lithoLabel(lithology: string): string {
  return LITHOLOGY_LABELS[lithology] ?? lithology
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
function computeDragBounds(
  edge: 'top' | 'base',
  idx: number,
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  rejectedIndices: ReadonlySet<number>,
): {
  boundsAboveM: number
  boundsBelowM: number
  collapseIdxAbove: number | null
  collapseIdxBelow: number | null
} {
  const own = effectiveDepths(suggestions, edits, idx)
  if (edge === 'top') {
    const aboveIdx = nearestVisibleIndexAbove(idx, rejectedIndices)
    const boundsAboveM =
      aboveIdx !== null ? effectiveDepths(suggestions, edits, aboveIdx).baseM : 0
    return {
      boundsAboveM,
      boundsBelowM: own.baseM,
      collapseIdxAbove: null,
      collapseIdxBelow: idx,
    }
  }
  // edge === 'base'
  const belowIdx = nearestVisibleIndexBelow(idx, suggestions.length, rejectedIndices)
  const boundsBelowM =
    belowIdx !== null
      ? effectiveDepths(suggestions, edits, belowIdx).topM
      : Number.POSITIVE_INFINITY
  return {
    boundsAboveM: own.topM,
    boundsBelowM,
    collapseIdxAbove: idx,
    collapseIdxBelow: null,
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
     * Suggestion index whose layer collapses if the drag snaps at
     * ``boundsAboveM`` — own idx (base-drag → own collapses) or the
     * next-pending-above's idx (top-drag → neighbour collapses).
     * ``null`` when the bound is the ground surface (no neighbour
     * to collapse).
     */
    collapseIdxAbove: number | null
    /** Mirror of ``collapseIdxAbove`` for ``boundsBelowM``. */
    collapseIdxBelow: number | null
    /**
     * Whether the current drag position is snapped to either bound.
     * Drives the visible snap indicator + the on-mouseup auto-reject.
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
     * Layer to auto-reject on mouseup when ``snapped`` is true. This
     * is whichever ``collapseIdx{Above,Below}`` corresponds to the
     * bound that was hit. ``null`` when no snap fired or the snap is
     * at the ground surface.
     */
    collapseOnReleaseIdx: number | null
  } | null>(null)

  // Composition editor (debt #72). Tracks which suggestion index is
  // open for edit; null when closed. Lives in this parent component
  // so it can survive across LithoSuggestionLayer remounts and so
  // the Save handler can call onEdit at the same level the click
  // handlers are wired.
  const [editIdx, setEditIdx] = useState<number | null>(null)

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
        drag.collapseIdxAbove !== null &&
        Math.abs(clamped - drag.boundsAboveM) <= snapThresholdM
      const snappedAtBelow =
        snapThresholdM > 0 &&
        drag.collapseIdxBelow !== null &&
        Math.abs(clamped - drag.boundsBelowM) <= snapThresholdM
      // If both bounds are within threshold simultaneously (a layer
      // narrower than 2 * snapThresholdM), prefer the one closer to
      // the cursor — keeps the snap intuitive when the layer is thin.
      let snapTargetM: number | null = null
      let collapseOnReleaseIdx: number | null = null
      if (snappedAtAbove && snappedAtBelow) {
        const aboveDist = Math.abs(clamped - drag.boundsAboveM)
        const belowDist = Math.abs(clamped - drag.boundsBelowM)
        if (aboveDist <= belowDist) {
          snapTargetM = drag.boundsAboveM
          collapseOnReleaseIdx = drag.collapseIdxAbove
        } else {
          snapTargetM = drag.boundsBelowM
          collapseOnReleaseIdx = drag.collapseIdxBelow
        }
      } else if (snappedAtAbove) {
        snapTargetM = drag.boundsAboveM
        collapseOnReleaseIdx = drag.collapseIdxAbove
      } else if (snappedAtBelow) {
        snapTargetM = drag.boundsBelowM
        collapseOnReleaseIdx = drag.collapseIdxBelow
      }
      const next = snapTargetM !== null ? snapTargetM : clamped
      setDrag(d =>
        d !== null
          ? {
              ...d,
              currentDepthM: next,
              snapped: snapTargetM !== null,
              snapTargetM,
              collapseOnReleaseIdx,
            }
          : null,
      )
    }
    function handleUp(): void {
      if (!drag) return
      const final = drag.currentDepthM
      // Shared-boundary commit (owner directive 2026-05-20 reversal of
      // the earlier "independent edges" design). A boundary BETWEEN
      // two adjacent layers is one boundary, not two — moving it slides
      // both the layer above's base AND the layer below's top to the
      // same depth. This prevents whitespace gaps + overlapping ranges
      // (both flagged as geologically nonsense on dogfeed).
      //
      // Adjacency skips REJECTED and ACCEPTED layers (dogfeed bug
      // 2026-05-20): rejected layers are hidden so propagating to them
      // doesn't move what the user sees, leaving A.base and C.top out
      // of sync across the gap; accepted layers' depths are committed
      // contacts and mutating their stored top/base via the edits map
      // visually distorts the green-tick ghost rect without changing
      // the actual contact in the DB. Both classes therefore stop the
      // shared-boundary propagation cold (or, when there is a further
      // pending neighbour, propagate ACROSS them to that neighbour).
      //
      // Outer edges (no pending neighbour above for idx 0's top, none
      // below for the last idx's base) update only the dragged layer.
      if (drag.edge === 'top') {
        if (onEdit) onEdit(drag.idx, { depth_top_m: final })
        // Propagate to the nearest VISIBLE neighbour above (skip only
        // rejected, same topology as the clamp); but skip the edit if
        // that visible is ACCEPTED — its committed-contact depth must
        // not be mutated via the edits map. The clamp guarantees
        // `final` can't move past an accepted barrier anyway, so no
        // propagation is needed in that case.
        const visible = nearestVisibleIndexAbove(drag.idx, rejectedIndices)
        if (visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_base_m: final })
        }
      } else {
        if (onEdit) onEdit(drag.idx, { depth_base_m: final })
        const visible = nearestVisibleIndexBelow(
          drag.idx,
          suggestions.length,
          rejectedIndices,
        )
        if (visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_top_m: final })
        }
      }
      // Snap-to-collapse auto-reject. The collapse target is the
      // layer that became zero-thickness after the shared-boundary
      // commit:
      //   - snap to own opposite edge (#81) → collapseOnReleaseIdx
      //     is the dragged layer itself
      //   - snap to neighbour's far edge (#83 v1) → collapseOnReleaseIdx
      //     is the neighbour whose near edge was absorbed
      // Rejected/accepted layers in between keep their stored depths
      // so un-rejecting later restores them at their original position.
      if (drag.snapped && drag.collapseOnReleaseIdx !== null) {
        onReject(drag.collapseOnReleaseIdx)
      }
      setDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [drag, pxPerM, onEdit, onReject, suggestions.length, acceptedIndices, rejectedIndices])

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
        const effective: LithoLayerSuggestion = {
          ...rawLayer,
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
                      collapseOnReleaseIdx: null,
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
                      collapseOnReleaseIdx: null,
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Per-layer rectangle
// ---------------------------------------------------------------------------

function LithoSuggestionLayer({
  layer,
  idx,
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
  formationNameById,
}: {
  layer: LithoLayerSuggestion
  idx: number
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
  const labelText = lithoLabel(layer.suggested_lithology)
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

  return (
    <g>
      <rect
        x={left}
        y={topY}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke={strokeColor}
        strokeOpacity={accepted ? 0.9 : 0.7}
        strokeWidth={strokeWidth}
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
