/**
 * Litho↔geo snap dialog state + handlers for ``SectionsCanvas``.
 *
 * Extracted verbatim from SectionsCanvas.tsx (debt #201 round 2, cluster 3).
 * When a litho-contact drag (or a single-suggestion accept) lands within
 * tolerance of a geological contact, a 3-option prompt opens so the user
 * picks the direction of the snap: snap the litho contact to the geo depth,
 * move the geo contact to the litho depth (with a surface-rebuild cascade),
 * or keep them separate (cancel).
 *
 * Both axes that edit a litho contact ask it — the litho axis directly, the
 * geotech axis through the band-boundary drag that resolves to the same row.
 *
 * Also owns the P1b live contact-depth preview (dogfeed 2026-05-30) that
 * lets the committed contact follow a cross-store suggestion drag visually.
 */
import { useCallback, useState } from 'react'

import { api } from '../../../api/client'
import type { FormationContactResponse } from '../../../api/client'
import { findGeoSnapCandidates } from '../../../utils/lithoGeoSnap'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'

/** The open snap prompt — null when the dialog is closed. */
export interface LithoGeoSnapPrompt {
  lithoContactId: string
  rawDepthM: number
  candidates: readonly FormationContactResponse[]
  // Which boundary of the litho contact the originating drag moved. The
  // snap PATCH MUST write this same edge — a base-edge drag that snaps to a
  // geo contact has to set depth_base_m, not depth_top_m. Required (no
  // default) so the field can never be silently dropped again.
  field: 'top' | 'base'
}

/** Everything the snap handlers consume from the SectionsCanvas scope. */
export interface UseLithoGeoSnapDialogDeps {
  /** Current project (id feeds the rebuild-surfaces call). */
  project: { id: string } | null
  /** True when the section axis is lithostratigraphic. */
  isLitho: boolean
  /**
   * True when the section axis is geotechnical.
   *
   * The geotech axis edits litho contacts too (owner ruling 2026-08-08): a band
   * boundary that restates a lithostratigraphic contact is draggable there, and the
   * PATCH lands on the litho row. About a third of the owner's litho layers carry a
   * ``parent_geo_contact_id``, so that drag runs into a geological contact roughly one
   * time in three — and the answer has to be the SAME prompt the litho axis already
   * asks (owner: "same mental model"), not a second mechanism that decides silently.
   */
  isGeotech: boolean
  /** Litho contacts on this section (anchor lookup for the dragged contact). */
  lithoContacts: FormationContactResponse[]
  /** Geological contacts (snap-candidate search space). */
  contacts: FormationContactResponse[]
  /** Per-project snap tolerance in metres (debt #134-A). */
  lithoSnapToleranceM: number
  /** Commit a contact-depth PATCH (shell action; `snapped` marks provenance). */
  handleUpdateContactDepth: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
    field?: 'top' | 'base',
  ) => Promise<void>
  /** Reload backdrop surfaces after a geo rebuild (idempotent shell action). */
  handleLoadBackdropSurfaces: (modelId: string) => Promise<void>
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/** State + handlers returned to SectionsCanvas. */
export interface UseLithoGeoSnapDialogResult {
  lithoGeoSnapPrompt: LithoGeoSnapPrompt | null
  /** Open the prompt directly — used by the accept-with-snap path (#134-C). */
  openLithoGeoSnapPrompt: (prompt: LithoGeoSnapPrompt) => void
  lithoGeoSnapBusy: boolean
  lithoSuggestionContactPreview: { contactId: string; depthM: number } | null
  handleLithoContactLivePreview: (contactId: string | null, liveDepthM: number) => void
  handleLithoSnapAwareUpdateContactDepth: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
    field?: 'top' | 'base',
  ) => Promise<void>
  handleSnapLithoToGeo: (geoContactId: string) => Promise<void>
  handleMoveGeoToLitho: (geoContactId: string) => Promise<void>
  handleSnapDialogCancel: () => void
}

/**
 * Snap-prompt state machine for litho-contact drags near a geo contact.
 *
 * Parameters
 * ----------
 * deps : UseLithoGeoSnapDialogDeps
 *     Shared SectionsCanvas state + shell actions the handlers close over.
 *
 * Returns
 * -------
 * UseLithoGeoSnapDialogResult
 *     Prompt/busy/preview state and the five stable handlers.
 */
export function useLithoGeoSnapDialog(
  deps: UseLithoGeoSnapDialogDeps,
): UseLithoGeoSnapDialogResult {
  const {
    project,
    isLitho,
    isGeotech,
    lithoContacts,
    contacts,
    lithoSnapToleranceM,
    handleUpdateContactDepth,
    handleLoadBackdropSurfaces,
    toast,
  } = deps

  const [lithoGeoSnapPrompt, setLithoGeoSnapPrompt] = useState<LithoGeoSnapPrompt | null>(null)
  const [lithoGeoSnapBusy, setLithoGeoSnapBusy] = useState(false)

  // P1b (dogfeed 2026-05-30) — live contact-depth override during a
  // cross-store suggestion drag. Set on every mousemove by the
  // ``onContactLivePreview`` callback that ``useBoundaryDrag`` fires;
  // cleared on mouseup. ContactsLayer reads this prop and renders the
  // matching contact at the live depth so the committed contact
  // follows the pending edit visually until the PATCH commit refetch
  // takes over.
  const [
    lithoSuggestionContactPreview,
    setLithoSuggestionContactPreview,
  ] = useState<{ contactId: string; depthM: number } | null>(null)
  const handleLithoContactLivePreview = useCallback(
    (contactId: string | null, liveDepthM: number) => {
      if (contactId === null) {
        setLithoSuggestionContactPreview(null)
      } else {
        setLithoSuggestionContactPreview({ contactId, depthM: liveDepthM })
      }
    },
    [],
  )

  // Snap-aware wrapper around ``handleUpdateContactDepth``.  Commits the
  // litho contact at the raw drag depth first (so the user sees the drag
  // result immediately), then — on either axis that edits litho contacts —
  // checks for any geological contact within tolerance.  If one or more
  // candidates exist, opens the prompt; otherwise the wrapper is a no-op
  // past the initial PATCH.
  //
  // The geotech axis reaches this through ``handleGeotechContactDrag``, which
  // has already mapped the grabbed band boundary back to the litho row it
  // restates — so what arrives here is a litho contact on both axes, and the
  // coupling question it can raise is the same one.
  const handleLithoSnapAwareUpdateContactDepth = useCallback(
    async (contactId: string, newDepthM: number, snapped: boolean, field: 'top' | 'base' = 'top'): Promise<void> => {
      await handleUpdateContactDepth(contactId, newDepthM, snapped, field)
      if (!isLitho && !isGeotech) return
      const dragged = lithoContacts.find(c => c.id === contactId)
      if (!dragged) return
      const anchorId = dragged.borehole_id ?? dragged.cpt_id
      if (!anchorId) return
      const candidates = findGeoSnapCandidates(
        newDepthM,
        anchorId,
        contacts,
        lithoSnapToleranceM,
      )
      if (candidates.length === 0) return
      setLithoGeoSnapPrompt({
        lithoContactId: contactId,
        rawDepthM: newDepthM,
        candidates,
        field,
      })
    },
    [handleUpdateContactDepth, isLitho, isGeotech, lithoContacts, contacts, lithoSnapToleranceM],
  )

  const handleSnapLithoToGeo = useCallback(
    async (geoContactId: string): Promise<void> => {
      if (lithoGeoSnapBusy || lithoGeoSnapPrompt === null) return
      const geo = lithoGeoSnapPrompt.candidates.find(c => c.id === geoContactId)
      if (!geo) return
      setLithoGeoSnapBusy(true)
      try {
        // Second PATCH on the litho contact, snapping it to the geo depth.
        // ``snapped=true`` marks the source/confidence on the litho row.
        // Carry the originating drag's ``field`` so a base-edge snap writes
        // depth_base_m, not depth_top_m (the dropped-field wrong-boundary bug).
        await handleUpdateContactDepth(
          lithoGeoSnapPrompt.lithoContactId,
          geo.depth_top_m,
          true,
          lithoGeoSnapPrompt.field,
        )
      } catch (err) {
        log.error('section', 'handleSnapLithoToGeo: snap failed', {
          lithoContactId: lithoGeoSnapPrompt.lithoContactId,
          geoContactId,
          err,
        })
        toast('error', t('sections.snap.failed', { message: (err as Error).message }))
      } finally {
        setLithoGeoSnapBusy(false)
        setLithoGeoSnapPrompt(null)
      }
    },
    [lithoGeoSnapBusy, lithoGeoSnapPrompt, handleUpdateContactDepth, toast],
  )

  const handleMoveGeoToLitho = useCallback(
    async (geoContactId: string): Promise<void> => {
      if (lithoGeoSnapBusy || lithoGeoSnapPrompt === null) return
      const geo = lithoGeoSnapPrompt.candidates.find(c => c.id === geoContactId)
      if (!geo || !project) return
      const oldDepth = geo.depth_top_m
      const lithoDepth = lithoGeoSnapPrompt.rawDepthM
      setLithoGeoSnapBusy(true)
      // No "in progress" toast — the dialog stays open with all buttons
      // disabled (busy=true) which already signals work-in-flight.  A
      // success / error toast lands at the end.
      try {
        await handleUpdateContactDepth(geoContactId, lithoDepth, false)
        await api.geology.rebuildSurfaces(project.id, geo.model_id)
        await handleLoadBackdropSurfaces(geo.model_id)
        toast('success', t('sections.snap.moved'))
      } catch (err) {
        log.error('section', 'handleMoveGeoToLitho: move failed', {
          geoContactId,
          lithoDepth: lithoGeoSnapPrompt.rawDepthM,
          err,
        })
        toast('error', t('sections.snap.moveFailed', { message: (err as Error).message }))
        // Best-effort rollback of the geological-contact depth.  Swallow
        // a secondary failure — the user already saw the primary error.
        try {
          await handleUpdateContactDepth(geoContactId, oldDepth, false)
        } catch {
          // intentionally empty — rollback is best-effort
        }
      } finally {
        setLithoGeoSnapBusy(false)
        setLithoGeoSnapPrompt(null)
      }
    },
    [
      lithoGeoSnapBusy,
      lithoGeoSnapPrompt,
      project,
      handleUpdateContactDepth,
      handleLoadBackdropSurfaces,
      toast,
    ],
  )

  const handleSnapDialogCancel = useCallback((): void => {
    if (lithoGeoSnapBusy) return
    setLithoGeoSnapPrompt(null)
  }, [lithoGeoSnapBusy])

  return {
    lithoGeoSnapPrompt,
    openLithoGeoSnapPrompt: setLithoGeoSnapPrompt,
    lithoGeoSnapBusy,
    lithoSuggestionContactPreview,
    handleLithoContactLivePreview,
    handleLithoSnapAwareUpdateContactDepth,
    handleSnapLithoToGeo,
    handleMoveGeoToLitho,
    handleSnapDialogCancel,
  }
}
