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
  refetchGeotechPackingEdges: () => Promise<void>
  /** Ask the shell to refetch geotech layers (body_id stamp source). */
  requestGeotechLayersRefetch: () => void
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  setArmedContactId: Dispatch<SetStateAction<string | null>>
  setArmedContactSide: Dispatch<SetStateAction<'top' | 'base'>>
  setLastTargetTestId: Dispatch<SetStateAction<string | null>>
  setContactCorrelationEdges: Dispatch<SetStateAction<LithoContactCorrelationEdge[]>>
  setGeotechPackingEdges: Dispatch<SetStateAction<LithoContactCorrelationEdge[]>>
}

/** Handler pair returned to SectionsCanvas. */
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
    markMutated,
    toast,
    setArmedContactId,
    setArmedContactSide,
    setLastTargetTestId,
    setContactCorrelationEdges,
    setGeotechPackingEdges,
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
        await api.geology.createContactCorrelation(
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
        markMutated()
        // Bodies changed → the borehole division is now out of date (amber the
        // "Divide boreholes" button until the engineer re-divides).
        markBoreholesStale()
        toast('success', 'Packing correlation added.')
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
        markMutated()
        // Bodies changed → the borehole division is now out of date.
        markBoreholesStale()
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
      }
    },
    [
      activeGeotechModel,
      projectId,
      selectedSectionId,
      refetchContactEdges,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      markMutated,
      setContactCorrelationEdges,
      setGeotechPackingEdges,
    ],
  )

  return { handleCreateGeotechPackingCorrelation, handleDeleteGeotechPackingCorrelation }
}
