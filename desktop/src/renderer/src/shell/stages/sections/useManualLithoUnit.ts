/**
 * Manual litho-unit creation (debt #151, Phase-1.5 composition picker) for
 * ``SectionsCanvas`` — extracted verbatim (debt #201 round 2, cluster 4).
 *
 * New-unit path: direct-insert via two acceptLithoSuggestions calls (top
 * contact + restoration contact carrying the surrounding band's lithology).
 * Existing-unit path: looks up the picked formation and reuses the same
 * direct-insert. See the inline comments for the owner-directed flow.
 */
import { useCallback } from 'react'

import { api } from '../../../api/client'
import type {
  AdmixtureItem,
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import { log } from '../../../utils/log'

/** Everything the two handlers consume from the SectionsCanvas scope. */
export interface UseManualLithoUnitDeps {
  /** Active lithostratigraphic model (insert requires one). */
  activeLithoModel: GeologicalModelResponse | null
  /** Selected cross-section (insert is section-scoped). */
  selectedSection: CrossSectionResponse | null
  /** Current project id. */
  projectId: string
  /** Apply an updated_section payload to local section state (#57). */
  applyUpdatedSection: (section: CrossSectionResponse) => void
  /** Refetch the formation vocabulary. */
  refetchFormations: () => void
  /** Refetch the litho contact list. */
  refetchLithoContacts: () => void
  /** Litho contacts (surrounding-band snapshot source). */
  lithoContacts: FormationContactResponse[]
  /** Geological formation vocabulary. */
  formations: GeologicalFormationResponse[]
  /** Litho formation vocabulary. */
  lithoFormations: GeologicalFormationResponse[]
}

/** Handler pair returned to SectionsCanvas. */
export interface UseManualLithoUnitResult {
  handleManualLithoUnitCreate: (
    mainCode: string,
    admixtures: AdmixtureItem[],
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depthM: number,
  ) => Promise<{ formationId: string } | null>
  handleLithoExistingUnitPick: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depthM: number,
    formationId: string,
  ) => Promise<void>
}

/**
 * Direct-insert manual litho unit handlers (new-unit + existing-unit paths).
 *
 * Parameters
 * ----------
 * deps : UseManualLithoUnitDeps
 *     Shared SectionsCanvas state + shell actions the handlers close over.
 *
 * Returns
 * -------
 * UseManualLithoUnitResult
 *     The two stable ``useCallback`` handlers.
 */
export function useManualLithoUnit(deps: UseManualLithoUnitDeps): UseManualLithoUnitResult {
  const {
    activeLithoModel,
    selectedSection,
    projectId,
    applyUpdatedSection,
    refetchFormations,
    refetchLithoContacts,
    lithoContacts,
    formations,
    lithoFormations,
  } = deps

  // Phase-1.5 manual litho composition picker — new-unit path.
  //
  // WHY a dedicated callback at this boundary:
  //   The "new unit" tab in LithoCompositionPickerDialog produces a main soil
  //   code + admixture list. The existing acceptLithoSuggestions endpoint is
  //   reused with a synthetic one-item payload (source='manual_pick', sentinel
  //   depth_base = depth_top + 0.01 so it never straddles). After the formation
  //   is created (the only BE path that sets litho_main_soil_code), a ghost is
  //   placed at the same depth so the user enters the ghost-extend-accept flow
  //   instead of working with a committed 0.01 m contact.
  //
  // The "existing unit" path goes through sectionAwareCreateContact (already
  // #57-correct via GET) — DO NOT change it.
  const handleManualLithoUnitCreate = useCallback(
    async (
      mainCode: string,
      admixtures: AdmixtureItem[],
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
    ): Promise<{ formationId: string } | null> => {
      // Debt #151 dogfeed refinement 2026-05-27 (owner): "how about we
      // don't wire it through the suggestion and it immediately
      // becomes an accepted litho layer, user can always right click
      // delete anyway".
      //
      // Direct-insert flow.  Replaces the previous
      // create-formation-only → ghost → user-accepts chain.  Two
      // accept-litho-suggestions calls fire in sequence:
      //
      //   1. Top contact at ``depthM`` with the user's chosen
      //      lithology + admixtures.  The new band starts here.
      //   2. Restoration contact at ``depthM + 0.20`` with the
      //      SURROUNDING band's lithology + admixtures (found via the
      //      deepest existing litho contact whose ``depth_top_m <=
      //      depthM``).  The original band continues underneath.
      //
      // Result: 3 visible bands instead of 2 (original split into
      // top + bottom pieces, new layer in between).  No pending-ghost
      // state; the user can right-click → Remove to undo, and the
      // existing same-litho merge popup re-merges the surrounding
      // pieces if the user removes the new one.
      if (!activeLithoModel || !selectedSection) {
        log.warn('section', 'handleManualLithoUnitCreate: no active litho model or section')
        return null
      }

      type ManualSuggestion = {
        depth_top_m: number
        depth_base_m: number
        suggested_lithology: string
        suggested_nad_class: null
        mean_qc_mpa: null
        dr_pct: null
        confidence: 'medium'
        source: 'manual_pick'
        suggested_admixtures: AdmixtureItem[]
        parent_formation_id: null
        spans_boundary: false
      }

      // Snapshot the surrounding formation BEFORE we mutate any
      // contacts.  Surrounding = deepest existing litho contact whose
      // ``depth_top_m <= depthM`` (the band the click sits inside).
      const peers = lithoContacts
        .filter(c => (c.borehole_id ?? c.cpt_id) === anchorId)
        .slice()
        .sort((a, b) => a.depth_top_m - b.depth_top_m)
      let surroundingContact: typeof peers[number] | null = null
      for (const c of peers) {
        if (c.depth_top_m <= depthM) surroundingContact = c
        else break
      }
      const surroundingFormation = surroundingContact !== null
        ? formations.find(f => f.id === surroundingContact?.formation_id)
            ?? lithoFormations.find(f => f.id === surroundingContact?.formation_id)
            ?? null
        : null

      const topSuggestion: ManualSuggestion = {
        depth_top_m: depthM,
        depth_base_m: depthM + 0.2,
        suggested_lithology: mainCode,
        suggested_nad_class: null,
        mean_qc_mpa: null,
        dr_pct: null,
        confidence: 'medium',
        source: 'manual_pick',
        suggested_admixtures: admixtures,
        parent_formation_id: null,
        spans_boundary: false,
      }

      log.debug(
        'section',
        `handleManualLithoUnitCreate (direct-insert): litho_model=${activeLithoModel.id} ` +
          `anchor=${anchorKind}/${anchorId} depth=${depthM.toFixed(2)}m soil=${mainCode} ` +
          `surrounding=${surroundingFormation?.litho_main_soil_code ?? '(none)'}`,
      )

      try {
        // 1. Insert the user's chosen layer (top contact at depthM).
        const topResult = await api.geology.acceptLithoSuggestions(
          projectId,
          activeLithoModel.id,
          {
            [anchorKind === 'cpt' ? 'cpt_id' : 'borehole_id']: anchorId,
            section_id: selectedSection.id,
            suggestions: [topSuggestion],
          },
        )
        if (topResult.updated_section != null) {
          applyUpdatedSection(topResult.updated_section)
        }
        const formationId =
          topResult.created_formation_ids[0] ?? topResult.found_formation_ids[0] ?? null
        if (formationId === null) {
          log.warn(
            'section',
            'handleManualLithoUnitCreate: no formation id in top-insert response',
          )
          return null
        }

        // 2. Restoration contact at depthM + 0.20 carrying the
        //    surrounding band's lithology + admixtures.  Skip if no
        //    surrounding (e.g. inserting at the top of a column with
        //    no prior litho contacts above) — the new band simply
        //    extends downward to the next existing contact (or the
        //    test bottom), which is the right behaviour when there's
        //    nothing to restore.  Skip if the surrounding is the
        //    SAME as the user's pick (a same-litho restoration would
        //    be a no-op cosmetic duplicate).
        if (
          surroundingFormation?.litho_main_soil_code != null
          && surroundingFormation.litho_main_soil_code !== mainCode
        ) {
          const restorationSuggestion: ManualSuggestion = {
            depth_top_m: depthM + 0.2,
            depth_base_m: depthM + 0.21, // sentinel — only depth_top_m matters for the new contact
            suggested_lithology: surroundingFormation.litho_main_soil_code,
            suggested_nad_class: null,
            mean_qc_mpa: null,
            dr_pct: null,
            confidence: 'medium',
            source: 'manual_pick',
            suggested_admixtures: (surroundingFormation.litho_admixtures ?? []).map(a => ({
              soil_code: a.soil_code,
              amount: a.amount,
              locally: a.locally,
            })),
            parent_formation_id: null,
            spans_boundary: false,
          }
          try {
            const restoreResult = await api.geology.acceptLithoSuggestions(
              projectId,
              activeLithoModel.id,
              {
                [anchorKind === 'cpt' ? 'cpt_id' : 'borehole_id']: anchorId,
                section_id: selectedSection.id,
                suggestions: [restorationSuggestion],
              },
            )
            if (restoreResult.updated_section != null) {
              applyUpdatedSection(restoreResult.updated_section)
            }
            log.success(
              'section',
              `handleManualLithoUnitCreate restoration ok at depth=${(depthM + 0.2).toFixed(2)}m ` +
                `lithology=${surroundingFormation.litho_main_soil_code}`,
            )
          } catch (err) {
            log.warn(
              'section',
              'handleManualLithoUnitCreate: restoration acceptLithoSuggestions failed — the new layer\'s bottom boundary is missing',
              err,
            )
          }
        }

        // Refresh formations + litho contacts so the new contacts
        // land in local state — without this the in-corridor
        // ``sectionContacts`` filter in SectionsCanvas still has the OLD
        // ``lithoContacts`` and renders nothing for the new contact
        // (owner dogfeed 2026-05-27: "dialog box, select a unit but
        // nothing is being rendered").
        refetchFormations()
        refetchLithoContacts()

        log.success(
          'section',
          `handleManualLithoUnitCreate: layer committed formationId=${formationId}`,
        )
        return { formationId }
      } catch (err) {
        log.warn('section', 'handleManualLithoUnitCreate: top-insert acceptLithoSuggestions failed', err)
        return null
      }
    },
    [
      activeLithoModel,
      selectedSection,
      projectId,
      applyUpdatedSection,
      refetchFormations,
      refetchLithoContacts,
      lithoContacts,
      formations,
      lithoFormations,
    ],
  )

  // Debt #151 dogfeed refinement 2026-05-27 — Existing Units tab of
  // ``LithoCompositionPickerDialog`` on the litho axis.  Looks up the
  // picked formation by id and reuses ``handleManualLithoUnitCreate``
  // with its litho code + admixtures; the backend's find-or-create
  // returns the same formation row (no duplicate), and a ghost lands
  // at the click depth.
  const handleLithoExistingUnitPick = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
      formationId: string,
    ): Promise<void> => {
      const formation = lithoFormations.find(f => f.id === formationId)
      if (!formation?.litho_main_soil_code) {
        log.warn(
          'section',
          `handleLithoExistingUnitPick: formation ${formationId} missing litho_main_soil_code`,
        )
        return
      }
      const admixtures = (formation.litho_admixtures ?? []) as AdmixtureItem[]
      await handleManualLithoUnitCreate(
        formation.litho_main_soil_code,
        admixtures,
        anchorKind,
        anchorId,
        depthM,
      )
    },
    [lithoFormations, handleManualLithoUnitCreate],
  )

  return { handleManualLithoUnitCreate, handleLithoExistingUnitPick }
}
