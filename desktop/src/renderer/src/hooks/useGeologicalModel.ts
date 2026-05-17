// Geological model state and mutation handlers.
//
// Owns the active geological model, its formations, contacts, and the
// cached TIN surfaces. Every contact-mutating handler (create, update,
// delete, batch, auto-populate, dedupe, rebuild, Plaxis export, borehole
// toggle) lives here so the mutation logic is co-located with the state
// it updates.
//
// Forward-ref hazard resolved:
//   In App.tsx, ``handleCreateContact`` called
//   ``handleUpdateContactDepthRef.current`` to dodge a TDZ violation.
//   Here both functions are in the same module scope, so they can call
//   each other directly. The ref pattern is not needed.
//
// Surfaces auto-refetch:
//   A ``useEffect`` on ``contacts`` identity fires after every
//   mutation handler (each one calls ``setContacts``). The first
//   observation is skipped (bootstrap already fetched surfaces in
//   parallel); subsequent ones call ``refetchSurfaces`` and bump the
//   crossings counter.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, DuplicateContactError } from '../api/client'
import type {
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  ProjectResponse,
} from '../api/client'
import type { UndoCommand } from './useUndoStack'
import { addAllToSet } from '../utils/sets'
import { log } from '../utils/log'

/** Payload accepted by the ContactsLayer batch-copy handler. */
export type ContactCopyPayload = import('../components/sections/ContactsLayer').ContactCopyPayload

/** A candidate formation discovered from borehole stratigraphy. */
export interface FormationCandidate {
  /** Working display name (informal description preferred; formal as fallback). */
  name: string
  /**
   * Stable cross-borehole identity key — ``regional_ref`` when formal
   * stratigraphy is present, else ``name``.  Selection state in
   * FormationSelectionDialog and the ``selected_keys`` filter sent to the
   * auto-populate endpoint are both expressed in these keys.
   */
  key: string
  /** Number of in-scope boreholes that carry this key. */
  boreholeCount: number
}

export interface UseGeologicalModelResult {
  activeGeologicalModel: GeologicalModelResponse | null
  formations: GeologicalFormationResponse[]
  /**
   * Manifest-filtered formation list — the single source of truth for
   * "which formations are visible in this project".
   *
   * Computed in App.tsx (which has access to both ``formations`` and
   * ``manifestFormationIds``) and injected here so every consumer reads the
   * same filtered value: GeologyInspector, GeologyStage badge, and the Seed
   * gate in SectionsToolbar.  Avoids the three-site duplication that caused
   * the badge/inspector/seed desync bug (Fix 3 — 2026-05-16).
   *
   * Semantics: when ``manifestFormationIds`` is undefined (no project open),
   * returns all formations (matches the existing GeologyInspector fallback
   * behaviour).
   */
  visibleFormations: GeologicalFormationResponse[]
  formationsRefreshCounter: number
  contacts: FormationContactResponse[]
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  crossingsRefreshCounter: number
  staleSurfaceCount: number
  // Formation actions
  handleFormationCreated: (id: string) => void
  handleFormationUpdated: () => void
  handleFormationDeleted: (id: string) => void
  handleInlineCreateFormation: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
  refetchFormations: () => void
  // Contact actions
  handleCreateContact: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
  ) => Promise<void>
  handleUpdateContactDepth: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  handleBatchCreateContacts: (creates: readonly ContactCopyPayload[]) => Promise<void>
  handleBatchUpdateContacts: (updates: readonly FormationContactBatchUpdateEntry[]) => Promise<void>
  handleDeleteContact: (contactId: string) => Promise<void>
  handleAutoPopulateFromStratigraphy: (boreholeIds: readonly string[]) => Promise<void>
  handleDedupeContacts: () => Promise<number>
  handleRebuildSurfaces: () => Promise<void>
  handleExportModelPlaxis3d: () => Promise<void>
  handleToggleBoreholeInModel: (boreholeId: string, included: boolean) => Promise<void>
  // Discard bridge — removes a set of contact ids from local state
  // without a DB call (the DB deletes are the caller's responsibility).
  // Used by discardSessionImports in App.tsx (moving to
  // useProjectLifecycle in Commit 7) so it can scrub the contacts list
  // without owning the internal setContacts setter.
  discardContacts: (ids: ReadonlySet<string>) => void
  // Fill-from-boreholes: discover candidate names (read-only).
  discoverBoreholeFormations: (
    boreholeIds: readonly string[],
  ) => Promise<FormationCandidate[]>
  // Fill-from-boreholes: apply the curated selection (destructive).
  // Calls auto-populate with selected stable keys (server creates only
  // those formations), then refetches the fresh formation list and
  // deletes any formation whose stable key is NOT in the selected set.
  // The confirm gate lives in FormationSelectionDialog.
  applyBoreholeFormationSelection: (
    selectedKeys: ReadonlySet<string>,
    boreholeIds: readonly string[],
  ) => Promise<void>
  // Geology toolbar: delete the active geological model (irreversible).
  handleDeleteModel: () => Promise<void>
  /**
   * Ensure an active geological model exists, creating the "Default" model
   * when none is present.  Used by Fill-from-boreholes so the action is
   * always reachable regardless of bootstrap timing.
   *
   * Returns
   * -------
   * ``GeologicalModelResponse`` on success, ``null`` when the project is
   * absent or the API call fails.
   */
  ensureActiveGeologicalModel: () => Promise<GeologicalModelResponse | null>
}

/**
 * React hook that manages the geological model, formations, contacts, and
 * TIN surface cache for the active project.
 *
 * Parameters
 * ----------
 * project
 *     Active project.  When ``null`` all state is cleared.
 * toast
 *     Stable action from ``useToasts`` for surfacing API failures.
 * pushUndo
 *     Stable action from ``useUndoStack`` for recording reversible mutations.
 * addToManifest
 *     From ``useProject`` — appends newly-created formation ids to the
 *     bundle manifest so they survive the save-filter.
 * removeFromManifest
 *     From ``useProject`` — removes deleted / discarded formation ids.
 * addToSessionImports
 *     From the session-imports tracking layer — flags new formations and
 *     contacts as unsaved so the dirty indicator lights up.
 * removeFromSessionImports
 *     Dual of ``addToSessionImports`` — clears a formation/contact's
 *     unsaved flag when it is deleted before ever being saved, so the
 *     project doesn't stay dirty over a row that no longer exists.
 *
 * Returns
 * -------
 * UseGeologicalModelResult
 *     All geological model state + action callbacks.
 */
export function useGeologicalModel({
  project,
  toast,
  pushUndo,
  addToManifest,
  removeFromManifest,
  addToSessionImports,
  removeFromSessionImports,
  manifestFormationIds,
}: {
  project: ProjectResponse | null
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'formation', ids: string[]) => void
  removeFromManifest: (kind: 'formation', ids: Iterable<string>) => void
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  removeFromSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  // R4 (debt #12): the bundle manifest of formation ids, from
  // ``useProject``. Injected (not read here directly) because it is a
  // coordinator-level value; the hook owns the visible-list filter so
  // App.tsx no longer post-processes the geo slice via a spread.
  // ``undefined`` ⇒ no project open ⇒ no filter (show everything).
  manifestFormationIds: ReadonlySet<string> | undefined
}): UseGeologicalModelResult {
  const [activeGeologicalModel, setActiveGeologicalModel] =
    useState<GeologicalModelResponse | null>(null)
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>([])
  // Refresh signal for InterpretationPane. The pane keeps its own
  // formations cache; bumping this counter forces a refetch.
  // Bumped after auto-populate from stratigraphy because the new
  // formations land server-side, outside the pane's create-edit-
  // delete flow.
  const [formationsRefreshCounter, setFormationsRefreshCounter] = useState(0)
  const [contacts, setContacts] = useState<FormationContactResponse[]>([])
  // Cached TIN surfaces for the active geological model, keyed by
  // formation id. Recomputed server-side on every contact mutation
  // (debt #11), so the desktop just refetches after each commit. The
  // map shape is convenient because ContactsLayer's slice render
  // looks up "is there a surface for formation X?" per-formation.
  const [surfacesByFormationId, setSurfacesByFormationId] = useState<
    ReadonlyMap<string, FormationSurfaceResponse>
  >(new Map())
  const [crossingsRefreshCounter, setCrossingsRefreshCounter] = useState(0)

  // Mirrors activeGeologicalModel into a ref so useCallback closures
  // can read the latest value without listing the state as a dep.
  // Follows the lastSurfaceRefetchContactsRef pattern already used in
  // this hook: a tiny useEffect keeps the ref in sync whenever the
  // state changes.
  const activeGeologicalModelRef = useRef<GeologicalModelResponse | null>(null)
  useEffect(() => {
    activeGeologicalModelRef.current = activeGeologicalModel
  }, [activeGeologicalModel])

  // Shared in-flight guard: if a list→adopt→create-Default operation
  // is already running (bootstrap or ensureActiveGeologicalModel),
  // any second caller awaits the SAME promise instead of issuing a
  // concurrent createModel call. Cleared when the promise settles so
  // a later legitimate ensure (e.g. after handleDeleteModel) works.
  const ensureModelPromiseRef = useRef<Promise<GeologicalModelResponse | null> | null>(null)

  // Core list→adopt→create-Default logic shared by the bootstrap
  // effect and ensureActiveGeologicalModel. Extracted here so both
  // paths are identical and cannot diverge (CLAUDE.md "extract on the
  // second copy" rule — this is the second concrete use).
  //
  // Does NOT set React state — callers do that so they can apply
  // cancelled-flag guards correctly.
  //
  // Returns the active model or throws on API failure.
  const resolveActiveModel = async (projectId: string): Promise<GeologicalModelResponse> => {
    const models = await api.geology.listModels(projectId)
    // Slice-1 made is_active scoped PER KIND — a project can now have
    // an active geological AND an active lithostratigraphic model at
    // once. The section editor / Build / crossings flow operates on
    // the GEOLOGICAL backbone, so select that one specifically. Absent
    // kind (legacy rows / pre-slice-1 fixtures) is treated as
    // geological, matching the backend column default — so this stays
    // backward-compatible with every existing project + test.
    const isGeological = (m: GeologicalModelResponse): boolean =>
      m.is_active && (m.kind === 'geological' || m.kind == null)
    let active = models.find(isGeological) ?? null
    const isGeologicalKind = (m: GeologicalModelResponse): boolean =>
      m.kind === 'geological' || m.kind == null
    const geologicalModels = models.filter(isGeologicalKind)
    if (geologicalModels.length === 0) {
      // No geological backbone (empty project, or somehow only
      // litho/geotech models) — bootstrap a Default geological one.
      const created = await api.geology.createModel(projectId, {
        name: 'Default',
        is_active: true,
      })
      active = created
      log.info('geology', `resolveActiveModel: created Default model for ${projectId}`)
    } else if (active === null) {
      // Geological models exist but none active — promote the first
      // GEOLOGICAL one (never a litho/geotech sibling).
      const promoted = await api.geology.activateModel(projectId, geologicalModels[0].id)
      active = promoted
    }
    if (active === null) {
      // Unreachable: the branches above assign on every path
      // (create when no geological model exists, promote when one
      // exists but is inactive, otherwise the find() already hit).
      // Explicit so the return type stays non-null for callers.
      throw new Error('resolveActiveModel: no geological model could be resolved')
    }
    return active
  }

  // Geological-model bootstrap + load.
  //
  // Every project carries exactly one active geological model in v1.
  // On project change we (1) fetch the model list, (2) pick the
  // active one, (3) auto-create a "Default" model if the project
  // has none, and (4) refresh the formations + contacts that the
  // editor surfaces (Ground model pane + cross-section overlay).
  //
  // The bootstrap-on-empty step is what makes the editor accessible
  // immediately after File → New — no separate "create model"
  // button to discover. Multi-model UX (named scenarios, model
  // comparison) lands later.
  //
  // Uses ensureModelPromiseRef to share the list→adopt→create work
  // with any concurrent ensureActiveGeologicalModel call so two
  // "Default" models cannot be created simultaneously.
  useEffect(() => {
    if (!project) {
      setActiveGeologicalModel(null)
      setFormations([])
      setContacts([])
      setSurfacesByFormationId(new Map())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const projectId = project.id
        // Step 1: model list. Bootstrap a default if empty.
        // Reuse or create the shared in-flight promise so a
        // concurrent ensureActiveGeologicalModel call doesn't race
        // us into a second createModel.
        if (!ensureModelPromiseRef.current) {
          ensureModelPromiseRef.current = resolveActiveModel(projectId).finally(() => {
            ensureModelPromiseRef.current = null
          })
        }
        const active = await ensureModelPromiseRef.current
        if (cancelled) return
        setActiveGeologicalModel(active)

        // Step 2: formations + contacts + surfaces in parallel.
        // Surfaces come from the per-mutation recompute cache; on a
        // freshly opened bundle they may already be populated (the
        // bundle round-trips them) so the section paints the slice on
        // first render — no recompute round-trip required.
        const [forms, conts, surfs] = await Promise.all([
          api.geology.listFormations(projectId),
          api.geology.listContacts(projectId, active.id),
          api.geology.listSurfaces(projectId, active.id),
        ])
        if (cancelled) return
        setFormations(forms)
        setContacts(conts)
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setSurfacesByFormationId(sm)
      } catch (err) {
        log.warn('geology', `model bootstrap failed for ${project.id}`, err)
        if (!cancelled) {
          setActiveGeologicalModel(null)
          setFormations([])
          setContacts([])
          setSurfacesByFormationId(new Map())
          // Surface a user-visible error so the stage is not silently dead.
          // The Fill-from-boreholes button's ensureActiveGeologicalModel
          // provides the self-heal path — the user can click it and the
          // model will be created/adopted on demand.
          toast(
            'error',
            'Could not load the geological model — check the connection and reopen the project.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project])

  const refetchFormations = useCallback(() => {
    if (!project) return
    void api.geology
      .listFormations(project.id)
      .then(setFormations)
      .catch(err => {
        log.warn('geology', `listFormations refetch failed`, err)
      })
  }, [project])

  // Refetch the per-formation TIN cache. Called after any contact
  // mutation (create / update / delete / batch / auto-populate /
  // dedupe) so the section's slice render tracks the new geometry.
  // Backend recomputes synchronously inside each mutation handler
  // (debt #11), so by the time we call this the cache is already
  // current. Cheap: one GET per mutation, payload is bounded by
  // (formations × triangles) which is tiny at v1 cardinality.
  const refetchSurfaces = useCallback(() => {
    if (!project || !activeGeologicalModel) return
    void api.geology
      .listSurfaces(project.id, activeGeologicalModel.id)
      .then(surfs => {
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setSurfacesByFormationId(sm)
      })
      .catch(err => {
        log.warn('geology', `listSurfaces refetch failed`, err)
      })
  }, [project, activeGeologicalModel])

  // Ensure an active geological model is present, creating "Default" when none
  // exists. Delegates to resolveActiveModel via the shared ensureModelPromiseRef
  // guard so it cannot race the bootstrap effect into a second createModel call.
  // This is the self-heal path for Fill-from-boreholes: the action is always
  // reachable even when the initial bootstrap raced or failed.
  //
  // Reads the latest active model via activeGeologicalModelRef (not the state
  // variable) so the dep array is [project] — stable to project identity.
  // This prevents setActiveGeologicalModel from re-identifying this callback
  // and cascading into discoverBoreholeFormations / applyBoreholeFormationSelection
  // identity churn on every rapid-fill step.
  //
  // Returns null only when project is absent or the API call genuinely fails.
  const ensureActiveGeologicalModel = useCallback(
    async (): Promise<GeologicalModelResponse | null> => {
      if (!project) return null
      // Fast path: already have one. Read from ref to avoid listing
      // activeGeologicalModel as a dep (see comment above).
      if (activeGeologicalModelRef.current) return activeGeologicalModelRef.current
      try {
        const projectId = project.id
        // Reuse a bootstrap-initiated promise if one is in flight —
        // the at-most-once guard for createModel("Default").
        if (!ensureModelPromiseRef.current) {
          ensureModelPromiseRef.current = resolveActiveModel(projectId).finally(() => {
            ensureModelPromiseRef.current = null
          })
        }
        const active = await ensureModelPromiseRef.current
        setActiveGeologicalModel(active)
        return active
      } catch (err) {
        log.error('geology', 'ensureActiveGeologicalModel failed', err)
        toast('error', 'Could not create the geological model — check the connection.')
        return null
      }
    },
    [project],
  )

  // Auto-refetch surfaces after any contact mutation. ``contacts``
  // identity changes exactly once per mutation handler (each one
  // calls setContacts), so this useEffect fires once per mutation
  // without per-handler bookkeeping. Post on-click build pivot: the
  // refetch returns is_stale=true for surfaces of formations whose
  // contacts changed (per-edit handlers flip the flag rather than
  // recompute), and is_stale=false after AutoPopulate / Dedupe
  // (those still trigger Delaunay synchronously). Either way the
  // GET reflects the current cache state. Skips on the bootstrap-
  // initial setContacts because the bootstrap already fetched
  // surfaces in parallel. Same trigger bumps the crossings refresh
  // signal so the InterpretationPane's validator banner re-runs
  // whenever picks change.
  const lastSurfaceRefetchContactsRef = useRef<readonly FormationContactResponse[] | null>(null)
  useEffect(() => {
    if (lastSurfaceRefetchContactsRef.current === null) {
      // First observation — bootstrap already fetched. Just record.
      lastSurfaceRefetchContactsRef.current = contacts
      return
    }
    if (lastSurfaceRefetchContactsRef.current === contacts) return
    lastSurfaceRefetchContactsRef.current = contacts
    refetchSurfaces()
    setCrossingsRefreshCounter(c => c + 1)
  }, [contacts, refetchSurfaces])

  // ---------------------------------------------------------------------------
  // Formation callbacks
  // ---------------------------------------------------------------------------

  const handleFormationCreated = useCallback(
    (id: string) => {
      addToManifest('formation', [id])
      addToSessionImports('formation', [id])
      refetchFormations()
    },
    [addToManifest, addToSessionImports, refetchFormations],
  )
  const handleFormationUpdated = useCallback(() => {
    // No manifest / dirty change on update (the formation is already
    // in the manifest); just resync the cached list so renames and
    // recolour land in the picker + section overlay.
    refetchFormations()
  }, [refetchFormations])
  const handleFormationDeleted = useCallback(
    (id: string) => {
      removeFromManifest('formation', new Set([id]))
      // Drop it from the session-import set too. Deleting a formation
      // that was created-but-not-yet-saved must clear its dirty
      // contribution — otherwise ``projectDirty`` stays true forever
      // over a row that no longer exists (the normal delete-then-save
      // path never reaches discardSessionImports).
      removeFromSessionImports('formation', [id])
      refetchFormations()
    },
    [removeFromManifest, removeFromSessionImports, refetchFormations],
  )

  const handleInlineCreateFormation = useCallback(
    async (
      payload: GeologicalFormationCreatePayload,
    ): Promise<{ id: string } | null> => {
      if (!project) return null
      try {
        const created = await api.geology.createFormation(project.id, payload)
        setFormations(prev => [...prev, created])
        handleFormationCreated(created.id)
        return { id: created.id }
      } catch (err) {
        log.error('geology', 'inline createFormation failed', err)
        return null
      }
    },
    [project, handleFormationCreated],
  )

  // ---------------------------------------------------------------------------
  // Contact callbacks
  //
  // NOTE: ``handleUpdateContactDepth`` is declared before
  // ``handleCreateContact`` so the latter can call the former directly
  // (no forward-ref needed — both are in the same module scope).
  // The ref pattern used in App.tsx was only necessary because of the
  // top-to-bottom declaration order in that 3,200-line function body.
  // ---------------------------------------------------------------------------

  // Re-pick an existing contact's depth — the commit handler for
  // the drag interaction on the section's ContactsLayer. Updates the
  // local contacts list optimistically on success so the polyline
  // settles at the dragged Y without a refetch round-trip.
  //
  // Declared first so ``handleCreateContact``'s 409-recovery path can
  // call it directly without a forward-ref.
  const handleUpdateContactDepth = useCallback(
    async (
      contactId: string,
      newDepthM: number,
      snapped: boolean,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `updateContactDepth entry id=${contactId} newDepth=${newDepthM.toFixed(3)}m snapped=${snapped}`,
      )
      try {
        // Snapshot the pre-update contact so undo can restore depth
        // + source + confidence in one PATCH (debt #22 / #23 rule:
        // source/confidence ride along with depth changes).
        const previous = contacts.find(c => c.id === contactId)
        if (!previous) return
        const updated = await api.geology.updateContact(
          project.id,
          activeGeologicalModel.id,
          contactId,
          {
            depth_top_m: newDepthM,
            source: snapped ? 'borehole_observation' : 'manual_pick',
            confidence: snapped ? 'high' : 'medium',
          },
        )
        setContacts(prev => prev.map(c => (c.id === contactId ? updated : c)))
        log.success(
          'geology',
          `updateContactDepth ok id=${contactId} depth=${updated.depth_top_m.toFixed(3)}m source=${updated.source}`,
        )
        // Undo: PATCH the contact back to its pre-drag state.
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforePayload = {
          depth_top_m: previous.depth_top_m,
          source: previous.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: previous.confidence as 'high' | 'medium' | 'low',
        }
        const afterPayload = {
          depth_top_m: updated.depth_top_m,
          source: updated.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: updated.confidence as 'high' | 'medium' | 'low',
        }
        pushUndo({
          description: 'Move contact',
          revert: async () => {
            const reverted = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              beforePayload,
            )
            setContacts(prev =>
              prev.map(c => (c.id === contactId ? reverted : c)),
            )
          },
          reapply: async () => {
            const reapplied = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              afterPayload,
            )
            setContacts(prev =>
              prev.map(c => (c.id === contactId ? reapplied : c)),
            )
          },
        })
      } catch (err) {
        log.error('geology', 'updateContact failed', err)
        toast('error', 'Could not update the contact depth.')
      }
    },
    [project, activeGeologicalModel, contacts, pushUndo],
  )

  // Create a formation contact at a specific depth on a specific
  // investigation. Wired from SectionPanel — the user clicks on a
  // borehole's lithology strip or commits a CPT's slider depth,
  // picks a formation in the modal, and this fires with the
  // (anchorKind, anchorId, depth, formation) tuple. The new
  // contact lands in DB AND in App's contacts state so the
  // ContactsLayer overlay updates without a refetch.
  const handleCreateContact = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `createContact entry kind=${anchorKind} anchor=${anchorId} depth=${depth_m.toFixed(3)}m formation=${formationId} snapped=${snapped}`,
      )
      try {
        // Snap-placed contacts: depth came from a stratigraphy
        // observation boundary on the borehole, so source =
        // 'borehole_observation' and confidence = 'high'.
        // Free-placed: engineer's manual call, source = 'manual_pick',
        // confidence stays at the schema default 'medium'.
        // Debt #22 / #23.
        const payload = {
          formation_id: formationId,
          depth_top_m: depth_m,
          borehole_id: anchorKind === 'borehole' ? anchorId : null,
          cpt_id: anchorKind === 'cpt' ? anchorId : null,
          source: (snapped ? 'borehole_observation' : 'manual_pick') as
            | 'borehole_observation'
            | 'manual_pick',
          confidence: (snapped ? 'high' : 'medium') as 'high' | 'medium',
        }
        const created = await api.geology.createContact(
          project.id,
          activeGeologicalModel.id,
          payload,
        )
        setContacts(prev => [...prev, created])
        addToSessionImports('contact', [created.id])
        log.success(
          'geology',
          `createContact ok id=${created.id} depth=${created.depth_top_m.toFixed(3)}m source=${created.source}`,
        )
        // Undo command — captures the created id in a closure
        // variable so the reapply path can overwrite it on
        // redo (the re-POST gets a new server-assigned id).
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        let currentId = created.id
        pushUndo({
          description: 'Create contact',
          revert: async () => {
            await api.geology.deleteContact(projectId, modelId, currentId)
            setContacts(prev => prev.filter(c => c.id !== currentId))
          },
          reapply: async () => {
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              payload,
            )
            currentId = recreated.id
            setContacts(prev => [...prev, recreated])
            addToSessionImports('contact', [recreated.id])
          },
        })
      } catch (err) {
        // 409 = a contact for this (borehole, formation) already
        // exists. Backend returns the existing id in detail.existing_contact_id;
        // we treat the click as "move that one to the new depth"
        // rather than refusing — the user clearly wants Boom Klei
        // at the depth they just clicked, and the geological rule
        // is one top per formation per borehole. PATCH the existing
        // contact's depth to the new location.
        //
        // Both functions are in the same module, so we can call
        // handleUpdateContactDepth directly — no forward-ref needed.
        const existingId =
          err instanceof DuplicateContactError ? err.existingContactId : null
        if (existingId) {
          log.info(
            'geology',
            `createContact 409 — moving existing ${existingId} to ${depth_m.toFixed(3)}m instead`,
          )
          try {
            await handleUpdateContactDepth(existingId, depth_m, snapped)
          } catch (moveErr) {
            log.error('geology', 'duplicate-contact move failed', moveErr)
            toast('error', 'Could not move the existing contact to the new depth.')
          }
          return
        }
        log.error('geology', 'createContact failed', err)
        toast('error', 'Could not place the formation contact.')
      }
    },
    [project, activeGeologicalModel, addToSessionImports, pushUndo, handleUpdateContactDepth],
  )

  // Cross-column COPY commit — fired by plain-drag onto a different
  // column. Each entry becomes a new contact at the target anchor;
  // originals stay where they were. The "stamp my interpretation
  // onto a nearby test" workflow that dogfooding identified as the
  // dominant cross-column use case.
  //
  // Implementation: N parallel POSTs via the existing single-create
  // endpoint. Acceptable for v1 (typical stack ≤6 contacts; partial-
  // failure risk small in absolute terms). Promote to a dedicated
  // ``POST /contacts/batch-create`` endpoint when failure rates
  // start to bite.
  const handleBatchCreateContacts = useCallback(
    async (
      creates: readonly ContactCopyPayload[],
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (creates.length === 0) return
      log.debug(
        'geology',
        `batchCreateContacts entry count=${creates.length}`,
      )
      const projectId = project.id
      const modelId = activeGeologicalModel.id

      // Per-entry result: either a fresh POST (newly-created) OR a
      // PATCH of an already-existing (target_borehole, formation)
      // contact whose pre-PATCH state we snapshot for undo. The COPY
      // workflow's intent on collision is "stamp the source's depth
      // onto the target" — so a 409 from the new uniqueness rule
      // becomes a "move existing to here" instead of a hard failure.
      type PatchedItem = {
        kind: 'patched'
        before: FormationContactResponse
        after: FormationContactResponse
      }
      const created: FormationContactResponse[] = []
      const patched: PatchedItem[] = []
      let failed = 0
      // Local index of "everything currently in the model on the
      // server side" — seeded from React state, then live-updated
      // as this batch progresses. Authoritative for in-batch 409
      // PATCH lookups: a row created earlier in this loop hasn't
      // landed in React state yet (we flush ``setContacts`` at the
      // end), so checking ``contacts`` alone would miss it.
      const idIndex = new Map<string, FormationContactResponse>(
        contacts.map(c => [c.id, c]),
      )
      // Sequential, NOT parallel. Two source CPTs landing on one
      // target produces N picks for the same (formation, anchor)
      // triple; the backend's uniqueness check is application-layer
      // (no DB unique index — see create_formation_contact.py), so
      // parallel POSTs race and each transaction sees "no existing"
      // → all of them insert. Serialising lets the second POST for
      // a given triple hit a real 409 and fall into the PATCH path,
      // which IS the "stamp the source's depth onto the target"
      // semantic. Throughput trade-off is negligible at copy-shape
      // batch sizes (~10 rows worst case).
      for (let i = 0; i < creates.length; i += 1) {
        const payload = creates[i]
        try {
          const row = await api.geology.createContact(projectId, modelId, payload)
          created.push(row)
          idIndex.set(row.id, row)
        } catch (err) {
          if (err instanceof DuplicateContactError) {
            // 409: target already has a contact for this formation
            // (either pre-existing OR just inserted earlier in this
            // same batch). PATCH it to the new depth — "stamp on
            // target" semantic, latest-copy-wins.
            const before = idIndex.get(err.existingContactId)
            if (!before) {
              // Defensive: existing contact id missing from both the
              // server-state cache and the in-batch index. Refetch
              // would slow the path; skip + count.
              failed += 1
              log.warn(
                'geology',
                `batchCreateContacts 409 but existing id ${err.existingContactId} not in local cache, skipped`,
              )
              continue
            }
            try {
              const after = await api.geology.updateContact(
                projectId,
                modelId,
                err.existingContactId,
                {
                  depth_top_m: payload.depth_top_m,
                  source: payload.source,
                  confidence: payload.confidence,
                },
              )
              patched.push({ kind: 'patched', before, after })
              idIndex.set(after.id, after)
            } catch (patchErr) {
              failed += 1
              log.error(
                'geology',
                `batchCreateContacts PATCH-on-409 failed for existing ${err.existingContactId}`,
                patchErr,
              )
            }
            continue
          }
          // Non-409 failure (network, validation, etc.) — count +
          // log, keep going so the rest of the batch still commits.
          failed += 1
          log.error('geology', 'batchCreateContacts entry failed', err)
        }
      }

      // Apply local-state changes from BOTH lanes at once.
      if (created.length > 0) {
        setContacts(prev => [...prev, ...created])
        addToSessionImports('contact', created.map(c => c.id))
      }
      if (patched.length > 0) {
        const byId = new Map(patched.map(p => [p.after.id, p.after]))
        setContacts(prev => prev.map(c => byId.get(c.id) ?? c))
      }
      const total = created.length + patched.length
      log.success(
        'geology',
        `batchCreateContacts ok created=${created.length} ` +
          `moved-existing=${patched.length} failed=${failed}`,
      )
      if (total === 0) {
        toast(
          'error',
          'Could not copy any contacts to the target — see console for details.',
        )
        return
      }
      if (failed > 0) {
        toast(
          'error',
          `Copied ${total} contact(s); ${failed} failed — some may be missing.`,
        )
      }

      // Undo: revert BOTH lanes — DELETE everything we created, PATCH
      // everything we moved back to its pre-move state. Redo replays
      // the same shape (re-POSTs the creates with fresh ids,
      // re-PATCHes the moves to the post state).
      let currentCreatedIds = created.map(c => c.id)
      const createdPayloads = creates.slice()
      const patchedSnapshots = patched.slice()
      pushUndo({
        description:
          patched.length > 0
            ? `Copy ${created.length}, move ${patched.length} contact(s)`
            : `Copy ${created.length} contact(s)`,
        revert: async () => {
          await Promise.all(
            currentCreatedIds.map(id =>
              api.geology.deleteContact(projectId, modelId, id),
            ),
          )
          const deleted = new Set(currentCreatedIds)
          setContacts(prev => prev.filter(c => !deleted.has(c.id)))
          // PATCH each "moved" contact back to its pre-move state.
          // Run in parallel; per-(model, anchor, formation)
          // uniqueness can't be violated here because we're shrinking
          // toward the previous state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.before.depth_top_m,
                  source: p.before.source,
                  confidence: p.before.confidence,
                })
                .then(reverted => {
                  setContacts(prev =>
                    prev.map(c => (c.id === reverted.id ? reverted : c)),
                  )
                }),
            ),
          )
        },
        reapply: async () => {
          // POST fresh creates — capture new server ids for the
          // next revert.
          const recreated: FormationContactResponse[] = []
          // We may NOT 409 this time around (the previous revert
          // deleted them), so a plain POST is safe.
          for (let j = 0; j < createdPayloads.length; j += 1) {
            const r = await api.geology.createContact(
              projectId,
              modelId,
              createdPayloads[j],
            )
            recreated.push(r)
          }
          currentCreatedIds = recreated.map(c => c.id)
          if (recreated.length > 0) {
            setContacts(prev => [...prev, ...recreated])
            addToSessionImports('contact', recreated.map(c => c.id))
          }
          // PATCH each previously-moved contact back to the
          // post-move state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.after.depth_top_m,
                  source: p.after.source,
                  confidence: p.after.confidence,
                })
                .then(reapplied => {
                  setContacts(prev =>
                    prev.map(c => (c.id === reapplied.id ? reapplied : c)),
                  )
                }),
            ),
          )
        },
      })
    },
    [
      project,
      activeGeologicalModel,
      addToSessionImports,
      pushUndo,
      contacts,
    ],
  )

  // All-or-nothing batch UPDATE commit — fired by the section
  // editor's same-column multi-drag (depth shift) and the explicit
  // Alt+drag cross-column MOVE (re-anchor). Sends one PUT and
  // patches local state with the returned rows so the section
  // overlay updates without a refetch.
  // The single-contact same-anchor depth-only drag still goes
  // through ``handleUpdateContactDepth`` to keep the existing PATCH
  // tests pinned and to avoid a server round-trip per pixel.
  const handleBatchUpdateContacts = useCallback(
    async (
      updates: readonly FormationContactBatchUpdateEntry[],
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (updates.length === 0) return
      log.debug(
        'geology',
        `batchUpdateContacts entry count=${updates.length}`,
      )
      try {
        // Snapshot the pre-update state for every contact in the
        // batch so undo can PUT them back in one call.
        const updateIds = updates.map(u => u.contact_id)
        const idSet = new Set(updateIds)
        const beforeById = new Map(
          contacts.filter(c => idSet.has(c.id)).map(c => [c.id, c]),
        )
        const res = await api.geology.updateContactsBatch(
          project.id,
          activeGeologicalModel.id,
          updates,
        )
        // Index by id so the local state patch is O(N+M).
        const byId = new Map(res.contacts.map(c => [c.id, c]))
        setContacts(prev => prev.map(c => byId.get(c.id) ?? c))
        log.success(
          'geology',
          `batchUpdateContacts ok count=${res.contacts.length}`,
        )
        // Undo: PUT the snapshot back. Redo: PUT the original
        // update payload again.
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforeUpdates: FormationContactBatchUpdateEntry[] = updateIds
          .map(id => beforeById.get(id))
          .filter((c): c is FormationContactResponse => Boolean(c))
          .map(c => ({
            contact_id: c.id,
            depth_top_m: c.depth_top_m,
            borehole_id: c.borehole_id,
            cpt_id: c.cpt_id,
            source: c.source as
              | 'borehole_observation'
              | 'manual_pick'
              | 'interpolated',
            confidence: c.confidence as 'high' | 'medium' | 'low',
          }))
        const afterUpdates = updates.slice()
        pushUndo({
          description: `Update ${updateIds.length} contact(s)`,
          revert: async () => {
            const back = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              beforeUpdates,
            )
            const map = new Map(back.contacts.map(c => [c.id, c]))
            setContacts(prev => prev.map(c => map.get(c.id) ?? c))
          },
          reapply: async () => {
            const fwd = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              afterUpdates,
            )
            const map = new Map(fwd.contacts.map(c => [c.id, c]))
            setContacts(prev => prev.map(c => map.get(c.id) ?? c))
          },
        })
      } catch (err) {
        log.error('geology', 'batchUpdateContacts failed', err)
        toast('error', 'Could not update the selected contacts.')
      }
    },
    [project, activeGeologicalModel, contacts, pushUndo],
  )

  // Right-click → confirm → delete an existing contact. ContactsLayer
  // pops the native confirm; we only land here on a user-confirmed
  // destructive action, so no extra gate. Optimistically prune the
  // local contacts list + the session-import id set so the overlay
  // updates without a refetch and the discard-on-close flow doesn't
  // try to re-delete an already-deleted row.
  const handleDeleteContact = useCallback(
    async (contactId: string): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug('geology', `deleteContact entry id=${contactId}`)
      try {
        // Snapshot the contact before deletion so undo can re-POST
        // an equivalent row (server assigns a new id on the re-create
        // — captured in the closure for redo).
        const snapshot = contacts.find(c => c.id === contactId)
        if (!snapshot) return
        await api.geology.deleteContact(
          project.id,
          activeGeologicalModel.id,
          contactId,
        )
        setContacts(prev => prev.filter(c => c.id !== contactId))
        // No setSessionImportContactIds here — the session-imports set
        // is owned by useProjectLifecycle. The deleteContact callback
        // reaches the session set via the addToSessionImports injected
        // dep only for additions; for removals the
        // discardSessionImports path handles the full flush.
        log.success('geology', `deleteContact ok id=${contactId}`)
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const recreatePayload = {
          formation_id: snapshot.formation_id,
          depth_top_m: snapshot.depth_top_m,
          borehole_id: snapshot.borehole_id,
          cpt_id: snapshot.cpt_id,
          source: snapshot.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: snapshot.confidence as 'high' | 'medium' | 'low',
        }
        // currentId tracks the most-recently-created id so the
        // next revert (delete) targets the latest row. Starts at
        // null because the contact was JUST deleted; the first
        // revert call re-creates it.
        let currentId: string | null = null
        pushUndo({
          description: 'Delete contact',
          revert: async () => {
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              recreatePayload,
            )
            currentId = recreated.id
            setContacts(prev => [...prev, recreated])
            addToSessionImports('contact', [recreated.id])
          },
          reapply: async () => {
            if (!currentId) return
            await api.geology.deleteContact(projectId, modelId, currentId)
            const deletedId = currentId
            setContacts(prev => prev.filter(c => c.id !== deletedId))
            currentId = null
          },
        })
      } catch (err) {
        log.error('geology', `deleteContact failed id=${contactId}`, err)
        toast('error', 'Could not delete the contact.')
      }
    },
    [
      project,
      activeGeologicalModel,
      addToSessionImports,
      contacts,
      pushUndo,
    ],
  )

  // Auto-populate the active model with contacts derived from
  // each section borehole's stratigraphy observation (formal
  // preferred, informal fallback). Backend creates contacts +
  // any missing formations in one transaction; we refresh local
  // formations + contacts state from the API afterwards (cheaper
  // and more correct than reconstructing from the returned id
  // lists).
  const handleAutoPopulateFromStratigraphy = useCallback(
    async (boreholeIds: readonly string[]): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (boreholeIds.length === 0) return
      log.debug(
        'geology',
        `autoPopulateFromStratigraphy entry boreholes=${boreholeIds.length}`,
      )
      try {
        const outcome = await api.geology.autoPopulateFromStratigraphy(
          project.id,
          activeGeologicalModel.id,
          boreholeIds,
        )
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
            `${outcome.skipped_no_stratigraphy} no-strat`,
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
            description: `Seed from stratigraphy (+${created} contacts)`,
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
        if (created > 0) {
          toast(
            'success',
            `Seeded ${created} contacts` +
              (outcome.created_formation_ids.length
                ? ` and ${outcome.created_formation_ids.length} new formations`
                : '') +
              '.',
          )
        } else if (outcome.skipped_no_stratigraphy === boreholeIds.length) {
          toast(
            'error',
            'No boreholes on this section carry stratigraphy data.',
          )
        } else if (skipped > 0) {
          toast('success', 'Already in sync — nothing to add.')
        }
      } catch (err) {
        log.error(
          'geology',
          'autoPopulateFromStratigraphy failed',
          err,
        )
        toast('error', 'Could not seed contacts from stratigraphy.')
      }
    },
    [
      project,
      activeGeologicalModel,
      addToSessionImports,
      addToManifest,
      pushUndo,
    ],
  )

  // One-shot cleanup for legacy duplicate (anchor, formation)
  // contacts left over from auto-populate runs that predated the
  // per-anchor uniqueness rule. Backend keeps one survivor per
  // group + deletes the rest; we refresh local contacts state +
  // toast the count. NOT in the undo stack — this is an explicit
  // "clean up old data" action with a confirmation dialog, not
  // an interactive edit.
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
        toast('success', 'Already clean — no duplicates found.')
      } else {
        toast(
          'success',
          `Removed ${result.duplicates_removed} duplicate ` +
            `contact${result.duplicates_removed === 1 ? '' : 's'} ` +
            `across ${result.inspected_groups} (anchor, formation) ` +
            `pair${result.inspected_groups === 1 ? '' : 's'}.`,
        )
      }
      return result.duplicates_removed
    } catch (err) {
      log.error('geology', 'dedupeContacts failed', err)
      toast('error', 'Could not run the cleanup — see console.')
      return 0
    }
  }, [project, activeGeologicalModel])

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
        toast('success', 'No formations with picks yet — nothing to rebuild.')
      } else if (result.formations_rebuilt === 0 && reordered === 0) {
        toast(
          'success',
          `Cache already in sync (${result.formations_considered} ` +
            `formation${result.formations_considered === 1 ? '' : 's'} checked).`,
        )
      } else {
        const rebuiltPart =
          result.formations_rebuilt > 0
            ? `Rebuilt ${result.formations_rebuilt} of ${result.formations_considered} ` +
              `surface${result.formations_considered === 1 ? '' : 's'}`
            : `${result.formations_considered} surface${
                result.formations_considered === 1 ? '' : 's'
              } already current`
        const reorderPart =
          reordered > 0
            ? `; reordered ${reordered} formation${reordered === 1 ? '' : 's'} by depth`
            : ''
        toast('success', `${rebuiltPart}${reorderPart}.`)
      }
    } catch (err) {
      log.error('geology', 'rebuildSurfaces failed', err)
      toast('error', 'Could not rebuild surfaces — see console.')
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
      toast('success', 'Plaxis 3D script exported.')
    } catch (err) {
      log.error('geology', 'exportPlaxis3d failed', err)
      toast(
        'error',
        err instanceof Error ? err.message : 'Could not export the Plaxis script.',
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
      const previousExcluded = activeGeologicalModel.excluded_borehole_ids
      const current = new Set(previousExcluded)
      // ``included = true`` means the user wants this borehole IN
      // the model → remove from exclusion. ``false`` adds it.
      if (included) current.delete(boreholeId)
      else current.add(boreholeId)
      const nextExcluded = Array.from(current)
      // Optimistic update first, then PATCH. On failure we log
      // and let the next project-change effect reconcile.
      setActiveGeologicalModel(prev =>
        prev === null ? null : { ...prev, excluded_borehole_ids: nextExcluded },
      )
      try {
        await api.geology.updateModel(project.id, activeGeologicalModel.id, {
          excluded_borehole_ids: nextExcluded,
        })
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforeList = previousExcluded.slice()
        const afterList = nextExcluded.slice()
        pushUndo({
          description: included
            ? 'Include borehole in model'
            : 'Exclude borehole from model',
          revert: async () => {
            await api.geology.updateModel(projectId, modelId, {
              excluded_borehole_ids: beforeList,
            })
            setActiveGeologicalModel(prev =>
              prev === null
                ? null
                : { ...prev, excluded_borehole_ids: beforeList },
            )
          },
          reapply: async () => {
            await api.geology.updateModel(projectId, modelId, {
              excluded_borehole_ids: afterList,
            })
            setActiveGeologicalModel(prev =>
              prev === null
                ? null
                : { ...prev, excluded_borehole_ids: afterList },
            )
          },
        })
      } catch (err) {
        log.error('geology', `updateModel exclude-borehole failed for ${boreholeId}`, err)
        // Roll back optimistic state on failure so the toggle
        // visually reflects server truth.
        setActiveGeologicalModel(prev =>
          prev === null
            ? null
            : { ...prev, excluded_borehole_ids: previousExcluded },
        )
      }
    },
    [project, activeGeologicalModel, pushUndo],
  )

  const staleSurfaceCount = useMemo(
    () =>
      Array.from(surfacesByFormationId.values()).filter(s => s.is_stale === true).length,
    [surfacesByFormationId],
  )

  // Removes a set of contact ids from local state only (no DB call).
  // The caller (discardSessionImports) owns the DB deletes; this
  // callback just keeps the in-memory contacts list consistent.
  const discardContacts = useCallback((ids: ReadonlySet<string>) => {
    setContacts(prev => prev.filter(c => !ids.has(c.id)))
  }, [])

  // Read-only discovery scan — queries the backend for candidate
  // formations from the given boreholes' stratigraphy
  // (FORMAL preferred, INFORMAL fallback). Returns the list for
  // FormationSelectionDialog to render. Nothing is created.
  //
  // Calls ensureActiveGeologicalModel so Fill-from-boreholes works even
  // when the bootstrap raced or the model was just deleted — the model is
  // created on demand and the scan proceeds without requiring the user to
  // manually recover.
  //
  // On API error: toasts the failure and throws — the caller (GeologyToolbar)
  // sees the throw and stays in the idle state. Previously this returned []
  // on error, masquerading as "no stratigraphy data" and giving the user no
  // feedback on what went wrong.
  const discoverBoreholeFormations = useCallback(
    async (boreholeIds: readonly string[]): Promise<FormationCandidate[]> => {
      if (!project) return []
      if (boreholeIds.length === 0) return []
      log.debug(
        'geology',
        `discoverBoreholeFormations entry boreholes=${boreholeIds.length}`,
      )
      const model = await ensureActiveGeologicalModel()
      if (!model) return []
      try {
        const result = await api.geology.discoverFromStratigraphy(
          project.id,
          model.id,
          boreholeIds,
        )
        log.success(
          'geology',
          `discoverBoreholeFormations ok candidates=${result.candidates.length}`,
        )
        return result.candidates.map(c => ({
          name: c.name,
          // key falls back to name for old server responses that pre-date the
          // stable-key field (empty-string default on the schema); name is the
          // correct fallback in that case.
          key: c.key || c.name,
          boreholeCount: c.borehole_count,
        }))
      } catch (err) {
        log.error('geology', 'discoverBoreholeFormations failed', err)
        toast('error', 'Could not scan borehole stratigraphy — check the connection.')
        throw err
      }
    },
    [project, ensureActiveGeologicalModel, toast],
  )

  // Apply the user's curated formation selection (Fill-from-boreholes confirm).
  //
  // Corrected pipeline (2026-05-16 — third attempt, root cause confirmed):
  //
  //   Step 1: POST auto-populate with selected stable keys.
  //           The server creates ONLY the formations whose stable key is in the
  //           set — no bulk create-then-delete dance, no key identity mismatch.
  //
  //   Step 2: Refetch the FRESH formation list from the server.
  //           Never filter the stale pre-Fill ``formations`` closure — that was
  //           the stale-closure delete bug (created formations got deleted
  //           because the pre-Fill closure didn't know about them yet).
  //
  //   Step 3: Delete every formation whose stable key is NOT in selectedKeys,
  //           computed against the FRESH list (Fork E: non-kept formations,
  //           incl. manually-added ones, are removed). Stable key =
  //           regional_ref when present, else name — same rule as server.
  //           Sequential deletes (cascade-safe).
  //
  //   Step 4: If auto-populate returned +0 formations AND skipped_existing > 0,
  //           surface a clear toast ("already populated — dedupe or delete to
  //           reset") so the user isn't silently confused by a no-op.
  //
  //   Step 5: Final refresh of formations + contacts + surfaces state.
  //
  // NOT on the undo stack — irreversible at unknown scale; confirm dialog is
  // the safeguard. Mirrors handleDedupeContacts' exclusion for the same reason.
  const applyBoreholeFormationSelection = useCallback(
    async (
      selectedKeys: ReadonlySet<string>,
      boreholeIds: readonly string[],
    ): Promise<void> => {
      if (!project) return
      const activeModel = await ensureActiveGeologicalModel()
      if (!activeModel) return
      const projectId = project.id
      const modelId = activeModel.id
      log.info(
        'geology',
        `applyBoreholeFormationSelection entry ` +
          `selected=${selectedKeys.size} boreholes=${boreholeIds.length}`,
      )
      try {
        // Step 1: auto-populate with selected stable keys (server-side filter).
        // The server creates only formations whose key is in selectedKeys, so
        // there is no unselected-formation creation to clean up afterwards.
        const outcome = await api.geology.autoPopulateFromStratigraphy(
          projectId,
          modelId,
          boreholeIds,
          Array.from(selectedKeys),
        )
        log.debug(
          'geology',
          `applyBoreholeFormationSelection auto-populate: ` +
            `+${outcome.created_formation_ids.length} formations, ` +
            `+${outcome.created_contact_ids.length} contacts, ` +
            `skipped_existing=${outcome.skipped_existing}`,
        )

        // Step 2: fetch the FRESH formation list — never filter the pre-Fill
        // closure (stale-closure delete was the prior bug).
        const freshForms = await api.geology.listFormations(projectId)

        // Step 3: delete every formation whose stable key (regional_ref ?? name)
        // is NOT in selectedKeys — includes manually-added formations the user
        // did not select. Sequential to avoid cascade race conditions.
        const selectedKeyLower = new Set(
          Array.from(selectedKeys).map(k => k.toLowerCase()),
        )
        const toDelete = freshForms.filter(f => {
          const stableKey = (f.regional_ref ?? f.name).toLowerCase()
          return !selectedKeyLower.has(stableKey)
        })
        log.info(
          'geology',
          `applyBoreholeFormationSelection deleting ${toDelete.length} formation(s)`,
        )
        for (const f of toDelete) {
          await api.geology.deleteFormation(projectId, f.id)
          log.debug('geology', `deleted formation id=${f.id} name="${f.name}"`)
        }

        // Step 4: surface feedback when auto-populate created nothing despite
        // the user selecting formations — this means orphaned contacts from a
        // prior run were suppressing creation (should now be fixed by the server-
        // side orphan purge, but keep the toast for observability).
        if (
          outcome.created_formation_ids.length === 0 &&
          outcome.skipped_existing > 0
        ) {
          toast(
            'error',
            `Nothing created — ${outcome.skipped_existing} layer(s) already ` +
              `populated. Use Dedupe or Delete model to reset, then retry.`,
          )
        }

        // Step 5: final refresh — fetch post-delete state.
        const [forms, conts] = await Promise.all([
          api.geology.listFormations(projectId),
          api.geology.listContacts(projectId, modelId),
        ])
        setFormations(forms)
        setContacts(conts)

        // Manifest + session-import housekeeping.
        const deletedIds = toDelete.map(f => f.id)
        removeFromManifest('formation', deletedIds)
        removeFromSessionImports('formation', deletedIds)
        // Register ALL surviving formations into the manifest, not only the
        // newly-created ones. This covers the orphan/reopen path: when a
        // prior Delete model left orphan formations behind, re-Fill matches
        // them (skipped_existing > 0, created_formation_ids.length === 0) and
        // those found formations need to enter the manifest so the inspector's
        // manifest-filtered visibleFormations shows them. Without this, the
        // inspector reports "0 formations" even though contacts are visible on
        // the section (the section reads contacts directly, not the manifest).
        const allFormationIds = forms.map(f => f.id)
        addToManifest('formation', allFormationIds)
        // Only newly-created formations are "unsaved" (session-import amber).
        // Matched/found formations were already committed in a prior session.
        if (outcome.created_formation_ids.length > 0) {
          addToSessionImports('formation', outcome.created_formation_ids)
        }
        setFormationsRefreshCounter(c => c + 1)
        log.success(
          'geology',
          `applyBoreholeFormationSelection done ` +
            `formations=${forms.length} deleted=${toDelete.length} ` +
            `created=${outcome.created_formation_ids.length}`,
        )
      } catch (err) {
        log.error('geology', 'applyBoreholeFormationSelection failed', err)
        throw err
      }
    },
    [
      project,
      ensureActiveGeologicalModel,
      toast,
      addToManifest,
      removeFromManifest,
      addToSessionImports,
      removeFromSessionImports,
    ],
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
  ])

  // R4 (debt #12): the visible-list filter now lives HERE, not as an
  // App.tsx post-spread. ``manifestFormationIds`` undefined (no project
  // open) ⇒ pass everything through, same semantics App.tsx had.
  // Pure useMemo over [formations, manifestFormationIds] — no effect
  // depends on it, so there is no identity-update loop.
  const visibleFormations = useMemo(
    () =>
      manifestFormationIds !== undefined
        ? formations.filter(f => manifestFormationIds.has(f.id))
        : formations,
    [formations, manifestFormationIds],
  )

  return {
    activeGeologicalModel,
    formations,
    visibleFormations,
    formationsRefreshCounter,
    contacts,
    surfacesByFormationId,
    crossingsRefreshCounter,
    staleSurfaceCount,
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    handleInlineCreateFormation,
    refetchFormations,
    handleCreateContact,
    handleUpdateContactDepth,
    handleBatchCreateContacts,
    handleBatchUpdateContacts,
    handleDeleteContact,
    handleAutoPopulateFromStratigraphy,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    discardContacts,
    discoverBoreholeFormations,
    applyBoreholeFormationSelection,
    handleDeleteModel,
    ensureActiveGeologicalModel,
  }
}
