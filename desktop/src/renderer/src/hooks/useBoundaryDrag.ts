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

import type { FormationContactResponse, LithoLayerSuggestion } from '../api/client'
import type { LithoSuggestionEdit } from './useGeologicalModel'
import { log } from '../utils/log'
import { crossMergeAbsorbTarget } from '../utils/lithoAbsorbRule'
import {
  ZERO_THICKNESS_M,
  effectiveDepths,
  findVisibleNeighbourAbove,
  findVisibleNeighbourBelow,
  nearestVisibleIndexAbove,
  nearestVisibleIndexBelow,
} from '../utils/lithoBoundaryHelpers'

/**
 * Tolerance (m) for matching a committed contact's ``depth_top_m`` to
 * a pre-drag boundary depth. Boundary depths should be equal exactly
 * because the contact was created at the suggestion's depth, but
 * intermediate edits (via ContactsLayer drag) can drift the contact
 * before the litho-side drag begins. 1 cm absorbs typical user-edit
 * drift; tighter would miss; looser risks matching the wrong contact
 * on layers narrower than the tolerance.
 */
const CONTACT_MATCH_TOLERANCE_M = 0.01

// ---------------------------------------------------------------------------
// State + start-params types
// ---------------------------------------------------------------------------

/**
 * Live drag state — set on mousedown via ``startDrag``, mutated on
 * each mousemove (current depth, snap), cleared on mouseup after the
 * commit dispatch.
 *
 * The Shift+drag absorb gesture (``absorbPending``) was removed by
 * owner directive 2026-06-04 — the plain drag-to-collapse path is the
 * single absorb surface. ``onAbsorbLayer`` is gone from the params.
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
  /** Optional — chain-merge path. Falls back to ``onReject`` when
   *  absent (backwards-compat for callers that haven't opted in). */
  onMergeLayers?: (upperIdx: number) => void
  /**
   * Slice 3 — committed litho contacts for the focused anchor,
   * pre-filtered by the caller. When a pending drag's mouseup lands
   * at an accepted neighbour's boundary, the hook scans this list
   * for a contact whose ``depth_top_m`` matches the pre-drag
   * boundary depth and fires ``onUpdateContactDepth`` so the
   * committed contact follows the pending edit.
   */
  committedContactsForAnchor?: readonly FormationContactResponse[]
  /**
   * Robust-fix follow-up to Slice 3 (dogfeed 2026-05-30): contact
   * ids the API returned per accepted suggestion idx. When set, the
   * cross-store dispatch picks the matching contact by IDENTITY
   * (filter committedContactsForAnchor by id) instead of by depth
   * tolerance — survives contact-drift drag sequences where the
   * committed contact's depth no longer matches the pending's
   * pre-drag boundary depth. Optional; absence falls back to the
   * pre-fix depth-tolerance match for backwards-compat.
   */
  contactIdsByAcceptedIdx?: ReadonlyMap<number, readonly string[]>
  /**
   * Slice 3 — PATCH callback fired when a pending drag moves a
   * shared boundary with an accepted neighbour. Optional — when
   * absent, the cross-store dispatch is a no-op.
   *
   * The ``field`` discriminator controls which depth dimension is written:
   * ``'top'`` moves ``depth_top_m`` (the below-neighbour case — the shared
   * boundary is the below layer's TOP); ``'base'`` moves ``depth_base_m``
   * (the above-neighbour case — dragging a pending TOP up into an accepted
   * layer above shrinks that layer's BASE, not its TOP).
   */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
    field: 'top' | 'base',
  ) => Promise<void>
  /**
   * P1b (dogfeed 2026-05-30) — live preview during a cross-store
   * drag. Fired on every mousemove with the committed contact id
   * + the cursor's live depth, so the section editor can render
   * that contact at the live depth (instead of its DB-committed
   * depth) until mouseup. ``contactId === null`` clears the
   * preview (drag isn't crossing accepted territory).
   *
   * Optional — when absent the preview is a no-op and the
   * committed contact only updates on mouseup PATCH success.
   */
  onContactLivePreview?: (
    contactId: string | null,
    liveDepthM: number,
  ) => void
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
    onMergeLayers,
    committedContactsForAnchor,
    contactIdsByAcceptedIdx,
    onUpdateContactDepth,
    onContactLivePreview,
  } = params

  const [drag, setDrag] = useState<BoundaryDragState | null>(null)

  /**
   * Robust-fix resolver (dogfeed 2026-05-30): given an accepted
   * neighbour's suggestion idx + the pre-drag boundary depth, return
   * the committed contact that owns this boundary.
   *
   * Identity-first path: if ``contactIdsByAcceptedIdx`` carries an
   * entry for this idx, scope the candidate pool to those ids and
   * pick the closest to the expected depth. Handles contact-drift
   * (user moved the committed contact in ContactsLayer after accept)
   * because the IDs survive the drift.
   *
   * Depth-tolerance fallback: when no id mapping is available (older
   * BulkAnchorGhost, accept-all multi-suggestion path that doesn't
   * populate the map yet), use the pre-fix 1-cm depth match. Works
   * as long as no drift has occurred.
   *
   * Returns null when no matching contact is found — caller skips
   * the cross-store PATCH silently.
   */
  function resolveContactForAcceptedNeighbour(
    acceptedIdx: number,
    expectedDepthM: number,
  ): FormationContactResponse | null {
    if (committedContactsForAnchor === undefined) return null
    const knownIds = contactIdsByAcceptedIdx?.get(acceptedIdx)
    if (knownIds !== undefined && knownIds.length > 0) {
      const idSet = new Set(knownIds)
      const candidates = committedContactsForAnchor.filter(c => idSet.has(c.id))
      if (candidates.length === 0) return null
      let best = candidates[0]
      let bestDist = Math.abs(best.depth_top_m - expectedDepthM)
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i]
        const d = Math.abs(c.depth_top_m - expectedDepthM)
        if (d < bestDist) {
          best = c
          bestDist = d
        }
      }
      return best
    }
    // Fallback: depth-tolerance match.
    const match = committedContactsForAnchor.find(
      c => Math.abs(c.depth_top_m - expectedDepthM) < CONTACT_MATCH_TOLERANCE_M,
    )
    return match ?? null
  }

  const startDrag = useCallback((start: BoundaryDragStart) => {
    // Diagnostic log — dogfeed 2026-05-31. The clamp values + the
    // effectively-rejected set at this exact moment fully determine
    // why a drag can or can't move in either direction. If a future
    // "drag-up locked after merge" report comes in, the very first
    // line in DevTools tells us:
    //   - The bounds the user is about to be clamped against.
    //   - Which sibling indices are treated as rejected.
    //   - The dragger's own current depth.
    // The bug-class (stale clamp / wrong rejection / wrong neighbour
    // walk) follows directly from comparing those.
    const rejectedList = [...effectivelyRejectedIndices].sort((a, b) => a - b)
    const acceptedList = [...acceptedIndices].sort((a, b) => a - b)
    log.info(
      'litho-drag',
      `startDrag idx=${start.idx} edge=${start.edge} initialDepth=${start.initialDepthM.toFixed(2)} boundsAbove=${start.boundsAboveM.toFixed(2)} boundsBelow=${start.boundsBelowM.toFixed(2)} collapseAbove=[${start.collapseChainAbove.join(',')}] collapseBelow=[${start.collapseChainBelow.join(',')}] rejected=[${rejectedList.join(',')}] accepted=[${acceptedList.join(',')}] nSuggestions=${suggestions.length}`,
    )
    setDrag({
      ...start,
      currentDepthM: start.initialDepthM,
      snapped: false,
      snapTargetM: null,
      collapseChainOnRelease: [],
    })
  }, [effectivelyRejectedIndices, acceptedIndices, suggestions.length])

  // Document-level mousemove + mouseup while a drag is active. The
  // hit-zones are SVG rects but the mouse can leave them during a
  // drag; attaching to document keeps the gesture coherent. Final
  // depth fires through ``onEdit`` / ``onReject`` / ``onMergeLayers``
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

      // P1b (dogfeed 2026-05-30) — live contact preview. When the
      // drag crosses an accepted neighbour, publish the matching
      // contact's live depth so the section editor renders the
      // committed contact at the live drag depth (instead of its
      // DB-committed depth) until mouseup. Without this the user
      // sees the pending edge move live but the committed contact
      // stay frozen until release — visible mismatch by design that
      // Slice 3 alone left unaddressed.
      if (onContactLivePreview !== undefined) {
        const neighbourIdx =
          drag.edge === 'top'
            ? nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices)
            : nearestVisibleIndexBelow(drag.idx, suggestions.length, effectivelyRejectedIndices)
        if (neighbourIdx !== null && acceptedIndices.has(neighbourIdx)) {
          const contact = resolveContactForAcceptedNeighbour(
            neighbourIdx,
            drag.initialDepthM,
          )
          if (contact !== null) {
            onContactLivePreview(contact.id, next)
          } else {
            onContactLivePreview(null, 0)
          }
        } else {
          onContactLivePreview(null, 0)
        }
      }
    }
    function handleUp(): void {
      if (!drag) return

      // Diagnostic log — dogfeed 2026-05-31. Dumps the final drag
      // state so the next "drag-up locked after merge" report has a
      // record of which branch fired and with what values. Pair with
      // the startDrag log to see the full lifecycle of every drag.
      const ownDepthsAtCommit = effectiveDepths(suggestions, edits, drag.idx)
      log.info(
        'litho-drag',
        `handleUp idx=${drag.idx} edge=${drag.edge} initial=${drag.initialDepthM.toFixed(2)} final=${drag.currentDepthM.toFixed(2)} snapped=${drag.snapped} chain=[${drag.collapseChainOnRelease.join(',')}] ownTopAtCommit=${ownDepthsAtCommit.topM.toFixed(2)} ownBaseAtCommit=${ownDepthsAtCommit.baseM.toFixed(2)}`,
      )

      // P1b — clear the live preview at the top of mouseup so that
      // whichever branch fires (zero-thickness reject, plain commit,
      // cross-store dispatch) the section editor stops rendering the
      // contact at the live drag depth. The committed-contact PATCH
      // refetch (Slice 3 via the audit-point wrapper) then takes over
      // rendering at the new persisted depth on the next render cycle.
      if (onContactLivePreview !== undefined) {
        onContactLivePreview(null, 0)
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
        // P1a (dogfeed 2026-05-30): after auto-rejecting the dragged
        // layer, also extend the neighbour in the drag direction so
        // the rejected layer's territory is filled instead of left as
        // a stub. Drag direction:
        //   TOP drag collapses by moving top DOWN to base → the
        //     LAYER ABOVE should extend its BASE down to the rejected
        //     layer's base.
        //   BASE drag collapses by moving base UP to top → the
        //     LAYER BELOW should extend its TOP up to the rejected
        //     layer's top.
        // If the receiving neighbour is ACCEPTED, the committed
        // contact at the OLD shared boundary needs the same depth
        // update — same audit-point PATCH as the Slice 3 cross-store
        // dispatch, just triggered by the auto-reject path.
        onReject(drag.idx)
        const fillBoundary =
          drag.edge === 'top' ? ownDepths.baseM : ownDepths.topM
        const neighbourIdx =
          drag.edge === 'top'
            ? nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices)
            : nearestVisibleIndexBelow(drag.idx, suggestions.length, effectivelyRejectedIndices)
        if (neighbourIdx !== null) {
          if (acceptedIndices.has(neighbourIdx)) {
            // Accepted neighbour: PATCH the contact so the survivor layer
            // extends to cover the rejected territory.
            //
            // Field discriminator:
            //   TOP drag collapses dragger → ABOVE neighbour fills down.
            //     The above neighbour's BASE extends: field = 'base'.
            //   BASE drag collapses dragger → BELOW neighbour fills up.
            //     The below neighbour's TOP extends: field = 'top'.
            //
            // Identity resolver handles contact-drift (above-layer case:
            // the contact's depth_top_m is the layer's TOP, not the shared
            // boundary; the identity map finds it by id when available).
            if (onUpdateContactDepth !== undefined) {
              const contact = resolveContactForAcceptedNeighbour(
                neighbourIdx,
                drag.initialDepthM,
              )
              if (contact !== null) {
                const field: 'top' | 'base' = drag.edge === 'top' ? 'base' : 'top'
                void onUpdateContactDepth(contact.id, fillBoundary, false, field)
              }
            }
          } else if (onEdit) {
            // Pending neighbour: extend its edit so the band grows
            // into the rejected territory.
            const fillEdit: LithoSuggestionEdit =
              drag.edge === 'top'
                ? { depth_base_m: fillBoundary }
                : { depth_top_m: fillBoundary }
            onEdit(neighbourIdx, fillEdit)
          }
        }
        setDrag(null)
        return
      }

      // Predict whether the primary onEdit will trigger a cross-merge
      // absorb inside the parent reducer's applyCrossMergeOnDrag. If
      // it will, two follow-up emissions become incorrect and MUST be
      // suppressed (dogfeed 2026-05-26 — bottom layer turning into
      // the dragger's lithology after a drag-up): (1) the secondary
      // onEdit on the partner, (2) the chain onMergeLayers.
      //
      // The prediction asks the reducer's OWN predicate
      // (``crossMergeAbsorbTarget``) rather than re-deriving one here. Owner
      // dogfeed 2026-09-11, installer #32 — "i split, renamed (added
      // admixture) then tried to pull up the boundary and then it went wrong
      // ... a whole suggestion disappeared": the local copy tested for a FULL
      // cross (released at or past the partner's far edge) while the reducer
      // absorbs as soon as the partner is eaten down to a sliver
      // (absorbRemainderThresholdM — at least 10 cm). In that window the
      // reducer merged and this commit still fired the partner edit, at an
      // index the merge had just shifted onto the merged layer itself, whose
      // far edge was then written onto its own near edge. Two rules that must
      // agree now have one definition.
      const absorbTarget = crossMergeAbsorbTarget(
        suggestions,
        edits,
        acceptedIndices,
        effectivelyRejectedIndices,
        drag.idx,
        drag.edge === 'top' ? { depth_top_m: final } : { depth_base_m: final },
      )
      const partnerWillBeAbsorbed = absorbTarget !== null
      if (drag.edge === 'top') {
        const visible = nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices)
        if (onEdit) onEdit(drag.idx, { depth_top_m: final })
        if (!partnerWillBeAbsorbed && visible !== null && !acceptedIndices.has(visible) && onEdit) {
          onEdit(visible, { depth_base_m: final, _propagateOnly: true })
        }
      } else {
        const visible = nearestVisibleIndexBelow(drag.idx, suggestions.length, effectivelyRejectedIndices)
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

      // Slice 3 of the unified-boundary-drag work (2026-05-30): cross-
      // store commit dispatch. When the dragged boundary is SHARED
      // with an ACCEPTED neighbour, also fire the committed contact's
      // PATCH so the contact follows the pending edit (the "drag at
      // any stage" delivery — owner directive Q1 audit-point framing).
      //
      // The dragger's edge moved from ``initialDepthM`` to ``final``.
      // The shared boundary depth (pre-drag) equals ``initialDepthM``.
      // We look up the committed contact whose ``depth_top_m`` matches
      // that depth (within tolerance) on this anchor, and PATCH it to
      // ``final``. ContactsLayer's same drag-commit path is used so
      // refetch / undo / litho-geo snap prompt fire identically.
      //
      // Gated on:
      //   - onUpdateContactDepth wired (caller opt-in).
      //   - The drag's neighbour in the drag direction is in
      //     acceptedIndices (we're at a pending-↔-accepted boundary).
      //   - A contact whose depth_top_m matches the pre-drag boundary
      //     depth exists on this anchor (the match is the audit point).
      //   - The drag actually moved the boundary (final !== initial).
      //
      // Optimistic local first per Q2: the onEdit above already
      // committed the local pending edit; this PATCH fires in
      // background. PATCH failure surfaces a toast via the wrapped
      // handler at the SectionsCanvas level — the local pending edit
      // is intentionally NOT rolled back here (deferring full
      // cross-store rollback to a follow-up; see spec Slice 3 risks).
      if (
        onUpdateContactDepth !== undefined &&
        Math.abs(final - drag.initialDepthM) > ZERO_THICKNESS_M
      ) {
        const neighbourIdx =
          drag.edge === 'top'
            ? nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices)
            : nearestVisibleIndexBelow(drag.idx, suggestions.length, effectivelyRejectedIndices)
        if (neighbourIdx !== null && acceptedIndices.has(neighbourIdx)) {
          // Robust resolver — identity match via contactIdsByAcceptedIdx
          // when available, depth-tolerance fallback otherwise.
          const contact = resolveContactForAcceptedNeighbour(
            neighbourIdx,
            drag.initialDepthM,
          )
          if (contact !== null) {
            // Field discriminator (same rule as the collapsesToZero path):
            //   TOP drag → neighbour is ABOVE → extend its BASE.
            //   BASE drag → neighbour is BELOW → extend its TOP.
            const field: 'top' | 'base' = drag.edge === 'top' ? 'base' : 'top'
            void onUpdateContactDepth(contact.id, final, drag.snapped, field)
          }
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
  // reason: onMergeLayers identity is stable (useCallback in the parent).
  // edits is a ReadonlyMap that changes by reference on every edit commit;
  // listing it here keeps the closure fresh. suggestions is a readonly
  // array that changes by reference on accept; same pattern as onEdit.
  // effectivelyRejectedIndices is a useMemo set whose identity tracks its inputs.
  }, [drag, pxPerM, onEdit, onReject, onMergeLayers, suggestions, edits, acceptedIndices, effectivelyRejectedIndices, committedContactsForAnchor, contactIdsByAcceptedIdx, onUpdateContactDepth, onContactLivePreview])

  return { drag, startDrag }
}
