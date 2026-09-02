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

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerSuggestion,
} from '../../api/client'
import { useBoundaryDrag } from '../../hooks/useBoundaryDrag'
import { lithoDisplayName } from '../../utils/lithoLabels'
import { formatNadClass } from '../../utils/formatNadClass'
import { canMergeAt } from '../../utils/lithoLayerMerge'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import CopyCompositionConfirmDialog from './CopyCompositionConfirmDialog'
import HoverReadoutCard from './HoverReadoutCard'
import { useT } from '../../i18n/translate'
import MultiLineLabel from './MultiLineLabel'
import { lookupCptValueAtDepth } from './cptInterpolation'
import { depthAxisAtSurface } from './utils'
import type { PlacedColumn } from './utils'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
} from '../../utils/lithoConstants'
import {
  ZERO_THICKNESS_M,
  computeDragBounds,
  effectiveDepths,
  nearestVisibleIndexAbove,
  nearestVisibleIndexBelow,
} from '../../utils/lithoBoundaryHelpers'
import { LithoSuggestionLayer } from './LithoSuggestionLayer'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const HEADER_FONT_SIZE = 8

/**
 * Half-height of the edge/boundary hit-strip in pixels. Picked so the
 * pending suggestion's hit-strip (2 * 5 = 10 px tall) fully shadows
 * the committed contact's drag strip in ``ContactsLayer`` (which is
 * also 10 px tall — ``DRAG_HIT_HALF_HEIGHT_PX = 5``). SVG paint order
 * (``LithoSuggestionGhostColumns`` is rendered AFTER ``ContactsLayer``
 * in ``SectionPanel``) then guarantees the pending hit-strip wins
 * mousedown on the shared boundary.
 *
 * Pre-2026-05-30 this was 3 px → suggestion strip was 6 px tall →
 * the 4-px outer ring of the contact strip (between 3 and 5 px from
 * the boundary y) had no overlapping suggestion pixel and grabbed the
 * mousedown, so the user grabbing "the pending edge" actually grabbed
 * the committed contact and dragged it off, opening a visible gap
 * (P2 of the dogfeed report 2026-05-30).
 */
const HIT_STRIP_HALF_PX = 5




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
    /** Internal marker — see ``LithoSuggestionEdit._propagateOnly``. */
    _propagateOnly?: boolean
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
  // onAbsorbLayer removed by owner directive 2026-06-04. The plain
  // drag-to-collapse path is the single absorb surface; Shift+drag was
  // deleted because it was never used and added gesture complexity.
  /**
   * "Extend to nearest contacts" right-click gesture on a pending ghost
   * layer.  Fired when the user picks the menu item; returns
   * ``{ ok: true }`` on success or ``{ ok: false, reason }`` on overlap.
   * When absent the menu item is not rendered (zero regression for callers
   * that haven't opted in).
   */
  onExtendToNearest?: (idx: number) => { ok: boolean; reason?: string }
  /**
   * Slice 3 of unified-boundary-drag (2026-05-30): committed litho
   * contacts for the focused anchor. The hook scans this list when a
   * pending drag's mouseup lands at an accepted neighbour's far edge
   * — finds the contact whose depth_top_m equals the pre-drag
   * boundary depth and fires ``onUpdateContactDepth`` so the
   * committed contact follows the pending edit (the "drag at any
   * stage" delivery). Optional + defaults to an empty list so
   * existing callers (tests, the bulk-ghost path) keep working with
   * zero behaviour change — the cross-store dispatch is a no-op when
   * either prop is absent.
   */
  committedContactsForAnchor?: readonly FormationContactResponse[]
  /**
   * Robust-fix follow-up (dogfeed 2026-05-30): contact ids the API
   * returned per accepted suggestion idx. Lets the hook's cross-
   * store dispatch resolve the committed contact by IDENTITY instead
   * of by depth-tolerance match, surviving contact-drift drag
   * sequences. Optional — falls back to depth match when absent.
   */
  contactIdsByAcceptedIdx?: ReadonlyMap<number, readonly string[]>
  /**
   * Slice 3: PATCH callback fired when the dragged boundary crosses
   * into accepted territory and a matching committed contact exists.
   * Same signature as ContactsLayer's drag commit (uses the existing
   * snap-aware wrapper at the SectionsCanvas level so the post-PATCH
   * litho-geo snap prompt still fires identically). Optional — when
   * absent the cross-store dispatch is a no-op.
   *
   * ``field`` selects which depth dimension is written:
   * ``'top'`` for the below-neighbour case (its TOP moves);
   * ``'base'`` for the above-neighbour case (its BASE shrinks or extends).
   */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
    field: 'top' | 'base',
  ) => Promise<void>
  /**
   * P1b (dogfeed 2026-05-30) — live preview callback fired on every
   * mousemove during a cross-store drag. ``contactId === null``
   * clears the preview. The caller (SectionsCanvas) holds a state
   * Map<contactId, depthM> + passes it to ContactsLayer so the
   * committed contact renders at the live drag depth until mouseup.
   * Optional — when absent the preview is a no-op.
   */
  onContactLivePreview?: (
    contactId: string | null,
    liveDepthM: number,
  ) => void
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
  formations = [],
  edits,
  onEdit,
  onCrossColumnPaste,
  onInsertLayer,
  onSplitLayer,
  onMergeLayers,
  onExtendToNearest,
  committedContactsForAnchor,
  contactIdsByAcceptedIdx,
  onUpdateContactDepth,
  onContactLivePreview,
  cptPlotByAnchorId,
}: LithoSuggestionGhostColumnsProps): JSX.Element | null {
  const t = useT()
  // Live drag preview state. Set on mousedown on an edge handle;
  // updated on document mousemove; cleared on mouseup which fires
  // ``onEdit`` once with the final depth. Pre-commit edit lives only
  // in this local state — committed edits are echoed back via the
  // ``edits`` prop on the next render.
  //
  // Hooks live ABOVE all early returns (suggestions.length === 0 /
  // !surfaceElevationM / !col) so the hook count is invariant —
  // CLAUDE.md "Temporal Dead Zone after reordering React component
  // bodies" / Rules of Hooks.
  //
  // The drag state + the document-level mousemove/mouseup listeners
  // were extracted into ``useBoundaryDrag`` (Slice 1 of the unified
  // boundary drag work). The component owns the hit-strip render +
  // their onMouseDown callbacks; the hook owns the live drag state
  // and the mouseup commit dispatch (onEdit / onReject /
  // onMergeLayers + the zero-thickness auto-reject).
  // ``startDrag`` is what the hit-strip onMouseDowns call; ``drag``
  // is what the indicator + readout renderers consume.

  // ZERO-THICKNESS SAFETY NET. A pending layer with effective thickness
  // below ZERO_THICKNESS_M is treated as effectively rejected for ALL
  // internal walkers (computeDragBounds, nearestVisibleIndex*,
  // findVisibleNeighbour*). Reason: a drag that collapses a layer's top
  // edge onto its base commits a plain depth edit but DOES NOT mark the
  // layer rejected (snap-to-collapse only fires on deliberate overshoot
  // past the threshold). The collapsed rect early-returns at
  // ``height ≤ 0.5px`` so the user sees the layer "gone" — but it
  // survives in state as a zero-thickness pending entry whose effective
  // top/base both sit at the shared boundary depth, locking the next
  // layer's drag at that boundary. Folding it into the rejected set at
  // the walker boundary is the bound-walker safety net (B); the
  // commit-side auto-reject below in handleUp is the primary fix (A).
  // Layers explicitly in ``rejectedIndices`` win regardless; accepted
  // layers are untouched (they have legitimate zero-thickness committed
  // state in some edge cases and should remain barriers per their own
  // accepted-neighbour rule).
  const effectivelyRejectedIndices = useMemo(() => {
    const out = new Set(rejectedIndices)
    for (let i = 0; i < suggestions.length; i++) {
      if (acceptedIndices.has(i) || out.has(i)) continue
      const { topM, baseM } = effectiveDepths(suggestions, edits, i)
      if (baseM - topM < ZERO_THICKNESS_M) out.add(i)
    }
    return out
  }, [suggestions, edits, acceptedIndices, rejectedIndices])

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

  // pxPerM derived from levelToScreen via depthAxisAtSurface (a linear
  // transform — sample two points). Guards against zero when the section
  // is too narrow to render the band. Lifted before the early returns so
  // the ref stays stable; the inner JSX guards on surfaceElevationM anyway.
  const { surfaceY, pxPerMetreDown: pxPerM } =
    surfaceElevationM != null
      ? depthAxisAtSurface(levelToScreen, surfaceElevationM)
      : { surfaceY: 0, pxPerMetreDown: 0 }

  const { drag, startDrag } = useBoundaryDrag({
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
  })


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
          targetLabel: lithoDisplayName(tgtEffectiveLitho, tgtEffectiveAdmix),
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

  // Debt #142 — diagonal-line pattern for the PENDING-state overlay.
  // Once a layer is accepted it's hidden entirely; pending layers wear
  // this hatching so the user reads "still suggestion, awaiting your
  // accept/reject" at a glance, distinct from the solid fill of a
  // committed contact band.  Unique id per investigation so two
  // sibling ghost-column instances (single-anchor + bulk) don't
  // collide on the same SVG-wide id.
  const hatchPatternId = `litho-pending-hatch-${investigationId}`
  return (
    <>
    <g data-testid="litho-suggestion-ghosts">
      <defs>
        <pattern
          id={hatchPatternId}
          patternUnits="userSpaceOnUse"
          width={6}
          height={6}
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={6} stroke="#000000" strokeOpacity={0.28} strokeWidth={1.4} />
        </pattern>
      </defs>
      {/* Column header — "Litho" label above the plot top. */}
      <text
        x={left + ghostWidth / 2}
        y={plotTop - 3}
        textAnchor="middle"
        fontSize={HEADER_FONT_SIZE}
        fill="#6b7280"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {t('sections.axis.litho')}
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
            !effectivelyRejectedIndices.has(idx)
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
                effectivelyRejectedIndices,
              ) === idx
            ) {
              topM = drag.currentDepthM
            }
            if (
              drag.edge === 'top' &&
              nearestVisibleIndexAbove(drag.idx, effectivelyRejectedIndices) === idx
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
        // Use the effective set so zero-thickness pending layers also
        // gate their hit-strips off (drag handles + boundary strip
        // alike) — same effect as a user-rejected layer. The explicit
        // rejected-from-prop is a subset of this, so the strikethrough
        // / unreject icon rendering inside LithoSuggestionLayer keeps
        // its existing semantics because the inner component only
        // renders when height > 0.5 px (zero-thickness layers return
        // null inside LithoSuggestionLayer anyway).
        const rejected = effectivelyRejectedIndices.has(idx)
        // Debt #142 — once a layer is accepted, the committed
        // FormationContact takes over as the source of truth.  The
        // ghost rect was previously frozen-in-place at the raw
        // suggestion depth, which read as a "phantom" contact at the
        // OLD position once the user dragged the committed contact.
        // Skip the layer entirely so the committed contact stands
        // alone.  ``acceptedIndices`` is still consulted by the
        // bounds-walk helpers (which compute neighbours from
        // suggestions, not from rendered rects), so drag clamping
        // across an accepted layer keeps working.
        if (accepted) return null
        // Drag handles only when onEdit is wired AND the layer is
        // still pending. Rejected layers are frozen.
        const dragHandlesEnabled = onEdit !== undefined && !rejected
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
          !effectivelyRejectedIndices.has(nextIdx)
        return (
          <g
            key={`${idx}-${rawLayer.suggested_lithology}-${rawLayer.depth_top_m}`}
            data-testid={`litho-band-group-${idx}`}
          >
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
              hatchPatternId={hatchPatternId}
              onAccept={onAccept}
              onReject={onReject}
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
                    Half-height matches ContactsLayer so the pending
                    strip fully shadows the contact strip on shared
                    boundaries (see HIT_STRIP_HALF_PX). */}
                <rect
                  x={left}
                  y={topY - HIT_STRIP_HALF_PX}
                  width={ghostWidth}
                  height={HIT_STRIP_HALF_PX * 2}
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
                      effectivelyRejectedIndices,
                    )
                    startDrag({
                      idx,
                      edge: 'top',
                      initialClientY: e.clientY,
                      initialDepthM: topM,
                      ...bounds,
                    })
                  }}
                />
                {/* Base-edge handle — drag moves only this layer's BASE.
                    Half-height matches ContactsLayer (see HIT_STRIP_HALF_PX). */}
                <rect
                  x={left}
                  y={baseY - HIT_STRIP_HALF_PX}
                  width={ghostWidth}
                  height={HIT_STRIP_HALF_PX * 2}
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
                      effectivelyRejectedIndices,
                    )
                    startDrag({
                      idx,
                      edge: 'base',
                      initialClientY: e.clientY,
                      initialDepthM: baseM,
                      ...bounds,
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
          // and Rf at the dragged depth via the shared
          // ``lookupCptValueAtDepth`` interpolator — the same helper the
          // committed-contact drag readout uses (SectionPanel's
          // getCptValuesAtDepth), so the two mirrored readouts agree.
          // Boreholes hit this path with no cptPlot → only depth + mTAW
          // lines render (backwards-compatible).
          const plot =
            col.kind === 'cpt' && cptPlotByAnchorId
              ? cptPlotByAnchorId.get(investigationId) ?? null
              : null
          const readoutLines: { text: string }[] = [
            { text: `depth ${drag.currentDepthM.toFixed(2)} m` },
            { text: `${elevation >= 0 ? '+' : ''}${elevation.toFixed(2)} m TAW` },
          ]
          if (plot !== null && plot.depths_m.length > 0) {
            const qc = lookupCptValueAtDepth(plot.depths_m, plot.qc_mpa, drag.currentDepthM)
            if (qc !== null && Number.isFinite(qc)) {
              readoutLines.push({ text: `qc ${qc.toFixed(2)} MPa` })
            }
            const rf = lookupCptValueAtDepth(
              plot.depths_m,
              plot.rf_pct ?? [],
              drag.currentDepthM,
            )
            if (rf !== null && Number.isFinite(rf)) {
              readoutLines.push({ text: `Rf ${rf.toFixed(2)} %` })
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
          plus a contextual hint label.
          - "release to merge"    — neighbour will be absorbed (chain=[neighbour.idx])
          - "release to collapse" — dragged layer collapses onto itself (chain=[own.idx])
          NOT shown for outer-edge snap (chain=[]): cursor hit the test-bottom
          or ground surface, so snapping here changes nothing on release and
          showing "release to merge" is misleading (dogfeed 2026-05-25). */}
      {drag?.snapped &&
        drag.snapTargetM !== null &&
        drag.collapseChainOnRelease.length > 0 && (
        <g data-testid="litho-snap-indicator" style={{ pointerEvents: 'none' }}>
          {(() => {
            const y = Math.max(
              plotTop,
              Math.min(
                plotBottom,
                levelToScreen(surfaceElevationM - drag.snapTargetM),
              ),
            )
            const label =
              drag.collapseChainOnRelease[0] === drag.idx
                ? 'release to collapse'
                : 'release to merge'
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
                  {label}
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
          aria-label={t('sections.menu.ghostActions')}
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
            {t('sections.menu.acceptLayer')}
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
              {t('sections.menu.editComposition')}
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
              {t('sections.menu.splitLayer')}
            </button>
          )}
          {/* Extend a manual-ghost sentinel to the nearest committed contacts.
              Only offered when the caller has wired onExtendToNearest
              (litho-axis only; geological axis doesn't use ghosts). */}
          {onExtendToNearest && (
            <button
              type="button"
              className="block w-full text-left px-3 py-1.5 hover:bg-surface-page text-text-primary"
              data-testid="litho-context-extend"
              onClick={() => {
                const result = onExtendToNearest(contextMenu.idx)
                setContextMenu(null)
                if (!result.ok && result.reason) {
                  // No toast infrastructure at this component level —
                  // surface as a browser alert so the user is not silently
                  // stuck.  The caller (SectionsCanvas) can upgrade this
                  // to a toast in a follow-up if desired.
                  alert(result.reason)
                }
              }}
            >
              {t('sections.menu.extendToNearest')}
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
            {t('sections.menu.rejectLayer')}
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
          aria-label={t('sections.menu.boundaryActions')}
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
            {t('sections.menu.insertLayerHere')}
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
              effectivelyRejectedIndices,
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
                {t('sections.menu.mergeLayers')}
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
          {t('sections.ghost.copyChip', {
            litho: lithoDisplayName(
              edits?.get(copyDrag.sourceIdx)?.suggested_lithology ??
                suggestions[copyDrag.sourceIdx]?.suggested_lithology ??
                '?',
              edits?.get(copyDrag.sourceIdx)?.suggested_admixtures ??
                suggestions[copyDrag.sourceIdx]?.suggested_admixtures ??
                [],
            ),
          })}
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

