/**
 * Lithostratigraphic-model operations handler cluster for
 * {@link useGeologicalModel} (debt #201 Move 5). Extracted as a focused
 * sub-hook so the composer stays a thin owner of shared state. This cluster
 * covers litho-model-level mutations: rebuild litho surfaces, clear litho
 * model, create/activate/delete lithostratigraphic model.
 *
 * The shared state (ghost overlay, focused-anchor flag, the model list,
 * and the refetch helpers) lives in the composer and is passed in; this
 * hook owns only the five operation callbacks.
 *
 * Dep-array convention: ``set*`` setters (``setGhostsByAnchor``,
 * ``setFocusedSuggestAnchorId``) are
 * omitted from dep arrays — they are stable-by-construction useState
 * setters. Unlike the modelOps cluster, ``toast`` IS listed in dep arrays
 * for this cluster (carried verbatim from the composer — the original
 * handlers listed it explicitly). Refs (``activeLithoModelRef``,
 * ``activeGeologicalModelRef``) are stable across renders and never appear
 * in dep arrays.
 */
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import { api } from '../api/client'
import type { GeologicalModelResponse, ProjectResponse } from '../api/client'
import type { BulkAnchorGhost } from './useGeologicalModel'
import { isApiStatus } from '../api/clients/shared'
import { log } from '../utils/log'
import { deleteBlockedMessageKey } from '../utils/modelDependents'
import { t } from '../i18n/translate'

/** Inputs for {@link useLithoModelOps}. */
export interface UseLithoModelOpsParams {
  /** The open project, or null when none is loaded. */
  project: ProjectResponse | null
  /**
   * Stable ref to the active lithostratigraphic model. Used by
   * handleRebuildLithoSurfaces and handleClearLithoModel so they can read
   * the latest value without listing it as a dep.
   */
  activeLithoModelRef: MutableRefObject<GeologicalModelResponse | null>
  /**
   * Stable ref to the active geological model. Used by
   * handleCreateLithoModel to read the parent backbone without a dep.
   */
  activeGeologicalModelRef: MutableRefObject<GeologicalModelResponse | null>
  /** Resync the model list + derive the active-litho pointer. */
  refreshModels: () => Promise<GeologicalModelResponse[]>
  /** Resync the litho layers (and derived litho contacts) from the server. */
  refetchLithoContacts: () => void
  /** Resync the formation list from the server. */
  refetchFormations: () => void
  /** Refetch the litho surface TIN cache from the server. */
  refetchLithoSurfaces: () => void
  /**
   * Setter for the ghost-suggestion Map. Stable — omitted from dep arrays.
   * Called by handleClearLithoModel to dismiss stale ghost overlays.
   */
  setGhostsByAnchor: Dispatch<SetStateAction<ReadonlyMap<string, BulkAnchorGhost>>>
  /**
   * Setter for the focused-anchor pointer. Stable — omitted from dep arrays.
   * Cleared by handleClearLithoModel alongside the ghost Map.
   */
  setFocusedSuggestAnchorId: Dispatch<SetStateAction<string | null>>
  /** Mark the project dirty after a mutation of pre-existing rows. */
  markMutated: () => void
  /** Surface a toast to the user. Listed in dep arrays for this cluster. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/** Handlers returned by {@link useLithoModelOps}. */
export interface UseLithoModelOpsResult {
  handleRebuildLithoSurfaces: () => Promise<void>
  handleClearLithoModel: () => Promise<void>
  handleCreateLithoModel: (name: string) => Promise<GeologicalModelResponse | null>
  handleActivateLithoModel: (modelId: string) => Promise<void>
  handleDeleteLithoModel: (modelId: string) => Promise<void>
}

/**
 * Lithostratigraphic-model operation callbacks (rebuild surfaces, clear,
 * create, activate, delete).
 *
 * Parameters
 * ----------
 * params
 *     See {@link UseLithoModelOpsParams}.
 *
 * Returns
 * -------
 * UseLithoModelOpsResult
 *     The five operation handlers.
 */
export function useLithoModelOps({
  project,
  activeLithoModelRef,
  activeGeologicalModelRef,
  refreshModels,
  refetchLithoContacts,
  refetchFormations,
  refetchLithoSurfaces,
  setGhostsByAnchor,
  setFocusedSuggestAnchorId,
  markMutated,
  toast,
}: UseLithoModelOpsParams): UseLithoModelOpsResult {
  // Rebuild TIN surfaces for the active lithostratigraphic model.
  // Closes over activeLithoModelRef; the dep array is
  // [project, refetchLithoSurfaces, toast] — refetchLithoSurfaces is a
  // stable useCallback keyed on [project] and toast is caller-stable,
  // so the callback identity tracks project identity.  The rebuild
  // endpoint is model-id-
  // agnostic (POST .../models/{mid}/surfaces/rebuild works for any kind);
  // no backend change is required.  After a successful rebuild we
  // call refetchLithoSurfaces so lithoSurfacesByFormationId + the
  // stale-count badge update synchronously.
  const handleRebuildLithoSurfaces = useCallback(async (): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.debug('geology', `rebuildLithoSurfaces entry model=${model.id}`)
    try {
      const result = await api.geology.rebuildSurfaces(project.id, model.id)
      refetchLithoSurfaces()
      log.success(
        'geology',
        `rebuildLithoSurfaces ok considered=${result.formations_considered} rebuilt=${result.formations_rebuilt}`,
      )
      const surfaceWord =
        result.formations_considered === 1
          ? t('litho.surfaceWordOne')
          : t('litho.surfaceWordMany')
      if (result.formations_considered === 0) {
        toast('success', t('litho.noFormationsToRebuild'))
      } else if (result.formations_rebuilt === 0) {
        toast('success', t('litho.cacheInSync', { n: result.formations_considered, surfaceWord }))
      } else {
        toast(
          'success',
          t('litho.rebuiltSurfaces', {
            rebuilt: result.formations_rebuilt,
            considered: result.formations_considered,
            surfaceWord,
          }),
        )
      }
    } catch (err) {
      log.error('geology', 'rebuildLithoSurfaces failed', err)
      toast('error', t('litho.rebuildSurfacesFailed'))
    }
  }, [project, refetchLithoSurfaces, toast])

  // Debt #94 fix: clear all content from the active litho model.
  // Removes contacts, correlation edges, TIN surfaces, and orphan litho
  // formations in one atomic call. Irreversible — the caller
  // (LithologyInspector) must present a confirm dialog first.
  const handleClearLithoModel = useCallback(async (): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.info('geology', `clearLithoModel entry model=${model.id}`)
    try {
      const result = await api.geology.clearLithoModel(project.id, model.id)
      // Refetch contacts (now empty), formations (litho units gone), and
      // surfaces (TIN rows deleted) so the inspector roster and 3D viewer
      // both update without a page reload.
      refetchLithoContacts()
      refetchFormations()
      refetchLithoSurfaces()
      // Also dismiss any litho suggestion ghosts — they were proposals
      // for the model we just emptied; leaving the coloured ghost bands
      // on the section after a "Clear litho model" is confusing (dogfeed
      // 2026-05-22). The ghost overlay is ephemeral frontend state,
      // separate from the DB model, so the clear endpoint never touched
      // it — reset it here. (Setters from useState are stable; the
      // closure resolves them at call time, well after declaration.)
      setGhostsByAnchor(new Map())
      setFocusedSuggestAnchorId(null)
      const total = result.contacts + result.formations
      // Rows were deleted — mark dirty so a close-without-save reverts.
      if (total > 0) markMutated()
      log.success(
        'geology',
        `clearLithoModel ok contacts=${result.contacts} edges=${result.edges} ` +
          `surfaces=${result.surfaces} formations=${result.formations}`,
      )
      toast(
        'success',
        total === 0
          ? t('litho.modelAlreadyEmpty')
          : t('litho.clearedModel', {
              c: result.contacts,
              contactWord:
                result.contacts === 1 ? t('litho.contactWordOne') : t('litho.contactWordMany'),
              u: result.formations,
              unitWord: result.formations === 1 ? t('litho.unitWordOne') : t('litho.unitWordMany'),
            }),
      )
    } catch (err) {
      log.error('geology', 'clearLithoModel failed', err)
      toast('error', t('litho.clearModelFailed'))
    }
  }, [project, refetchLithoContacts, refetchFormations, refetchLithoSurfaces, toast, markMutated])

  // #55 model-kind picker — create a lithostratigraphic model under
  // the active geological backbone. The backend enforces the parent
  // invariant (422 if parent missing / wrong kind); we surface that
  // as a toast and return null rather than throwing into the UI.
  const handleCreateLithoModel = useCallback(
    async (name: string): Promise<GeologicalModelResponse | null> => {
      if (!project) return null
      const parent = activeGeologicalModelRef.current
      if (!parent) {
        toast('error', t('litho.createGeoModelFirst'))
        return null
      }
      try {
        const created = await api.geology.createModel(project.id, {
          name,
          kind: 'lithostratigraphic',
          parent_model_id: parent.id,
          is_active: true,
        })
        await refreshModels()
        log.success('geology', `created litho model ${created.id} (${name})`)
        return created
      } catch (err) {
        log.error('geology', `handleCreateLithoModel failed (${name})`, err)
        toast('error', t('litho.createModelFailed'))
        return null
      }
    },
    [project, refreshModels, toast],
  )

  // #55 — activate a lithostratigraphic model (backend clears the
  // same-kind sibling only; the geological backbone is untouched).
  const handleActivateLithoModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (!project) return
      try {
        await api.geology.activateModel(project.id, modelId)
        await refreshModels()
        log.success('geology', `activated litho model ${modelId}`)
      } catch (err) {
        log.error('geology', `handleActivateLithoModel failed ${modelId}`, err)
        toast('error', t('litho.activateModelFailed'))
      }
    },
    [project, refreshModels, toast],
  )

  // #55: delete a lithostratigraphic model. A geotechnical model can
  // refine a litho model; the backend then refuses the delete with a 409.
  // The picker disables the action when the local model list shows such a
  // child, so the 409 here is only the safety net for a stale list: it is
  // an expected refusal, logged as a warning (the walker counts console
  // errors) and toasted as a warning with the same sentence the disabled
  // button shows, and the model list is refreshed so the picker learns the
  // child and switches to the explanation. refreshModels re-derives
  // activeLithoModel from the fresh list; when the deleted model was
  // active it becomes null and the activeLithoModel-watching effect
  // clears the parallel litho formation/contact state — no manual
  // teardown needed. The picker shows a confirm dialog before calling
  // this (irreversible-action rule, docs/ux.md).
  const handleDeleteLithoModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (!project) return
      log.info('geology', `handleDeleteLithoModel entry model=${modelId}`)
      try {
        await api.geology.deleteModel(project.id, modelId)
        await refreshModels()
        // Debt #147 follow-up — the backend delete cascade removes
        // every litho formation that had a contact ONLY in this model
        // (per the model-aware vocabulary rule in
        // ``GeologyRepository.delete_model``).  The frontend
        // ``formations`` list is project-scoped and isn't auto-
        // refreshed by ``refreshModels``, so the deleted litho units
        // would linger in ``lithoFormations`` → the LithologyInspector
        // INSTANCES section keeps showing the OLD 69 unit rows under
        // a freshly-created new model.  Refetch formations so the
        // local vocabulary reflects what's actually in the DB.
        refetchFormations()
        markMutated()
        log.success('geology', `deleted litho model ${modelId}`)
      } catch (err) {
        if (isApiStatus(err, 409)) {
          log.warn('geology', `handleDeleteLithoModel refused model=${modelId}: another model refines it`)
          toast('warning', t(deleteBlockedMessageKey('geotechnical')))
          refreshModels().catch(refreshErr =>
            log.warn('geology', 'refreshModels after a refused litho delete failed', refreshErr),
          )
          throw err
        }
        log.error('geology', `handleDeleteLithoModel failed ${modelId}`, err)
        // Surface the server's reason (del() now carries `detail`).
        toast(
          'error',
          err instanceof Error ? err.message : t('litho.deleteModelFailed'),
        )
        throw err
      }
    },
    [project, refreshModels, refetchFormations, toast, markMutated],
  )

  return {
    handleRebuildLithoSurfaces,
    handleClearLithoModel,
    handleCreateLithoModel,
    handleActivateLithoModel,
    handleDeleteLithoModel,
  }
}
