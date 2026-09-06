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

import { ApiError, api } from '../api/client'
import type { UseGeotechLithoStalenessResult } from './useGeotechLithoStaleness'
import { useGeotechLithoStaleness } from './useGeotechLithoStaleness'
import type { UseLithoSolidsResult } from './useLithoSolids'
import { useLithoSolids } from './useLithoSolids'
import type {
  AcceptLithoSuggestionsResponse,
  AutoPopulateMode,
  CrossingPinchOut,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  DivideBoreholeResponse,
  LithoLayerResponse,
  LithoLayerSuggestion,
  NadAdmixtureChoice,
  ProjectResponse,
  SubdivideAllBodiesResponse,
} from '../api/client'
import { lithoLayersToContacts } from '../utils/lithoLayerToContact'
import { clearBoreholesStale, markBoreholesStale } from '../utils/boreholesStaleStore'
import type { UndoCommand } from './useUndoStack'
import { useFormationCrud } from './useFormationCrud'
import { useContactCrud } from './useContactCrud'
import { useGeologicalModelOps } from './useGeologicalModelOps'
import { useLithoModelOps } from './useLithoModelOps'
import { useLithoSuggestions } from './useLithoSuggestions'
import type { StratigraphyLumping } from '../utils/projectFile'
import { isLithoUnit, isGeotechUnit } from '../utils/formationKind'
import { pairBandsWithLithoParents } from '../utils/geotechBandParents'
// Aliased: the memo below carries the same name as the rule it calls.
import { columnsNeedingRederive as columnsNeedingRederiveFromFit } from '../utils/geotechParentFit'
import { divideBoreholesToastMessage } from '../utils/divideBoreholesToast'
import { lostTieMessage } from '../utils/lostTieMessage'
import { subdivideCptsToast } from '../utils/subdivideCptsToast'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
// LITHOLOGY_COLORS/LABELS/FALLBACK_COLOR removed — formation name/colour
// is now determined server-side by AcceptLithoSuggestions (Phase 1).

/** Payload accepted by the ContactsLayer batch-copy handler. */
export type ContactCopyPayload = import('../components/sections/ContactsLayer').ContactCopyPayload

/**
 * One DOV formal-stratigraphy code a candidate's boreholes pair it with.
 *
 * Frontend-normalised mirror of the API ``FormalCodeItem``. Lets the fill
 * dialog show the DOV code behind each informal candidate name, expose a
 * formal↔informal disagreement (several codes on one candidate), and offer the
 * DOV code's own formation as a one-click lumping target.
 */
export interface FormalCode {
  /** DOV code (canonical casing where the lexicon knows it, e.g. "GeVl"). */
  code: string
  /** Number of in-scope boreholes pairing the candidate with this code. */
  count: number
  /** Canonical Dutch name from the DOV lexicon, or null when the code is unknown. */
  catalogName: string | null
}

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
  /**
   * DOV formal codes the candidate's boreholes pair the informal name with,
   * each with a count and (where known) the catalogue name.  Empty for an
   * informal-only candidate or a backend older than 2026-09-05.  Optional so
   * older/hand-built candidate fixtures stay valid; the discover flow always
   * sets it (to ``[]`` when the backend sent none).
   */
  formalCodes?: FormalCode[]
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

/**
 * One user edit on a ghost suggestion. Each field is partial — the
 * caller sends only the edges / fields they touched. ``depth_top_m``
 * + ``depth_base_m`` come from drag-resize (Phase 2);
 * ``suggested_lithology`` + ``suggested_admixtures`` come from the
 * composition editor (Phase 2.5 / debt #72).
 */
export interface LithoSuggestionEdit {
  depth_top_m?: number
  depth_base_m?: number
  suggested_lithology?: string
  suggested_admixtures?: readonly {
    soil_code: string
    amount: string
    locally: boolean
  }[]
  /**
   * Internal marker set by the shared-boundary propagation path in
   * ``LithoSuggestionGhostColumns.handleUp``. When true,
   * ``applyCrossMergeOnDrag`` skips the cross-merge neighbour scan and
   * performs a plain depth merge only.
   *
   * The double-absorb bug (2026-05-26): dragging a shared boundary calls
   * ``onEdit`` twice — once for the canonical dragger (primary, with cross-
   * merge) and once for the partner layer (secondary, shared-boundary
   * propagation only). Without this flag, the secondary call also ran the
   * cross-merge scan on the post-primary ghost, where the primary had
   * already set the dragger's base to ``final``. The secondary then saw
   * ``newTop <= dragger.updatedBase`` and absorbed the dragger — wrong
   * direction, double absorb. The flag confines cross-merge to the primary
   * call only.
   *
   * Never persisted to the server; stripped by the accept path.
   */
  _propagateOnly?: boolean
}

/**
 * One investigation's ghost-suggestion state in the bulk-suggest
 * Map (debt #73). Mirrors the per-anchor structure the single-
 * anchor state spreads across several useState hooks; collected
 * here so the bulk store is a Map<anchorId, BulkAnchorGhost>.
 */
export interface BulkAnchorGhost {
  /** ``cpt`` or ``borehole`` discriminator for the anchor. */
  kind: 'cpt' | 'borehole'
  /** Segmenter output for this anchor, ordered top → bottom. */
  suggestions: LithoLayerSuggestion[]
  /** Surface elevation (mTAW) for ghost rendering. */
  surfaceElevationM: number | null
  /** Layer indices the user has accepted. */
  accepted: ReadonlySet<number>
  /** Layer indices the user has explicitly rejected. */
  rejected: ReadonlySet<number>
  /** User edits per layer — depth + composition overrides. */
  edits: ReadonlyMap<number, LithoSuggestionEdit>
  /**
   * Robust-fix tracking for the cross-store dispatch (dogfeed 2026-05-30,
   * follow-up to Slice 3). Map<acceptedSuggestionIdx → contact ids
   * that the API returned when that suggestion was accepted>. Used
   * by ``useBoundaryDrag`` to resolve "the committed contact that
   * corresponds to this accepted suggestion's boundary" by IDENTITY
   * (not by depth-tolerance match). Survives contact-drift drag
   * sequences that previously fell off the depth-match: the user
   * can move a committed contact in ContactsLayer, then drag the
   * adjacent pending, and the cross-store dispatch still finds the
   * right contact.
   *
   * Populated ONLY by the two one-layer accept paths
   * (``handleAcceptLithoSuggestion`` and ``handleAcceptBulkLitho`` via
   * the shared ``commitAcceptTail`` — debt #232): a single-suggestion
   * accept is the trivial identity case, every id in the API's
   * ``created_contact_ids`` + ``found_contact_ids`` belongs to that one
   * suggestion idx. The multi-layer paths
   * (``handleAcceptAllLithoSuggestions``, ``handleAcceptAllBulkLitho``)
   * deliberately do NOT populate it — associating N returned contact
   * ids to N suggestion indices needs a backend ordering contract
   * (owner decision pending).
   *
   * Optional + defaults to empty for backwards-compat with existing
   * tests and the bulk-suggest reducer paths that don't touch this
   * field. When absent the cross-store dispatch falls back to the
   * pre-fix depth-tolerance match in ``useBoundaryDrag``.
   */
  contactIdsByAcceptedIdx?: ReadonlyMap<number, readonly string[]>
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
  /**
   * Accepted litho layers for the active model — the Shape A source of truth.
   * Each carries ``body_id`` (the instance it belongs to). ``lithoContacts``
   * is the boundary-centric projection of this set; consumers that need the
   * body link (e.g. BodyExtentOverlay framing, the open-end gesture) read
   * ``lithoLayers`` directly.
   */
  lithoLayers: LithoLayerResponse[]
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
  // ---- Litho body solids (useLithoSolids — lifted from LithologyCanvas) ----
  /** All built body solids for the active litho model. */
  lithoSolids: UseLithoSolidsResult['lithoSolids']
  /** True while the initial fetch is in flight. */
  lithoSolidsLoading: UseLithoSolidsResult['lithoSolidsLoading']
  /** True while a rebuild is in progress. */
  lithoSolidsBuilding: UseLithoSolidsResult['lithoSolidsBuilding']
  /** True when at least one solid has triangles. */
  hasLithoSolids: UseLithoSolidsResult['hasLithoSolids']
  /** True when any solid has ``is_stale === true``. */
  hasStaleLithoSolid: UseLithoSolidsResult['hasStaleLithoSolid']
  /** Build / rebuild solids for the active litho model, toast the result. */
  buildLithoSolids: UseLithoSolidsResult['buildLithoSolids']
  /**
   * Build the litho model via a background job with phase + per-column progress
   * and a cancel (debt #282). Same payload assembly as ``buildLithoSolids``.
   */
  startLithoBuild: UseLithoSolidsResult['startLithoBuild']
  /** Ask the running streaming litho build to stop; the model is left unchanged. */
  cancelLithoBuild: UseLithoSolidsResult['cancelLithoBuild']
  /** Live state of the streaming litho build (idle/running/done/cancelled/error). */
  voxelBuildState: UseLithoSolidsResult['voxelBuildState']
  /**
   * Set or clear a per-body display colour (optimistic + debounced).
   * ``null`` resets to the formation lithology colour.
   */
  setBodyColor: UseLithoSolidsResult['setBodyColor']
  /**
   * When ``true``, the 3D viewer and inspector suppress under-constrained
   * marker bodies (``is_flagged === true``).  Default ``false``.
   */
  hideMarkers: UseLithoSolidsResult['hideMarkers']
  /** Toggle the ``hideMarkers`` flag. */
  setHideMarkers: UseLithoSolidsResult['setHideMarkers']
  /**
   * Re-fetch the active litho model's contacts from the server.
   * Called after a manual contact create (handleManualLithoUnitCreate)
   * so the section view shows the new contact immediately — without
   * this the contact lands in the DB but local lithoContacts stays
   * stale and the user sees "nothing happened" (dogfeed bug 2026-05-20).
   * No-op when no litho model is active.
   */
  refetchLithoContacts: () => void
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
  refetchFormations: () => Promise<void>
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
    /** Which depth dimension to update. ``'top'`` (default) writes
     *  ``depth_top_m``; ``'base'`` writes ``depth_base_m``.
     *  Used when an absorb/collapse extends an accepted layer's BASE —
     *  passing ``'top'`` in that case would move the wrong boundary. */
    field?: 'top' | 'base',
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
  /** Mark the project dirty after a geology mutation (#160). Re-exported from
   *  the injected coordinator dep so bus consumers (SectionsCanvas) can flag
   *  section-local mutations — correlation create/delete, lens-shape edits —
   *  that don't go through this hook's own handlers. */
  markMutated: () => void
  /** Bump the correlation-edges refetch nonce (#163c). Re-exported from the
   *  injected coordinator dep so bus consumers (the Sections toolbar) can force
   *  ``SectionsCanvas`` to re-list its correlation edges + bodies after a
   *  body-level mutation that doesn't flow through this hook (e.g. an
   *  Accept-correlations run that re-detects lenses server-side). Optional only
   *  so the many hand-rolled
   *  geoModel test mocks need not supply it — the real hook always returns it;
   *  call sites guard with ``?.()``. */
  requestCorrelationEdgesRefetch?: () => void
  /** Break the litho↔geo coupling on a single lithostratigraphic contact.
   *
   * Nulls ``parent_geo_contact_id`` — does NOT move/delete either contact or
   * rebuild surfaces (geometry is unchanged; only the coupling label is cleared).
   * Refetches litho contacts after the server commits so the glyph disappears.
   */
  handleUnlinkLithoFromGeo: (contactId: string) => Promise<void>
  /** Establish a litho↔geo coupling on a single uncoupled lithostratigraphic contact.
   *
   * Sets ``parent_geo_contact_id`` to the nearest geological contact within
   * the snap tolerance and snaps geo→litho depth.  Shows a toast and skips the
   * refetch when no geological contact is within range (server returns null).
   * Refetches litho contacts after the server commits so the glyph appears.
   */
  handleLinkLithoToGeo: (contactId: string) => Promise<void>
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
  handleDedupeContacts: () => Promise<number>
  handleRebuildSurfaces: () => Promise<void>
  handleExportModelPlaxis3d: () => Promise<void>
  handleToggleBoreholeInModel: (boreholeId: string, included: boolean) => Promise<void>
  /** Include ("Include again") or exclude a borehole in the active LITHO model
   *  (debt #65). Mirror of ``handleToggleBoreholeInModel`` for the litho
   *  model. */
  handleToggleBoreholeInLithoModel: (boreholeId: string, included: boolean) => Promise<void>
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
  // Fill-from-boreholes: apply the curated selection.
  // Calls auto-populate with the selected stable keys; the server creates only
  // those formations, and — in ``overwrite`` mode ONLY — deletes the ones whose
  // stable key is not in the set. ``mode`` defaults to the additive, harmless
  // half; the destructive half is gated by the GeologyToolbar prompt.
  // ``manualMap`` is the SAME map that was used for the last preview call —
  // never re-discovered between dialog confirm and the apply call, preserving
  // the discover ≡ apply invariant the backend enforces.
  applyBoreholeFormationSelection: (
    selectedKeys: ReadonlySet<string>,
    boreholeIds: readonly string[],
    manualMap?: Record<string, string>,
    mode?: AutoPopulateMode,
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
  //
  // Phase 2 of debt #77 (2026-05-21): the bus interface is a single
  // ``ghostsByAnchor`` Map + ``focusedSuggestAnchorId`` flag.
  // Consumers compute the "focused single" entry and the "bulk
  // subset" themselves — see SectionsCanvas's lithoGhostState +
  // bulkLithoGhostState build sites for the canonical derivation.
  // -------------------------------------------------------------------------
  /**
   * Every anchor with an active ghost — single-anchor focus + bulk
   * fan-out share this Map. The entry at ``focusedSuggestAnchorId``
   * is the "single focus" target; every other entry is part of the
   * bulk set. Empty Map = no active suggestion of any kind.
   */
  ghostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
  /**
   * Replace the whole ghost workspace.
   *
   * Exposed for crash recovery ONLY (docs/design/autosave-recovery.md §2,
   * item 2): the ghost store is the one at-risk item with no API traffic
   * until Accept, so restoring it means writing the decoded Map back
   * wholesale. Every in-session gesture goes through the named handlers
   * above — reach for one of those, not for this.
   */
  setGhostsByAnchor: (ghosts: ReadonlyMap<string, BulkAnchorGhost>) => void
  /**
   * The anchor id currently in focus mode (single Suggest target), or
   * null when no focus is set. ``handleSuggestLitho`` flips this;
   * ``clearLithoSuggestions`` clears it; ``handleSuggestAllLitho``
   * leaves it alone.
   */
  focusedSuggestAnchorId: string | null
  /**
   * Apply a depth edit to one suggestion under the focused anchor.
   * Partial: pass any subset of ``{ depth_top_m, depth_base_m,
   * suggested_lithology, suggested_admixtures }``. Composes with
   * prior edits on the same idx.
   */
  handleEditLithoSuggestion: (
    idx: number,
    edit: LithoSuggestionEdit,
  ) => void
  /** Whether a single-anchor suggestion fetch is in flight. */
  lithoSuggesting: boolean
  /** Whether a bulk-suggest fetch is in flight. */
  bulkLithoSuggesting: boolean
  /**
   * Bulk-suggest: fan out the segmenter across N investigations.
   * Replaces any prior bulk state. Per-anchor results stream into
   * ``bulkLithoGhosts`` as they arrive; partial state visible mid-flight.
   *
   * Parameters
   * ----------
   * anchors : array
   *     List of (kind, id) tuples to suggest for.
   */
  handleSuggestAllLitho: (
    anchors: readonly {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[],
  ) => Promise<void>
  /**
   * Accept one suggestion layer for one bulk-anchor. Mirrors
   * ``handleAcceptLithoSuggestion`` but anchor-scoped via the
   * ``anchorId`` arg (bulk has many anchors, not one current).
   */
  handleAcceptBulkLitho: (
    anchorId: string,
    idx: number,
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
  /**
   * Accept ALL non-rejected layers across ALL bulk anchors. Calls
   * the segmenter accept endpoint once per anchor (sequential to
   * keep DB/section update ordering coherent).
   */
  handleAcceptAllBulkLitho: (
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
  /** Mark one bulk anchor's layer rejected (dismissed in the overlay). */
  handleRejectBulkLitho: (anchorId: string, idx: number) => void
  /** Undo a prior bulk reject — restore the layer to pending state (debt #80). */
  handleUnrejectBulkLitho: (anchorId: string, idx: number) => void
  /** Apply a depth edit to one bulk anchor's layer (drag-resize). */
  handleEditBulkLitho: (
    anchorId: string,
    idx: number,
    edit: LithoSuggestionEdit,
  ) => void
  /**
   * Debt #85: insert a new pending litho layer at the shared boundary
   * between ``afterIdx`` and ``afterIdx+1`` for ``anchorId``. The new
   * layer arrives as a 10 cm sentinel — the user resizes after via
   * the standard drag handles. Accepted / rejected / edits indices
   * shift by +1 above the insertion point; the lower neighbour's
   * ``depth_top`` is auto-edited to the new sentinel boundary so the
   * three layers stay geometrically consistent.
   */
  handleInsertLithoLayer: (
    anchorId: string,
    afterIdx: number,
    composition: {
      suggested_lithology: string
      suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
    },
  ) => void
  /**
   * Debt #98: split a pending litho ghost layer in two at its midpoint.
   * Wired to the per-layer right-click "Split layer" menu item. Both
   * halves inherit the original layer's effective composition; the user
   * drag-resizes the new shared boundary and edits whichever half differs.
   * Accepted / rejected / edits indices above the split shift by +1.
   */
  handleSplitLithoLayer: (anchorId: string, idx: number) => void
  /**
   * Debt #102: merge two adjacent same-lithology pending litho ghost
   * layers into one. Wired to the boundary right-click "Merge layers"
   * menu item — only offered when both neighbours are pending AND
   * share the same effective lithology. User-initiated by design;
   * reconciles with the no-auto-merge directive (#74 history).
   */
  handleMergeLithoLayers: (anchorId: string, upperIdx: number) => void
  /**
   * Dogfeed 2026-05-25 — Shift+drag absorb gesture. Fires when the
   * user releases a Shift-dragged edge past the pending neighbour's
   * midpoint. The dragger's depth extends to cover the absorbed
   * neighbour; the neighbour is removed from the ghost; the dragger's
   * composition is preserved unchanged.
   */
  handleAbsorbLithoLayer: (
    anchorId: string,
    draggerIdx: number,
    direction: 'up' | 'down',
  ) => void
  /**
   * Left-click on the LITHO axis creates a zero-thickness ghost layer
   * at ``depth_m`` instead of a committed contact.  The ghost is appended
   * to ``ghostsByAnchor[anchorId]`` (creating the entry when absent) and
   * ``focusedSuggestAnchorId`` is set so the overlay renders immediately.
   *
   * The user extends the sentinel to a real range via the "Extend to
   * nearest contacts" right-click menu item.  The ghost is then accepted
   * via the standard Accept flow — no separate commit path needed.
   *
   * Parameters
   * ----------
   * anchorKind
   *     ``'cpt'`` or ``'borehole'``.
   * anchorId
   *     Id of the investigation.
   * surfaceElevationM
   *     Surface elevation in mTAW for the investigation.
   * depth_m
   *     Click depth below surface in metres.
   * formationId
   *     Formation chosen in the picker — used to look up
   *     ``litho_main_soil_code`` and ``litho_admixtures`` from the active
   *     litho formation list.
   */
  handleCreateManualLithoGhost: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    surfaceElevationM: number | null,
    depth_m: number,
    formationId: string,
  ) => void
  /**
   * Extend ghost layer at ``(anchorId, idx)`` to span between the
   * nearest committed litho contacts above and below its midpoint.
   * Returns ``{ ok: true }`` on success or ``{ ok: false, reason }``
   * when the extension would overlap another ghost suggestion.
   *
   * Parameters
   * ----------
   * anchorId
   *     Anchor whose ghost is being extended.
   * idx
   *     Index of the ghost layer to extend.
   * investigationMaxDepthM
   *     Maximum depth of the investigation — used as fallback bottom
   *     when no committed contact exists below.
   */
  handleExtendLithoGhostToNearestContacts: (
    anchorId: string,
    idx: number,
    investigationMaxDepthM: number,
  ) => { ok: boolean; reason?: string }
  /** Clear ALL bulk ghosts (used by the toolbar Clear button + on suggest-all). */
  clearBulkLithoGhosts: () => void
  /**
   * Strip admixtures from ghost suggestions, scoped by anchor kind
   * ('cpt' / 'borehole' / 'all'). Edits the ephemeral ghost map only —
   * accept commits whatever the ghost is showing.
   */
  handleStripLithoAdmixtures: (scope: 'cpt' | 'borehole' | 'all') => void
  /**
   * Reseed admixtures on borehole ghost suggestions — drops the
   * admixture override so the layers revert to the segmenter's raw
   * (ObservationLayer-derived) admixtures.
   */
  handleReseedLithoAdmixtures: () => void
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
   * Accept suggestion layer ``idx`` via the bulk endpoint (one-item call).
   * The server handles formation find-or-create + section seeding atomically.
   * Marks the layer accepted on success.
   *
   * Parameters
   * ----------
   * idx : number
   *     Index into ``lithoSuggestions`` to commit.
   * sectionId : string | null | undefined
   *     When provided, the contact is seeded into this section's
   *     explicit-content set (``#57`` invariant).
   * onSectionUpdated : function | undefined
   *     Callback forwarded with ``updated_section`` from the response so
   *     the section filter updates without a manual refresh.
   */
  handleAcceptLithoSuggestion: (
    idx: number,
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<AcceptLithoSuggestionsResponse | null>
  /**
   * Accept ALL non-rejected suggestion layers in one bulk endpoint call.
   * Idempotent — already-committed layers are found and re-used by the
   * server.  Marks every committed layer accepted on success.
   *
   * Parameters
   * ----------
   * sectionId : string | null | undefined
   *     When provided, created contacts are seeded into this section.
   * onSectionUpdated : function | undefined
   *     Forwarded with ``updated_section`` from the bulk response.
   */
  handleAcceptAllLithoSuggestions: (
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
  /** Reject suggestion layer ``idx`` — marks it rejected (no network call). */
  handleRejectLithoSuggestion: (idx: number) => void
  /** Undo a prior reject — restore the layer to pending state (debt #80). */
  handleUnrejectLithoSuggestion: (idx: number) => void
  /** Clear all suggestion state (close the ghost overlay). */
  clearLithoSuggestions: () => void

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
  /**
   * Clear ALL content from the active lithostratigraphic model (debt #94
   * fix — originally "wipe contacts", extended to also remove correlation
   * edges, TIN surfaces, and orphan litho formations).
   *
   * Makes persisted litho state fully recoverable — the user encounters
   * orphan litho units / criss-cross lines from a prior session and can
   * wipe the slate clean.  Irreversible; the caller must present a confirm
   * dialog before invoking this handler.
   *
   * On success: refetches litho contacts, formations, and surfaces so the
   * inspector roster and 3D viewer both update without a page reload.
   * Toasts a summary on success, toasts error on failure.
   * No-op when no litho model is active.
   *
   * Returns
   * -------
   * Promise<void>
   */
  handleClearLithoModel: () => Promise<void>
  /**
   * Run the auto-correlate algorithm across the active lithostratigraphic
   * model (#127).  Inserts net-new ``source='auto'`` edges, re-runs the
   * ordinal resolver, triggers inference per formation — all server-side
   * in one transaction.  Idempotent; toasts a summary on completion.
   *
   * Returns
   * -------
   * Promise<void>
   */
  handleAutoCorrelate: (sectionId?: string | null) => Promise<void>
  /**
   * Clear all unapproved (auto) correlation suggestions for the active litho
   * model without re-running auto-correlate (#179). Keeps approved manual
   * correlations. Reversible via Auto-correlate.
   */
  handleClearSuggestions: () => Promise<void>
  /**
   * Pinch-out lens candidates from the last auto-correlate run (auto-lens):
   * crossings that were dropped from persistence and surfaced as lenses.
   * Rendered as amber lens-candidate markers on the section.
   */
  lithoCrossingPinchOuts: CrossingPinchOut[]
  // -------------------------------------------------------------------------
  // Geotechnical model parallel set (F2 — geotech data layer).
  //
  // Mirrors the litho parallel set above.  Loaded from the active
  // kind='geotechnical' sibling; independent of the geological and litho
  // contact sets so mutations in one set never invalidate the others.
  // Cleared when activeGeotechModel is null (no geotech model yet).
  // -------------------------------------------------------------------------
  /**
   * The active ``kind='geotechnical'`` model for the project, or ``null``
   * when none exists yet.  Populated by ``refreshModels`` alongside
   * ``activeLithoModel``.
   */
  activeGeotechModel: GeologicalModelResponse | null
  /**
   * Accepted geotech layers for the active model — the source of truth
   * for the geotechnical axis render.  Mirrors ``lithoLayers``.
   */
  geotechLayers: LithoLayerResponse[]
  /**
   * Whether ``geotechLayers`` currently reflects the server.
   *
   * ``false`` while a load is in flight and after a failed one — the effect
   * below clears the array to ``[]`` before every refetch and swallows a
   * failure to ``[]`` as well, so an empty array on its own cannot be read as
   * "nothing is committed". Consumers that would draw a conclusion from
   * emptiness (the borehole packing-preview ghosts) must check this first.
   */
  geotechLayersLoaded: boolean
  /**
   * Monotonic counter, incremented once per SUCCESSFUL geotech-layer load.
   *
   * The invalidation key for anything derived from the committed geotech rows
   * by a separate server call — the borehole packing preview keys its refetch
   * on it. A counter rather than the array itself precisely because the array
   * gets a new identity twice per mutation (cleared, then filled), which made
   * the preview re-run the whole planner twice per Divide.
   */
  geotechLayersVersion: number
  /**
   * Boundary-centric projection of ``geotechLayers``.  Mirrors
   * ``lithoContacts`` — derived via ``lithoLayersToContacts`` so legacy
   * consumers that operate on the contact shape keep working unchanged.
   */
  geotechContacts: FormationContactResponse[]
  /**
   * Geotech NAD-class unit vocabulary for the active project.  Derived
   * from the global ``formations`` list filtered by ``isGeotechUnit``
   * (``nad_class !== null``).  Mirrors ``lithoFormations``.
   */
  geotechFormations: GeologicalFormationResponse[]
  /**
   * Ids of the CPT columns whose packing bands no longer fit their litho units.
   *
   * A band's contract is that it lies inside the litho unit ``Subdivide`` cut it
   * out of. Dragging that unit's contact — which the geotech axis now allows —
   * moves the litho row and leaves the band where it was, describing ground the
   * unit no longer covers. Those columns need ``Subdivide CPTs`` run again.
   *
   * DERIVED on every render from ``geotechLayers`` + ``lithoLayers``, never
   * stored: the comparison cannot outlive its operands, so dragging the contact
   * back empties this list with nothing to reset (owner ruling — two shipped
   * bugs came from caching a staleness flag that could never clear).
   *
   * CPT columns only. A borehole's bands are re-derived by ``Divide
   * boreholes``, not by ``Subdivide CPTs``; see
   * ``utils/geotechBandParents``.
   */
  columnsNeedingRederive: string[]
  /**
   * Request a re-fetch of the geotech layers for the active model.
   *
   * Bumps an internal nonce so the ``geotechLayers`` useEffect re-runs and
   * reloads the list from the server.  Call after a packing-correlation
   * mutation so the updated ``body_id`` stamps appear in the render without
   * the user having to switch models (mirrors the
   * ``requestCorrelationEdgesRefetch`` pattern for the litho edge state).
   *
   * No-op when no geotech model is active (the effect already clears the
   * list to ``[]`` in that case).
   */
  requestGeotechLayersRefetch: () => void
  /**
   * Run "Subdivide all bodies" model-wide.
   *
   * Calls ``POST .../geotech/subdivide-all-bodies`` with the active litho
   * model id.  The operation is model-wide: geotech layers are written once
   * per investigation, edges are derived per-section from the litho model's
   * approved edges.  On success the geotechnical model is re-derived
   * (``refreshModels``) so ``activeGeotechModel`` becomes non-null, the
   * geotech layer list refetches, the formations list refreshes so NAD-class
   * units appear, and the project is marked dirty.
   *
   * Guards: requires an active project and an active litho model.  Returns
   * early (with an error toast) when any guard fails.
   *
   * Returns
   * -------
   * Promise<void>
   */
  handleSubdivideAllBodies: (options?: {
    deriveEdges?: boolean
    /**
     * Restrict the rebuild to one section's columns (owner ruling 2026-08-15);
     * ``null`` / omitted is the all-sections press. Off-section
     * investigations are excluded in both modes.
     */
    sectionId?: string | null
    /**
     * Create the geotech model under this representative-qc statistic — the
     * choice the engineer made before there was a model to store it on (owner
     * ruling 2026-08-15). Honoured by the backend only on the call that
     * CREATES the model; a re-run keeps the model's own choice, which
     * ``POST .../geotech/statistic`` remains the only way to change.
     */
    representativeStatistic?: string | null
    /**
     * True = the historic rebuild (statistic re-run / re-derive tags).
     * Otherwise the press imports already-banded columns as-is (owner ruling
     * 2026-08-18 — the first subdivision wins).
     */
    rebuildExisting?: boolean
  }) => Promise<void>
  /**
   * TIN-divide borehole columns using CPT packing-transition surfaces.
   *
   * Must be called after ``handleSubdivideAllBodies`` so CPT geotech layers
   * already exist.  Idempotent: prior borehole bands are replaced.
   *
   * ``boreholeIds`` scopes the run to a subset — the ghost-accept gesture
   * divides ONE column. Omitting it divides every borehole in scope; an empty
   * array is refused rather than sent, because "divide none" is never what a
   * click means.  ``sectionId`` scopes it to one cross-section (owner ruling
   * 2026-08-15), which is what the toolbar's step 4 sends.  The backend
   * refuses the call outright while packing ties in that scope are still
   * proposed (``geotech_ties_pending``), and its message is surfaced verbatim.
   *
   * Returns
   * -------
   * Promise<void>
   */
  handleDivideBoreholes: (options?: {
    boreholeIds?: readonly string[]
    sectionId?: string | null
    /**
     * The section's 2-D partition, keyed by section id — the geometry each
     * borehole column is read off (owner ruling 2026-08-15). Omitted when the
     * caller could not assemble it; the backend then answers with the donor
     * rule exactly as before.
     */
    sectionPartitions?: Record<string, unknown> | null
    /** First subdivision wins: import already-divided boreholes as-is. */
    skipExisting?: boolean
  }) => Promise<void>
  /**
   * Persist the engineer's NAD-family answer for admixture-ambiguous litho
   * units (owner ruling 2026-09-04). PATCHes ``nad_admixture_choice`` on each
   * formation and updates the local ``formations`` state so the geotech
   * pre-flight's derived "needs an answer" list reflects the new choices
   * immediately. Used by the pre-flight admixture prompt and (change-my-answer)
   * the geotech inspector.
   *
   * Parameters
   * ----------
   * entries : readonly {formationId, choice}[]
   *     The units answered this round and the family chosen for each.
   *
   * Returns
   * -------
   * Promise<void>
   *
   * Optional so the many hand-rolled ShellContext stubs need not set it (mirrors
   * ``startGeotechBuild?``); the real hook always returns it.
   */
  handleSetNadAdmixtureChoices?: (
    entries: readonly { formationId: string; choice: NadAdmixtureChoice }[],
  ) => Promise<void>
  // ---- Geotech body solids (second useLithoSolids on the geotech model) ----
  // A parallel ``useLithoSolids`` instance pointed at the GEOTECH model.  The
  // hook is model-agnostic (the voxel builder parameterises on ``model_id``),
  // so the geotech 3D body solids reuse the same fetch / build / colour
  // machinery as the litho ones.  Keys are renamed (``geotech*``) so both 3D
  // surfaces coexist on the bus alongside the litho solids spread above.
  /** All built body solids for the active geotech model. */
  geotechSolids: UseLithoSolidsResult['lithoSolids']
  /** True while the initial geotech-solids fetch is in flight. */
  geotechSolidsLoading: UseLithoSolidsResult['lithoSolidsLoading']
  /** True while a geotech-solids rebuild is in progress. */
  geotechSolidsBuilding: UseLithoSolidsResult['lithoSolidsBuilding']
  /** True when at least one geotech solid has triangles. */
  hasGeotechSolids: UseLithoSolidsResult['hasLithoSolids']
  /** True when any geotech solid has ``is_stale === true``. */
  hasStaleGeotechSolid: UseLithoSolidsResult['hasStaleLithoSolid']
  /** Build / rebuild solids for the active geotech model, toast the result. */
  buildGeotechSolids: UseLithoSolidsResult['buildLithoSolids']
  /**
   * Build the geotech model via a background job with phase + per-column progress
   * and a cancel (debt #282) — the same streaming machinery the litho Build uses,
   * pointed at the geotech model. The geotech Build press (via the pre-flight)
   * routes here; the toolbar shows inline progress + Cancel while it runs.
   *
   * Optional so the many hand-rolled ShellContext stubs need not set it (mirrors
   * ``geotechBodyRosterRefetchNonce?``); the real hook always returns it, and the
   * pre-flight falls back to ``buildGeotechSolids`` when a stub omits it.
   */
  startGeotechBuild?: UseLithoSolidsResult['startLithoBuild']
  /** Ask the running streaming geotech build to stop; the model is left unchanged. */
  cancelGeotechBuild?: UseLithoSolidsResult['cancelLithoBuild']
  /** Live state of the streaming geotech build (idle/running/done/cancelled/error). */
  geotechVoxelBuildState?: UseLithoSolidsResult['voxelBuildState']
  /**
   * Bumps when a geotech ``buildGeotechSolids`` press completes — the units
   * pane's geotech body roster keys on it to RE-READ (not recompute) the
   * healed litho parent links (debt #278 dogfeed 2026-09-01).
   *
   * The Build heals ``body.parent_litho_body_id`` server-side, but the roster
   * (``useModelBodies``) only re-fetched on a body-recompute nonce, which the
   * Build never bumps — so the tree kept the pre-Build bodies (NULL parents) and
   * grouped them all under "no litho body" until a manual reload. Optional so the
   * many ShellContext stubs need not set it (mirrors ``requestCorrelationEdgesRefetch``).
   */
  geotechBodyRosterRefetchNonce?: number
  /** Set or clear a per-body display colour on the geotech model. */
  setGeotechBodyColor: UseLithoSolidsResult['setBodyColor']
  /**
   * Columns whose litho stack moved after their packing bands were made (#266).
   *
   * Sorted by label so the toolbar and the section overlay name them the same
   * way twice running.
   */
  staleLithoGeotechColumns: UseGeotechLithoStalenessResult['staleColumns']
  /** Investigation ids of those columns — the section overlay's membership test. */
  staleLithoGeotechColumnIds: UseGeotechLithoStalenessResult['staleColumnIds']
  /** How many columns are stale — the toolbar chip's count. */
  staleLithoGeotechColumnCount: UseGeotechLithoStalenessResult['staleColumnCount']
  /**
   * Banded columns with no record of what litho they came from.
   *
   * NOT stale (unknown provenance is not evidence of a move); carried so the
   * coming export-completeness guard can tell "verified" from "cannot say".
   */
  unstampedGeotechColumnCount: UseGeotechLithoStalenessResult['unstampedColumnCount']
  /** Force a staleness re-read — after a press that should have cleared columns. */
  refreshGeotechLithoStaleness: UseGeotechLithoStalenessResult['refresh']
  /** When ``true``, the geotech 3D viewer + inspector suppress flagged bodies. */
  geotechHideMarkers: UseLithoSolidsResult['hideMarkers']
  /** Toggle the geotech ``hideMarkers`` flag. */
  setGeotechHideMarkers: UseLithoSolidsResult['setHideMarkers']
  /**
   * The seven-clause gapless gate for the geotech model's last build — the
   * report banner's whole input. ``null`` means no verdict, which the banner
   * shows as such rather than as a pass.
   */
  geotechGaplessReport: UseLithoSolidsResult['gaplessReport']
}

/**
 * Index a surfaces list by ``formation_id`` — the fold every surface
 * setter in this hook applies before caching (last surface per
 * formation wins, matching the API's one-surface-per-formation shape).
 *
 * @param surfs - Surfaces as returned by ``api.geology.listSurfaces``.
 * @returns Map of ``formation_id`` → surface.
 */
function indexSurfacesByFormationId(
  surfs: readonly FormationSurfaceResponse[],
): Map<string, FormationSurfaceResponse> {
  const sm = new Map<string, FormationSurfaceResponse>()
  for (const s of surfs) sm.set(s.formation_id, s)
  return sm
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
 * requestCorrelationEdgesRefetch
 *     Coordinator signal fired after a successful ``handleAutoCorrelate``
 *     so the Sections canvas refetches its contact-correlation edges
 *     (#163c) — the edge state lives there, not in this hook.
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
  clearUndo,
  addToManifest,
  removeFromManifest,
  addToSessionImports,
  removeFromSessionImports,
  manifestFormationIds,
  currentLumping,
  stageLumping,
  requestCorrelationEdgesRefetch,
  requestBodyRecompute,
  markMutated,
}: {
  project: ProjectResponse | null
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  /**
   * Clear the section undo stack. A re-subdivide deletes and rewrites every
   * geotech row, so the band UUIDs the stack's commands hold stop meaning
   * anything — the first stale Ctrl+Z used to 422 and the failure handler then
   * discarded the WHOLE history, litho entries included (audit F23). Optional
   * so callers without a stack (tests, secondary shells) need not thread one.
   */
  clearUndo?: () => void
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
  /**
   * Coordinator signal that tells the Sections canvas to refetch its
   * contact-correlation edges (#163c). ``handleAutoCorrelate`` persists
   * edges server-side but the edge state lives in ``SectionsCanvas`` — a
   * sibling of the toolbar that fires auto-correlate — so the handler
   * cannot refetch it directly. Bumping this nonce after a successful
   * auto-correlate makes the overlay refresh without a manual reload.
   */
  requestCorrelationEdgesRefetch: () => void
  /**
   * Coordinator signal that schedules the body-identity recompute for the
   * mutated model axis (slice 5). Optional so the many hand-rolled geoModel
   * test mocks need not supply it; call sites guard with ``?.()``.
   */
  requestBodyRecompute?: (kind: 'litho' | 'geotech') => void
  /**
   * Coordinator signal that marks the project dirty after a geology
   * MUTATION (a depth drag, a delete, a batch depth change) — changes to
   * pre-existing rows that don't flow through ``addToSessionImports`` (#160).
   * Without it those edits never flip the dirty flag, so the close prompt
   * doesn't fire and they silently persist past a close-without-save.
   * Decoupled from the session-import delete-manifest: a mutated row must
   * NOT be deleted on discard — the replace-restore reverts it instead.
   */
  markMutated: () => void
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
  // Auto-lens (2026-06-02): pinch-out lens candidates returned by the last
  // auto-correlate run (crossings dropped from persistence). Rendered as amber
  // lens-candidate markers on the section; cleared on model switch + on a
  // fresh correlate that finds none.
  const [lithoCrossingPinchOuts, setLithoCrossingPinchOuts] = useState<CrossingPinchOut[]>([])
  // Litho parallel state (slice 2, #55). Independent of the geological
  // contact set — mutations in one set never invalidate the other.
  // Loaded / cleared by a useEffect that watches activeLithoModel.
  // A5 — single source of truth on the litho axis: `lithoLayers` is
  // the only state slice; `lithoContacts` is a derived memo that
  // projects the layer rows onto the FormationContact shape so legacy
  // consumers (renderers, inspectors that still think boundary-centric)
  // keep working unchanged. The dual-state era ended with A4 — every
  // FE writer hits /layers/* endpoints, and the LL→FC trigger feeds
  // the database mirror for legacy /contacts readers.
  //
  // Both arrays carry the SAME UUIDs (A2.5 backfill preserved them
  // end-to-end), so litho_correlation_edge / seeded_formation_contact_ids
  // / parent_geo_contact_id all continue to resolve in either shape.
  //
  // Consumers can migrate from `lithoContacts` to `lithoLayers` at
  // their own pace — there is no longer any state-coherence risk.
  const [lithoLayers, setLithoLayers] = useState<LithoLayerResponse[]>([])
  const lithoContacts = useMemo<FormationContactResponse[]>(
    () => lithoLayersToContacts(lithoLayers),
    [lithoLayers],
  )
  // lithoFormations was a separate useState until debt #89 — that dual
  // atom caused the staleness class behind debt #88 (one half refreshed
  // after accept, the other didn't). Now a useMemo over the global
  // ``formations`` state filtered by ``isLithoUnit``: every refetch of
  // ``formations`` implicitly updates ``lithoFormations`` for free, so
  // the bug class can't recur. The useMemo declaration lives further
  // down — has to follow the ``formations`` useState.
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
  // Litho units derived from the global formation list (debt #89).
  // Every refetch of ``formations`` updates this implicitly — the
  // bug class behind debt #88 (one atom refreshed while the other
  // didn't) cannot recur. ``isLithoUnit`` checks litho_main_soil_code
  // (the unconditionally-set Phase-1 column) instead of the legacy
  // ``lithology`` field that the accept-suggestion path doesn't set.
  const lithoFormations = useMemo(
    () => formations.filter(isLithoUnit),
    [formations],
  )
  // Geotech parallel state (F2 — geotech data layer).  Mirrors the litho
  // parallel state block above.  The active geotechnical model pointer is
  // set by ``refreshModels``; geotechLayers is loaded by a dedicated
  // useEffect keyed on activeGeotechModel.  geotechContacts + geotechFormations
  // derive from geotechLayers / formations respectively (same useMemo
  // pattern as lithoContacts / lithoFormations so bug class #88 cannot
  // recur here either).
  const [activeGeotechModel, setActiveGeotechModel] =
    useState<GeologicalModelResponse | null>(null)
  const [geotechLayers, setGeotechLayers] = useState<LithoLayerResponse[]>([])
  // Whether the array above reflects the server, and a counter that ticks once
  // per successful load. Both exist because the load effect clears the array to
  // [] before refetching AND on failure: without these, "[]" is ambiguous
  // between "nothing is committed" and "we do not know yet", and consumers were
  // reading the first meaning while the second was true.
  const [geotechLayersLoaded, setGeotechLayersLoaded] = useState(false)
  const [geotechLayersVersion, setGeotechLayersVersion] = useState(0)
  // Bumped whenever the litho layer stack is re-read. Feeds the litho solids'
  // ``refreshOn`` so a geometry change reaches the Build badge. A COUNTER rather than
  // the array's identity: identity depends on the transport handing back a fresh array,
  // which is true of a real fetch and not of a cache or a stub — the signal has to be
  // something the code states, not something a layer below happens to do.
  const [lithoLayersVersion, setLithoLayersVersion] = useState(0)
  // Which model the current geotechLayers rows belong to — the load effect
  // clears eagerly only when this identity changes, so a same-model refetch
  // (every band edit) keeps the last rows visible instead of blinking the fill.
  const geotechLoadedModelIdRef = useRef<string | null>(null)
  // Which model the current lithoLayers rows belong to — same guard as the
  // geotech twin above. The litho bootstrap effect keys on the active litho
  // MODEL OBJECT, whose identity churns on every refreshModels / project
  // view-state autosave even when the id is unchanged; without this ref the
  // effect blanked lithoLayers to [] on every such churn, and a refetch that
  // then failed or was cancelled under a correlate / delete-storm burst left
  // the whole accepted-litho section permanently empty (installer #21 PROD
  // BLOCKER, owner 2026-09-06: "the lithos disappeared from the columns").
  const lithoLoadedModelIdRef = useRef<string | null>(null)
  const geotechContacts = useMemo<FormationContactResponse[]>(
    () => lithoLayersToContacts(geotechLayers),
    [geotechLayers],
  )
  // Geotech NAD-class units derived from the global formation list.
  // Every refetch of ``formations`` updates this implicitly — same
  // anti-debt-#88 reasoning as lithoFormations above.
  const geotechFormations = useMemo(
    () => formations.filter(isGeotechUnit),
    [formations],
  )
  // Which columns' packing bands no longer fit the litho units they subdivide.
  // The engineer can drag a litho contact from the geotech axis itself, which
  // moves the litho row and leaves the bands derived against the old boundary
  // where they were. That mismatch IS the staleness — DERIVED here from the two
  // live layer sets, never stored (owner ruling), so it self-clears the moment
  // the contact is dragged back and cannot outlive the condition it describes.
  const columnsNeedingRederive = useMemo(
    () =>
      columnsNeedingRederiveFromFit(
        pairBandsWithLithoParents(geotechLayers, lithoLayers, geotechFormations),
      ),
    [geotechLayers, lithoLayers, geotechFormations],
  )
  // Monotonic nonce that forces the geotechLayers useEffect to re-run
  // after a packing-correlation mutation so body_id stamps update in the
  // render without a model switch (mirrors correlationEdgesRefetchNonce).
  const [geotechLayersRefetchNonce, setGeotechLayersRefetchNonce] = useState(0)
  const requestGeotechLayersRefetch = useCallback(
    () => setGeotechLayersRefetchNonce(n => n + 1),
    [],
  )
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
      setActiveGeotechModel(null)
      return []
    }
    const ms = await api.geology.listModels(project.id)
    setModels(ms)
    setActiveLithoModel(
      ms.find(m => m.is_active && m.kind === 'lithostratigraphic') ?? null,
    )
    setActiveGeotechModel(
      ms.find(m => m.is_active && m.kind === 'geotechnical') ?? null,
    )
    return ms
  }, [project])

  // Shared in-flight guard: if a list→adopt→create-Default operation
  // is already running (bootstrap or ensureActiveGeologicalModel),
  // any second caller awaits the SAME promise instead of issuing a
  // concurrent createModel call. Cleared when the promise settles so
  // a later legitimate ensure (e.g. after handleDeleteModel) works.
  // resolveActiveModel throws on failure (never returns null), so the
  // ref's promise type is non-null. The `... | null` on the OUTER ref
  // is the "no fetch in flight" sentinel, NOT the promise's resolve
  // type — that was the bug behind the two TS18047 'active' possibly
  // null errors the gate flagged.
  const ensureModelPromiseRef = useRef<Promise<GeologicalModelResponse> | null>(null)

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
        setSurfacesByFormationId(indexSurfacesByFormationId(surfs))
        // #55: populate the model list + active-litho pointer for the
        // picker. Non-fatal, and now ACTUALLY non-fatal: the old comment
        // claimed the outer catch would leave the resolved geological
        // state alone, but the catch wipes activeGeologicalModel +
        // formations + contacts + surfaces — so one flaky picker fetch
        // blanked the whole geology stage ("the units are gone and the
        // model is gone too", owner dogfeed 2026-08-03) until the project
        // was closed and reopened. Isolate it: the picker stays empty on
        // failure, the geological flow keeps what it already loaded.
        try {
          await refreshModels()
        } catch (refreshErr) {
          log.warn(
            'geology',
            `model-picker refresh failed for ${project.id} — geological state kept`,
            refreshErr,
          )
        }
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
          toast('error', t('geology.loadFailed'))
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
  // shared refresh counter — mutations go through setLithoLayers
  // optimistically + refetch, never through setContacts.
  useEffect(() => {
    if (!project || !activeLithoModel) {
      lithoLoadedModelIdRef.current = null
      setLithoLayers([])
      setLithoSurfacesByFormationId(new Map())
      setGhostsByAnchor(new Map())
      setFocusedSuggestAnchorId(null)
      return
    }
    // Same-id guard (mirrors the geotech twin's geotechLoadedModelIdRef): the
    // effect keys on the active litho MODEL OBJECT, and refreshModels /
    // view-state autosaves hand back a new-but-same object every burst, so this
    // effect re-runs constantly with the id unchanged. Only a REAL model-id
    // change may clear the section eagerly.
    const modelChanged = lithoLoadedModelIdRef.current !== activeLithoModel.id
    if (modelChanged) {
      // Debt #147 — clear stale state IMMEDIATELY on a real model change (e.g.
      // delete model + create new in quick succession), BEFORE the new fetch
      // resolves. Without this the inspector and the section render the previous
      // model's contacts during the fetch window (the "delete + new → 823
      // contacts reappear" report, dogfeed 2026-05-27). A→B means A's contacts
      // are no longer relevant, period; never show them under B's header. The
      // fetch then populates with B's actual contents (typically 0 for a fresh
      // model).
      //
      // Debt #147 follow-up (2026-05-27): also reset the suggestion-ghost bundle
      // + focused-anchor pointer so a freshly-created model presents a clean
      // canvas (no leftover pending ghosts from the prior model's Suggest
      // sweep). Mirrors the triad ``handleClearLithoModel`` resets.
      //
      // A SAME-model re-run (a refreshModels/view-state churn on the id we
      // already show) deliberately does NOT clear: the last-good rows stay on
      // screen until the fresh answer lands, so a transient re-run can never
      // blank the accepted-litho section (installer #21 PROD BLOCKER).
      setLithoLayers([])
      setLithoSurfacesByFormationId(new Map())
      setGhostsByAnchor(new Map())
      setFocusedSuggestAnchorId(null)
    }
    let cancelled = false
    const projectId = project.id
    const modelId = activeLithoModel.id
    ;(async () => {
      try {
        // A5 — single source of truth: only setLithoLayers fires;
        // lithoContacts re-derives via the useMemo above.
        const [layers, surfs] = await Promise.all([
          api.geology.listLayers(projectId, modelId),
          api.geology.listSurfaces(projectId, modelId),
        ])
        if (cancelled) return
        lithoLoadedModelIdRef.current = modelId
        setLithoLayers(layers)
        setLithoSurfacesByFormationId(indexSurfacesByFormationId(surfs))
        log.debug(
          'geology',
          `litho model ${modelId}: loaded ${layers.length} layers, ${surfs.length} surfaces`,
        )
      } catch (err) {
        if (!cancelled) {
          // Keep the last-good rows on a FAILED fetch — the accepted layers are
          // still in the DB, so blanking them to [] here (as the code did
          // before) turned a transient failure under a correlate / delete-storm
          // burst into a permanently empty section. A real model switch already
          // cleared above; a same-model refetch that fails leaves what was shown.
          log.warn('geology', `litho model ${modelId}: load failed — keeping last-good rows`, err)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project, activeLithoModel])

  // Load / reload geotech layers when the active geotech model changes.
  // Mirrors the litho-layers effect above; clears when activeGeotechModel
  // is null.  No surfaces fetch (geotech model has no TIN surfaces in v1).
  // geotechLayersRefetchNonce: bumped by requestGeotechLayersRefetch after a
  // packing-correlation mutation so body_id stamps re-render without a model
  // switch (same pattern as the edge-refetch nonce in SectionsCanvas).
  useEffect(() => {
    if (!project || !activeGeotechModel) {
      geotechLoadedModelIdRef.current = null
      setGeotechLayers([])
      // No geotech model is a KNOWN state, not an unknown one: there are
      // genuinely no committed geotech rows to have.
      setGeotechLayersLoaded(true)
      return
    }
    if (geotechLoadedModelIdRef.current !== activeGeotechModel.id) {
      // Clear immediately on model change to prevent stale state showing
      // under a different model header (same reasoning as the litho effect).
      // A SAME-model refetch (every committed band edit bumps the nonce) keeps
      // the last committed rows on screen until the fresh answer lands — the
      // clear-then-refill used to blank the unit count for a frame and blink
      // the whole NAD fill off and back on per edit (#227 slice F).
      setGeotechLayers([])
      setGeotechLayersLoaded(false)
    }
    let cancelled = false
    const projectId = project.id
    const modelId = activeGeotechModel.id
    ;(async () => {
      try {
        const layers = await api.geology.listLayers(projectId, modelId)
        if (cancelled) return
        geotechLoadedModelIdRef.current = modelId
        setGeotechLayers(layers)
        setGeotechLayersLoaded(true)
        // Once per SUCCESSFUL load. A failed load leaves the version alone, so
        // consumers keyed on it do not re-run against an answer we never got.
        setGeotechLayersVersion(v => v + 1)
        log.debug(
          'geology',
          `geotech model ${modelId}: loaded ${layers.length} layers`,
        )
      } catch (err) {
        if (!cancelled) {
          log.warn('geology', `geotech model ${modelId}: load failed`, err)
          geotechLoadedModelIdRef.current = null
          setGeotechLayers([])
          // Stays false: [] here means "the load failed", and a consumer that
          // reads it as "nothing is committed" draws the wrong conclusion for
          // as long as the failure lasts.
          setGeotechLayersLoaded(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // reason: geotechLayersRefetchNonce is the only dep beyond project +
    // activeGeotechModel; it is a primitive counter added to force a re-fetch
    // when packing correlations change body_id stamps without switching model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, activeGeotechModel, geotechLayersRefetchNonce])

  const refetchFormations = useCallback((): Promise<void> => {
    if (!project) return Promise.resolve()
    return api.geology
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
        setSurfacesByFormationId(indexSurfacesByFormationId(surfs))
      })
      .catch(err => {
        log.warn('geology', `listSurfaces refetch failed`, err)
      })
  }, [project, activeGeologicalModel])

  // Refetch geological contacts for the active geological model.
  // Needed after a drag-down cross-merge on the geological axis — the BE
  // atomically deleted the dragger + crossed peers, so local state is stale.
  // Uses activeGeologicalModelRef so the dep array stays stable.
  const refetchContacts = useCallback(() => {
    const model = activeGeologicalModelRef.current
    if (!project || !model) return
    void api.geology
      .listContacts(project.id, model.id)
      .then(setContacts)
      .catch(err => {
        log.warn('geology', 'listContacts refetch failed', err)
      })
  }, [project])

  // Refetch litho contacts for the active litho model. Called after
  // handleCreateLithoContact / inline-create mutations (optimistic update
  // + explicit refetch pattern — same as the geological set uses implicitly
  // via the setContacts→useEffect→refetchSurfaces chain). Reads from ref
  // so the dep array is [project] — stable to project identity.
  const refetchLithoContacts = useCallback(() => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    // A5 — refetch /layers (the only source of truth). lithoContacts
    // re-derives via the useMemo above; consumers reading either
    // shape see the new state on the next render.
    void api.geology
      .listLayers(project.id, model.id)
      .then(rows => {
        setLithoLayers(rows)
        setLithoLayersVersion(v => v + 1)
      })
      .catch(err => {
        log.warn('geology', `litho listLayers refetch failed`, err)
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
        setLithoSurfacesByFormationId(indexSurfacesByFormationId(surfs))
      })
      .catch(err => {
        log.warn('geology', `litho listSurfaces refetch failed`, err)
      })
  }, [project])

  // (refetchLithoFormations removed in debt #89 — lithoFormations is now
  // a useMemo over the global ``formations`` state, so ``refetchFormations``
  // alone is sufficient to bring newly-created litho units into view.)

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
        setBackdropSurfacesByFormationId(indexSurfacesByFormationId(surfs))
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
        toast('error', t('geology.createModelFailed'))
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

  // Formation create / update / delete — extracted to useFormationCrud
  // (debt #201 Move 5). A leaf cluster: no other handler calls these, so
  // it lifts out cleanly. Shared state (formations list, manifest,
  // session-imports) stays here and is passed down.
  const {
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    handleInlineCreateFormation,
  } = useFormationCrud({
    project,
    addToManifest,
    removeFromManifest,
    addToSessionImports,
    removeFromSessionImports,
    refetchFormations,
    setFormations,
  })

  // Contact create / update / delete — extracted to useContactCrud
  // (debt #201 Move 5). A leaf cluster (the only intra-cluster call is
  // handleCreateContact -> handleUpdateContactDepth, both now inside the
  // sub-hook); shared state stays here and is passed down. Call site sits
  // below every dependency it consumes (TDZ-checked).
  const {
    handleUpdateContactDepth,
    handleCreateContact,
    handleBatchCreateContacts,
    handleBatchUpdateContacts,
    handleDeleteContact,
    handleUnlinkLithoFromGeo,
    handleLinkLithoToGeo,
  } = useContactCrud({
    project,
    activeGeologicalModel,
    contacts,
    setContacts,
    lithoContacts,
    lithoLayers,
    refetchContacts,
    refetchLithoContacts,
    addToSessionImports,
    pushUndo,
    markMutated,
    toast,
  })

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

  // Geological-model operation handlers — extracted to useGeologicalModelOps
  // (debt #201 Move 5, cluster 3). handleDeleteModel is non-contiguous in
  // the original file but belongs in this cluster logically.
  const {
    handleAutoPopulateFromStratigraphy,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    handleToggleBoreholeInLithoModel,
    handleDeleteModel,
  } = useGeologicalModelOps({
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
  })

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
          // formal_codes is absent on a backend older than 2026-09-05 → [].
          formalCodes: (c.formal_codes ?? []).map(fc => ({
            code: fc.code,
            count: fc.count,
            catalogName: fc.catalog_name,
          })),
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
        toast('error', t('geology.scanStratigraphyFailed'))
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
      mode: AutoPopulateMode = 'add',
    ): Promise<void> => {
      if (!project) return
      const activeModel = await ensureActiveGeologicalModel()
      if (!activeModel) return
      const projectId = project.id
      const modelId = activeModel.id
      const mapSize = manualMap ? Object.keys(manualMap).length : 0
      log.info(
        'geology',
        `applyBoreholeFormationSelection entry mode=${mode} ` +
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
          null,
          undefined,
          mode,
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
          toast('error', t('geology.nothingCreated', { n: outcome.skipped_existing }))
        }

        // Step 2b: report what the server actually removed, by NAME.
        //
        // WHY this is not redundant with the confirmation the user just
        // accepted (2026-08-03): that prompt showed the client's PREDICTION of
        // the delete scope, computed from the formation + contact lists this
        // renderer happens to hold. This reads the server's RECORD of what it
        // did. When the two disagree — a stale list, a divergent key, a second
        // window — the disagreement is the thing worth seeing, and the whole
        // incident was that a deletion produced no message at all.
        //
        // Names, never ids: "removed 4 units" is not something an engineer can
        // check, and a UUID is not something they can recognise.
        if (outcome.deleted_formation_names && outcome.deleted_formation_names.length > 0) {
          const removed = outcome.deleted_formation_names
          toast(
            'warning',
            t('geology.removedNotInSelection', {
              n: removed.length,
              unit: removed.length === 1 ? t('geology.unitWordOne') : t('geology.unitWordMany'),
              names: removed.join(', '),
            }),
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
        //
        // The snapshot follows the mode, for the same reason the deletion
        // does (2026-08-03):
        //
        //   add       — MERGE. This run spoke only about the units it named;
        //               the groupings it never mentioned are still the user's.
        //               Later entries win on their own keys only.  Replacing
        //               the whole map here is how a 13-entry map got staged
        //               back as 0 during a run that touched one unit.
        //   overwrite — REPLACE. The user asked for the model to become this
        //               selection, aliases included; an empty map is then a
        //               deliberate clear, not an accident.
        const appliedMap = manualMap ?? {}
        const lumpingMap =
          mode === 'overwrite' ? appliedMap : { ...(currentLumping?.map ?? {}), ...appliedMap }
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
      // Read in the add-mode merge below — the snapshot this run extends.
      currentLumping,
    ],
  )

  // Slice 2, #55: create a formation contact on the LITHO model.
  // Mirror of handleCreateContact — refetchLithoContacts drives the
  // local state refresh (post-A5 lithoContacts is a derived memo
  // over lithoLayers, so no optimistic patch is needed). Closes over
  // activeLithoModelRef so the dep array stays
  // [project, refetchLithoContacts] — stable to project identity.
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
        // A4 remaining-writer cut — handleCreateLithoContact now routes
        // to POST /layers. The new endpoint takes section_id at the
        // request level (not per-item) and unions the created layer
        // ids into the section's seeded_formation_contact_ids — the
        // explicit-content invariant that used to live on the contact
        // POST. The LL→FC trigger materialises the matching FC mirror
        // so correlation FKs + legacy /contacts readers stay coherent.
        //
        // depth_base_m derivation: the original /contacts POST had no
        // base concept (boundary-shape). For the layer-shape we need
        // one — use the next-deeper layer's top at this anchor, or
        // depth_m + 1.0 m as a fallback when nothing's below. The
        // user's next gesture (drag boundary, or another create) will
        // refine; the +1.0 m floor satisfies the depth-ordered CHECK.
        const anchorLayers = lithoLayers
          .filter(
            l =>
              (anchorKind === 'borehole' ? l.borehole_id : l.cpt_id) === anchorId &&
              l.depth_top_m > depth_m,
          )
          .sort((a, b) => a.depth_top_m - b.depth_top_m)
        const depth_base_m = anchorLayers[0]?.depth_top_m ?? depth_m + 1.0
        const created = await api.geology.bulkCreateLayers(
          project.id,
          model.id,
          [
            {
              formation_id: formationId,
              depth_top_m: depth_m,
              depth_base_m,
              status: 'accepted',
              source: snapped ? 'observation_layer' : 'manual',
              confidence: snapped ? 'high' : 'medium',
              borehole_id: anchorKind === 'borehole' ? anchorId : null,
              cpt_id: anchorKind === 'cpt' ? anchorId : null,
            },
          ],
          sectionId,
        )
        refetchLithoContacts()
        refetchLithoSurfaces()
        log.success(
          'geology',
          `createLithoContact ok id=${created[0]?.id} depth=${depth_m.toFixed(3)}m`,
        )
      } catch (err) {
        log.error('geology', 'createLithoContact failed', err)
        toast('error', t('litho.placeContactFailed'))
      }
    },
    [project, lithoLayers, refetchLithoContacts, refetchLithoSurfaces, toast],
  )

  // Slice 2, #55: inline-create a formation inside the active LITHO model.
  // Mirror of handleInlineCreateFormation — same optimistic-update pattern.
  // After debt #89: writes to the GLOBAL ``formations`` atom because
  // ``lithoFormations`` is now derived from it (useMemo). The new unit
  // appears in the litho roster automatically on the next render.
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
        setFormations(prev => [...prev, created])
        log.success(
          'geology',
          `handleInlineLithoCreateFormation ok id=${created.id} name="${created.name}"`,
        )
        return { id: created.id }
      } catch (err) {
        log.error('geology', 'handleInlineLithoCreateFormation failed', err)
        toast('error', t('litho.createFormationFailed'))
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

  // Unified ghost-suggestion state (debt #77 — Phase 1, 2026-05-21).
  // ONE Map<anchorId, BulkAnchorGhost> backs both the single-anchor
  // workflow (focus + Suggest) and the bulk workflow (Suggest all).
  // ``focusedSuggestAnchorId`` flags which anchor is the "single"
  // focus; all other entries are the "bulk" set. The bus interface
  // keeps its prior single/bulk shape via derived selectors below so
  // consumers don't churn (Phase 2 would simplify the bus too).
  //
  // History: until 2026-05-21 there were SIX single-anchor useState
  // atoms (lithoSuggestions / Investigation / AnchorKind / Accepted /
  // Rejected / Edits) plus a separate bulkLithoGhosts Map. The shapes
  // were identical (BulkAnchorGhost mirrors the single tuple exactly)
  // and the dual state invited the kind of partial-refresh bugs the
  // #88/#89 pair surfaced for a similar dual-atom case in formations.
  const [ghostsByAnchor, setGhostsByAnchor] = useState<
    ReadonlyMap<string, BulkAnchorGhost>
  >(new Map())
  const [focusedSuggestAnchorId, setFocusedSuggestAnchorId] = useState<string | null>(null)
  // Stable ref of focusedSuggestAnchorId so handler callbacks with
  // empty dep arrays can read the current focus without triggering
  // identity churn on every focus change.
  const focusedSuggestAnchorIdRef = useRef<string | null>(null)
  useEffect(() => {
    focusedSuggestAnchorIdRef.current = focusedSuggestAnchorId
  }, [focusedSuggestAnchorId])
  const [lithoSuggesting, setLithoSuggesting] = useState(false)
  const [bulkLithoSuggesting, setBulkLithoSuggesting] = useState(false)

  // Litho-model operation handlers — extracted to useLithoModelOps (debt #201
  // Move 5, cluster 4). Call site is placed AFTER the ghost-overlay useState
  // declarations above because handleClearLithoModel passes setGhostsByAnchor
  // and setFocusedSuggestAnchorId as args — placing it before those useState
  // calls would be a TDZ violation.
  const {
    handleRebuildLithoSurfaces,
    handleClearLithoModel,
    handleCreateLithoModel,
    handleActivateLithoModel,
    handleDeleteLithoModel,
  } = useLithoModelOps({
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
  })

  // Phase 2 of debt #77: derived selectors retired from the BUS —
  // consumers read ``ghostsByAnchor + focusedSuggestAnchorId``
  // directly and compute the focused entry / bulk subset themselves
  // (see SectionsCanvas). The locals below stay because internal
  // handlers (effectiveLithoSuggestionAt, accept-all-pending, etc.)
  // need a synchronous read of the focused entry's fields and the
  // empty-value primitives need to be stable for those reads.
  const EMPTY_SET = useMemo(() => new Set<number>(), [])
  const EMPTY_EDITS = useMemo(
    () => new Map<number, LithoSuggestionEdit>(),
    [],
  )
  const focusedGhostEntry = useMemo<BulkAnchorGhost | null>(() => {
    if (focusedSuggestAnchorId === null) return null
    return ghostsByAnchor.get(focusedSuggestAnchorId) ?? null
  }, [ghostsByAnchor, focusedSuggestAnchorId])
  const lithoSuggestions = focusedGhostEntry?.suggestions ?? []
  const lithoSuggestionAnchorKind = focusedGhostEntry?.kind ?? null
  const lithoSuggestionInvestigationId = focusedSuggestAnchorId
  const lithoSuggestionRejected = focusedGhostEntry?.rejected ?? EMPTY_SET
  const lithoSuggestionEdits = focusedGhostEntry?.edits ?? EMPTY_EDITS
  // Bulk subset = Map minus focused entry. Used by handleAcceptAllBulkLitho
  // to iterate "every non-focused anchor with a ghost". The focused
  // anchor has its own Accept-all-pending verb (single).
  const bulkGhostsByAnchor = useMemo<ReadonlyMap<string, BulkAnchorGhost>>(() => {
    if (focusedSuggestAnchorId === null) return ghostsByAnchor
    if (!ghostsByAnchor.has(focusedSuggestAnchorId)) return ghostsByAnchor
    const next = new Map(ghostsByAnchor)
    next.delete(focusedSuggestAnchorId)
    return next
  }, [ghostsByAnchor, focusedSuggestAnchorId])

  // (lithoFormationsRef removed in debt #89 — it was written but never
  // read anywhere. Originally intended for use inside accept-handler
  // callbacks to dodge a dep on a frequently-changing array, but the
  // accept handlers never reach for it. Dead code on removal.)

  // Litho-suggestion handlers — extracted to useLithoSuggestions (debt #201
  // Move 5, cluster 5). Call site is placed AFTER the derived selectors above
  // because the sub-hook receives their values (lithoSuggestions,
  // lithoSuggestionEdits, etc.) as params. The B-1 ghost-clear useEffect
  // (model-switch guard) lives inside the sub-hook alongside clearLithoSuggestions.
  const {
    handleAutoCorrelate,
    handleClearSuggestions,
    handleEditLithoSuggestion,
    clearLithoSuggestions,
    clearBulkLithoGhosts,
    handleStripLithoAdmixtures,
    handleReseedLithoAdmixtures,
    handleRejectBulkLitho,
    handleUnrejectBulkLitho,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleAbsorbLithoLayer,
    handleCreateManualLithoGhost,
    handleExtendLithoGhostToNearestContacts,
    handleSuggestLitho,
    handleAcceptLithoSuggestion,
    handleAcceptAllLithoSuggestions,
    handleRejectLithoSuggestion,
    handleUnrejectLithoSuggestion,
    handleSuggestAllLitho,
    handleAcceptBulkLitho,
    handleAcceptAllBulkLitho,
  } = useLithoSuggestions({
    project,
    activeLithoModelRef,
    lithoContacts,
    activeLithoModel,
    formations,
    addToSessionImports,
    pushUndo,
    markMutated,
    requestCorrelationEdgesRefetch,
    requestBodyRecompute,
    refetchLithoContacts,
    refetchFormations,
    toast,
    setGhostsByAnchor,
    setFocusedSuggestAnchorId,
    setLithoSuggesting,
    setBulkLithoSuggesting,
    setLithoCrossingPinchOuts,
    ghostsByAnchor,
    focusedSuggestAnchorId,
    focusedSuggestAnchorIdRef,
    lithoSuggestions,
    lithoSuggestionEdits,
    lithoSuggestionRejected,
    lithoSuggestionAnchorKind,
    lithoSuggestionInvestigationId,
    bulkGhostsByAnchor,
  })

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


  // Litho body solids — lifted from LithologyCanvas so the toolbar, canvas,
  // and inspector all share one state atom.  The hook is always called here
  // (unconditionally, above any early return) per the hook-order rule.
  const lithoSolidsResult = useLithoSolids(
    project?.id ?? null,
    activeLithoModel?.id ?? null,
    toast,
    // Any litho GEOMETRY change stales these solids server-side — a boundary move
    // from either axis does it. Without a re-read the flag never reaches the Build
    // badge: the owner's DB showed 81 solids go from 0 stale to 81 stale across one
    // contact drag while the button kept the state it had read at load.
    //
    // The litho half of the wire the geotech instance below has had since 2026-08-08.
    lithoLayersVersion,
    // A build changes what a save would write, so it dirties the project like any
    // other edit. Without it the close prompt never fires for a build.
    markMutated,
  )

  // The units-pane geotech body roster (``useModelBodies`` in GeotechnicalInspector)
  // groups packing bodies under their litho parent via ``parent_litho_body_id``.
  // A geotech Build HEALS those links server-side, but the roster only re-fetched
  // on a body-recompute nonce the Build never bumps — so the tree kept the pre-Build
  // bodies (NULL parents) under "no litho body" until a manual reload (debt #278
  // dogfeed 2026-09-01). This counter is the missing signal: a completed geotech
  // build bumps it, the roster keys on it, and it re-READS the already-correct DB.
  // NOT a recompute — the geotech stage cannot assemble the Sections partition
  // payload a recompute needs, and the DB is already right, so a re-read is both
  // sufficient and far lighter.
  //
  // Declared ABOVE the geotech useLithoSolids call because the composed
  // ``onMutated`` below (which the streaming build path fires on ``done``) needs
  // its setter.
  const [geotechBodyRosterRefetchNonce, setGeotechBodyRosterRefetchNonce] = useState(0)

  // The geotech "a build landed" hook: mark the project dirty (like every model
  // mutation) AND re-read the body roster. Fires from inside ``applyVoxelBuildResult``,
  // so it covers BOTH the synchronous build and the streaming build's ``done``
  // event (debt #282 parity) — the roster heals its litho-parent links no matter
  // which path ran. The synchronous wrapper below ALSO bumps for the no-op
  // (empty-payload) case that GBR1 pins, where no result is applied and this hook
  // never fires; a real synchronous build would bump twice, a harmless counter
  // increment, and no longer a production path now that Build streams.
  const markMutatedAndRereadGeotechRoster = useCallback(() => {
    markMutated()
    setGeotechBodyRosterRefetchNonce(n => n + 1)
  }, [markMutated])

  // Geotech body solids — a SECOND useLithoSolids instance pointed at the
  // active GEOTECH model.  ``useLithoSolids`` is model-agnostic (the voxel
  // builder parameterises on ``model_id``; the geotech model id is accepted
  // by the same ``buildVoxelLithoModel`` endpoint), so the geotech 3D body
  // solids reuse the same fetch / build / colour machinery — INCLUDING the
  // streaming build job (progress + cancel), which is why the geotech Build can
  // share it without a second copy (debt #282).  Called unconditionally here
  // (above any early return) per the hook-order rule — mirrors the litho instance
  // directly above it.
  const geotechSolidsResult = useLithoSolids(
    project?.id ?? null,
    activeGeotechModel?.id ?? null,
    toast,
    // Hand band edits stale the geotech solids server-side; every such write
    // bumps geotechLayersVersion, and this re-fetch is what turns the Build
    // badge amber without waiting for the next build.
    geotechLayersVersion,
    // Dirty the project AND re-read the units-pane roster on every completed
    // build — sync or streaming (debt #282).
    markMutatedAndRereadGeotechRoster,
  )

  // GEOTECH-only wrapper around the second useLithoSolids build. Awaits the
  // underlying build, then bumps the roster nonce. Finally-style on purpose: the
  // inner build swallows its own errors (it toasts, never rejects) and no-ops on
  // an empty payload, so a partial / no-op build harmlessly re-reads unchanged
  // data — threading a success signal out of buildLithoSolids buys nothing here.
  // The LITHO build (spread from ``lithoSolidsResult`` above) is deliberately NOT
  // wrapped: it changes a different model's roster.
  //
  // Retained after the geotech Build moved to the streaming path (debt #282): it
  // is still the synchronous fallback the pre-flight uses when the bus does not
  // wire ``startGeotechBuild`` (test stubs), and GBR1-3 drive it directly.
  const buildGeotechSolids = useCallback<UseLithoSolidsResult['buildLithoSolids']>(
    async voxelRequestBuilder => {
      await geotechSolidsResult.buildLithoSolids(voxelRequestBuilder)
      setGeotechBodyRosterRefetchNonce(n => n + 1)
    },
    [geotechSolidsResult.buildLithoSolids],
  )

  // Debt #266 — which geotech columns are standing on litho that has since been
  // edited.  Sibling signal to the stale-solid flag above, and re-read on BOTH
  // version counters: a litho edit is what makes a column stale, and a geotech
  // press is what clears it, so keying on only one of them would leave the
  // indicator showing the answer from before the change — the very bug.
  const geotechLithoStalenessResult = useGeotechLithoStaleness(
    project?.id ?? null,
    activeGeotechModel?.id ?? null,
    `${lithoLayersVersion}:${geotechLayersVersion}`,
  )

  // F4 — "Subdivide all bodies" toolbar verb.  Called from the Geotechnical
  // stage toolbar (SectionsToolbar on the geotech axis).  The endpoint
  // creates or reuses the kind='geotechnical' child model and materialises
  // geotech spatial bodies; after success we need:
  //   (a) refreshModels → so activeGeotechModel becomes non-null and the
  //       Geotech axis toggle enables (or stays enabled on re-runs)
  //   (b) the geotech-layers useEffect fires automatically because
  //       setActiveGeotechModel inside refreshModels triggers it
  //   (c) refetchFormations → so NAD-class units appear in the formations list
  //   (d) markMutated + addToSessionImports for the new formations → dirty flag
  // The verb must be usable when NO geotech model exists yet (first run).
  const handleSubdivideAllBodies = useCallback(
    async (options?: {
      deriveEdges?: boolean
      sectionId?: string | null
      representativeStatistic?: string | null
      /** True = the historic rebuild (statistic re-run / re-derive tags).
       *  Otherwise the press imports already-banded columns as-is (owner
       *  ruling 2026-08-18 — first subdivision wins). */
      rebuildExisting?: boolean
    }): Promise<void> => {
      const lithoModel = activeLithoModelRef.current
      if (!project || !lithoModel) {
        toast('error', t('geotech.selectLithoModelFirst'))
        return
      }
      // Owner ruling 2026-08-15 — a section id rebuilds that section's columns
      // only; null is the deliberate all-sections press.
      const sectionId = options?.sectionId ?? null
      // The statistic chosen before any geotech model existed (owner ruling
      // 2026-08-15). The backend applies it only when this call CREATES the
      // model, so passing it on a re-run is harmless — and the toolbar clears
      // it the moment a model exists anyway.
      const representativeStatistic = options?.representativeStatistic ?? null
      // Pipeline step 1 (owner ruling 2026-08-04) subdivides the CPTs and
      // proposes NOTHING; the combined verb is the compatibility path and is
      // the only caller that asks for edges. Everything AFTER the request is
      // identical, so the two share this handler rather than drifting.
      const deriveEdges = options?.deriveEdges ?? false
      const verb = deriveEdges ? 'subdivideAllBodies' : 'subdivideCpts'
      log.info(
        'geology',
        `${verb} entry lithoModel=${lithoModel.id} scope=${sectionId ?? 'all sections'}` +
          ` statistic=${representativeStatistic ?? 'model default'}`,
      )
      let result: SubdivideAllBodiesResponse
      try {
        result = deriveEdges
          ? await api.geology.subdivideAllBodies(
              project.id,
              lithoModel.id,
              sectionId,
              representativeStatistic,
            )
          : await api.geology.subdivideCpts(
              project.id,
              lithoModel.id,
              sectionId,
              representativeStatistic,
              !(options?.rebuildExisting ?? false),
            )
      } catch (err) {
        log.error('geology', `${verb} failed`, err)
        toast(
          'error',
          deriveEdges
            ? t('geotech.subdivideAllBodiesFailed')
            : t('geotech.subdivideCptsFailed'),
        )
        return
      }
      // The rebuild has landed: every geotech row the undo commands referenced is
      // gone. Clearing HERE (success only) keeps a failed request from wiping
      // valid history, and beats the alternative the owner met — the first stale
      // Ctrl+Z 422s and the failure handler discards the whole stack anyway,
      // litho entries included (audit F23). A SECTION-SCOPED run also clears the
      // WHOLE stack, deliberately (audit P2-6): UndoCommand carries no section
      // identity, so the entries whose closures now point at deleted rows cannot
      // be told apart from the still-valid ones — and one stale revert firing
      // trips the same F23 discard-everything path, only after a confusing 422.
      clearUndo?.()
      log.success(
        'geology',
        `${verb} ok geotech_model=${result.geotech_model_id}` +
          ` edges_derived=${result.edges_derived ?? deriveEdges}` +
          ` ties_proposed=${result.proposed_tie_count ?? 0}` +
          ` bodies=${result.body_count}` +
          ` split=${result.split_body_count}` +
          ` one_class=${result.one_class_body_count}` +
          ` borehole_only=${result.borehole_only_count}` +
          ` sections=${result.section_count ?? 0}` +
          ` ties_reanchored=${result.reanchored_tie_count ?? 0}` +
          ` ties_lost=${result.lost_tie_count ?? 0}` +
          ` ties_need_review=${JSON.stringify(result.review_tie_reasons ?? {})}` +
          ` ${JSON.stringify(result.lost_tie_reasons ?? {})}`,
      )
      // (a)+(b): re-derive activeGeotechModel so the axis toggle enables and
      // the geotechLayers useEffect fires with the new model id.
      await refreshModels()
      // (c): NAD-class formation rows were created server-side; bring them in.
      // Awaited so geotechFormations is populated before the success toast fires
      // (prevents a brief "No geotech units yet" flash in the inspector).
      await refetchFormations()
      // (c2): the geotech correlation edges are re-derived server-side, but the
      // SectionsCanvas edge fetch is keyed on the geotech model id STRING — which
      // is unchanged on a re-run — so it won't refetch on its own. Bump the nonce
      // so the bands pick up the new edges (otherwise a re-click shows stale
      // connectivity / no visible refresh).
      requestCorrelationEdgesRefetch?.()
      // reason: on a re-subdivide the geotech model id is unchanged, so the
      // geotechLayers useEffect (keyed on the model object) only re-fires if
      // refreshModels happens to swap the object reference — implicit and
      // non-obvious. Make the body_id-stamp reload explicit (mirrors the
      // edge-nonce rationale above); the small redundant GET on a heavy user
      // action is acceptable for mechanism-consistency with the manual gesture
      // path (the packing-correlate handler also bumps this nonce).
      requestGeotechLayersRefetch()
      // A subdivide rewrites every packing band, so the geotech model's body
      // geometry has moved — schedule its identity recompute (slice 5).
      requestBodyRecompute?.('geotech')
      // (d): record new NAD-class formations as session imports so markMutated
      // lights the dirty flag and they land in the next .gmproj save.
      if (result.created_formation_ids.length > 0) {
        addToSessionImports('formation', result.created_formation_ids)
      }
      markMutated()
      // Subdivide rebuilds the CPT bodies and writes NO borehole bands — the
      // boreholes are now undivided, so amber the "Divide boreholes" button.
      markBoreholesStale()
      // The rebuild gives every band a new id, so an accepted packing tie has to be
      // re-anchored: onto the band that came back unchanged, or onto the one it moved
      // into. Where neither is unambiguous the tie is still carried, but flagged —
      // an accepted edge never disappears without the engineer deleting it. Report
      // all three outcomes, because a flag nobody is told about is a flag nobody acts
      // on, and the section it sits on may not be the one that is open.
      const lostTies = result.lost_tie_count ?? 0
      // Wording lives in ``subdivideCptsToast`` (mirrors ``lostTieMessage`` /
      // ``divideBoreholesToast``): it is pinned there, and this hook is long
      // past the god-component threshold.
      toast(
        'success',
        subdivideCptsToast({
          scopedToSection: sectionId !== null,
          splitBodyCount: result.split_body_count,
          oneClassBodyCount: result.one_class_body_count,
          boreholeOnlyCount: result.borehole_only_count ?? 0,
          reanchoredTieCount: result.reanchored_tie_count ?? 0,
          deriveEdges,
        }),
      )
      const needsReview = Object.values(result.review_tie_reasons ?? {}).reduce(
        (a, b) => a + b,
        0,
      )
      if (needsReview > 0) {
        toast(
          'warning',
          needsReview === 1
            ? t('geotech.tieReviewOne', { n: needsReview })
            : t('geotech.tieReviewMany', { n: needsReview }),
        )
      }
      if (lostTies > 0) {
        // NAMES, not just a count: an accepted tie the engineer has to redraw
        // is unfindable from "3 ties were lost", and the ids only ever reached
        // a console a packaged build does not show (audit 2026-08-02).
        toast('error', lostTieMessage(lostTies, result.lost_tie_labels))
      }
    },
    // reason: activeLithoModelRef is a ref (always current) so listing it would
    // cause no-op dep churn; refreshModels, refetchFormations, addToSessionImports,
    // markMutated, toast, requestCorrelationEdgesRefetch, requestGeotechLayersRefetch,
    // requestBodyRecompute are all stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, refreshModels, refetchFormations, addToSessionImports, markMutated, toast],
  )

  // "Divide boreholes" — standalone post-SAB step that TIN-divides borehole
  // columns using the CPT geotech layers already written by SAB.  Idempotent:
  // prior borehole bands are replaced.  Must be called after SAB has run at
  // least once (a 404 from the API means the geotech model doesn't exist yet).
  const dividingBoreholesRef = useRef(false)
  const handleDivideBoreholes = useCallback(
    async (options?: {
      boreholeIds?: readonly string[]
      sectionId?: string | null
      sectionPartitions?: Record<string, unknown> | null
      /** First subdivision wins: import already-divided boreholes as-is. */
      skipExisting?: boolean
    }): Promise<void> => {
      // Concurrent-divide guard (review MINOR-1): the toolbar debounces via its
      // busy state, but the ghost right-click path has no such state — a double
      // click must not fire two overlapping delete-and-rewrite passes.
      if (dividingBoreholesRef.current) {
        log.warn('geology', 'divideBoreholes ignored — a divide is already running')
        return
      }
      const lithoModel = activeLithoModelRef.current
      if (!project || !lithoModel) {
        toast('error', t('geotech.selectLithoModelFirst'))
        return
      }
      if (!activeGeotechModel) {
        toast('error', t('geotech.divideBoreholesNeedsCpts'))
        return
      }
      // An EMPTY subset is "divide none" on the wire, so refusing it here saves
      // a pointless round trip AND makes the no-op visible instead of silent.
      const subset = options?.boreholeIds
      if (subset !== undefined && subset.length === 0) {
        toast('warning', t('geotech.noBoreholeSelected'))
        return
      }
      // Owner ruling 2026-08-15 — step 4 joined the other three: a section id
      // divides that section's boreholes and gates on that section's ties.
      const sectionId = options?.sectionId ?? null
      log.info(
        'geology',
        `divideBoreholes entry lithoModel=${lithoModel.id} ` +
          `scope=${sectionId ?? 'all sections'} ` +
          `boreholes=${subset === undefined ? 'ALL' : subset.length}`,
      )
      let result: DivideBoreholeResponse
      dividingBoreholesRef.current = true
      try {
        result = await api.geology.divideBoreholes(project.id, lithoModel.id, {
          boreholeIds: subset,
          sectionId,
          sectionPartitions: options?.sectionPartitions ?? null,
          skipExisting: options?.skipExisting ?? false,
        })
      } catch (err) {
        log.error('geology', 'divideBoreholes failed', err)
        // The step-3 gate answers 422 with a structured detail naming the
        // count; ``detailMessage`` has already unwrapped it into the ApiError,
        // so showing it verbatim tells the engineer WHAT to do. Only an
        // ApiError carries a server sentence — a transport failure's
        // "Failed to fetch" explains nothing, so it keeps the generic line
        // (review MINOR-3).
        toast(
          'error',
          err instanceof ApiError && err.message
            ? err.message
            : t('geotech.divideBoreholesFailed'),
        )
        return
      } finally {
        dividingBoreholesRef.current = false
      }
      log.success(
        'geology',
        `divideBoreholes ok geotech_model=${result.geotech_model_id}` +
          ` divided=${result.divided_borehole_count}` +
          ` single=${result.single_band_borehole_count}` +
          ` layers=${result.layer_count}` +
          ` ties_reanchored=${result.reanchored_tie_count ?? 0}` +
          ` ties_superseded=${result.superseded_jump_tie_count ?? 0}` +
          ` ties_lost=${result.lost_tie_count ?? 0}` +
          ` ties_need_review=${JSON.stringify(result.review_tie_reasons ?? {})}` +
          ` ${JSON.stringify(result.lost_tie_reasons ?? {})}`,
      )
      // Refresh geotech layers so the section canvas picks up the new borehole bands.
      requestGeotechLayersRefetch()
      // The bands are only half of what a divide rewrites. It also writes the
      // borehole-mediated chain edges and DELETES the jump ties that chain
      // supersedes — under an unchanged geotech model id, which is the very key
      // the canvas's edge fetch is memoised on, so it never refetches on its
      // own (same trap ``handleSubdivideCpts`` documents). Without this bump the
      // section keeps drawing the pre-press edge list: deleted ties still
      // painted, new hops nowhere — the owner's 2026-08-15 report, on a press
      // whose own log line read ``ties_superseded=13``.
      requestCorrelationEdgesRefetch?.()
      // New borehole bands plus new ties move body identity on the geotech axis.
      requestBodyRecompute?.('geotech')
      if (result.created_formation_ids.length > 0) {
        addToSessionImports('formation', result.created_formation_ids)
      }
      markMutated()
      // Boreholes now match the current bodies — clear the stale flag. A SCOPED
      // run (borehole subset OR a single section) must NOT clear it: the
      // boreholes it left out are still out of date, and an amber button that
      // goes grey after dividing one column — or one section — would say the
      // opposite (audit P1-4: the section arm was missing from this gate).
      if (subset === undefined && sectionId === null) clearBoreholesStale()
      // Re-dividing throws every borehole band away and rebuilds it with a new
      // id, so an accepted packing tie on a borehole has to be re-anchored:
      // onto the band that came back unchanged, or onto the one it moved into.
      // Where neither is unambiguous the tie is still carried, but flagged —
      // an accepted edge never disappears without the engineer deleting it.
      // Report all three outcomes; the section a flag sits on may not be open.
      const lostTies = result.lost_tie_count ?? 0
      // The sentence names the reanchored ties AND the jump ties the mediated
      // chain replaced (owner ruling 2026-08-14) — built in a pure helper so
      // the wording is pinned by its own test.
      toast('success', divideBoreholesToastMessage(result, subset === undefined))
      const needsReview = Object.values(result.review_tie_reasons ?? {}).reduce((a, b) => a + b, 0)
      if (needsReview > 0) {
        toast(
          'warning',
          needsReview === 1
            ? t('geotech.tieReviewBoreholeOne', { n: needsReview })
            : t('geotech.tieReviewBoreholeMany', { n: needsReview }),
        )
      }
      if (lostTies > 0) {
        // See the Subdivide branch: the engineer needs to know WHICH ties.
        toast('error', lostTieMessage(lostTies, result.lost_tie_labels))
      }
    },
    // reason: activeLithoModelRef and activeGeotechModel are refs / stable
    // objects; the other deps — including requestCorrelationEdgesRefetch,
    // requestGeotechLayersRefetch and requestBodyRecompute — are all stable
    // callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, activeGeotechModel, addToSessionImports, markMutated, toast],
  )

  const handleSetNadAdmixtureChoices = useCallback(
    async (entries: readonly { formationId: string; choice: NadAdmixtureChoice }[]) => {
      if (!project || entries.length === 0) return
      log.info(
        'geology',
        `set nad_admixture_choice on ${entries.length} unit(s): ` +
          entries.map(e => `${e.formationId}=${e.choice}`).join(', '),
      )
      try {
        // PATCH each answered unit. Parallel because they are independent rows.
        await Promise.all(
          entries.map(({ formationId, choice }) =>
            api.geology.updateFormation(project.id, formationId, {
              nad_admixture_choice: choice,
            }),
          ),
        )
      } catch (err) {
        log.error('geology', 'set nad_admixture_choice failed', err)
        toast('error', t('geotech.admixtureChoiceSaveFailed'))
        // Re-throw so the caller (the pre-flight) keeps the dialog open and does
        // NOT proceed to divide on a half-saved answer set.
        throw err
      }
      // Reflect the writes in local state so the pre-flight's derived
      // "needs an answer" list updates without a round-trip refetch.
      const byId = new Map(entries.map(e => [e.formationId, e.choice]))
      setFormations(prev =>
        prev.map(f =>
          byId.has(f.id) ? { ...f, nad_admixture_choice: byId.get(f.id) ?? null } : f,
        ),
      )
      markMutated()
    },
    // reason: ``t`` is a module-level import and ``setFormations`` a stable state
    // setter; neither belongs in the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, markMutated, toast],
  )

  return {
    activeGeologicalModel,
    models,
    activeLithoModel,
    handleCreateLithoModel,
    handleActivateLithoModel,
    handleDeleteLithoModel,
    lithoContacts,
    lithoLayers,
    lithoFormations,
    lithoSurfacesByFormationId,
    lithoStaleSurfaceCount,
    handleRebuildLithoSurfaces,
    refetchLithoContacts,
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
    markMutated,
    requestCorrelationEdgesRefetch,
    handleUnlinkLithoFromGeo,
    handleLinkLithoToGeo,
    handleAutoPopulateFromStratigraphy,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    handleToggleBoreholeInLithoModel,
    discardContacts,
    discoverBoreholeFormations,
    applyBoreholeFormationSelection,
    handleDeleteModel,
    ensureActiveGeologicalModel,
    // Phase 2 of debt #77 (2026-05-21): bus exposes the unified Map
    // + the focused-anchor flag. Consumers compute "focused" and
    // "bulk subset" themselves (see SectionsCanvas + SectionsToolbar).
    ghostsByAnchor,
    // Crash-recovery restore writes the decoded workspace back wholesale.
    setGhostsByAnchor,
    focusedSuggestAnchorId,
    handleEditLithoSuggestion,
    lithoSuggesting,
    handleSuggestLitho,
    handleAcceptLithoSuggestion,
    handleAcceptAllLithoSuggestions,
    handleRejectLithoSuggestion,
    handleUnrejectLithoSuggestion,
    clearLithoSuggestions,
    // Bulk-suggest (debt #73 / Phase 3)
    bulkLithoSuggesting,
    handleSuggestAllLitho,
    handleAcceptBulkLitho,
    handleAcceptAllBulkLitho,
    handleRejectBulkLitho,
    handleUnrejectBulkLitho,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleAbsorbLithoLayer,
    handleCreateManualLithoGhost,
    handleExtendLithoGhostToNearestContacts,
    clearBulkLithoGhosts,
    handleStripLithoAdmixtures,
    handleReseedLithoAdmixtures,
    backdropSurfacesByFormationId,
    handleLoadBackdropSurfaces,
    handleClearLithoModel,
    handleAutoCorrelate,
    handleClearSuggestions,
    lithoCrossingPinchOuts,
    // Litho body solids — spread from useLithoSolids (lifted from canvas).
    ...lithoSolidsResult,
    // Geotech parallel set (F2 — geotech data layer).
    activeGeotechModel,
    geotechLayers,
    geotechLayersLoaded,
    geotechLayersVersion,
    geotechContacts,
    geotechFormations,
    // Which columns a litho-contact drag left with out-of-date packing bands.
    columnsNeedingRederive,
    // Packing-correlation: re-fetch geotech layers after a body_id mutation.
    requestGeotechLayersRefetch,
    // F4 — "Subdivide all bodies" toolbar verb.
    handleSubdivideAllBodies,
    // "Divide boreholes" toolbar verb (post-SAB, geotech axis only).
    handleDivideBoreholes,
    // Persist the admixture NAD-family answer (owner ruling 2026-09-04).
    handleSetNadAdmixtureChoices,
    // Geotech body solids — second useLithoSolids instance (geotech model).
    // Keys are renamed (the litho solids set is already spread above) so both
    // 3D surfaces coexist on the bus.  The geotech 3D pane (GeotechnicalCanvas)
    // + Build button (GeotechnicalToolbar) read these.
    geotechSolids: geotechSolidsResult.lithoSolids,
    geotechSolidsLoading: geotechSolidsResult.lithoSolidsLoading,
    geotechSolidsBuilding: geotechSolidsResult.lithoSolidsBuilding,
    hasGeotechSolids: geotechSolidsResult.hasLithoSolids,
    hasStaleGeotechSolid: geotechSolidsResult.hasStaleLithoSolid,
    buildGeotechSolids,
    // Streaming build job (progress + cancel) for the geotech model — the same
    // machinery the litho Build uses, surfaced under geotech names (debt #282).
    startGeotechBuild: geotechSolidsResult.startLithoBuild,
    cancelGeotechBuild: geotechSolidsResult.cancelLithoBuild,
    geotechVoxelBuildState: geotechSolidsResult.voxelBuildState,
    geotechBodyRosterRefetchNonce,
    setGeotechBodyColor: geotechSolidsResult.setBodyColor,
    geotechHideMarkers: geotechSolidsResult.hideMarkers,
    setGeotechHideMarkers: geotechSolidsResult.setHideMarkers,
    geotechGaplessReport: geotechSolidsResult.gaplessReport,

    // Debt #266 — the columns whose litho moved after their bands were made.
    // Derived server-side on every read, so re-pressing them is what clears it.
    staleLithoGeotechColumns: geotechLithoStalenessResult.staleColumns,
    staleLithoGeotechColumnIds: geotechLithoStalenessResult.staleColumnIds,
    staleLithoGeotechColumnCount: geotechLithoStalenessResult.staleColumnCount,
    unstampedGeotechColumnCount: geotechLithoStalenessResult.unstampedColumnCount,
    refreshGeotechLithoStaleness: geotechLithoStalenessResult.refresh,
  }
}
