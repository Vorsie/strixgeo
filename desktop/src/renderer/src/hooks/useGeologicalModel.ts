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
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerSuggestion,
  PinchOutExtrapolationResponse,
  ProjectResponse,
} from '../api/client'
import type { UndoCommand } from './useUndoStack'
import type { StratigraphyLumping } from '../utils/projectFile'
import { addAllToSet } from '../utils/sets'
import { log } from '../utils/log'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
  LITHOLOGY_LABELS,
} from '../utils/lithoConstants'

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

/**
 * Frontend-normalised representation of a lumping collision returned by
 * the discover or auto-populate endpoint.
 *
 * A collision occurs when ≥2 primary layers in a single borehole resolve to
 * the same effective formation key after the ``manual_map`` is applied.  The
 * server keeps the shallowest boundary and drops the rest.
 */
export interface LumpingCollision {
  /** UUID string of the borehole where the collision occurred. */
  boreholeId: string
  /** Normalised effective key that multiple raw names mapped to. */
  targetFormationKey: string
  /** Display name of the target formation after lumping. */
  targetFormationName: string
  /** All raw description strings (kept + dropped) that resolved to the key. */
  collidingRawNames: string[]
  /** Top depth (m) of the surviving (shallowest) boundary. */
  keptTopM: number
  /** Number of deeper duplicate boundaries that were dropped. */
  droppedCount: number
}

export interface UseGeologicalModelResult {
  activeGeologicalModel: GeologicalModelResponse | null
  // Three-level hierarchy (#55, model-kind picker). The geological
  // model is the v1 single backbone (above); these expose the
  // lithostratigraphic sibling lifecycle. ``models`` is the full
  // project list (all kinds) for the picker; ``activeLithoModel`` is
  // the active kind='lithostratigraphic' model the suggest-litho /
  // ghost-overlay flow targets (null until the user creates one).
  models: GeologicalModelResponse[]
  activeLithoModel: GeologicalModelResponse | null
  /** Create a lithostratigraphic model under the active geological
   * backbone (backend enforces the parent invariant). Returns the
   * created model, or null on failure (toasts the error). */
  handleCreateLithoModel: (name: string) => Promise<GeologicalModelResponse | null>
  /** Activate a model (backend clears same-kind siblings). Refreshes
   * the list + the active-litho pointer. */
  handleActivateLithoModel: (modelId: string) => Promise<void>
  /** Delete a lithostratigraphic model (irreversible — caller must
   * confirm first). Refreshes the list; the active-litho pointer +
   * its parallel formation/contact state clear via refreshModels when
   * the deleted model was active. */
  handleDeleteLithoModel: (modelId: string) => Promise<void>
  // Litho contact/surface/formation parallel sets (slice 2, #55).
  // Loaded from the active litho model; independent of the geological
  // contact set so mutations in one set never invalidate the other.
  lithoContacts: FormationContactResponse[]
  lithoFormations: GeologicalFormationResponse[]
  lithoSurfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Number of lithostratigraphic formation surfaces whose ``is_stale``
   * flag is true.  Mirrors ``staleSurfaceCount`` for the geo model.
   * Zero when no litho model is active or no surfaces exist yet.
   */
  lithoStaleSurfaceCount: number
  /**
   * Rebuild TIN surfaces for the active lithostratigraphic model.
   *
   * Calls ``POST .../models/{mid}/surfaces/rebuild`` with the litho
   * model id (the same model-id-agnostic endpoint used by
   * ``handleRebuildSurfaces`` for the geological model).  After the
   * call succeeds it refetches ``lithoSurfacesByFormationId`` so the
   * LithologyCanvas and stale-count badge update without a page reload.
   * No-ops when no litho model is active.
   */
  handleRebuildLithoSurfaces: () => Promise<void>
  /** Create a formation contact on the active LITHO model (mirrors
   * handleCreateContact exactly, closes over activeLithoModel). */
  handleCreateLithoContact: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
    // Parity with handleCreateContact — axisCreateContact unifies the
    // two, so the Sections-stage section-aware wrapper calls both with
    // the section id. Seeds the section's explicit-content set.
    sectionId?: string | null,
  ) => Promise<void>
  /** Inline-create a formation inside the active LITHO model (mirrors
   * handleInlineCreateFormation, closes over activeLithoModel). */
  handleInlineLithoCreateFormation: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
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
    // Sections stage passes the active section id so the backend seeds
    // seeded_formation_contact_ids (P2 explicit-content). Omitted from
    // the Geology stage (no section context). See sectionAwareCreateContact.
    sectionId?: string | null,
  ) => Promise<void>
  handleUpdateContactDepth: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  handleBatchCreateContacts: (
    creates: readonly ContactCopyPayload[],
    // Sections stage passes the active section id so every copied
    // contact is seeded into seeded_formation_contact_ids server-side
    // (P2 explicit-content). Omitted from the Geology stage.
    sectionId?: string | null,
  ) => Promise<void>
  handleBatchUpdateContacts: (updates: readonly FormationContactBatchUpdateEntry[]) => Promise<void>
  handleDeleteContact: (contactId: string) => Promise<void>
  /**
   * Seed the active geological model with contacts from borehole stratigraphy.
   * When called from the Sections stage, pass ``sectionId`` and
   * ``onSectionUpdated`` so the router seeds the section's explicit-content
   * set and the local section state is patched without a refetch.
   */
  handleAutoPopulateFromStratigraphy: (
    boreholeIds: readonly string[],
    sectionId?: string | null,
    onSectionUpdated?: (updated: import('../api/client').CrossSectionResponse) => void,
  ) => Promise<void>
  /**
   * Seed the active lithostratigraphic model from its parent geological model's
   * contacts.  Copies each parent contact with source='geological_model_seed'
   * and confidence='medium'.  Idempotent — re-running skips existing pairs.
   *
   * When called from the Sections stage, pass ``sectionId`` and
   * ``onSectionUpdated`` so the server seeds the section's explicit-content
   * set and local section state is patched without a refetch.
   */
  handleSeedLithoFromParent: (
    boreholeIds: readonly string[],
    sectionId?: string | null,
    onSectionUpdated?: (updated: import('../api/client').CrossSectionResponse) => void,
  ) => Promise<void>
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
  // ``manualMap`` is optional — when provided the server lumps candidate keys
  // using the map and returns collisions in the result so the dialog can show
  // warnings before the user confirms.
  discoverBoreholeFormations: (
    boreholeIds: readonly string[],
    manualMap?: Record<string, string>,
  ) => Promise<{ candidates: FormationCandidate[]; collisions: LumpingCollision[] }>
  // Fill-from-boreholes: apply the curated selection (destructive).
  // Calls auto-populate with selected stable keys (server creates only
  // those formations), then refetches the fresh formation list and
  // deletes any formation whose stable key is NOT in the selected set.
  // The confirm gate lives in FormationSelectionDialog.
  // ``manualMap`` is the SAME map that was used for the last preview call —
  // never re-discovered between dialog confirm and the apply call, preserving
  // the discover ≡ apply invariant the backend enforces.
  applyBoreholeFormationSelection: (
    selectedKeys: ReadonlySet<string>,
    boreholeIds: readonly string[],
    manualMap?: Record<string, string>,
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
  // -------------------------------------------------------------------------
  // Litho suggestion ghost state (slice 3, #55).
  // Ephemeral — not persisted to .gmproj. Cleared on model switch.
  // -------------------------------------------------------------------------
  /** Current layer suggestions from the segmenter. Empty = no active suggestion. */
  lithoSuggestions: LithoLayerSuggestion[]
  /** The investigation id (CPT or borehole) whose suggestions are loaded. */
  lithoSuggestionInvestigationId: string | null
  /** Whether the anchor is a CPT or borehole (null when no suggestion is active). */
  lithoSuggestionAnchorKind: 'cpt' | 'borehole' | null
  /** Layer indices the user has accepted (contact was created successfully). */
  lithoSuggestionAccepted: ReadonlySet<number>
  /** Layer indices the user has explicitly rejected (dismissed). */
  lithoSuggestionRejected: ReadonlySet<number>
  /** Whether a suggestion fetch is in flight. */
  lithoSuggesting: boolean
  /**
   * Fetch lithostratigraphic suggestions for one investigation.
   * Stores results in ``lithoSuggestions`` for the ghost overlay.
   * Clears any prior accepted/rejected state.
   */
  handleSuggestLitho: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
  ) => Promise<void>
  /**
   * Accept suggestion layer ``idx``: ensure the formation exists in the
   * litho model (reuse if present, create if absent), then create a contact
   * at ``depth_top_m``.  Marks the layer accepted on success.
   */
  handleAcceptLithoSuggestion: (idx: number) => Promise<void>
  /** Reject suggestion layer ``idx`` — marks it rejected (no network call). */
  handleRejectLithoSuggestion: (idx: number) => void
  /** Clear all suggestion state (close the ghost overlay). */
  clearLithoSuggestions: () => void

  // -------------------------------------------------------------------------
  // Pinch-out ghost-preview state (ghost-UX slice).
  // Ephemeral — not persisted to .gmproj. One active preview at a time.
  // -------------------------------------------------------------------------
  /** Non-null when a dry_run preview is loaded. Carries the tip geometry
   * and the request parameters needed to call the commit endpoint. */
  pinchOutPreview: {
    /** Along-section distance of the computed tip (m from section start). */
    tip_along_m: number
    /** Absolute elevation of the tip (m above datum). */
    tip_elevation_m: number
    /** Id of the formation that is pinching out. */
    formation_id: string
    /** Id of the deeper formation the pinching one wedges into. */
    target_formation_id: string
    /** Which end of the section the formation thins toward. */
    direction: 'left' | 'right'
    /** Section the preview was computed against. */
    section_id: string
    /** Model the preview was computed against. */
    model_id: string
  } | null
  /** True while a dry_run or commit call is in flight. */
  pinchOutLoading: boolean
  /**
   * Run the dry_run path to load a ghost preview.
   * On 422 (geometry uncomputable) resolves to false and surfaces an
   * inline error message via toast.
   */
  handlePreviewPinchOut: (params: {
    formationId: string
    targetFormationId: string
    sectionId: string
    modelId: string
    direction: 'left' | 'right'
    dipOverrideMMPerM?: number | null
  }) => Promise<boolean>
  /**
   * Commit the active pinch-out preview.  On success patches the local
   * contacts state, adds to sessionImports (dirty flag), and echoes the
   * updated section via ``onSectionUpdated``.  Clears the preview state
   * whether or not the call succeeds.
   */
  handleCommitPinchOut: (
    onSectionUpdated?: (updated: CrossSectionResponse) => void,
  ) => Promise<void>
  /** Dismiss the preview without committing (no-op). */
  clearPinchOutPreview: () => void
  // -------------------------------------------------------------------------
  // Geological surface backdrop for the litho cross-section (#60).
  // READ-ONLY: surfaces from the reference geological model rendered as faint
  // polylines behind the active litho contacts. Fetched on explicit user
  // request (the rewired "Sync geology" toolbar verb on the litho axis).
  // Never routes through seeded_formation_contact_ids — the backdrop is a
  // surface-geometry overlay, not an explicit-content contact set.
  // -------------------------------------------------------------------------
  /** Cached TIN surfaces for the geological backdrop model, keyed by formation id.
   * Empty map = no backdrop loaded yet. */
  backdropSurfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Fetch (or re-fetch) the geological model's surfaces for the backdrop.
   * Gated to the litho axis in the caller (SectionsCanvas) — calling on
   * the geological axis is a no-op here (project check only).
   *
   * Parameters
   * ----------
   * geoModelId
   *     UUID of the geological model whose surfaces to load as the backdrop.
   */
  handleLoadBackdropSurfaces: (geoModelId: string) => Promise<void>
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
 * currentLumping
 *     Persisted lumping snapshot from ``useProject``.  Used by
 *     ``handleAutoPopulateFromStratigraphy`` (Seed path) to pass the
 *     stored ``manualMap`` to the backend so the discover ≡ apply ≡ seed
 *     invariant is maintained.  ``null`` when no snapshot is persisted.
 * stageLumping
 *     Callback from ``useProject`` that stages a new lumping snapshot
 *     in-memory and marks the project dirty (two-stage save model).
 *     Called by ``applyBoreholeFormationSelection`` after a successful
 *     apply so the alias map is persisted on the next File→Save.
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
  currentLumping,
  stageLumping,
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
  /** Persisted lumping snapshot — ``null`` when no Apply has been committed. */
  currentLumping: StratigraphyLumping | null
  /** Stage a new lumping snapshot in-memory, marking the project dirty. */
  stageLumping: (lumping: StratigraphyLumping) => void
}): UseGeologicalModelResult {
  const [activeGeologicalModel, setActiveGeologicalModel] =
    useState<GeologicalModelResponse | null>(null)
  // #55 model-kind picker: the full project model list (all kinds) +
  // the active lithostratigraphic sibling. Kept separate from the
  // race-guarded geological bootstrap so that delicate path is
  // untouched — these are refreshed additively via refreshModels.
  const [models, setModels] = useState<GeologicalModelResponse[]>([])
  const [activeLithoModel, setActiveLithoModel] =
    useState<GeologicalModelResponse | null>(null)
  // Litho parallel state (slice 2, #55). Independent of the geological
  // contact set — mutations in one set never invalidate the other.
  // Loaded / cleared by a useEffect that watches activeLithoModel.
  const [lithoContacts, setLithoContacts] = useState<FormationContactResponse[]>([])
  const [lithoFormations, setLithoFormations] = useState<GeologicalFormationResponse[]>([])
  const [lithoSurfacesByFormationId, setLithoSurfacesByFormationId] = useState<
    ReadonlyMap<string, FormationSurfaceResponse>
  >(new Map())
  // Ref version of activeLithoModel for useCallback closures that
  // must not list it as a dep (same pattern as activeGeologicalModelRef).
  const activeLithoModelRef = useRef<GeologicalModelResponse | null>(null)
  useEffect(() => {
    activeLithoModelRef.current = activeLithoModel
  }, [activeLithoModel])
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
  // Geological surface backdrop for the litho cross-section (#60).
  // Loaded on explicit user request (the rewired "Sync geology" verb on
  // the litho axis). Cleared when the project changes so stale surfaces
  // from a previous project never bleed in.
  const [backdropSurfacesByFormationId, setBackdropSurfacesByFormationId] = useState<
    ReadonlyMap<string, FormationSurfaceResponse>
  >(new Map())

  // Mirrors activeGeologicalModel into a ref so useCallback closures
  // can read the latest value without listing the state as a dep.
  // Follows the lastSurfaceRefetchContactsRef pattern already used in
  // this hook: a tiny useEffect keeps the ref in sync whenever the
  // state changes.
  const activeGeologicalModelRef = useRef<GeologicalModelResponse | null>(null)
  useEffect(() => {
    activeGeologicalModelRef.current = activeGeologicalModel
  }, [activeGeologicalModel])

  // #55: single source of truth for the model list + the active
  // lithostratigraphic pointer. Called from the bootstrap effect and
  // after every create/activate. Deliberately does NOT touch
  // activeGeologicalModel (owned by the race-guarded resolve path) —
  // it only derives the litho pointer (treat absent kind as
  // geological, matching the backend default → never mis-picks a
  // legacy row as the litho model).
  const refreshModels = useCallback(async (): Promise<
    GeologicalModelResponse[]
  > => {
    if (!project) {
      setModels([])
      setActiveLithoModel(null)
      return []
    }
    const ms = await api.geology.listModels(project.id)
    setModels(ms)
    setActiveLithoModel(
      ms.find(m => m.is_active && m.kind === 'lithostratigraphic') ?? null,
    )
    return ms
  }, [project])

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
    // ``== null`` (not ``=== null``) intentionally also matches
    // ``undefined`` — pre-slice-1 rows / test fixtures have no kind.
    const isGeologicalKind = (m: GeologicalModelResponse): boolean =>
      m.kind === 'geological' || m.kind == null
    const isActiveGeological = (m: GeologicalModelResponse): boolean =>
      m.is_active && isGeologicalKind(m)
    let active = models.find(isActiveGeological) ?? null
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
      setModels([])
      setActiveLithoModel(null)
      setFormations([])
      setContacts([])
      setSurfacesByFormationId(new Map())
      setBackdropSurfacesByFormationId(new Map())
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
        // #55: populate the model list + active-litho pointer for the
        // picker. Non-fatal — a list-fetch failure must not blank the
        // (already-resolved) geological flow, so it is awaited inside
        // the same try but its own failure is swallowed by the outer
        // catch only if it throws before the geological state is set
        // (it is set above, so the picker just stays empty on failure).
        await refreshModels()
      } catch (err) {
        log.warn('geology', `model bootstrap failed for ${project.id}`, err)
        if (!cancelled) {
          setActiveGeologicalModel(null)
          setModels([])
          setActiveLithoModel(null)
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
    // refreshModels is useCallback([project]) — stable per project, so
    // including it does not add re-runs beyond the existing [project]
    // key; satisfies exhaustive-deps without a suppression.
  }, [project, refreshModels])

  // Load / reload litho contacts + formations + surfaces when the
  // active litho model changes. Parallel fetch, mirroring the
  // geological bootstrap. Clears when activeLithoModel is null.
  // Architect-flagged highest risk: this effect is INDEPENDENT of
  // the geological bootstrap (different state atoms) so there is no
  // shared refresh counter — mutations go through setLithoContacts
  // optimistically + refetch, never through setContacts.
  useEffect(() => {
    if (!project || !activeLithoModel) {
      setLithoContacts([])
      setLithoFormations([])
      setLithoSurfacesByFormationId(new Map())
      return
    }
    let cancelled = false
    const projectId = project.id
    const modelId = activeLithoModel.id
    ;(async () => {
      try {
        const [forms, conts, surfs] = await Promise.all([
          api.geology.listFormations(projectId),
          api.geology.listContacts(projectId, modelId),
          api.geology.listSurfaces(projectId, modelId),
        ])
        if (cancelled) return
        // S-4 (senior-review, data-integrity): listFormations is
        // PROJECT-scoped — it returns geological + litho + geotech
        // formations. Geological formations carry lithology=null;
        // litho units always carry a lithology token (the same
        // discriminator handleAcceptLithoSuggestion's reuse step uses).
        // Filtering here keeps geological formations out of the litho
        // picker AND out of the reuse-match. Empty before the first
        // accept is correct — every accept then creates, and the
        // refetch brings the new litho formation back in scope.
        setLithoFormations(forms.filter(f => f.lithology != null))
        setLithoContacts(conts)
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setLithoSurfacesByFormationId(sm)
        log.debug(
          'geology',
          `litho model ${modelId}: loaded ${conts.length} contacts, ${forms.length} formations, ${surfs.length} surfaces`,
        )
      } catch (err) {
        if (!cancelled) {
          log.warn('geology', `litho model ${modelId}: load failed`, err)
          setLithoContacts([])
          setLithoFormations([])
          setLithoSurfacesByFormationId(new Map())
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project, activeLithoModel])

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

  // Refetch litho contacts for the active litho model. Called after
  // handleCreateLithoContact / inline-create mutations (optimistic update
  // + explicit refetch pattern — same as the geological set uses implicitly
  // via the setContacts→useEffect→refetchSurfaces chain). Reads from ref
  // so the dep array is [project] — stable to project identity.
  const refetchLithoContacts = useCallback(() => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    void api.geology
      .listContacts(project.id, model.id)
      .then(setLithoContacts)
      .catch(err => {
        log.warn('geology', `litho listContacts refetch failed`, err)
      })
  }, [project])

  // Refetch litho surfaces for the active litho model. Called after
  // any litho contact mutation so the section slice render stays current.
  const refetchLithoSurfaces = useCallback(() => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    void api.geology
      .listSurfaces(project.id, model.id)
      .then(surfs => {
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setLithoSurfacesByFormationId(sm)
      })
      .catch(err => {
        log.warn('geology', `litho listSurfaces refetch failed`, err)
      })
  }, [project])

  // Fetch (or re-fetch) the geological model's surfaces for the backdrop.
  // Called from SectionsCanvas when the user clicks the rewired "Sync geology"
  // toolbar verb on the litho axis. The dep array is [project] — stable to
  // project identity — so the callback identity does not churn on every surface
  // state change.
  const handleLoadBackdropSurfaces = useCallback(
    async (geoModelId: string): Promise<void> => {
      if (!project) return
      log.debug('geology', `loadBackdropSurfaces entry model=${geoModelId}`)
      try {
        const surfs = await api.geology.listSurfaces(project.id, geoModelId)
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setBackdropSurfacesByFormationId(sm)
        log.success(
          'geology',
          `loadBackdropSurfaces ok model=${geoModelId} surfaces=${surfs.length}`,
        )
      } catch (err) {
        log.warn('geology', `loadBackdropSurfaces failed model=${geoModelId}`, err)
      }
    },
    [project],
  )

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
      sectionId?: string | null,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `createContact entry kind=${anchorKind} anchor=${anchorId} depth=${depth_m.toFixed(3)}m formation=${formationId} snapped=${snapped}` +
          (sectionId ? ` section=${sectionId}` : ''),
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
          // P2 explicit-content: when drawn on a section, tell the backend
          // so it unions this contact's id into seeded_formation_contact_ids
          // (else SectionsCanvas's P2-F filter hides it). Reused verbatim by
          // the undo reapply path below (same `payload` object).
          ...(sectionId ? { section_id: sectionId } : {}),
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
      sectionId?: string | null,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (creates.length === 0) return
      // P2 explicit-content: when the copy happens on a section, every
      // created id must be seeded into seeded_formation_contact_ids or
      // SectionsCanvas's P2-F filter hides the whole copy. Threaded into
      // both the main POST and the undo-redo re-POST below; the caller
      // (sectionAwareBatchCreateContacts) refreshes the section once after.
      const withSection = <T extends object>(p: T): T =>
        sectionId ? { ...p, section_id: sectionId } : p
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
          const row = await api.geology.createContact(
            projectId,
            modelId,
            withSection(payload),
          )
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
              withSection(createdPayloads[j]),
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
    async (
      boreholeIds: readonly string[],
      sectionId?: string | null,
      onSectionUpdated?: (updated: import('../api/client').CrossSectionResponse) => void,
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
        const notInModelSuffix =
          notInModel > 0
            ? ` ${notInModel} layer${notInModel === 1 ? '' : 's'} skipped` +
              ' — formation not in your model.'
            : ''
        if (created > 0) {
          toast(
            'success',
            `Seeded ${created} contacts.` + notInModelSuffix,
          )
        } else if (outcome.skipped_no_stratigraphy === boreholeIds.length) {
          toast(
            'error',
            'No boreholes on this section carry stratigraphy data.',
          )
        } else if (notInModel > 0) {
          // Not an error — expected when the corridor's boreholes carry
          // formations the user chose not to curate. 'success' tone keeps
          // parity with the "Already in sync" message below (toast only
          // has success/error).
          toast(
            'success',
            `Nothing seeded —${notInModelSuffix} Add it in the Geology ` +
              'stage to place it here.',
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
      currentLumping,
      addToSessionImports,
      addToManifest,
      pushUndo,
    ],
  )

  // Seed the active lithostratigraphic model from its parent geological
  // model's contacts.  Mirrors the structure of handleAutoPopulateFromStratigraphy
  // but closes over activeLithoModel instead of activeGeologicalModel.
  // No undo entry — seeded contacts are idempotent tombstones; the user
  // removes unwanted ones via the Sections editor (one-by-one delete).
  const handleSeedLithoFromParent = useCallback(
    async (
      boreholeIds: readonly string[],
      sectionId?: string | null,
      onSectionUpdated?: (updated: import('../api/client').CrossSectionResponse) => void,
    ): Promise<void> => {
      if (!project || !activeLithoModel) return
      if (boreholeIds.length === 0) return
      log.debug(
        'geology',
        `seedLithoFromParent entry model=${activeLithoModel.id} boreholes=${boreholeIds.length}` +
          (sectionId ? ` section=${sectionId}` : ''),
      )
      try {
        const outcome = await api.geology.seedLithoFromParent(
          project.id,
          activeLithoModel.id,
          boreholeIds,
          sectionId,
        )
        // Patch local section state when the server echoed an updated section row.
        if (outcome.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(outcome.updated_section)
          log.debug(
            'geology',
            `seedLithoFromParent: section ${sectionId} seeded set applied locally`,
          )
        }
        // Refresh litho contacts — the simplest path to consistency;
        // new contacts were inserted server-side.
        const conts = await api.geology.listContacts(project.id, activeLithoModel.id)
        setLithoContacts(conts)
        addToSessionImports('contact', outcome.created_contact_ids)
        const created = outcome.created_contact_ids.length
        log.success(
          'geology',
          `seedLithoFromParent ok +${created} contacts, skipped ${outcome.skipped_existing} existing`,
        )
        if (created > 0) {
          toast('success', `Seeded ${created} contacts from geological model.`)
        } else {
          toast('success', 'Already in sync — nothing to add.')
        }
      } catch (err) {
        log.error('geology', 'seedLithoFromParent failed', err)
        toast('error', 'Could not seed contacts from geological model.')
      }
    },
    [project, activeLithoModel, addToSessionImports],
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

  // Mirror of staleSurfaceCount for the lithostratigraphic model.
  // Zero when no litho model is active or no surfaces have been built yet.
  const lithoStaleSurfaceCount = useMemo(
    () =>
      Array.from(lithoSurfacesByFormationId.values()).filter(s => s.is_stale === true).length,
    [lithoSurfacesByFormationId],
  )

  // Rebuild TIN surfaces for the active lithostratigraphic model.
  // Closes over activeLithoModelRef so the dep array is [project] —
  // stable to project identity.  The rebuild endpoint is model-id-
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
      if (result.formations_considered === 0) {
        toast('success', 'No litho formations with contacts yet — nothing to rebuild.')
      } else if (result.formations_rebuilt === 0) {
        toast(
          'success',
          `Litho cache in sync (${result.formations_considered} ` +
            `surface${result.formations_considered === 1 ? '' : 's'} checked).`,
        )
      } else {
        toast(
          'success',
          `Rebuilt ${result.formations_rebuilt} of ${result.formations_considered} litho surface${result.formations_considered === 1 ? '' : 's'}.`,
        )
      }
    } catch (err) {
      log.error('geology', 'rebuildLithoSurfaces failed', err)
      toast('error', 'Could not rebuild litho surfaces — see console.')
    }
  }, [project, refetchLithoSurfaces, toast])

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
    async (
      boreholeIds: readonly string[],
      manualMap?: Record<string, string>,
    ): Promise<{ candidates: FormationCandidate[]; collisions: LumpingCollision[] }> => {
      if (!project) return { candidates: [], collisions: [] }
      if (boreholeIds.length === 0) return { candidates: [], collisions: [] }
      const mapSize = manualMap ? Object.keys(manualMap).length : 0
      log.debug(
        'geology',
        `discoverBoreholeFormations entry boreholes=${boreholeIds.length} map_entries=${mapSize}`,
      )
      const model = await ensureActiveGeologicalModel()
      if (!model) return { candidates: [], collisions: [] }
      try {
        const result = await api.geology.discoverFromStratigraphy(
          project.id,
          model.id,
          boreholeIds,
          mapSize > 0 ? manualMap : undefined,
        )
        const collisionCount = result.collisions?.length ?? 0
        log.success(
          'geology',
          `discoverBoreholeFormations ok candidates=${result.candidates.length} collisions=${collisionCount}`,
        )
        const candidates: FormationCandidate[] = result.candidates.map(c => ({
          name: c.name,
          // key falls back to name for old server responses that pre-date the
          // stable-key field (empty-string default on the schema); name is the
          // correct fallback in that case.
          key: c.key || c.name,
          boreholeCount: c.borehole_count,
        }))
        const collisions: LumpingCollision[] = (result.collisions ?? []).map(col => ({
          boreholeId: col.borehole_id,
          targetFormationKey: col.target_formation_key,
          targetFormationName: col.target_formation_name,
          collidingRawNames: col.colliding_raw_names,
          keptTopM: col.kept_top_m,
          droppedCount: col.dropped_count,
        }))
        return { candidates, collisions }
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
  // Pipeline (2026-05-17 — server-side delete, fixes da98053 freeze):
  //
  //   Step 1: POST auto-populate with selected stable keys.
  //           The server creates ONLY the formations whose canonical key is in
  //           the set AND deletes every existing project formation whose key
  //           is NOT in the set — both in the same transaction.
  //           The response carries deleted_formation_ids so the client never
  //           has to recompute canonical keys from raw names. The previous
  //           client-side approach (raw .toLowerCase()) diverged from the
  //           server's normalize_formation_key() after da98053 introduced
  //           chrono-prefix stripping + lid-van reduction, causing the key
  //           comparison to miss every name with a dash/colon/space and
  //           delete the entire freshly-created formation list, hard-freezing
  //           the UI for minutes.
  //
  //   Step 2: If auto-populate returned +0 formations AND skipped_existing > 0,
  //           surface a clear toast ("already populated — dedupe or delete to
  //           reset") so the user isn't silently confused by a no-op.
  //
  //   Step 3: Final refresh of formations + contacts state.
  //
  // NOT on the undo stack — irreversible at unknown scale; confirm dialog is
  // the safeguard. Mirrors handleDedupeContacts' exclusion for the same reason.
  const applyBoreholeFormationSelection = useCallback(
    async (
      selectedKeys: ReadonlySet<string>,
      boreholeIds: readonly string[],
      manualMap?: Record<string, string>,
    ): Promise<void> => {
      if (!project) return
      const activeModel = await ensureActiveGeologicalModel()
      if (!activeModel) return
      const projectId = project.id
      const modelId = activeModel.id
      const mapSize = manualMap ? Object.keys(manualMap).length : 0
      log.info(
        'geology',
        `applyBoreholeFormationSelection entry ` +
          `selected=${selectedKeys.size} boreholes=${boreholeIds.length} map_entries=${mapSize}`,
      )
      try {
        // Step 1: auto-populate + server-side delete in one transaction.
        // The server uses normalize_formation_key() for both operations so
        // the canonical key is identical on the create side and the delete
        // side — no client-side key recomputation needed.
        // ``manualMap`` is the SAME map used in the preceding discover call
        // (passed through unchanged from the dialog confirm) so the backend's
        // discover ≡ apply invariant is preserved.
        const outcome = await api.geology.autoPopulateFromStratigraphy(
          projectId,
          modelId,
          boreholeIds,
          Array.from(selectedKeys),
          mapSize > 0 ? manualMap : undefined,
        )
        log.debug(
          'geology',
          `applyBoreholeFormationSelection auto-populate: ` +
            `+${outcome.created_formation_ids.length} formations, ` +
            `+${outcome.created_contact_ids.length} contacts, ` +
            `-${outcome.deleted_formation_ids.length} unselected, ` +
            `skipped_existing=${outcome.skipped_existing}`,
        )

        // Step 2: surface feedback when auto-populate created nothing despite
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

        // Step 3: final refresh — fetch post-populate state.
        const [forms, conts] = await Promise.all([
          api.geology.listFormations(projectId),
          api.geology.listContacts(projectId, modelId),
        ])
        setFormations(forms)
        setContacts(conts)

        // Manifest + session-import housekeeping.
        // Use server-returned deleted ids — no client key recomputation.
        removeFromManifest('formation', outcome.deleted_formation_ids)
        removeFromSessionImports('formation', outcome.deleted_formation_ids)
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
            `formations=${forms.length} ` +
            `deleted=${outcome.deleted_formation_ids.length} ` +
            `created=${outcome.created_formation_ids.length}`,
        )
        // Stage-on-apply: update the in-memory lumping snapshot and mark
        // the project dirty so the alias map is persisted on the next
        // File→Save (two-stage save model parity with metadata edits).
        // An empty or absent manualMap writes a cleared snapshot
        // (schema_version kept; map = {}) so the dialog does not prefill
        // stale aliases on reopen.
        const lumpingMap =
          manualMap != null && Object.keys(manualMap).length > 0
            ? manualMap
            : {}
        stageLumping({
          schema_version: 1,
          applied_at: new Date().toISOString(),
          map: lumpingMap,
        })
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
      stageLumping,
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

  // #55 model-kind picker — create a lithostratigraphic model under
  // the active geological backbone. The backend enforces the parent
  // invariant (422 if parent missing / wrong kind); we surface that
  // as a toast and return null rather than throwing into the UI.
  const handleCreateLithoModel = useCallback(
    async (name: string): Promise<GeologicalModelResponse | null> => {
      if (!project) return null
      const parent = activeGeologicalModelRef.current
      if (!parent) {
        toast('error', 'Create a geological model before adding a lithostratigraphic one.')
        return null
      }
      try {
        const created = await api.geology.createModel(project.id, {
          name,
          kind: 'lithostratigraphic',
          parent_geological_model_id: parent.id,
          is_active: true,
        })
        await refreshModels()
        log.success('geology', `created litho model ${created.id} (${name})`)
        return created
      } catch (err) {
        log.error('geology', `handleCreateLithoModel failed (${name})`, err)
        toast('error', 'Could not create the lithostratigraphic model.')
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
        toast('error', 'Could not activate the lithostratigraphic model.')
      }
    },
    [project, refreshModels, toast],
  )

  // #55 — delete a lithostratigraphic model. A litho model has no
  // children (it is itself a leaf that refines a geological parent),
  // so the backend delete never 409s here. refreshModels re-derives
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
        log.success('geology', `deleted litho model ${modelId}`)
      } catch (err) {
        log.error('geology', `handleDeleteLithoModel failed ${modelId}`, err)
        // Surface the server's reason (del() now carries `detail`).
        toast(
          'error',
          err instanceof Error
            ? err.message
            : 'Could not delete the lithostratigraphic model.',
        )
        throw err
      }
    },
    [project, refreshModels, toast],
  )

  // Slice 2, #55: create a formation contact on the LITHO model.
  // Mirror of handleCreateContact — same optimistic-update + refetch
  // pattern (setLithoContacts → refetchLithoContacts), DIFFERENT state
  // atom. Closes over activeLithoModelRef so the dep array stays
  // [project, refetchLithoContacts] — stable to project identity.
  // Architect warning: the parallel litho contact-set must NEVER share
  // a refresh counter with the geological set; each has its own optimistic
  // setter + explicit refetch.
  const handleCreateLithoContact = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
      sectionId?: string | null,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      log.debug(
        'geology',
        `createLithoContact entry kind=${anchorKind} anchor=${anchorId} depth=${depth_m.toFixed(3)}m formation=${formationId}` +
          (sectionId ? ` section=${sectionId}` : ''),
      )
      try {
        const payload = {
          formation_id: formationId,
          depth_top_m: depth_m,
          borehole_id: anchorKind === 'borehole' ? anchorId : null,
          cpt_id: anchorKind === 'cpt' ? anchorId : null,
          source: (snapped ? 'borehole_observation' : 'manual_pick') as
            | 'borehole_observation'
            | 'manual_pick',
          confidence: (snapped ? 'high' : 'medium') as 'high' | 'medium',
          // P2 explicit-content parity with the geological axis — seed
          // this section's set so the P2-F filter shows the litho contact.
          ...(sectionId ? { section_id: sectionId } : {}),
        }
        const created = await api.geology.createContact(project.id, model.id, payload)
        // Optimistic update first — refetch follows for server truth.
        setLithoContacts(prev => [...prev, created])
        refetchLithoContacts()
        refetchLithoSurfaces()
        log.success(
          'geology',
          `createLithoContact ok id=${created.id} depth=${created.depth_top_m.toFixed(3)}m`,
        )
      } catch (err) {
        log.error('geology', 'createLithoContact failed', err)
        toast('error', 'Could not place the litho formation contact.')
      }
    },
    [project, refetchLithoContacts, refetchLithoSurfaces, toast],
  )

  // Slice 2, #55: inline-create a formation inside the active LITHO model.
  // Mirror of handleInlineCreateFormation — same optimistic-update pattern,
  // DIFFERENT state atom (setLithoFormations). Closes over activeLithoModelRef.
  const handleInlineLithoCreateFormation = useCallback(
    async (
      payload: GeologicalFormationCreatePayload,
    ): Promise<{ id: string } | null> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return null
      try {
        // Formations are project-scoped, not model-scoped. Membership in
        // the litho model is established implicitly when contacts reference
        // this formation through that model's geological_model_id. The
        // payload spreads caller-provided fields only (name, color, lithology
        // for litho formations; nad_class for geotech).
        const created = await api.geology.createFormation(project.id, payload)
        setLithoFormations(prev => [...prev, created])
        log.success(
          'geology',
          `handleInlineLithoCreateFormation ok id=${created.id} name="${created.name}"`,
        )
        return { id: created.id }
      } catch (err) {
        log.error('geology', 'handleInlineLithoCreateFormation failed', err)
        toast('error', 'Could not create the litho formation.')
        return null
      }
    },
    [project, toast],
  )

  // -------------------------------------------------------------------------
  // Slice 3, #55: ephemeral litho-suggestion state (suggest/ghost/accept).
  //
  // Session-only — not persisted to .gmproj. Cleared on litho model switch
  // (the useEffect that loads litho data resets it via clearLithoSuggestions
  // in its cleanup). Independent state atoms so acceptance of one layer
  // never triggers a re-render of the whole geological model state.
  // -------------------------------------------------------------------------

  const [lithoSuggestions, setLithoSuggestions] = useState<LithoLayerSuggestion[]>([])
  const [lithoSuggestionInvestigationId, setLithoSuggestionInvestigationId] = useState<
    string | null
  >(null)
  const [lithoSuggestionAnchorKind, setLithoSuggestionAnchorKind] = useState<
    'cpt' | 'borehole' | null
  >(null)
  const [lithoSuggestionAccepted, setLithoSuggestionAccepted] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [lithoSuggestionRejected, setLithoSuggestionRejected] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [lithoSuggesting, setLithoSuggesting] = useState(false)

  // Stable ref to lithoFormations — lets handleAcceptLithoSuggestion close
  // over it without listing the array as a dep (which would recreate the
  // callback on every formation change). Mirrors the activeLithoModelRef pattern.
  const lithoFormationsRef = useRef<GeologicalFormationResponse[]>([])
  useEffect(() => {
    lithoFormationsRef.current = lithoFormations
  }, [lithoFormations])

  // #55 reuse-race fix: lithoFormationsRef only refreshes via the
  // post-render effect above, so two same-lithology accepts fired
  // before React commits (the common "accept the sand layers off a
  // CPT" burst) would BOTH miss the just-created formation and
  // duplicate it. These synchronous refs make
  // handleAcceptLithoSuggestion's reuse decision burst-safe within a
  // suggestion session: the token→id map is written the instant a
  // formation id is known, and the in-flight map serialises
  // concurrent creates of the same lithology token. Both are reset
  // per suggestion session by clearLithoSuggestions.
  const acceptedFormationByLithoRef = useRef<Map<string, string>>(new Map())
  const lithoFormationInFlightRef = useRef<Map<string, Promise<string | null>>>(
    new Map(),
  )

  const clearLithoSuggestions = useCallback((): void => {
    setLithoSuggestions([])
    setLithoSuggestionInvestigationId(null)
    setLithoSuggestionAnchorKind(null)
    setLithoSuggestionAccepted(new Set())
    setLithoSuggestionRejected(new Set())
    // S-1 (senior-review): also release the Suggest button — if Clear
    // is hit while a suggest fetch is in flight, the spinner would
    // otherwise stay stuck until the orphaned fetch settles.
    setLithoSuggesting(false)
    // New suggestion session → drop the per-session reuse caches so a
    // fresh segmentation cannot reuse a stale prior formation map.
    acceptedFormationByLithoRef.current.clear()
    lithoFormationInFlightRef.current.clear()
  }, [])

  // B-1 (senior-review, data-integrity): a ghost overlay left showing
  // when the active litho model SWITCHES would accept onto the new
  // model (activeLithoModelRef points at the new one) while the
  // suggestion/anchor still reference the old investigation — a
  // contact written to the wrong model. The litho-data effect (above)
  // can't reach clearLithoSuggestions (declared here, far below it —
  // TDZ). Keyed on the model ID (a primitive) NOT the object, so a
  // refreshModels that returns a new-but-same model object does not
  // wipe an in-progress overlay; only a real model change clears it.
  const activeLithoModelId = activeLithoModel?.id ?? null
  useEffect(() => {
    clearLithoSuggestions()
  }, [activeLithoModelId, clearLithoSuggestions])

  // Fetch suggestions for one investigation against the active litho model.
  // Replaces any prior suggestion set (one investigation at a time).
  const handleSuggestLitho = useCallback(
    async (anchorKind: 'cpt' | 'borehole', anchorId: string): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      log.debug(
        'geology',
        `handleSuggestLitho entry kind=${anchorKind} anchor=${anchorId} model=${model.id}`,
      )
      setLithoSuggesting(true)
      // Clear prior suggestion before the fetch so stale data never shows.
      clearLithoSuggestions()
      try {
        const body =
          anchorKind === 'cpt'
            ? { cpt_id: anchorId }
            : { borehole_id: anchorId }
        const resp = await api.geology.suggestLitho(project.id, model.id, body)
        log.success(
          'geology',
          `suggestLitho ok ${resp.layers.length} layers for ${anchorKind} ${anchorId}`,
        )
        setLithoSuggestions(resp.layers)
        setLithoSuggestionInvestigationId(anchorId)
        setLithoSuggestionAnchorKind(anchorKind)
      } catch (err) {
        log.error('geology', `handleSuggestLitho failed for ${anchorId}`, err)
        toast('error', 'Could not fetch lithostratigraphic suggestions.')
      } finally {
        setLithoSuggesting(false)
      }
    },
    [project, clearLithoSuggestions, toast],
  )

  // Accept one suggestion layer: reuse an existing litho formation with the
  // same base lithology, or create one. Then create the contact at depth_top_m.
  // Marks the layer accepted (green tick) on success.
  const handleAcceptLithoSuggestion = useCallback(
    async (idx: number): Promise<void> => {
      const model = activeLithoModelRef.current
      const layers = lithoSuggestions
      if (!project || !model || idx < 0 || idx >= layers.length) return
      const layer = layers[idx]
      const anchorKind = lithoSuggestionAnchorKind
      const anchorId = lithoSuggestionInvestigationId
      if (!anchorKind || !anchorId) return
      log.debug(
        'geology',
        `acceptLithoSuggestion idx=${idx} lithology=${layer.suggested_lithology} depth=${layer.depth_top_m.toFixed(2)}m`,
      )
      try {
        // Reuse-not-duplicate, BURST-SAFE (token match, case-insensitive).
        // Four-step resolution so consecutive same-lithology accepts
        // (the common "accept the sand layers off a CPT" workflow)
        // share ONE formation even when fired faster than React can
        // commit + refresh lithoFormationsRef:
        const token = layer.suggested_lithology.toUpperCase()
        let formationId: string | undefined =
          // 1. Created earlier this suggestion session (synchronous).
          acceptedFormationByLithoRef.current.get(token)

        if (formationId === undefined) {
          // 2. A pre-existing formation (post-render ref). Cache it so
          //    the rest of the burst hits step 1.
          const existing = lithoFormationsRef.current.find(
            f =>
              f.lithology != null && f.lithology.toUpperCase() === token,
          )
          if (existing) {
            formationId = existing.id
            acceptedFormationByLithoRef.current.set(token, existing.id)
            log.debug(
              'geology',
              `acceptLithoSuggestion reuse formation id=${formationId} name="${existing.name}"`,
            )
          }
        }

        if (formationId === undefined) {
          // 3. A concurrent accept of the same token is mid-create —
          //    await that single create instead of duplicating it.
          const inflight = lithoFormationInFlightRef.current.get(token)
          if (inflight) {
            const id = await inflight
            if (!id) return // the shared create failed (toast already fired)
            formationId = id
          }
        }

        if (formationId === undefined) {
          // 4. Nobody has it — create it. Register the in-flight
          //    promise SYNCHRONOUSLY before awaiting so a racing accept
          //    hits step 3 rather than starting a second create.
          // Shared name/colour tables (senior-review S-2) so the
          // created formation matches what the ghost overlay showed.
          const name =
            LITHOLOGY_LABELS[layer.suggested_lithology] ?? layer.suggested_lithology
          const color =
            LITHOLOGY_COLORS[layer.suggested_lithology] ?? LITHOLOGY_FALLBACK_COLOR
          const createPromise: Promise<string | null> =
            handleInlineLithoCreateFormation({
              name,
              color,
              lithology: layer.suggested_lithology,
              nad_class: layer.suggested_nad_class ?? undefined,
            }).then(r => {
              const id = r?.id ?? null
              if (id) acceptedFormationByLithoRef.current.set(token, id)
              lithoFormationInFlightRef.current.delete(token)
              return id
            })
          lithoFormationInFlightRef.current.set(token, createPromise)
          const id = await createPromise
          if (!id) return // toast already fired by handleInlineLithoCreateFormation
          formationId = id
        }
        // Unreachable — every branch above either set formationId or
        // returned. Explicit so TS narrows it to string for the call.
        if (formationId === undefined) return
        // Create the contact at the suggested top depth.
        await handleCreateLithoContact(
          anchorKind,
          anchorId,
          layer.depth_top_m,
          formationId,
          // Borehole-path suggestions come from observed stratigraphy —
          // treat as snapped (high confidence). CPT is a model output —
          // medium confidence (manual_pick equivalent).
          anchorKind === 'borehole',
        )
        // Mark accepted so the ghost overlay shows the tick.
        setLithoSuggestionAccepted(prev => {
          const next = new Set(prev)
          next.add(idx)
          return next
        })
        log.success(
          'geology',
          `acceptLithoSuggestion ok idx=${idx} formation=${formationId}`,
        )
      } catch (err) {
        log.error('geology', `acceptLithoSuggestion failed idx=${idx}`, err)
        toast('error', 'Could not accept the litho suggestion.')
      }
    },
    // reason: lithoSuggestions / lithoSuggestionAnchorKind / lithoSuggestionInvestigationId
    // are read synchronously inside the callback body via closure. They are listed as deps
    // so the callback identity refreshes when the active suggestion changes (a new suggest
    // replaces all of them at once). lithoFormationsRef is a ref (stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      lithoSuggestions,
      lithoSuggestionAnchorKind,
      lithoSuggestionInvestigationId,
      handleInlineLithoCreateFormation,
      handleCreateLithoContact,
      toast,
    ],
  )

  const handleRejectLithoSuggestion = useCallback((idx: number): void => {
    setLithoSuggestionRejected(prev => {
      const next = new Set(prev)
      next.add(idx)
      return next
    })
    log.debug('geology', `rejectLithoSuggestion idx=${idx}`)
  }, [])

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

  // -------------------------------------------------------------------------
  // Pinch-out ghost-preview state (ghost-UX slice).
  //
  // Session-only — not persisted to .gmproj.  One preview at a time; each
  // new "Extrapolate pinch-out…" right-click replaces the prior one.
  // Mirrors the litho-suggestion flow: dry_run → ghost → confirm/dismiss.
  // -------------------------------------------------------------------------

  /** Geometry returned by the dry_run call + parameters for the commit. */
  type PinchOutPreviewState = {
    tip_along_m: number
    tip_elevation_m: number
    formation_id: string
    target_formation_id: string
    direction: 'left' | 'right'
    section_id: string
    model_id: string
  }

  const [pinchOutPreview, setPinchOutPreview] = useState<PinchOutPreviewState | null>(null)
  const [pinchOutLoading, setPinchOutLoading] = useState(false)

  const clearPinchOutPreview = useCallback((): void => {
    setPinchOutPreview(null)
    setPinchOutLoading(false)
    log.debug('geology', 'pinchOut preview cleared')
  }, [])

  const handlePreviewPinchOut = useCallback(
    async (params: {
      formationId: string
      targetFormationId: string
      sectionId: string
      modelId: string
      direction: 'left' | 'right'
      dipOverrideMMPerM?: number | null
    }): Promise<boolean> => {
      if (!project) return false
      log.debug(
        'geology',
        `handlePreviewPinchOut entry formation=${params.formationId} ` +
          `target=${params.targetFormationId} section=${params.sectionId} ` +
          `direction=${params.direction}`,
      )
      setPinchOutLoading(true)
      // Clear only the prior preview — NOT the loading flag (review S2):
      // clearPinchOutPreview() also resets loading=false, and React
      // batches it with the setPinchOutLoading(true) above into a single
      // render with loading=false, so the spinner never shows during the
      // dry_run. finally{} restores loading=false.
      setPinchOutPreview(null)
      try {
        const resp = await api.geology.extrapolatePinchOut(project.id, params.modelId, {
          formation_id: params.formationId,
          target_formation_id: params.targetFormationId,
          section_id: params.sectionId,
          direction: params.direction,
          dip_override_m_per_m: params.dipOverrideMMPerM ?? null,
          dry_run: true,
        })
        log.success(
          'geology',
          `pinchOut dry_run ok along=${resp.tip_along_m.toFixed(2)} m ` +
            `elev=${resp.tip_elevation_m.toFixed(3)} m`,
        )
        setPinchOutPreview({
          tip_along_m: resp.tip_along_m,
          tip_elevation_m: resp.tip_elevation_m,
          formation_id: params.formationId,
          target_formation_id: params.targetFormationId,
          direction: params.direction,
          section_id: params.sectionId,
          model_id: params.modelId,
        })
        return true
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Could not compute pinch-out geometry.'
        log.error('geology', 'handlePreviewPinchOut failed', err)
        toast(
          'error',
          `Cannot pinch out here: ${msg}`,
        )
        return false
      } finally {
        setPinchOutLoading(false)
      }
    },
    [project, clearPinchOutPreview, toast],
  )

  const handleCommitPinchOut = useCallback(
    async (
      onSectionUpdated?: (updated: CrossSectionResponse) => void,
    ): Promise<void> => {
      if (!project || !pinchOutPreview) return
      const preview = pinchOutPreview
      log.debug(
        'geology',
        `handleCommitPinchOut entry formation=${preview.formation_id} ` +
          `section=${preview.section_id}`,
      )
      setPinchOutLoading(true)
      try {
        const resp: PinchOutExtrapolationResponse = await api.geology.extrapolatePinchOut(
          project.id,
          preview.model_id,
          {
            formation_id: preview.formation_id,
            target_formation_id: preview.target_formation_id,
            section_id: preview.section_id,
            direction: preview.direction,
            dry_run: false,
          },
        )
        // Merge new synthetic contacts into local state.
        if (resp.created_contact_ids.length > 0) {
          const newContacts = await api.geology.listContacts(project.id, preview.model_id)
          setContacts(newContacts)
          addToSessionImports('contact', resp.created_contact_ids)
        }
        // Explicit-content invariant: patch local section state from the
        // echoed updated_section (mirrors handleSeedLithoFromParent pattern).
        if (resp.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(resp.updated_section)
          log.debug(
            'geology',
            `pinchOut commit: section ${preview.section_id} seeded set patched locally`,
          )
        }
        log.success(
          'geology',
          `pinchOut committed: contacts=${resp.created_contact_ids.length} ` +
            `along=${resp.tip_along_m.toFixed(2)} m elev=${resp.tip_elevation_m.toFixed(3)} m`,
        )
        toast(
          'success',
          'Pinch-out created — run Build to update the 3D surface.',
        )
      } catch (err) {
        // 409 = idempotent (synthetic contacts already exist). Surface as
        // info rather than error — the existing contacts are the right state.
        const code = (err as Record<string, unknown>).code
        if (code === 'pinch_out_already_exists') {
          log.info(
            'geology',
            `pinchOut commit 409 (idempotent): existing contacts returned`,
          )
          // The server STILL seeded the section + the contacts already
          // exist — refresh local state so they actually render here
          // instead of staying invisible until a reload (review B2).
          try {
            const refreshed = await api.geology.listContacts(
              project.id,
              preview.model_id,
            )
            setContacts(refreshed)
            const existingIds = (err as { existingContactIds?: string[] })
              .existingContactIds
            if (existingIds && existingIds.length > 0) {
              addToSessionImports('contact', existingIds)
            }
            const updated = (err as { updatedSection?: CrossSectionResponse | null })
              .updatedSection
            if (updated != null && onSectionUpdated != null) {
              onSectionUpdated(updated)
            }
          } catch (refreshErr) {
            log.error(
              'geology',
              'pinchOut 409 local-state refresh failed',
              refreshErr,
            )
          }
          toast(
            'success',
            'Pinch-out already exists for this formation — using existing contacts.',
          )
        } else {
          log.error('geology', 'handleCommitPinchOut failed', err)
          toast('error', 'Could not create pinch-out contacts.')
        }
      } finally {
        setPinchOutLoading(false)
        clearPinchOutPreview()
      }
    },
    // reason: pinchOutPreview is read synchronously inside the callback.
    // It is listed as a dep so the callback identity refreshes when a new
    // preview loads.  addToSessionImports is stable (useCallback in
    // useProject with no volatile deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, pinchOutPreview, clearPinchOutPreview, addToSessionImports, toast],
  )

  return {
    activeGeologicalModel,
    models,
    activeLithoModel,
    handleCreateLithoModel,
    handleActivateLithoModel,
    handleDeleteLithoModel,
    lithoContacts,
    lithoFormations,
    lithoSurfacesByFormationId,
    lithoStaleSurfaceCount,
    handleRebuildLithoSurfaces,
    handleCreateLithoContact,
    handleInlineLithoCreateFormation,
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
    handleSeedLithoFromParent,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    discardContacts,
    discoverBoreholeFormations,
    applyBoreholeFormationSelection,
    handleDeleteModel,
    ensureActiveGeologicalModel,
    lithoSuggestions,
    lithoSuggestionInvestigationId,
    lithoSuggestionAnchorKind,
    lithoSuggestionAccepted,
    lithoSuggestionRejected,
    lithoSuggesting,
    handleSuggestLitho,
    handleAcceptLithoSuggestion,
    handleRejectLithoSuggestion,
    clearLithoSuggestions,
    pinchOutPreview,
    pinchOutLoading,
    handlePreviewPinchOut,
    handleCommitPinchOut,
    clearPinchOutPreview,
    backdropSurfacesByFormationId,
    handleLoadBackdropSurfaces,
  }
}
