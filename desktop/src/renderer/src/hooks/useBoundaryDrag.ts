/**
 * useBoundaryDrag — extracted drag state + document mousemove/mouseup
 * coordination for the litho-suggestion section editor.
 *
 * Slice 1 of the unified-boundary-drag work
 * (see ``docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md``).
 * This slice is a pure refactor — the drag state, snap math, and
 * mouseup commit dispatch that previously lived inline in
 * ``LithoSuggestionGhostColumns`` move here verbatim. Behaviour is
 * unchanged; the goal is to give the bound walker (Slice 2) and the
 * cross-store commit dispatch (Slice 3) a clean place to land.
 *
 * The hook owns:
 *   - The ``drag`` state (idx, edge, depths, bounds, snap, absorb).
 *   - The document-level mousemove + mouseup listeners while a drag
 *     is active.
 *   - The mouseup commit dispatch:
 *       - Shift+drag absorb path (onAbsorbLayer).
 *       - Zero-thickness auto-reject (fix A, dogfeed 2026-05-30).
 *       - Plain edit + shared-boundary partner propagation (onEdit).
 *       - Chain-on-snap auto-reject / merge (onReject / onMergeLayers).
 *
 * The component owns:
 *   - The hit-strip render + their onMouseDown → ``startDrag``.
 *   - The live snap indicator + drag-readout render (reads ``drag``).
 *
 * The hook is intentionally not generic yet — it consumes the litho-
 * suggestion shape directly. Slice 2 generalises the neighbour walk
 * to also consult committed contacts; Slice 3 adds the cross-store
 * commit dispatch. Each slice is a focused diff on this file.
 */

import { useCallback, useEffect, useState } from 'react'

import type { LithoLayerSuggestion } from '../api/client'
import type { LithoSuggestionEdit } from './useGeologicalModel'
import {
  ZERO_THICKNESS_M,
  effectiveDepths,
  findVisibleNeighbourAbove,
  findVisibleNeighbourBelow,
  nearestVisibleIndexAbove,
  nearestVisibleIndexBelow,
} from '../utils/lithoBoundaryHelpers'

// ---------------------------------------------------------------------------
// State + start-params types
// ---------------------------------------------------------------------------

/**
 * Live drag state — set on mousedown via ``startDrag``, mutated on
 * each mousemove (current depth, snap, absorbPending), cleared on
 * mouseup after the commit dispatch.
 */
export interface BoundaryDragState {
  idx: number
  edge: 'top' | 'base'
  initialClientY: number
  initialDepthM: number
  currentDepthM: number
  /**
   * Hard clamp on the shallow side (smaller depth). The dragged edge
   * cannot cross this. ``0`` when the dragged edge is the outermost
   * top with no pending layer above (= ground surface).
   */
  boundsAboveM: number
  /**
   * Hard clamp on the deep side. Capped by the plot bottom (no
   * infinite drag past the last layer).
   */
  boundsBelowM: number
  /**
   * Indices of pending layers absorbed when the drag snaps at
   * ``boundsAboveM``. Single-element ``[idx]`` for the #81 self-
   * collapse path. Empty when no collapse target on this side.
   */
  collapseChainAbove: number[]
  /** Mirror of ``collapseChainAbove`` for ``boundsBelowM``. */
  collapseChainBelow: number[]
  /** Whether the current drag position is snapped to either bound. */
  snapped: boolean
  /** Depth the current snap is bound to, or null when not snapped. */
  snapTargetM: number | null
  /** Chain of layers to auto-reject on mouseup when ``snapped``. */
  collapseChainOnRelease: number[]
  /**
   * Shift+drag absorb direction when the cursor has crossed the
   * neighbour's MIDPOINT. ``'down'`` = lower neighbour pending
   * absorption; ``'up'`` = upper. Null = no absorb pending.
   */
  absorbPending: 'up' | 'down' | null
}

/**
 * Inputs the caller passes to start a drag — the per-mousedown bits
 * the component already has at the hit-strip onMouseDown site.
 */
export interface BoundaryDragStart {
  idx: number
  edge: 'top' | 'base'
  initialClientY: number
  initialDepthM: number
  boundsAboveM: number
  boundsBelowM: number
  collapseChainAbove: number[]
  collapseChainBelow: number[]
}

// ---------------------------------------------------------------------------
// Hook params + return
// ---------------------------------------------------------------------------

export interface UseBoundaryDragParams {
  /** Linear pixels-per-metre, derived from ``levelToScreen`` by the
   *  caller. Used for the snap threshold + cursor → depth conversion. */
  pxPerM: number
  /** Live suggestion list (drives effective-depths, neighbour walk,
   *  partner-absorb prediction). */
  suggestions: readonly LithoLayerSuggestion[]
  /** Live edits map (committed depth + composition overrides). */
  edits: ReadonlyMap<number, LithoSuggestionEdit> | undefined
  /** Accepted set — used to gate partner propagation + Shift+absorb. */
  acceptedIndices: ReadonlySet<number>
  /**
   * Effectively-rejected set — the union of the user-rejected set
   * and any pending layer below the zero-thickness tolerance. The
   * caller (component) computes this via useMemo so it stays stable
   * across renders that don't change suggestions / edits / accepted /
   * rejected.
   */
  effectivelyRejectedIndices: ReadonlySet<number>
  /**
   * Commit a pending edit. May be undefined when the component is
   * rendered read-only; the hook no-ops in that case.
   */
  onEdit:
    | ((idx: number, edit: LithoSuggestionEdit) => void)
    | undefined
  /** Reject a pending layer (also used by the zero-thickness auto-reject). */
  onReject: (idx: number) => void
  /** Optional — Shift+drag absorb gesture. Hook no-ops the absorb
   *  branch when this prop is absent. */
  onAbsorbLayer?: (draggerIdx: number, direction: 'up' | 'down') => void
  /** Optional — chain-merge path. Falls back to ``onReject`` when
   *  absent (backwards-compat for callers that haven't opted in). */
  onMergeLayers?: (upperIdx: number) => void
}

export interface UseBoundaryDragReturn {
  /** Current drag state, or null when no drag is in progress. */
  drag: BoundaryDragState | null
  /** Begin a drag. Called by the hit-strip onMouseDown after
   *  computing the bounds via ``computeDragBounds``. */
  startDrag: (start: BoundaryDragStart) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * See file-level comment. Behaviour pinned by the existing
 * ``LithoSuggestionGhostColumns.test.tsx`` suite (88 cases as of
 * 2026-05-30); this hook is the implementation host, the suite is the
 * contract.
 */
export function useBoundaryDrag(
  params: UseBoundaryDragParams,
): UseBoundaryDragReturn {
  const {
    pxPerM,
    suggestions,
    edits,
    acceptedIndices,
    effectivelyRejectedIndices,
    onEdit,
    onReject,
    onAbsorbLayer,
    onMergeLayers,
  } = params

  const [drag, setDrag] = useState<BoundaryDragState | null>(null)

  const startDrag = useCallback((start: BoundaryDragStart) => {
    setDrag({
      ...start,
      currentDepthM: start.initialDepthM,
      snapped: false,
      snapTargetM: null,
      collapseChainOnRelease: [],
      absorbPending: null,
    })
  }, [])

  // Document-level mousemove + mouseup while a drag is active. The
  // hit-zones are SVG rects but the mouse can leave them during a
  // drag; attaching to document keeps the gesture coherent. Final
  // depth fires through ``onEdit`` / ``onReject`` / ``onAbsorbLayer``
  // exactly once on mouseup.
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
      // physically cannot cross any other layer's boundary.
      const clamped = Math.max(
        drag.boundsAboveM,
        Math.min(drag.boundsBelowM, raw),
      )
      // Snap visual — fires ONLY when the user has explicitly OVERSHOT
      // the bound (cursor past the bound by more than the snap
      // threshold). Use the UN-clamped cursor depth so an "I overshot
      // the ground" gesture (e.g. top-drag UP past surface) still
      // registers as a deliberate merge intent on the above-bound.
      const rawUnclamped = drag.initialDepthM + depthDelta
      const snappedAtAbove =
        snapThresholdM > 0 && rawUnclamped < drag.boundsAboveM - snapThresholdM
      const snappedAtBelow =
        snapThresholdM > 0 && rawUnclamped > drag.boundsBelowM + snapThresholdM
      // If both bounds are within threshold simultaneously (layer
      // narrower than 2 * snapThresholdM), prefer the one closer to
      // the cursor.
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

      // Shift+drag absorb gesture (dogfeed 2026-05-25). When the user
      // holds Shift AND the cursor has crossed the neighbour's
      // MIDPOINT, set absorbPending so the indicator renders and the
      // mouseup handler fires onAbsorbLayer.
      let absorbPending: 'up' | 'down' | null = null
      if (e.shiftKey && onAbsorbLayer !== undefined) {
        if (drag.edge === 'base') {
          const neighbourBelow = findVisibleNeighbourBelow(
            drag.idx,
            suggestions.length,
            acceptedIndices,
            effectivelyRejectedIndices,
          )
          if (
            neighbourBelow !== null &&
            neighbourBelow.kind === 'pending' &&
            !neighbourBelow.crossedRejected
          ) {
            const { topM: nTop, baseM: nBase } = effectiveDepths(
              suggestions,
              edits,
              neighbourBelow.idx,
            )
            const midpoint = nTop + (nBase - nTop) / 2
            if (rawUnclamped > midpoint) {
              absorbPending = 'down'
            }
          }
        } else {
          const neighbourAbove = findVisibleNeighbourAbove(
            drag.idx,
            acceptedIndices,
            effectivelyRejectedIndices,
          )
          if (
            neighbourAbove !== null &&
            neighbourAbove.kind === 'pending' &&
            !neighbourAbove.crossedRejected
          ) {
            const { topM: nTop, baseM: nBase } = effectiveDepths(
              suggestions,
              edits,
              neighbourAbove.idx,
            )
            const midpoint = nTop + (nBase - nTop) / 2
            if (rawUnclamped < midpoint) {
              absorbPending = 'up'
            }
          }
        }
      }

      setDrag(d =>
        d !== null
          ? {
              ...d,
              currentDepthM: next,
              snapped: snapTargetM !== null,
              snapTargetM,
              collapseChainOnRelease,
              absorbPending,
            }
          : null,
      )
    }
    function handleUp(): void {
      if (!drag) return

      // Shift+drag absorb — takes priority over the normal clamp/snap
      // path. When absorbPending is set, fire onAbsorbLayer and skip
      // the depth-commit + auto-reject path entirely.
      if (drag.absorbPending !== null && onAbsorbLayer !== undefined) {
        onAbsorbLayer(drag.idx, drag.absorbPending)
        setDrag(null)
        return
      }

      const final = drag.currentDepthM
      const chain = drag.snapped ? drag.collapseChainOnRelease : []

      // Zero-thickness auto-reject (fix A, dogfeed 2026-05-30). If the
      // commit would collapse the dragged layer onto its own opposite
      // edge (within tolerance), reject the layer outright instead of
      // emitting a depth edit. Without this, the layer survives in
      // state as a zero-thickness pending entry — visually gone (rect
      // early-returns at height ≤ 0.5 px) but still in the suggestions
      // array, where the bound walkers return its FAR edge as the
      // clamp for the next layer's drag, locking that drag at the
      // shared boundary depth.
      const ownDepths = effectiveDepths(suggestions, edits, drag.idx)
      const collapsesToZero =
        drag.edge === 'top'
          ? final >= ownDepths.baseM - ZERO_THICKNESS_M
          : final <= ownDepths.topM + ZERO_THICKNESS_M
      if (collapsesToZero) {
        onReject(drag.idx)
        setDrag(null)
        return
      }

      // Predict whether the primary onEdit will trigger a cross-merge
      // absorb inside the parent reducer's applyCrossMergeOnDrag. If
      // it will, two follow-up emissions become incorrect and MUST be
      // suppressed (dogfeed 2026-05-26 — bottom layer turning into
      // the dragger's lithology after a drag-up): (1) the secondary
      // onEdit on the partner, (2) the chain onMergeLayers.
      let partnerWillBeAbsorbed = false
      if (drag.edge === 'top') {
        const visible = nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices)
        partnerWillBeAbsorbed = (() => {
          if (visible === null) return false
          if (acceptedIndices.has(visible)) return false
          const partner = suggestions[visible]
          if (partner === undefined) return false
          const partnerTop = edits?.get(visible)?.depth_top_m ?? partner.depth_top_m
          return final <= partnerTop
        })()
        if (onEdit) onEdit(drag.idx, { depth_top_m: final })
        if (!partnerWillBeAbsorbed && visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_base_m: final, _propagateOnly: true })
        }
      } else {
        const visible = nearestVisibleIndexBelow(drag.idx, suggestions.length, effectivelyRejectedIndices)
        partnerWillBeAbsorbed = (() => {
          if (visible === null) return false
          if (acceptedIndices.has(visible)) return false
          const partner = suggestions[visible]
          if (partner === undefined) return false
          const partnerBase = edits?.get(visible)?.depth_base_m ?? partner.depth_base_m
          return final >= partnerBase
        })()
        if (onEdit) onEdit(drag.idx, { depth_base_m: final })
        if (!partnerWillBeAbsorbed && visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_top_m: final, _propagateOnly: true })
        }
      }
      // Resolve each chain entry. Two cases:
      //   i === drag.idx → self-collapse: the dragged layer folded
      //     onto its own opposite edge. onReject keeps it in
      //     suggestions as a rejected layer so the user can undo.
      //   i !== drag.idx → neighbour absorbed: onMergeLayers REMOVES
      //     the absorbed layer from suggestions entirely (avoids the
      //     zero-thickness rejected zombie that freezes bounds).
      for (const i of chain) {
        // Skip the chain entry when the cross-merge helper will
        // absorb the partner — the chain's idx was computed BEFORE
        // the helper's index-shift, so firing onMergeLayers now would
        // target the wrong layer post-shift.
        if (partnerWillBeAbsorbed && i !== drag.idx) continue
        if (i !== drag.idx && onMergeLayers !== undefined) {
          // upperIdx is the smaller index — the surviving layer.
          onMergeLayers(Math.min(drag.idx, i))
        } else {
          onReject(i)
        }
      }
      setDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  // reason: onAbsorbLayer + onMergeLayers identities are stable
  // (useCallback in the parent). edits is a ReadonlyMap that changes
  // by reference on every edit commit; listing it here keeps the
  // closure fresh for the absorb-midpoint lookup. suggestions is a
  // readonly array that changes by reference on accept; same pattern
  // as onEdit. effectivelyRejectedIndices is a useMemo set whose
  // identity tracks its inputs.
  }, [drag, pxPerM, onEdit, onReject, onAbsorbLayer, onMergeLayers, suggestions, edits, acceptedIndices, effectivelyRejectedIndices])

  return { drag, startDrag }
}
