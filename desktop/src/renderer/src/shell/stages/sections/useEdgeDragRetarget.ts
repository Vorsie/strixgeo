/**
 * Drag-to-retarget unapproved correlation edge (#133 Phase 2+3 Task 26) —
 * extracted verbatim from SectionsCanvas.tsx (debt #201 round 2).
 *
 * The user mousedowns on a grab handle (unapproved edge endpoint), drags to a
 * different contact hit-rect on the section, and releases. Plain drag
 * retargets the grabbed end; Ctrl/Cmd-drag leaves the original edge and
 * creates an extra one (the lens gesture, #31). See the inline comments for
 * the drop-validation and Option-Y approval semantics.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api/client'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'

/** Everything the drag state machine consumes from the SectionsCanvas scope. */
export interface UseEdgeDragRetargetDeps {
  /** Litho contacts on this section (anchor/drop investigation lookups). */
  lithoContacts: FormationContactResponse[]
  /** Active lithostratigraphic model (drop commits require one). */
  activeLithoModel: GeologicalModelResponse | null
  /** Current project id. */
  projectId: string
  /** Selected cross-section id — scopes deleted/created edges. */
  selectedSectionId: string | null
  /** Refetch the contact-correlation edge list. */
  refetchContactEdges: () => Promise<void>
  /** Refetch the litho contact list. */
  refetchLithoContacts: () => void | Promise<void>
  /** Refetch lens/body data (wedges may materialise server-side). */
  refetchLensData: () => void
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Schedule the litho model's body-identity recompute (slice 5). Optional so
   *  existing test fixtures need not supply it; call sites guard with ``?.()``. */
  requestBodyRecompute?: (kind: 'litho' | 'geotech') => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

export interface EdgeDragState {
  /** The edge being re-targeted. */
  edge: LithoContactCorrelationEdge
  /** Which endpoint is being dragged: 'a' or 'b'. */
  handle: 'a' | 'b'
  /** Contact id of the NON-dragged endpoint (the stable anchor). */
  anchorContactId: string
  /** Contact id of the endpoint being dragged (used to detect drop-on-self). */
  draggedContactId: string
  /** Investigation id of the anchor contact (used to reject same-investigation drops). */
  anchorInvestigationId: string | null
  /** True when Ctrl/Cmd was held at drag start: LEAVE the original edge and
   *  CREATE a new one to the drop (the "create an extra boundary" gesture —
   *  forms a lens when the drop is the layer's other boundary). False = plain
   *  drag = retarget the grabbed end (#31). */
  duplicate: boolean
  /** Current cursor X in viewport coords (updated on mousemove). */
  cursorViewportX: number
  /** Current cursor Y in viewport coords (updated on mousemove). */
  cursorViewportY: number
}

/** Live drag state + the mousedown starter returned to SectionsCanvas. */
export interface UseEdgeDragRetargetResult {
  edgeDrag: EdgeDragState | null
  handleUnapprovedDragStart: (
    e: React.MouseEvent,
    edge: LithoContactCorrelationEdge,
    handle: 'a' | 'b',
  ) => void
}

/**
 * Window-level drag state machine for re-targeting an unapproved edge.
 *
 * Parameters
 * ----------
 * deps : UseEdgeDragRetargetDeps
 *     Shared SectionsCanvas state + shell actions the handlers close over.
 *
 * Returns
 * -------
 * UseEdgeDragRetargetResult
 *     The live ``edgeDrag`` state and the grab-handle mousedown handler.
 */
export function useEdgeDragRetarget(deps: UseEdgeDragRetargetDeps): UseEdgeDragRetargetResult {
  const {
    lithoContacts,
    activeLithoModel,
    projectId,
    selectedSectionId,
    refetchContactEdges,
    refetchLithoContacts,
    refetchLensData,
    markMutated,
    requestBodyRecompute,
    toast,
  } = deps

  // -----------------------------------------------------------------------
  // Drag-to-retarget unapproved edge (#133 Phase 2+3 Task 26).
  //
  // The user mousedowns on a grab handle (unapproved edge endpoint), drags
  // to a different contact hit-rect on the section, and releases.  On drop:
  //   1. DELETE the original edge (old contact pair).
  //   2. POST a new edge (anchor contact + new drop-target contact).
  //   3. Refetch contact edges so the section reflects the re-targeted edge.
  //
  // The new edge uses source='manual' which the server sets to user_approved=True
  // by default — Option Y: re-targeting an auto suggestion is itself a form
  // of user blessing, so the resulting edge is treated as approved.  This is
  // simpler than adding a user_approved field to the create API and avoids
  // threading an extra backend change through the path.
  //
  // Coordinate system: viewport coords are stored in state; the overlay
  // converts them to SVG-local by reading ownerSVGElement.getBoundingClientRect().
  // -----------------------------------------------------------------------


  const [edgeDrag, setEdgeDrag] = useState<EdgeDragState | null>(null)

  // Fresh-read ref: the window-level mouseup must judge the drop against the
  // CURRENT contact list, not the drag-start snapshot — a refetch completing
  // mid-drag can reassign the drop target's investigation, and the
  // same-investigation guard has to see that (review finding 2026-07-13).
  // Updated every render; read inside handleMouseUp only.
  const lithoContactsRef = useRef(lithoContacts)
  lithoContactsRef.current = lithoContacts

  const handleUnapprovedDragStart = useCallback(
    (
      e: React.MouseEvent,
      edge: LithoContactCorrelationEdge,
      handle: 'a' | 'b',
    ): void => {
      e.preventDefault()
      const draggedContactId = handle === 'a' ? edge.layer_a_id : edge.layer_b_id
      const anchorContactId = handle === 'a' ? edge.layer_b_id : edge.layer_a_id
      // Resolve anchor investigation id to block same-investigation-as-anchor
      // drops. Ctrl/Cmd at drag start selects "leave + create another"
      // (duplicate → lens) vs plain "retarget the grabbed end".
      const anchorContact = lithoContacts.find(c => c.id === anchorContactId)
      const anchorInvestigationId = anchorContact?.cpt_id ?? anchorContact?.borehole_id ?? null
      const duplicate = e.ctrlKey || e.metaKey
      log.debug(
        'section',
        `edgeDrag: start edge=${edge.id} handle=${handle} dragged=${draggedContactId} ` +
          `anchor=${anchorContactId} duplicate=${duplicate}`,
      )
      setEdgeDrag({
        edge,
        handle,
        anchorContactId,
        draggedContactId,
        anchorInvestigationId,
        duplicate,
        cursorViewportX: e.clientX,
        cursorViewportY: e.clientY,
      })
    },
    [lithoContacts],
  )

  // Window-level mousemove + mouseup that drive the drag and commit the drop.
  useEffect(() => {
    if (edgeDrag === null) return

    function handleMouseMove(e: MouseEvent): void {
      setEdgeDrag(prev =>
        prev === null
          ? null
          : { ...prev, cursorViewportX: e.clientX, cursorViewportY: e.clientY },
      )
    }

    async function handleMouseUp(e: MouseEvent): Promise<void> {
      if (edgeDrag === null) {
        setEdgeDrag(null)
        return
      }
      // Hit-test the drop target via document.elementFromPoint (viewport coords).
      const dropEl = document.elementFromPoint(e.clientX, e.clientY)
      // Walk up the DOM to find the nearest element carrying data-contact-id.
      let el: Element | null = dropEl
      let dropContactId: string | null = null
      while (el !== null) {
        const cid = el.getAttribute('data-contact-id')
        if (cid) {
          dropContactId = cid
          break
        }
        el = el.parentElement
      }

      // Validate the drop target.
      if (dropContactId === null) {
        // Dropped on empty space — cancel.
        log.debug('section', 'edgeDrag: drop on empty space — cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.anchorContactId) {
        // Dropped on the anchor endpoint — no-op.
        log.debug('section', 'edgeDrag: drop on anchor — cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.draggedContactId) {
        // Dropped back on the same contact — no-op.
        log.debug('section', 'edgeDrag: drop on same contact — cancelled')
        setEdgeDrag(null)
        return
      }
      // Reject same-investigation: the server rejects this too, but fail early.
      const dropContact = lithoContactsRef.current.find(c => c.id === dropContactId)
      const dropInvestigationId = dropContact?.cpt_id ?? dropContact?.borehole_id ?? null
      if (
        edgeDrag.anchorInvestigationId !== null &&
        dropInvestigationId !== null &&
        dropInvestigationId === edgeDrag.anchorInvestigationId
      ) {
        log.debug(
          'section',
          `edgeDrag: drop on same investigation as anchor (${edgeDrag.anchorInvestigationId}) — rejected`,
        )
        setEdgeDrag(null)
        return
      }

      if (!activeLithoModel) {
        setEdgeDrag(null)
        return
      }

      // Clear drag state immediately so the UI feels responsive.
      const capturedDrag = edgeDrag
      setEdgeDrag(null)

      // Ctrl/Cmd-drag (#31): LEAVE the original edge and CREATE another from
      // the same anchor to the drop — "create an extra boundary where I drag
      // to". When the drop is the layer's OTHER boundary (anchor now connects
      // to both → 1↔2), DetectLithoLenses materialises a wedge.
      // ``createContactCorrelation`` is idempotent (re-creating an existing
      // unapproved edge would NOT approve it), so delete the original first
      // then create both fresh — both auto-approve. Direction-agnostic.
      if (capturedDrag.duplicate) {
        log.info(
          'section',
          `edgeDrag: duplicate edge=${capturedDrag.edge.id} anchor=${capturedDrag.anchorContactId} ↔ ` +
            `{${capturedDrag.draggedContactId}, ${dropContactId}}`,
        )
        try {
          await api.geology.deleteContactCorrelation(
            projectId,
            capturedDrag.edge.model_id,
            capturedDrag.edge.layer_a_id,
            capturedDrag.edge.layer_b_id,
            selectedSectionId,
            capturedDrag.edge.layer_a_side,
            capturedDrag.edge.layer_b_side,
          )
          // Re-create the original (now approved) + the twin to the dropped
          // boundary. The second create completes the 1↔2 and triggers the
          // lens materialisation server-side.
          await api.geology.createContactCorrelation(
            projectId,
            capturedDrag.edge.model_id,
            capturedDrag.anchorContactId,
            capturedDrag.draggedContactId,
            selectedSectionId,
          )
          await api.geology.createContactCorrelation(
            projectId,
            capturedDrag.edge.model_id,
            capturedDrag.anchorContactId,
            dropContactId,
            selectedSectionId,
          )
          await Promise.all([refetchContactEdges(), refetchLithoContacts()])
          void refetchLensData()
          markMutated()
          // New edges band geometry — schedule the litho identity recompute (slice 5).
          requestBodyRecompute?.('litho')
          log.success('section', 'edgeDrag: extra correlation created (anchor ↔ both targets)')
          toast('success', t('sections.toast.correlationAdded'))
        } catch (err) {
          log.warn('section', 'edgeDrag: duplicate-create failed', err)
          toast('error', t('sections.toast.correlationCreateFailed'))
          void refetchContactEdges()
          void refetchLensData()
        }
        return
      }

      log.info(
        'section',
        `edgeDrag: retarget edge=${capturedDrag.edge.id} ` +
          `${capturedDrag.draggedContactId} → ${dropContactId} (anchor=${capturedDrag.anchorContactId})`,
      )

      try {
        // 1. Delete the original edge.
        await api.geology.deleteContactCorrelation(
          projectId,
          capturedDrag.edge.model_id,
          capturedDrag.edge.layer_a_id,
          capturedDrag.edge.layer_b_id,
          selectedSectionId,
          capturedDrag.edge.layer_a_side,
          capturedDrag.edge.layer_b_side,
        )
        // 2. Create the replacement edge (anchor + new target).
        //    source='manual' → server defaults user_approved=True (Option Y).
        await api.geology.createContactCorrelation(
          projectId,
          capturedDrag.edge.model_id,
          capturedDrag.anchorContactId,
          dropContactId,
          selectedSectionId,
        )
        // 3. Refetch so the section reflects the re-targeted edge.
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        markMutated()
        // The tie moved — the litho body identity moved with it (slice 5).
        requestBodyRecompute?.('litho')
        log.success(
          'section',
          `edgeDrag: edge retargeted to ${capturedDrag.anchorContactId} ↔ ${dropContactId}`,
        )
        toast('success', t('sections.toast.edgeRetargeted'))
      } catch (err) {
        log.warn('section', 'edgeDrag: retarget failed', err)
        toast('error', t('sections.toast.edgeRetargetFailed'))
        // Restore edges from server on failure.
        void refetchContactEdges()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // reason: edgeDrag is the live drag object that drives both handlers;
    //   activeLithoModel, projectId, selectedSectionId, the api/log/toast
    //   refs, and markMutated (a stable App useCallback) are stable or
    //   captured in the same closure. lithoContacts is NOT stable (useMemo
    //   value) — the same-investigation guard reads it through
    //   lithoContactsRef so a refetch completing mid-drag is respected
    //   without re-registering window listeners mid-drag.
    //   The cleanup fn removes both listeners with the SAME named function
    //   references captured in this closure, which is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeDrag])

  return { edgeDrag, handleUnapprovedDragStart }
}
