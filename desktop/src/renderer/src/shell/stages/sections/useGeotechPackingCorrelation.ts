/**
 * Geotech packing-correlation handlers (spec §5) for ``SectionsCanvas``.
 *
 * Extracted verbatim from SectionsCanvas.tsx (debt #201 round 2). These
 * mirror the litho correlate handlers in SectionsCanvas but:
 *   (a) use activeGeotechModel instead of activeLithoModel,
 *   (b) call requestGeotechLayersRefetch after success so body_id stamps
 *       re-render (the geotech layer list is the body_id source, not the
 *       edges themselves).
 *   (c) do NOT touch litho state (refetchLithoContacts / undoStack pulse),
 *       keeping the geotech gesture self-contained.
 *
 * R1 directive (owner, 2026-06-25): the same-class / same-litho-body
 * canConnectPacking guard was DROPPED entirely — geotech packing ties are
 * now as permissive as litho's contact-correlate (no class / body /
 * lithology rejection). The litho-partition frame + the per-region
 * band/onlap/lens render keep the result sensible; an out-of-region
 * (nonsense) tie simply doesn't render, exactly like litho.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { api } from '../../../api/client'
import type {
  GeologicalModelResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'
import { markBoreholesStale } from '../../../utils/boreholesStaleStore'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'

/** Everything the two handlers consume from the SectionsCanvas scope. */
export interface UseGeotechPackingCorrelationDeps {
  /** Active geotechnical model (null until Subdivide all bodies has run). */
  activeGeotechModel: GeologicalModelResponse | null
  /** Current project id. */
  projectId: string
  /** Selected cross-section id — scopes the created/deleted edge. */
  selectedSectionId: string | null
  /** Refetch the litho contact-correlation edge list. */
  refetchContactEdges: () => Promise<void>
  /** Refetch the geotech packing edge list. */
  refetchGeotechPackingEdges: () => Promise<boolean>
  /** Ask the shell to refetch geotech layers (body_id stamp source). */
  requestGeotechLayersRefetch: () => void
  /** Schedule the geotech model's body-identity recompute (slice 5). Optional so
   *  hand-rolled test fixtures need not supply it; call sites guard with ``?.()``. */
  requestBodyRecompute?: (kind: 'litho' | 'geotech') => void
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  setArmedContactId: Dispatch<SetStateAction<string | null>>
  setArmedContactSide: Dispatch<SetStateAction<'top' | 'base'>>
  setLastTargetTestId: Dispatch<SetStateAction<string | null>>
  setContactCorrelationEdges: Dispatch<SetStateAction<LithoContactCorrelationEdge[]>>
  setGeotechPackingEdges: Dispatch<SetStateAction<LithoContactCorrelationEdge[]>>
  /**
   * The shell undo stack, so a disconnect can be taken back.
   *
   * This hook otherwise stays clear of litho state, but an undo entry for a geotech
   * disconnect is geotech's own — it recreates a geotech edge on the geotech model.
   * It is needed because the alternative repair is re-subdividing, which is model-wide
   * and destructive and would throw away every other manual correlation.
   */
  undoStack: {
    push: (entry: {
      description: string
      revert: () => Promise<void>
      reapply: () => Promise<void>
    }) => void
  }
}

/** Handlers returned to SectionsCanvas. */
export interface UseGeotechPackingCorrelationResult {
  handleCreateGeotechPackingCorrelation: (
    layerAId: string,
    layerBId: string,
    layerASide?: 'top' | 'base',
    layerBSide?: 'top' | 'base',
  ) => Promise<void>
  handleDeleteGeotechPackingCorrelation: (
    layerAId: string,
    layerBId: string,
    layerASide?: 'top' | 'base',
    layerBSide?: 'top' | 'base',
  ) => Promise<void>
  handleAcceptGeotechPackingCorrelation: (edgeId: string) => Promise<void>
  /** Clears a flagged tie's `review_reason` — the engineer confirms it is right. */
  handleConfirmGeotechPackingReview: (edgeId: string) => Promise<void>
}

/**
 * Create/delete geotech packing correlations on the geotech section axis.
 *
 * Parameters
 * ----------
 * deps : UseGeotechPackingCorrelationDeps
 *     Shared SectionsCanvas state + shell actions the handlers close over.
 *
 * Returns
 * -------
 * UseGeotechPackingCorrelationResult
 *     The two stable ``useCallback`` handlers.
 */
export function useGeotechPackingCorrelation(
  deps: UseGeotechPackingCorrelationDeps,
): UseGeotechPackingCorrelationResult {
  const {
    activeGeotechModel,
    projectId,
    selectedSectionId,
    refetchContactEdges,
    refetchGeotechPackingEdges,
    requestGeotechLayersRefetch,
    requestBodyRecompute,
    markMutated,
    toast,
    setArmedContactId,
    setArmedContactSide,
    setLastTargetTestId,
    setContactCorrelationEdges,
    setGeotechPackingEdges,
    undoStack,
  } = deps

  const handleCreateGeotechPackingCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeGeotechModel) {
        log.warn('section', 'packing-connect: no geotech model — run Subdivide all bodies first')
        return
      }
      const modelId = activeGeotechModel.id
      // Clear arm state regardless so the gesture always resets cleanly.
      const clearArm = () => {
        setArmedContactId(null)
        setArmedContactSide('top')
        setLastTargetTestId(null)
      }
      // Self-correlate short-circuit: a band cannot correlate to itself.
      if (layerAId === layerBId) {
        log.debug('section', 'packing-connect: self-correlate — no-op', { layerAId })
        clearArm()
        return
      }
      log.info(
        'section',
        `packing-connect: linking ${layerAId}(${layerASide}) ↔ ${layerBId}(${layerBSide}) on geotech model ${modelId}`,
      )
      try {
        const created = await api.geology.createContactCorrelation(
          projectId,
          modelId,
          layerAId,
          layerBId,
          selectedSectionId,
          layerASide,
          layerBSide,
        )
        clearArm()
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        requestGeotechLayersRefetch()
        requestBodyRecompute?.('geotech')
        markMutated()
        // Bodies changed → the borehole division is now out of date (amber the
        // "Divide boreholes" button until the engineer re-divides).
        markBoreholesStale()
        // THE TIE STANDS, BUT SAY WHAT IT CAN DO (owner order 2026-08-21, after
        // he deleted a silt↔clay packing tie whose ground the fill answered
        // with an onlap: "next time flag a tie like that when it doesn't
        // conform to the litho model!"). The plain success toast would claim
        // the correlation did something the litho frame will never let it do;
        // the warning names both bands and the tie carries a review badge.
        if (created?.frame_warning) {
          log.warn('section', `packing-connect: frame mismatch — ${created.frame_warning}`)
          toast('warning', created.frame_warning)
        } else {
          toast('success', t('sections.packingCorr.added'))
        }
        log.success(
          'section',
          `packing-connect: edge ${layerAId}(${layerASide}) ↔ ${layerBId}(${layerBSide}) created on model ${modelId}`,
        )
      } catch (err) {
        log.warn('section', 'handleCreateGeotechPackingCorrelation: POST failed', err)
        clearArm()
        // Propagate the server's detail string verbatim (post() throws
        // new Error(detail.detail) for non-2xx responses, so err.message
        // IS the server message — e.g. CrossLithoBodyCorrelationError).
        const message =
          err instanceof Error
            ? err.message
            : 'Could not create the packing correlation — try again.'
        toast('error', message)
      }
    },
    [
      activeGeotechModel,
      projectId,
      selectedSectionId,
      refetchContactEdges,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      requestBodyRecompute,
      markMutated,
      toast,
      setArmedContactId,
      setArmedContactSide,
      setLastTargetTestId,
    ],
  )

  const handleDeleteGeotechPackingCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeGeotechModel) return
      const modelId = activeGeotechModel.id
      log.info(
        'section',
        `packing-disconnect: removing ${layerAId}(${layerASide}) ↔ ${layerBId}(${layerBSide}) on geotech model ${modelId}`,
      )
      // Optimistic removal — mirror the litho handler's filter shape. The
      // overlay ribbons on the geotech axis read geotechPackingEdges, so the
      // optimistic edit removes the deleted edge from THAT list (the litho
      // contactCorrelationEdges list frames the partition and never carries a
      // geotech edge id — filtering it here is a harmless no-op, kept for
      // parity with the litho handler).
      const dropEdge = (
        e: LithoContactCorrelationEdge,
      ): boolean =>
        !(
          (e.layer_a_id === layerAId &&
            e.layer_b_id === layerBId &&
            e.layer_a_side === layerASide &&
            e.layer_b_side === layerBSide) ||
          (e.layer_a_id === layerBId &&
            e.layer_b_id === layerAId &&
            e.layer_a_side === layerBSide &&
            e.layer_b_side === layerASide)
        )
      setContactCorrelationEdges(prev => prev.filter(dropEdge))
      setGeotechPackingEdges(prev => prev.filter(dropEdge))
      try {
        await api.geology.deleteContactCorrelation(
          projectId,
          modelId,
          layerAId,
          layerBId,
          selectedSectionId,
          layerASide,
          layerBSide,
        )
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        requestGeotechLayersRefetch()
        requestBodyRecompute?.('geotech')
        markMutated()
        // Bodies changed → the borehole division is now out of date.
        markBoreholesStale()
        // Mirror of the litho uncorrelate entry: undo restores the edge, redo removes it
        // again, so a Ctrl-Z + Ctrl-Y round-trip leaves no drift. Pushed only after the
        // DELETE succeeds — an undo offered for an edge that still exists would recreate
        // a duplicate. The section id is captured here rather than read at undo time, so
        // the revert lands on the section the edge was deleted from even if the owner has
        // since selected another one.
        const sectionIdAtPush = selectedSectionId
        undoStack.push({
          description: 'Disconnect packing bands',
          revert: async () => {
            await api.geology.createContactCorrelation(
              projectId,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await refetchContactEdges()
            await refetchGeotechPackingEdges()
            requestGeotechLayersRefetch()
            requestBodyRecompute?.('geotech')
            markMutated()
            markBoreholesStale()
          },
          reapply: async () => {
            await api.geology.deleteContactCorrelation(
              projectId,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await refetchContactEdges()
            await refetchGeotechPackingEdges()
            requestGeotechLayersRefetch()
            requestBodyRecompute?.('geotech')
            markMutated()
            markBoreholesStale()
          },
        })
        log.success(
          'section',
          `packing-disconnect: edge ${layerAId}(${layerASide}) ↔ ${layerBId}(${layerBSide}) removed`,
        )
      } catch (err) {
        log.warn(
          'section',
          'handleDeleteGeotechPackingCorrelation: DELETE failed — rolling back optimistic removal',
          err,
        )
        // markMutated() is intentionally NOT called here: the optimistic edit
        // is rolled back and the server state is unchanged on a failed delete,
        // so the project is not actually dirty.
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        // Refresh geotech layers too (mirrors the success path) so body_id
        // stamps stay consistent even if an intermediate mutation changed them.
        requestGeotechLayersRefetch()
        requestBodyRecompute?.('geotech')
        // The removal was OPTIMISTIC and has just been rolled back by the two
        // refetches above, so the tie reappears on the canvas with no
        // explanation. Dogfeed 2026-08-02: the backend had gone away, the edge
        // flickered out and back, and the only record was a log.warn nobody was
        // watching — the engineer kept clicking for minutes. Name the gesture
        // that did not take; error toasts are sticky, so this waits to be read.
        toast('error', t('sections.packingCorr.disconnectFailed'))
      }
    },
    [
      activeGeotechModel,
      projectId,
      selectedSectionId,
      refetchContactEdges,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      requestBodyRecompute,
      markMutated,
      setContactCorrelationEdges,
      setGeotechPackingEdges,
      toast,
      undoStack,
    ],
  )

  // Right-click a pending packing tie → "Accept correlation".
  //
  // Geotech edges used to be written approved, so this gesture had nothing to act on
  // and was suppressed on this axis. The standalone geotech auto-correlate changed
  // that: it proposes ties unapproved, and until one is accepted the resolver leaves
  // it out of the bodies. Accepting is the point at which the tie becomes real, which
  // is why the geotech layers (the body_id stamp source) are refetched and the
  // borehole division goes stale — exactly as on the manual connect path.
  //
  // No undo entry: the symmetric reverse of an accept is deleting the edge, which the
  // same context menu offers as its other action.
  const handleAcceptGeotechPackingCorrelation = useCallback(
    async (edgeId: string): Promise<void> => {
      if (!activeGeotechModel) return
      const modelId = activeGeotechModel.id
      log.info('section', `packing-accept: edge=${edgeId} on geotech model ${modelId}`)
      try {
        const result = await api.geology.acceptSingleContactCorrelation(
          projectId,
          modelId,
          edgeId,
        )
        await refetchGeotechPackingEdges()
        requestGeotechLayersRefetch()
        requestBodyRecompute?.('geotech')
        markMutated()
        markBoreholesStale()
        log.success(
          'section',
          `packing-accept: edge=${edgeId} accepted=${result.edges_accepted} ` +
            `ordinals_changed=${result.ordinals_changed}`,
        )
      } catch (err) {
        log.warn('section', `handleAcceptGeotechPackingCorrelation: POST failed for edge ${edgeId}`, err)
        toast('error', t('sections.packingCorr.acceptFailed'))
      }
    },
    [
      activeGeotechModel,
      projectId,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      requestBodyRecompute,
      markMutated,
      toast,
    ],
  )

  // Confirm a tie the rebuild flagged — "yes, that one is right".
  //
  // A re-subdivide that could not identify the band an accepted tie was drawn on
  // carries the tie with a `review_reason` instead of deleting it, so the flag needs
  // a way out. Deleting is the other way out and already exists on the same menu.
  //
  // Nothing about the model changes: the tie is already approved and already points
  // where it points, so unlike accept there is no reason to refetch the geotech layers
  // or mark the borehole division stale. Only the flag is dropped.
  //
  // No undo entry: re-flagging an edge is not an operation the app has, and inventing
  // one to satisfy symmetry would mean writing a review_reason the engine never
  // raised. The recoverable half is the destructive one, and that is the delete path.
  const handleConfirmGeotechPackingReview = useCallback(
    async (edgeId: string): Promise<void> => {
      if (!activeGeotechModel) return
      const modelId = activeGeotechModel.id
      log.info('section', `packing-confirm-review: edge=${edgeId} on geotech model ${modelId}`)
      try {
        const result = await api.geology.confirmEdgeReview(projectId, modelId, edgeId)
        await refetchGeotechPackingEdges()
        markMutated()
        log.success(
          'section',
          `packing-confirm-review: edge=${edgeId} cleared=${result.edges_confirmed}`,
        )
      } catch (err) {
        log.warn(
          'section',
          `handleConfirmGeotechPackingReview: POST failed for edge ${edgeId}`,
          err,
        )
        toast('error', t('sections.packingCorr.confirmFailed'))
      }
    },
    [activeGeotechModel, projectId, refetchGeotechPackingEdges, markMutated, toast],
  )

  return {
    handleCreateGeotechPackingCorrelation,
    handleDeleteGeotechPackingCorrelation,
    handleAcceptGeotechPackingCorrelation,
    handleConfirmGeotechPackingReview,
  }
}
