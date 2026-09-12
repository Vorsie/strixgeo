/**
 * Geological-model operations handler cluster for {@link useGeologicalModel}
 * (debt #201 Move 5). Extracted as a focused sub-hook so the composer stays a
 * thin owner of shared state. This cluster covers model-level mutations that
 * are not formation- or contact-CRUD: auto-populate from stratigraphy, litho
 * seed-from-parent, dedupe, rebuild surfaces, Plaxis 3D export, borehole
 * toggle, and model delete.
 *
 * ``handleDeleteModel`` is non-contiguous in the original file (sits after the
 * lumping handlers) but logically belongs here; it is extracted alongside the
 * contiguous block.
 *
 * The shared state (contacts, formations, surfaces, the active model, the
 * session-import set, the manifest) lives in the composer and is passed in;
 * this hook owns only the seven operation callbacks.
 *
 * Dep-array convention (carried verbatim from the composer): ``toast`` (a
 * ref-stable function from ``useToasts`` that never goes stale) and all
 * ``set*`` setters from ``useState`` (``setFormations``,
 * ``setContacts``, ``setSurfacesByFormationId``, ``setActiveGeologicalModel``,
 * ``setFormationsRefreshCounter``) are
 * intentionally omitted from the ``useCallback`` dep arrays — all are
 * stable-by-construction references, so listing them would only churn callback
 * identities. Varying values (``project``, ``activeGeologicalModel``,
 * ``currentLumping``, …) ARE listed.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { api } from '../api/client'
import type {
  CrossSectionResponse,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  ProjectResponse,
} from '../api/client'
import type { StratigraphyLumping } from '../utils/projectFile'
import type { UndoCommand } from './useUndoStack'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import { toggleBoreholeExclusion } from './boreholeExclusionToggle'

/** Inputs for {@link useGeologicalModelOps}. */
export interface UseGeologicalModelOpsParams {
  /** The open project, or null when none is loaded. */
  project: ProjectResponse | null
  /** The active geological model. */
  activeGeologicalModel: GeologicalModelResponse | null
  /** Composer-owned formation list (read by handleDeleteModel). */
  formations: GeologicalFormationResponse[]
  /** Persisted lumping snapshot — null when no Apply has been committed. */
  currentLumping: StratigraphyLumping | null
  /** Append new formation ids to the bundle manifest. */
  addToManifest: (kind: 'formation', ids: string[]) => void
  /** Remove formation ids from the bundle manifest. */
  removeFromManifest: (kind: 'formation', ids: Iterable<string>) => void
  /** Flag new formations / contacts as unsaved (dirty). */
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  /** Clear the unsaved flag for formations / contacts. */
  removeFromSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  /** Push a reversible mutation onto the undo stack. */
  pushUndo: (cmd: UndoCommand) => void
  /** Mark the project dirty after a mutation of pre-existing rows. */
  markMutated: () => void
  /** Surface a toast to the user. Stable — intentionally omitted from dep arrays. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  /** Setter for the composer-owned formation list. Stable — omitted from dep arrays. */
  setFormations: Dispatch<SetStateAction<GeologicalFormationResponse[]>>
  /** Setter for the composer-owned contact list. Stable — omitted from dep arrays. */
  setContacts: Dispatch<SetStateAction<FormationContactResponse[]>>
  /** Setter for the geological surface cache. Stable — omitted from dep arrays. */
  setSurfacesByFormationId: Dispatch<SetStateAction<ReadonlyMap<string, FormationSurfaceResponse>>>
  /** Setter for the active geological model. Stable — omitted from dep arrays. */
  setActiveGeologicalModel: Dispatch<SetStateAction<GeologicalModelResponse | null>>
  /** Setter for the formations-refresh counter (InterpretationPane signal). Stable — omitted from dep arrays. */
  setFormationsRefreshCounter: Dispatch<SetStateAction<number>>
  /** Resync the formation list from the server. */
  refetchFormations: () => void
  /** Refetch the geological surface TIN cache from the server. */
  refetchSurfaces: () => void
  /** Resync the litho layers (and derived litho contacts) from the server. */
  refetchLithoContacts: () => void
  /** The active lithostratigraphic model, or null. Its own
   *  ``excluded_borehole_ids`` is what the Lithology inspector edits (#65). */
  activeLithoModel: GeologicalModelResponse | null
  /** Setter for the active litho model. Stable — omitted from dep arrays. */
  setActiveLithoModel: Dispatch<SetStateAction<GeologicalModelResponse | null>>
}

/** Handlers returned by {@link useGeologicalModelOps}. */
export interface UseGeologicalModelOpsResult {
  handleAutoPopulateFromStratigraphy: (
    boreholeIds: readonly string[],
    sectionId?: string | null,
    onSectionUpdated?: (updated: CrossSectionResponse) => void,
  ) => Promise<void>
  handleDedupeContacts: () => Promise<number>
  handleRebuildSurfaces: () => Promise<void>
  handleExportModelPlaxis3d: () => Promise<void>
  handleToggleBoreholeInModel: (boreholeId: string, included: boolean) => Promise<void>
  /** Include ("Include again") or exclude a borehole in the active LITHO
   *  model (debt #65). Mirror of ``handleToggleBoreholeInModel`` for the litho
   *  model, and confirms with a toast (the geo checkbox is silent). */
  handleToggleBoreholeInLithoModel: (boreholeId: string, included: boolean) => Promise<void>
  handleDeleteModel: () => Promise<void>
}

/**
 * Geological-model operation callbacks (auto-populate, seed, dedupe, rebuild,
 * export, borehole toggle, delete).
 *
 * Parameters
 * ----------
 * params
 *     See {@link UseGeologicalModelOpsParams}.
 *
 * Returns
 * -------
 * UseGeologicalModelOpsResult
 *     The seven operation handlers.
 */
export function useGeologicalModelOps({
  project,
  activeGeologicalModel,
  formations,
  currentLumping,
  addToManifest,
  removeFromManifest,
  addToSessionImports,
  removeFromSessionImports,
  pushUndo,
  markMutated,
  toast,
  setFormations,
  setContacts,
  setSurfacesByFormationId,
  setActiveGeologicalModel,
  setFormationsRefreshCounter,
  refetchFormations,
  refetchSurfaces,
  refetchLithoContacts,
  activeLithoModel,
  setActiveLithoModel,
}: UseGeologicalModelOpsParams): UseGeologicalModelOpsResult {
  // Auto-populate the active model with contacts derived from
  // each section borehole's stratigraphy observation (formal
  // preferred, informal fallback). Backend creates contacts +
  // any missing formations in one transaction; we refresh local
  // formations + contacts state from the API afterwards (cheaper
  // and more correct than reconstructing from the returned id
  // lists).
  const handleAutoPopulateFromStratigraphy = useCallback(
    async (
      boreholeIds: readonly string[],
      sectionId?: string | null,
      onSectionUpdated?: (updated: CrossSectionResponse) => void,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (boreholeIds.length === 0) return
      log.debug(
        'geology',
        `autoPopulateFromStratigraphy entry boreholes=${boreholeIds.length}` +
          (sectionId ? ` section=${sectionId}` : ''),
      )
      // Bug 2 fix: forward the persisted lumping map on the Seed path so the
      // discover ≡ apply ≡ seed invariant holds.  When the user previously
      // applied aliases (currentLumping != null), the same alias map must reach
      // the backend here — otherwise Seed creates contacts under raw borehole
      // keys that differ from the merged formation keys Fill applied.
      const seedManualMap =
        currentLumping != null && Object.keys(currentLumping.map).length > 0
          ? currentLumping.map
          : undefined
      try {
        const outcome = await api.geology.autoPopulateFromStratigraphy(
          project.id,
          activeGeologicalModel.id,
          boreholeIds,
          undefined, // selectedKeys — absent on the Seed path
          seedManualMap,
          sectionId,
          // Explicit-content invariant: Seed never creates formations.
          // An in-corridor borehole layer whose formation the user did
          // not curate is skipped (reported via skipped_not_in_model),
          // not minted — the "Seed added Formatie van Ieper" bug.
          false,
        )
        // P2-G: when the Seed response carries an updated section row
        // (server patched seeded_formation_contact_ids), patch local
        // section state without a round-trip GET.
        if (outcome.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(outcome.updated_section)
          log.debug(
            'geology',
            `autoPopulateFromStratigraphy: section ${sectionId} seeded set applied locally`,
          )
        }
        // Refresh formations + contacts state. The auto-populate
        // path can have created either / both — re-fetching is the
        // simplest path to consistency.
        const [forms, conts] = await Promise.all([
          api.geology.listFormations(project.id),
          api.geology.listContacts(project.id, activeGeologicalModel.id),
        ])
        setFormations(forms)
        setContacts(conts)
        // New formations are session-import entities so they
        // survive the save flow's manifest filter.
        addToSessionImports('formation', outcome.created_formation_ids)
        addToSessionImports('contact', outcome.created_contact_ids)
        // Add new formations to the project manifest so the save
        // flow's filter passes them through.
        for (const id of outcome.created_formation_ids) {
          addToManifest('formation', [id])
        }
        // Tell the InterpretationPane (separate state) to refetch
        // — it doesn't observe App's formations cache directly.
        setFormationsRefreshCounter(c => c + 1)
        const created = outcome.created_contact_ids.length
        const notInModel = outcome.skipped_not_in_model
        const skipped =
          outcome.skipped_existing +
          outcome.skipped_unmatched +
          outcome.skipped_no_stratigraphy
        log.success(
          'geology',
          `autoPopulateFromStratigraphy ok +${created} contacts, ` +
            `+${outcome.created_formation_ids.length} formations, ` +
            `skipped ${outcome.skipped_existing} existing / ` +
            `${outcome.skipped_unmatched} unmatched / ` +
            `${outcome.skipped_no_stratigraphy} no-strat / ` +
            `${notInModel} not-in-model`,
        )
        // Undo: delete every created contact + every created formation
        // (contacts first — FK from contact.formation_id). The redo
        // path re-runs the auto-populate against the same boreholes;
        // idempotency on observation_layer_id means the same layers
        // get re-seeded (potentially with new server-assigned ids).
        if (created > 0 || outcome.created_formation_ids.length > 0) {
          const projectId = project.id
          const modelId = activeGeologicalModel.id
          const boreholeIdsSnapshot = boreholeIds.slice()
          // Capture both lists in closure; mutated on each reapply
          // since the recreated rows get fresh server ids.
          let currentContactIds = outcome.created_contact_ids.slice()
          let currentFormationIds = outcome.created_formation_ids.slice()
          pushUndo({
            descriptionKey: 'undo.seedFromStratigraphy',
            descriptionParams: { n: created },
            revert: async () => {
              await Promise.all(
                currentContactIds.map(id =>
                  api.geology.deleteContact(projectId, modelId, id),
                ),
              )
              await Promise.all(
                currentFormationIds.map(id =>
                  api.geology.deleteFormation(projectId, id),
                ),
              )
              const droppedContacts = new Set(currentContactIds)
              const droppedFormations = new Set(currentFormationIds)
              setContacts(prev =>
                prev.filter(c => !droppedContacts.has(c.id)),
              )
              setFormations(prev =>
                prev.filter(f => !droppedFormations.has(f.id)),
              )
              setFormationsRefreshCounter(c => c + 1)
            },
            reapply: async () => {
              const next = await api.geology.autoPopulateFromStratigraphy(
                projectId,
                modelId,
                boreholeIdsSnapshot,
                undefined,
                undefined,
                undefined,
                // Redo of a Seed run must mirror it — never create.
                false,
              )
              currentContactIds = next.created_contact_ids.slice()
              currentFormationIds = next.created_formation_ids.slice()
              const [forms2, conts2] = await Promise.all([
                api.geology.listFormations(projectId),
                api.geology.listContacts(projectId, modelId),
              ])
              setFormations(forms2)
              setContacts(conts2)
              setFormationsRefreshCounter(c => c + 1)
            },
          })
        }
        // Surface a short summary toast. Tone: success on any new
        // rows; info on a pure-idempotent re-run; warning when
        // nothing was created AND boreholes lacked stratigraphy.
        // Seed never creates formations (explicit-content invariant), so
        // a layer whose formation the user didn't curate is skipped, not
        // minted. Surface that count so the dropped borehole data isn't
        // silent — the engineer adds the formation in the Geology stage
        // ("Fill from boreholes") if they want it on the section.
        const skippedFragment =
          notInModel > 0
            ? notInModel === 1
              ? t('geology.seedSkippedFragmentOne', { n: notInModel })
              : t('geology.seedSkippedFragmentMany', { n: notInModel })
            : ''
        if (created > 0) {
          toast(
            'success',
            notInModel > 0
              ? t('geology.seededContactsSkipped', { created, skipped: skippedFragment })
              : t('geology.seededContacts', { created }),
          )
        } else if (outcome.skipped_no_stratigraphy === boreholeIds.length) {
          toast('error', t('geology.noStratigraphyOnSection'))
        } else if (notInModel > 0) {
          // Not an error — expected when the corridor's boreholes carry
          // formations the user chose not to curate. 'success' tone keeps
          // parity with the "Already in sync" message below (toast only
          // has success/error).
          toast('success', t('geology.nothingSeeded', { skipped: skippedFragment }))
        } else if (skipped > 0) {
          toast('success', t('geology.alreadyInSyncNothingToAdd'))
        }
      } catch (err) {
        log.error(
          'geology',
          'autoPopulateFromStratigraphy failed',
          err,
        )
        toast('error', t('geology.seedContactsFailed'))
      }
    },
    [
      project,
      activeGeologicalModel,
      currentLumping,
      addToSessionImports,
      addToManifest,
      pushUndo,
    ],
  )

  // One-shot cleanup for legacy duplicate (anchor, formation)
  // contacts left over from auto-populate runs that predated the
  // per-anchor uniqueness rule. Backend keeps one survivor per
  // group + deletes the rest; we refresh local contacts state +
  // toast the count.
  //
  // The callers gate this behind DedupeContactsConfirmDialog — the
  // dialog this comment used to claim already existed while both
  // buttons called straight through (see the clean/dirty audit,
  // docs/design/clean-dirty-undo-audit.md §2.1).
  //
  // NOT in the undo stack, and not for want of the ids: the response
  // carries removed_contact_ids, but an id cannot rebuild a deleted
  // row, and re-POSTing the rows we still hold locally is refused —
  // CreateFormationContact raises DuplicateContactError for any
  // (model, anchor, formation) that already has a contact, which is
  // by definition every row dedupe removed, since it kept the
  // survivor. A real undo needs a backend restore command that
  // re-inserts the losers with their original created_at (the third
  // survivor tie-break reads it) and re-links the litho layers whose
  // parent_geo_contact_id the delete set to NULL. Until that exists
  // the dialog says the deletion cannot be undone rather than
  // offering a restore that quietly returns a poorer row.
  const handleDedupeContacts = useCallback(async (): Promise<number> => {
    if (!project || !activeGeologicalModel) return 0
    log.debug('geology', `dedupeContacts entry model=${activeGeologicalModel.id}`)
    try {
      const result = await api.geology.dedupeContacts(
        project.id,
        activeGeologicalModel.id,
      )
      // Refresh contacts so deleted rows leave the section view.
      const conts = await api.geology.listContacts(
        project.id,
        activeGeologicalModel.id,
      )
      setContacts(conts)
      log.success(
        'geology',
        `dedupeContacts ok inspected=${result.inspected_groups} removed=${result.duplicates_removed}`,
      )
      if (result.duplicates_removed === 0) {
        toast('success', t('geology.dedupeAlreadyClean'))
      } else {
        // Rows were deleted — mark dirty so a close-without-save reverts.
        markMutated()
        toast(
          'success',
          t('geology.dedupeRemoved', {
            d: result.duplicates_removed,
            contactWord:
              result.duplicates_removed === 1
                ? t('geology.contactWordOne')
                : t('geology.contactWordMany'),
            g: result.inspected_groups,
            pairWord:
              result.inspected_groups === 1
                ? t('geology.pairWordOne')
                : t('geology.pairWordMany'),
          }),
        )
      }
      return result.duplicates_removed
    } catch (err) {
      log.error('geology', 'dedupeContacts failed', err)
      toast('error', t('geology.cleanupFailed'))
      return 0
    }
  }, [project, activeGeologicalModel, markMutated])

  // Manual escape hatch — force-recompute every formation's TIN
  // cache. The auto-recompute hooks attached to every contact-
  // mutating use case keep the cache fresh on the happy path; this
  // covers the cases they don't (anchor elevation edited without a
  // contact mutation, suspected stale checksum). Reversible — no
  // confirmation modal.
  const handleRebuildSurfaces = useCallback(async (): Promise<void> => {
    if (!project || !activeGeologicalModel) return
    log.debug('geology', `rebuildSurfaces entry model=${activeGeologicalModel.id}`)
    try {
      const result = await api.geology.rebuildSurfaces(
        project.id,
        activeGeologicalModel.id,
      )
      // Refetch the cache so the section view's slice render uses
      // the freshly-computed TINs even when the checksum matched.
      refetchSurfaces()
      // Build also auto-reorders display_order to match the data —
      // refetch formations so the InterpretationPane list reflects
      // the new age order without a window reload.
      const reordered = result.formations_reordered ?? 0
      if (reordered > 0) {
        refetchFormations()
      }
      log.success(
        'geology',
        `rebuildSurfaces ok considered=${result.formations_considered} ` +
          `rebuilt=${result.formations_rebuilt} reordered=${reordered}`,
      )
      if (result.formations_considered === 0) {
        toast('success', t('geology.noFormationsToRebuild'))
      } else if (result.formations_rebuilt === 0 && reordered === 0) {
        toast(
          'success',
          t('geology.cacheInSync', {
            n: result.formations_considered,
            formationWord:
              result.formations_considered === 1
                ? t('geology.formationWordOne')
                : t('geology.formationWordMany'),
          }),
        )
      } else {
        const surfaceWord =
          result.formations_considered === 1
            ? t('geology.surfaceWordOne')
            : t('geology.surfaceWordMany')
        const rebuiltPart =
          result.formations_rebuilt > 0
            ? t('geology.rebuiltSurfaces', {
                rebuilt: result.formations_rebuilt,
                considered: result.formations_considered,
                surfaceWord,
              })
            : t('geology.surfacesAlreadyCurrent', {
                considered: result.formations_considered,
                surfaceWord,
              })
        const reorderPart =
          reordered > 0
            ? t('geology.reorderedByDepth', {
                n: reordered,
                formationWord:
                  reordered === 1
                    ? t('geology.formationWordOne')
                    : t('geology.formationWordMany'),
              })
            : ''
        toast('success', `${rebuiltPart}${reorderPart}.`)
      }
    } catch (err) {
      log.error('geology', 'rebuildSurfaces failed', err)
      toast('error', t('geology.rebuildSurfacesFailed'))
    }
  }, [project, activeGeologicalModel, refetchSurfaces, refetchFormations])

  // Export the geological model as a runnable Plaxis 3D Python
  // script (plxscripting). Mirrors handleExportSectionDxf — fetch
  // bytes → save dialog → file write. Hidden in the pane when no
  // active model is wired (Phase 4 Plaxis export).
  const handleExportModelPlaxis3d = useCallback(async (): Promise<void> => {
    if (!project || !activeGeologicalModel) return
    const projectId = project.id
    const modelId = activeGeologicalModel.id
    log.info('geology', `exportPlaxis3d start model=${modelId}`)
    try {
      const safeName = project.name.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'project'
      const dialogPath = await window.electron.showExportSaveDialog(
        `${safeName}_plaxis3d.py`,
        [
          { name: 'Python Script', extensions: ['py'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      )
      if (dialogPath === null) {
        log.debug('geology', 'exportPlaxis3d cancelled at save dialog')
        return
      }
      const bytes = await api.geology.exportPlaxis3d(projectId, modelId)
      await window.electron.writeExportFile(dialogPath, bytes)
      log.success(
        'geology',
        `exportPlaxis3d ok model=${modelId} bytes=${bytes.byteLength} path=${dialogPath}`,
      )
      toast('success', t('geology.plaxisExported'))
    } catch (err) {
      log.error('geology', 'exportPlaxis3d failed', err)
      toast(
        'error',
        err instanceof Error ? err.message : t('geology.plaxisExportFailed'),
      )
    }
  }, [project, activeGeologicalModel])

  // Toggle whether a borehole anchors formation contacts in the
  // active geological model. The model's ``excluded_borehole_ids``
  // is the bundle-portable source of truth. Toggling fires
  // PATCH /projects/{pid}/geology/models/{mid} and updates the
  // local state optimistically so the contacts overlay redraws
  // without waiting for the round-trip.
  //
  // Excluded boreholes still render their lithology strip (the
  // user can still SEE them for context), but their contacts get
  // filtered out of the ContactsLayer. Contact data stays in the
  // DB — re-including the borehole brings the lines back.
  const handleToggleBoreholeInModel = useCallback(
    async (boreholeId: string, included: boolean): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      // The geological checkbox toggles silently — no ``onSuccessToast``.
      await toggleBoreholeExclusion({
        projectId: project.id,
        model: activeGeologicalModel,
        setModel: setActiveGeologicalModel,
        boreholeId,
        included,
        pushUndo,
        markMutated,
        includeDescriptionKey: 'undo.includeBoreholeGeo',
        excludeDescriptionKey: 'undo.excludeBoreholeGeo',
        logLabel: 'updateModel',
      })
    },
    [project, activeGeologicalModel, pushUndo, markMutated],
  )

  // Debt #65: the Lithology inspector's "Include again" list. The active LITHO
  // model carries its OWN ``excluded_borehole_ids`` (set by the backend during
  // the litho build when a borehole disagrees with its corridor); this surfaces
  // the toggle for it. Same optimistic + reversible mechanics as the geological
  // toggle, and a confirmation toast — the include is a reversible action that
  // fires immediately (docs/ux.md), and its undo path is the Ctrl+Z stack.
  const handleToggleBoreholeInLithoModel = useCallback(
    async (boreholeId: string, included: boolean): Promise<void> => {
      if (!project || !activeLithoModel) return
      await toggleBoreholeExclusion({
        projectId: project.id,
        model: activeLithoModel,
        setModel: setActiveLithoModel,
        boreholeId,
        included,
        pushUndo,
        markMutated,
        includeDescriptionKey: 'undo.includeBoreholeLitho',
        excludeDescriptionKey: 'undo.excludeBoreholeLitho',
        logLabel: 'updateLithoModel',
        onSuccessToast: () =>
          toast(
            'success',
            t(
              included ? 'litho.boreholeIncludedToast' : 'litho.boreholeExcludedToast',
            ),
          ),
      })
    },
    [project, activeLithoModel, pushUndo, markMutated],
  )

  // Delete the active geological model (irreversible). Clears all
  // local formation / contact / surface state and fires
  // removeFromManifest for all formation ids. The caller (GeologyToolbar)
  // must show a confirmation dialog before calling this.
  const handleDeleteModel = useCallback(async (): Promise<void> => {
    if (!project || !activeGeologicalModel) return
    const projectId = project.id
    const modelId = activeGeologicalModel.id
    log.info('geology', `handleDeleteModel entry model=${modelId}`)
    try {
      await api.geology.deleteModel(projectId, modelId)
      const deletedFormationIds = formations.map(f => f.id)
      setActiveGeologicalModel(null)
      setFormations([])
      setContacts([])
      setSurfacesByFormationId(new Map())
      removeFromManifest('formation', deletedFormationIds)
      removeFromSessionImports('formation', deletedFormationIds)
      markMutated()
      log.success('geology', `handleDeleteModel ok model=${modelId}`)
    } catch (err) {
      log.error('geology', `handleDeleteModel failed model=${modelId}`, err)
      throw err
    }
  }, [
    project,
    activeGeologicalModel,
    formations,
    removeFromManifest,
    removeFromSessionImports,
    markMutated,
  ])

  return {
    handleAutoPopulateFromStratigraphy,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    handleToggleBoreholeInLithoModel,
    handleDeleteModel,
  }
}
