/**
 * Click-to-place formation-contact picker state for the cross-section
 * (debt #30).
 *
 * Encapsulates SectionPanel's previous inline ``pickContext`` state
 * + the three handlers it drives:
 *
 *   * ``handlePickCpt`` / ``handlePickBorehole`` — fired from
 *     ContactPickBar (CPT data band) and BoreholeColumn (lithology
 *     strip) when the user clicks a depth. Opens the formation
 *     picker modal pre-seeded with the anchor's metadata.
 *   * ``handlePickerSelect`` — fired when the user picks a formation
 *     in the modal. Calls back to the caller's ``onCreateContact``
 *     with the resolved tuple, then clears ``pickContext``.
 *   * ``cancel`` — clears ``pickContext`` (used by the modal's
 *     Cancel button + outside-click dismissal).
 *
 * The ``snapped`` boolean propagates from the click site through to
 * the create handler so App can stamp ``source`` /
 * ``confidence`` based on whether the depth came from a snap-to-
 * stratigraphy boundary or a free click (debt #22/#23).
 */

import { useCallback, useState } from 'react'

export interface PickContextState {
  kind: 'cpt' | 'borehole'
  anchorId: string
  anchorName: string
  depth_m: number
  elevationM: number
  snapped: boolean
}

interface CptPickAnchor {
  kind: 'cpt'
  cptId: string
  cptName: string
  depth_m: number
  elevationM: number
  snapped: false
}

interface BoreholePickAnchor {
  kind: 'borehole'
  boreholeId: string
  boreholeName: string
  depth_m: number
  elevationM: number
  snapped: boolean
}

/**
 * Caller-supplied create hook. ``snapped`` reflects whether the
 * click depth came from a snap-to-stratigraphy boundary; the caller
 * uses it to set the contact's ``source`` + ``confidence``
 * (debt #22/#23).
 */
type OnCreateContact = (
  anchorKind: 'cpt' | 'borehole',
  anchorId: string,
  depth_m: number,
  formationId: string,
  snapped: boolean,
) => Promise<void>

export interface UseContactPickerResult {
  pickContext: PickContextState | null
  handlePickCpt: (anchor: CptPickAnchor) => void
  handlePickBorehole: (anchor: BoreholePickAnchor) => void
  /** Picker modal commit. Forwards to ``onCreateContact`` then
   * clears the open-modal state. */
  handlePickerSelect: (formationId: string) => Promise<void>
  /** Imperative cancel — clears ``pickContext`` without committing
   * (used by the modal's Cancel button + outside-click). */
  cancel: () => void
}

/**
 * Click-to-place state + handlers.
 *
 * ``onCreateContact`` may be ``undefined`` when the section is
 * mounted read-only (no active geological model). In that case
 * ``handlePickerSelect`` clears the state without calling back —
 * matches the previous inline behaviour.
 */
export function useContactPicker(
  onCreateContact: OnCreateContact | undefined,
): UseContactPickerResult {
  const [pickContext, setPickContext] = useState<PickContextState | null>(null)

  const handlePickCpt = useCallback((anchor: CptPickAnchor) => {
    setPickContext({
      kind: 'cpt',
      anchorId: anchor.cptId,
      anchorName: anchor.cptName,
      depth_m: anchor.depth_m,
      elevationM: anchor.elevationM,
      snapped: anchor.snapped,
    })
  }, [])

  const handlePickBorehole = useCallback((anchor: BoreholePickAnchor) => {
    setPickContext({
      kind: 'borehole',
      anchorId: anchor.boreholeId,
      anchorName: anchor.boreholeName,
      depth_m: anchor.depth_m,
      elevationM: anchor.elevationM,
      snapped: anchor.snapped,
    })
  }, [])

  const handlePickerSelect = useCallback(
    async (formationId: string): Promise<void> => {
      if (!pickContext || !onCreateContact) return
      await onCreateContact(
        pickContext.kind,
        pickContext.anchorId,
        pickContext.depth_m,
        formationId,
        pickContext.snapped,
      )
      setPickContext(null)
    },
    [pickContext, onCreateContact],
  )

  const cancel = useCallback(() => setPickContext(null), [])

  return {
    pickContext,
    handlePickCpt,
    handlePickBorehole,
    handlePickerSelect,
    cancel,
  }
}
