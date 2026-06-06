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

import { api } from '../api/client'
import type {
  AcceptLithoSuggestionsResponse,
  BatchAcceptLithoSuggestionsResponse,
  CrossingPinchOut,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
  LithoLayerSuggestion,
  ProjectResponse,
} from '../api/client'
import { formatAcceptParentSummary, formatStraddleSummary } from '../utils/acceptLithoSummary'
import { lithoLayersToContacts } from '../utils/lithoLayerToContact'
import { insertLithoLayer } from '../utils/lithoLayerInsert'
import { splitLithoLayer } from '../utils/lithoLayerSplit'
import { absorbLithoLayer, applyCrossMergeOnDrag, mergeLithoLayers } from '../utils/lithoLayerMerge'
import { insertManualGhostLayer } from '../utils/insertManualGhostLayer'
import { extendGhostToNearest } from '../utils/extendGhostToNearest'
import type { UndoCommand } from './useUndoStack'
import { useFormationCrud } from './useFormationCrud'
import { useContactCrud } from './useContactCrud'
import { useGeologicalModelOps } from './useGeologicalModelOps'
import { useLithoModelOps } from './useLithoModelOps'
import type { StratigraphyLumping } from '../utils/projectFile'
import { isLithoUnit } from '../utils/formationKind'
import { addAllToSet } from '../utils/sets'
import { log } from '../utils/log'
import {
  buildLithoAcceptBody,
  lithoAcceptTuningParams,
  recordCreatedRows,
} from '../utils/lithoAccept'
import { readLithoSegmenterPrefs } from '../utils/lithoSegmenterPrefs'
// LITHOLOGY_COLORS/LABELS/FALLBACK_COLOR removed — formation name/colour
// is now determined server-side by AcceptLithoSuggestions (Phase 1).

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
   * Populated by the three accept handlers
   * (``handleAcceptLithoSuggestion``, ``handleAcceptAllLithoSuggestions``,
   * ``handleAcceptBulkLitho``) from the API's ``created_contact_ids``
   * + ``found_contact_ids`` arrays, associating each contact to its
   * suggestion idx by matching the contact's depth_top_m to the
   * suggestion's known depth at accept time (before any drift).
   *
   * Optional + defaults to empty for backwards-compat with existing
   * tests and the bulk-suggest reducer paths that don't touch this
   * field. When absent the cross-store dispatch falls back to the
   * pre-fix depth-tolerance match.
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
   * Cumulative count of stale-TIN straddle fallbacks across every
   * accept-litho-suggestions response in the current session.  Drives
   * the amber pill in ``LithologyInspector`` that asks the engineer
   * to rebuild the geology model for precision.  Cleared on (a) a
   * successful geology rebuild + (b) ``clearLithoSuggestions``.
   */
  lithoStaleTinSessionCount: number
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
   *  body-level mutation that doesn't flow through this hook (e.g. the toolbar's
   *  "Delete all detected lenses"). Optional only so the many hand-rolled
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
  addToManifest,
  removeFromManifest,
  addToSessionImports,
  removeFromSessionImports,
  manifestFormationIds,
  currentLumping,
  stageLumping,
  requestCorrelationEdgesRefetch,
  markMutated,
}: {
  project: ProjectResponse | null
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
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
  // shared refresh counter — mutations go through setLithoLayers
  // optimistically + refetch, never through setContacts.
  useEffect(() => {
    if (!project || !activeLithoModel) {
      setLithoLayers([])
      setLithoSurfacesByFormationId(new Map())
      setGhostsByAnchor(new Map())
      setFocusedSuggestAnchorId(null)
      setLithoStaleTinSessionCount(0)
      return
    }
    // Debt #147 — clear stale state IMMEDIATELY when activeLithoModel
    // changes (e.g. delete model + create new in quick succession),
    // BEFORE the new fetch resolves.  Without this the inspector and
    // the section view render the previous model's contacts during
    // the fetch window — the user's "delete + new → 823 contacts
    // reappear" report (filed dogfeed 2026-05-27).  The active model
    // changing from A→B means A's contacts are no longer relevant,
    // period; we should never show them under a different model's
    // header.  The new fetch then populates with B's actual contents
    // (typically 0 for a freshly-created model).
    //
    // Debt #147 follow-up (2026-05-27): also reset the suggestion-ghost
    // bundle + focused-anchor pointer + stale-TIN session counter so a
    // freshly-created model presents a clean section canvas (no leftover
    // pending ghost columns from the prior model's "Suggest litho"
    // sweep, no stale fallback counter).  Mirrors the same triad
    // ``handleClearLithoModel`` resets — the architectural reasoning is
    // identical (these are ephemeral overlays scoped to the model the
    // user is currently editing).
    setLithoLayers([])
    setLithoSurfacesByFormationId(new Map())
    setGhostsByAnchor(new Map())
    setFocusedSuggestAnchorId(null)
    setLithoStaleTinSessionCount(0)
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
        setLithoLayers(layers)
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setLithoSurfacesByFormationId(sm)
        log.debug(
          'geology',
          `litho model ${modelId}: loaded ${layers.length} layers, ${surfs.length} surfaces`,
        )
      } catch (err) {
        if (!cancelled) {
          log.warn('geology', `litho model ${modelId}: load failed`, err)
          setLithoLayers([])
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
      .then(setLithoLayers)
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
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setLithoSurfacesByFormationId(sm)
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

  // Debt: stale-TIN straddle fallback diagnostic. AcceptLithoSuggestions'
  // straddle-split path falls back to depth-ordered contacts when the
  // geology TIN is stale or absent; the response carries
  // ``stale_tin_fallback_count``. This session counter accumulates that
  // across every accept in the current dogfeed session so the
  // LithologyInspector can render an amber pill telling the engineer
  // to rebuild the geology model for precision. Cleared on (a) a
  // successful geology rebuild + (b) ``clearLithoSuggestions``.
  const [lithoStaleTinSessionCount, setLithoStaleTinSessionCount] = useState(0)

  // Geological-model operation handlers — extracted to useGeologicalModelOps
  // (debt #201 Move 5, cluster 3). Call site is placed AFTER
  // lithoStaleTinSessionCount (line above) because handleRebuildSurfaces
  // passes setLithoStaleTinSessionCount as an arg — placing it before that
  // useState would be a TDZ violation. handleDeleteModel is non-contiguous in
  // the original file but belongs in this cluster logically.
  const {
    handleAutoPopulateFromStratigraphy,
    handleSeedLithoFromParent,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    handleDeleteModel,
  } = useGeologicalModelOps({
    project,
    activeGeologicalModel,
    activeLithoModel,
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
    setLithoStaleTinSessionCount,
    refetchFormations,
    refetchSurfaces,
    refetchLithoContacts,
  })

  // #127 — auto-correlate: fire the domain algorithm across the model,
  // persist net-new edges with source='auto', re-run the resolver, and
  // trigger inference per formation — all in one server-side transaction.
  const handleAutoCorrelate = useCallback(
    async (sectionId?: string | null): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.info('geology', `autoCorrelate entry model=${model.id} section=${sectionId ?? 'model-wide'}`)
    try {
      // #163b: pass the user-tuned depth-match window from Settings.
      const depthWindowM = readLithoSegmenterPrefs(project.view_state).autoCorrelateDepthWindowM
      // sectionId (dogfeed 2026-05-29): gate adjacency to consecutive columns
      // along the section, not map-plane RNG. The Sections toolbar passes the
      // selected section; null/undefined keeps model-wide behaviour.
      const result = await api.geology.autoCorrelateContacts(
        project.id,
        model.id,
        depthWindowM,
        sectionId ?? null,
      )
      // Defensive: tolerate a response without the auto-lens fields (older API
      // / test mocks) — never let a missing field abort the refetch below.
      const pinchOuts = result.crossing_pinch_outs ?? []
      log.success(
        'geology',
        `autoCorrelate ok edges_created=${result.edges_created} ` +
          `skipped=${result.edges_skipped_existing} ` +
          `dropped_crossing=${result.edges_dropped_crossing ?? 0} ` +
          `pinch_outs=${pinchOuts.length}`,
      )
      // Auto-lens: surface the crossing-derived pinch-out candidates (and clear
      // any stale ones from a prior run that found none).
      setLithoCrossingPinchOuts(pinchOuts)
      // New edges persisted — mark dirty so a close-without-save reverts.
      if (result.edges_created > 0) markMutated()
      // Refetch so ordinal badges update (formations re-resolved server-side).
      refetchFormations()
      // #163c: the correlation-edge state lives in SectionsCanvas (a sibling
      // of the toolbar that fired this), so signal it to refetch — otherwise
      // the new edges/banners don't render until a manual section reselect.
      requestCorrelationEdgesRefetch()
      if (result.edges_created === 0 && result.edges_skipped_existing === 0) {
        // No contacts with a valid litho code + parent formation — the model
        // is empty or has no correlatable units yet. Guide the user toward
        // accepting litho suggestions first.
        toast(
          'success',
          'Auto-correlate: no correlatable units found — accept litho suggestions first.',
        )
      } else if (result.edges_created === 0) {
        toast('success', 'Auto-correlate: model already fully correlated — no new edges.')
      } else {
        toast(
          'success',
          `Auto-correlate: ${result.edges_created} edge${result.edges_created === 1 ? '' : 's'} created, ` +
            // TODO Task 19: formations_recomputed removed from autoCorrelateContacts response.
          `${result.edges_skipped_existing} edge(s) already existed.`,
        )
      }
      // Auto-lens: tell the user the crossings became lens candidates, not edges.
      if (pinchOuts.length > 0) {
        const n = pinchOuts.length
        toast(
          'success',
          `${n} pinch-out lens candidate${n === 1 ? '' : 's'} from crossings — ` +
            'shown as amber diamonds; the crossing edges were not drawn.',
        )
      }
    } catch (err) {
      log.error('geology', 'autoCorrelate failed', err)
      toast('error', 'Auto-correlate failed — see console.')
    }
  }, [project, refetchFormations, toast, requestCorrelationEdgesRefetch, markMutated])

  // #179 — Clear suggestions: remove all unapproved (auto) correlation edges
  // for the model without re-running auto-correlate. Approved manual
  // correlations are kept (the backend deletes user_approved=false only).
  // Reversible: re-run Auto-correlate to regenerate them. Mirrors
  // handleAutoCorrelate's sibling-refetch signal (#163c).
  const handleClearSuggestions = useCallback(async (): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.info('geology', `clearSuggestions entry model=${model.id}`)
    try {
      const result = await api.geology.deleteAutoCorrelations(project.id, model.id)
      log.success('geology', `clearSuggestions ok deleted=${result.deleted}`)
      // Edges deleted — mark dirty so a close-without-save reverts.
      if (result.deleted > 0) markMutated()
      requestCorrelationEdgesRefetch()
      toast(
        'success',
        result.deleted === 0
          ? 'No correlation suggestions to clear.'
          : `Cleared ${result.deleted} correlation suggestion${result.deleted === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      log.error('geology', 'clearSuggestions failed', err)
      toast('error', 'Could not clear suggestions — see console.')
    }
  }, [project, toast, requestCorrelationEdgesRefetch, markMutated])

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
        toast('error', 'Could not place the litho formation contact.')
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
    setLithoStaleTinSessionCount,
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

  // Apply a user edit to one suggestion's top and/or base depth. Partial:
  // pass just { depth_top_m } to move only the top, just { depth_base_m }
  // for the base. The edit is merged with any prior edit on the same idx
  // so dragging the same layer twice composes. Writes to the focused
  // anchor's entry in the unified Map (debt #77).
  const handleEditLithoSuggestion = useCallback(
    (idx: number, edit: LithoSuggestionEdit): void => {
      setGhostsByAnchor(prev => {
        const focusedId = focusedSuggestAnchorIdRef.current
        if (focusedId === null) return prev
        const existing = prev.get(focusedId)
        if (!existing) return prev
        // applyCrossMergeOnDrag detects whether the depth edit crossed a
        // pending neighbour's boundary (plain-drag cross-merge — no Shift
        // required). When a cross occurred it returns absorbLithoLayer's
        // result (neighbour removed, dragger extended); when not, it
        // returns a plain depth-edit ghost identical to the prior merge.
        const updated = applyCrossMergeOnDrag(existing, idx, edit)
        const next = new Map(prev)
        next.set(focusedId, updated)
        return next
      })
    },
    [],
  )

  /**
   * Returns the depth-effective layer for a suggestion index — original
   * suggestion with any user edits applied. Used at accept time so the
   * committed contact lands at the edited depth, AND by the ghost
   * renderer so the layer rect matches the user's drag.
   */
  const effectiveLithoSuggestionAt = useCallback(
    (idx: number): LithoLayerSuggestion | null => {
      const layer = lithoSuggestions[idx]
      if (layer === undefined) return null
      const edit = lithoSuggestionEdits.get(idx)
      if (!edit) return layer
      return {
        ...layer,
        depth_top_m: edit.depth_top_m ?? layer.depth_top_m,
        depth_base_m: edit.depth_base_m ?? layer.depth_base_m,
        // Composition overrides (Phase 2.5 / debt #72). Lithology
        // cast safe — the editor's dropdown is constrained to
        // BaseLithology codes (ZAND / KLEI / SILT / GRIND / VEEN).
        suggested_lithology:
          (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
          layer.suggested_lithology,
        suggested_admixtures: edit.suggested_admixtures
          ? edit.suggested_admixtures.map(a => ({ ...a }))
          : layer.suggested_admixtures,
      }
    },
    [lithoSuggestions, lithoSuggestionEdits],
  )

  const clearLithoSuggestions = useCallback((): void => {
    // Delete the focused anchor's entry from the unified Map (debt
    // #77). Other entries (the bulk set) survive — Clear is the
    // single-anchor clear gesture, not a "wipe all ghosts" verb.
    const focusedId = focusedSuggestAnchorIdRef.current
    if (focusedId !== null) {
      setGhostsByAnchor(prev => {
        if (!prev.has(focusedId)) return prev
        const next = new Map(prev)
        next.delete(focusedId)
        return next
      })
    }
    setFocusedSuggestAnchorId(null)
    // S-1 (senior-review): also release the Suggest button — if Clear
    // is hit while a suggest fetch is in flight, the spinner would
    // otherwise stay stuck until the orphaned fetch settles.
    setLithoSuggesting(false)
    // Stale-TIN diagnostic: clearing the suggestions ends the session,
    // so reset the cumulative counter for the inspector pill.
    setLithoStaleTinSessionCount(0)
    // The old burst-safe refs (acceptedFormationByLithoRef,
    // lithoFormationInFlightRef) were removed in Phase 1 — the bulk
    // endpoint is idempotent server-side (find-or-create), so the
    // client no longer needs per-session formation caches.
  }, [])

  // ---------- Bulk-suggest (debt #73 / Phase 3) ----------
  // Multi-anchor handlers. The Map is the source of truth; each
  // handler is anchor-scoped via the anchorId arg.

  const clearBulkLithoGhosts = useCallback((): void => {
    // After unification (debt #77) the Map holds both single + bulk.
    // ``clearBulkLithoGhosts`` is the bulk-clear verb — preserve any
    // focused (single) entry, drop everything else.
    setGhostsByAnchor(prev => {
      const focusedId = focusedSuggestAnchorIdRef.current
      if (focusedId === null) return new Map()
      const entry = prev.get(focusedId)
      if (!entry) return new Map()
      return new Map([[focusedId, entry]])
    })
    setBulkLithoSuggesting(false)
  }, [])

  /**
   * Strip admixtures from ghost suggestions (dogfeed 2026-05-22).
   *
   * Sets ``suggested_admixtures: []`` as an edit on every ghost layer
   * whose anchor matches ``scope`` ('cpt' / 'borehole' / 'all'). The
   * CPT segmenter's Robertson-derived admixtures are noisier than the
   * borehole observation-log admixtures, so the common workflow is
   * "strip all, then reseed boreholes" — see ``handleReseedLithoAdmixtures``.
   * Operates on the ephemeral ghost edit map only; accept commits
   * whatever the ghost is currently showing.
   */
  const handleStripLithoAdmixtures = useCallback(
    (scope: 'cpt' | 'borehole' | 'all'): void => {
      const targets = Array.from(ghostsByAnchor.entries()).filter(
        ([, g]) =>
          (scope === 'all' || g.kind === scope) && g.suggestions.length > 0,
      )
      if (targets.length === 0) {
        toast(
          'error',
          `No ${scope === 'all' ? '' : `${scope} `}ghost suggestions to strip.`,
        )
        return
      }
      const layerCount = targets.reduce((n, [, g]) => n + g.suggestions.length, 0)
      const targetIds = new Set(targets.map(([id]) => id))
      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        for (const anchorId of targetIds) {
          const ghost = next.get(anchorId)
          if (!ghost) continue
          const nextEdits = new Map(ghost.edits)
          for (let i = 0; i < ghost.suggestions.length; i++) {
            nextEdits.set(i, {
              ...(nextEdits.get(i) ?? {}),
              suggested_admixtures: [],
            })
          }
          next.set(anchorId, { ...ghost, edits: nextEdits })
        }
        return next
      })
      log.info(
        'geology',
        `stripLithoAdmixtures scope=${scope} layers=${layerCount} anchors=${targets.length}`,
      )
      toast(
        'success',
        `Stripped admixtures from ${layerCount} layer${layerCount === 1 ? '' : 's'}.`,
      )
    },
    [ghostsByAnchor, toast],
  )

  /**
   * Reseed admixtures on borehole ghost suggestions (dogfeed 2026-05-22).
   *
   * Drops the ``suggested_admixtures`` override from every borehole
   * ghost's edit map so the layers fall back to the segmenter's raw
   * admixtures (which, for boreholes, come from the ObservationLayer
   * descriptions and are trustworthy). The inverse of a prior
   * ``handleStripLithoAdmixtures('borehole')`` / strip-all. Depth and
   * lithology edits on the same layer are preserved.
   */
  const handleReseedLithoAdmixtures = useCallback((): void => {
    const targets = Array.from(ghostsByAnchor.entries()).filter(
      ([, g]) =>
        g.kind === 'borehole' &&
        Array.from(g.edits.values()).some(
          e => e.suggested_admixtures !== undefined,
        ),
    )
    if (targets.length === 0) {
      toast('error', 'No overridden borehole admixtures to restore.')
      return
    }
    const layerCount = targets.reduce(
      (n, [, g]) =>
        n +
        Array.from(g.edits.values()).filter(
          e => e.suggested_admixtures !== undefined,
        ).length,
      0,
    )
    const targetIds = new Set(targets.map(([id]) => id))
    setGhostsByAnchor(prev => {
      const next = new Map(prev)
      for (const anchorId of targetIds) {
        const ghost = next.get(anchorId)
        if (!ghost) continue
        const nextEdits = new Map<number, LithoSuggestionEdit>()
        for (const [idx, edit] of ghost.edits) {
          if (edit.suggested_admixtures === undefined) {
            nextEdits.set(idx, edit)
            continue
          }
          // Drop only the admixture override; keep depth/lithology edits.
          const rest: LithoSuggestionEdit = { ...edit }
          delete rest.suggested_admixtures
          if (Object.keys(rest).length > 0) nextEdits.set(idx, rest)
        }
        next.set(anchorId, { ...ghost, edits: nextEdits })
      }
      return next
    })
    log.info(
      'geology',
      `reseedLithoAdmixtures boreholes layers=${layerCount} anchors=${targets.length}`,
    )
    toast(
      'success',
      `Restored segmenter admixtures on ${layerCount} borehole layer${
        layerCount === 1 ? '' : 's'
      }.`,
    )
  }, [ghostsByAnchor, toast])

  // Shared helper — apply a partial update to one entry in the
  // unified Map. Used by every per-anchor update site (single accept,
  // single reject, bulk accept, bulk reject, edit, ...). The closure
  // reads no external state besides the setter — stable dep list.
  //
  // Two call forms:
  //   _updateGhostEntry(anchorId, partial)
  //     — when the new partial is known before the setState call (no
  //       dependency on existing entry fields).
  //   _updateGhostEntry(anchorId, existing => partial)
  //     — when the new partial must be derived from the existing entry
  //       (e.g. adding an index to an existing Set). The updater runs
  //       inside setState so it always sees the latest Map snapshot.
  const _updateGhostEntry = useCallback(
    (
      anchorId: string,
      updater:
        | Partial<BulkAnchorGhost>
        | ((existing: BulkAnchorGhost) => Partial<BulkAnchorGhost>),
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const partial = typeof updater === 'function' ? updater(existing) : updater
        const next = new Map(prev)
        next.set(anchorId, { ...existing, ...partial })
        return next
      })
    },
    [],
  )

  const handleRejectBulkLitho = useCallback(
    (anchorId: string, idx: number): void => {
      _updateGhostEntry(anchorId, existing => {
        const nextRejected = new Set(existing.rejected)
        nextRejected.add(idx)
        return { rejected: nextRejected }
      })
    },
    [_updateGhostEntry],
  )

  /**
   * Undo a prior bulk reject — debt #80 mirror of the single-anchor
   * variant. No-op when idx wasn't rejected on the anchor.
   */
  const handleUnrejectBulkLitho = useCallback(
    (anchorId: string, idx: number): void => {
      // Direct setState (not _updateGhostEntry): the guard `!rejected.has(idx)`
      // returns `prev` unchanged, preserving Map identity and skipping a re-render.
      // _updateGhostEntry always produces a new Map so it cannot short-circuit here.
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing || !existing.rejected.has(idx)) return prev
        const nextRejected = new Set(existing.rejected)
        nextRejected.delete(idx)
        const next = new Map(prev)
        next.set(anchorId, { ...existing, rejected: nextRejected })
        return next
      })
    },
    [],
  )

  const handleEditBulkLitho = useCallback(
    (
      anchorId: string,
      idx: number,
      edit: LithoSuggestionEdit,
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        // Same cross-merge logic as the focused-anchor path — plain drag
        // on a bulk-suggest ghost also auto-absorbs on release when the
        // dragged edge crosses a pending neighbour's boundary.
        const updated = applyCrossMergeOnDrag(existing, idx, edit)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #85: insert a new pending litho layer at the shared boundary
  // between layers ``afterIdx`` and ``afterIdx+1``. The mutation is a
  // pure helper (insertLithoLayer) so the index-shift math has its own
  // unit test; this hook just plugs it into setGhostsByAnchor.
  const handleInsertLithoLayer = useCallback(
    (
      anchorId: string,
      afterIdx: number,
      composition: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = insertLithoLayer(existing, afterIdx, composition)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #98: split a pending litho ghost layer in two at its midpoint.
  // Mirrors handleInsertLithoLayer — the mutation is the pure helper
  // splitLithoLayer; the hook only plugs it into setGhostsByAnchor.
  const handleSplitLithoLayer = useCallback(
    (anchorId: string, idx: number): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = splitLithoLayer(existing, idx)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #102: merge two adjacent same-lithology pending layers into
  // one. Mirrors handleSplitLithoLayer — pure helper mergeLithoLayers
  // does the index-shift math; the component-level menu only offers
  // the action when canMergeAt returns true.
  const handleMergeLithoLayers = useCallback(
    (anchorId: string, upperIdx: number): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = mergeLithoLayers(existing, upperIdx)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Dogfeed 2026-05-25: Shift+drag absorb gesture. Mirrors
  // handleMergeLithoLayers — pure helper absorbLithoLayer does the
  // index-shift math; the drag handler gates on cursor past midpoint.
  const handleAbsorbLithoLayer = useCallback(
    (anchorId: string, draggerIdx: number, direction: 'up' | 'down'): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = absorbLithoLayer(existing, draggerIdx, direction)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Left-click on the LITHO axis creates a zero-thickness ghost layer
  // instead of a committed contact.  The pure helper insertManualGhostLayer
  // does the array build/sort; this callback plugs it into setGhostsByAnchor
  // and sets the focused anchor so the overlay renders immediately.
  //
  // The picker returns a formation_id; we need its litho_main_soil_code +
  // litho_admixtures.  Both live in the ``formations`` state atom that is
  // always populated before the picker can open (the picker only offers
  // litho formations from the active model).  If the formation is not
  // found (race with a concurrent delete) the ghost is still created with
  // an empty lithology string — the user can edit via the composition
  // editor before accepting.
  const handleCreateManualLithoGhost = useCallback(
    (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      surfaceElevationM: number | null,
      depth_m: number,
      formationId: string,
    ): void => {
      // Resolve lithology from the active formation list.
      const formation = formations.find(f => f.id === formationId)
      const lithology = formation?.litho_main_soil_code ?? ''
      const admixtures: readonly { soil_code: string; amount: string; locally: boolean }[] =
        formation?.litho_admixtures?.map(a => ({
          soil_code: a.soil_code,
          amount: a.amount,
          locally: a.locally,
        })) ?? []

      log.debug(
        'geology',
        `handleCreateManualLithoGhost anchor=${anchorId} depth=${depth_m.toFixed(3)}m litho=${lithology || '(not found)'}`,
      )

      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        const updated = insertManualGhostLayer(
          existing,
          anchorKind,
          surfaceElevationM,
          depth_m,
          lithology,
          admixtures,
        )
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
      // Show the ghost immediately by focusing this anchor.
      setFocusedSuggestAnchorId(anchorId)

      log.success(
        'geology',
        `handleCreateManualLithoGhost placed ghost at depth=${depth_m.toFixed(3)}m anchor=${anchorId}`,
      )
    },
    // reason: formations identity changes when server sync completes;
    // we must read the latest list to look up litho_main_soil_code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formations],
  )

  // Extend ghost layer at (anchorId, idx) to the nearest committed litho
  // contacts above and below its midpoint.  Delegates to the pure helper
  // extendGhostToNearest; returns ok/reason so the caller can toast on
  // overlap.  Synchronous — no network call.
  const handleExtendLithoGhostToNearestContacts = useCallback(
    (
      anchorId: string,
      idx: number,
      investigationMaxDepthM: number,
    ): { ok: boolean; reason?: string } => {
      const ghost = ghostsByAnchor.get(anchorId)
      if (!ghost) return { ok: false, reason: 'No ghost found for this investigation.' }

      // Collect committed contacts for this anchor.
      const contactsOnAnchor = lithoContacts.filter(c =>
        ghost.kind === 'cpt' ? c.cpt_id === anchorId : c.borehole_id === anchorId,
      )

      const result = extendGhostToNearest(
        ghost,
        idx,
        contactsOnAnchor,
        investigationMaxDepthM,
      )

      if (!result.ok) {
        log.debug(
          'geology',
          `handleExtendLithoGhostToNearestContacts overlap: anchor=${anchorId} idx=${idx} reason="${result.reason}"`,
        )
        return { ok: false, reason: result.reason }
      }

      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        next.set(anchorId, result.next)
        return next
      })

      log.success(
        'geology',
        `handleExtendLithoGhostToNearestContacts ok anchor=${anchorId} idx=${idx}`,
      )
      return { ok: true }
    },
    // reason: ghostsByAnchor and lithoContacts change by reference on mutations;
    // listing them keeps the callback fresh without identity churn on renders
    // that don't touch these atoms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ghostsByAnchor, lithoContacts],
  )

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
  // Replaces any prior single-anchor focus + writes the new entry into
  // the unified Map (debt #77).
  const handleSuggestLitho = useCallback(
    async (anchorKind: 'cpt' | 'borehole', anchorId: string): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      log.debug(
        'geology',
        `handleSuggestLitho entry kind=${anchorKind} anchor=${anchorId} model=${model.id}`,
      )
      setLithoSuggesting(true)
      // Clear prior single-anchor focus before the fetch so stale data
      // never shows. Bulk entries on OTHER anchors survive.
      clearLithoSuggestions()
      try {
        // Pull the per-project segmenter prefs out of view_state (set
        // via File → Settings…). Falls back to defaults when unset.
        // γunsat + Dr factor only ride along on the CPT path — the
        // borehole segmenter ignores stress-derived parameters (no qc).
        const prefs = readLithoSegmenterPrefs(project.view_state)
        const body =
          anchorKind === 'cpt'
            ? {
                cpt_id: anchorId,
                minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                gunsat_kNm3: prefs.gunsatKNm3,
                dr_compression_factor: prefs.drCompressionFactor,
                merge_same_lithology: prefs.mergeSameLithology,
                use_normalised_qc: prefs.useNormalisedQc,
              }
            : {
                borehole_id: anchorId,
                minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
              }
        const resp = await api.geology.suggestLitho(project.id, model.id, body)
        log.success(
          'geology',
          `suggestLitho ok ${resp.layers.length} layers for ${anchorKind} ${anchorId}`,
        )
        // Write a fresh entry under anchorId and set it as the focused
        // (single) one. If a bulk entry already existed for this anchor,
        // it is replaced — matches the prior semantics where a Suggest
        // cleared and overwrote single state.
        setGhostsByAnchor(prev => {
          const next = new Map(prev)
          next.set(anchorId, {
            kind: anchorKind,
            suggestions: resp.layers,
            surfaceElevationM: null,
            accepted: new Set<number>(),
            rejected: new Set<number>(),
            edits: new Map<number, LithoSuggestionEdit>(),
          })
          return next
        })
        setFocusedSuggestAnchorId(anchorId)
      } catch (err) {
        log.error('geology', `handleSuggestLitho failed for ${anchorId}`, err)
        toast('error', 'Could not fetch lithostratigraphic suggestions.')
      } finally {
        setLithoSuggesting(false)
      }
    },
    [project, clearLithoSuggestions, toast],
  )

  // ---- Undo support for the accept-litho-suggestions paths ----------
  // Accept commits contacts (and possibly formations) immediately, like
  // an import. Until 2026-05-22 it was the one mutation NOT on the undo
  // stack, so Ctrl+Z silently skipped past a mis-accepted layer. This
  // helper builds + pushes the UndoCommand; all four accept handlers
  // call it on success.
  //
  // One "op" = one acceptLithoSuggestions call: the request body
  // (replayed verbatim on redo), the created contact/formation ids the
  // revert deletes, and the (anchorId, idx) ghost entries to flip back
  // to pending. The accept-all-across-anchors sweep passes N ops so one
  // Ctrl+Z reverses the whole sweep.
  type AcceptLithoUndoOp = {
    body: Parameters<typeof api.geology.acceptLithoSuggestions>[2]
    createdContactIds: string[]
    createdFormationIds: string[]
    acceptedEntries: ReadonlyArray<{ anchorId: string; idx: number }>
  }
  const pushAcceptLithoUndo = useCallback(
    (
      description: string,
      lithoModelId: string,
      ops: AcceptLithoUndoOp[],
      onSectionUpdated?: ((s: CrossSectionResponse) => void) | null,
    ): void => {
      if (!project) return
      // Accepting an already-accepted layer returns only found_* ids —
      // nothing was created, so there is nothing to undo.
      const hasWork = ops.some(
        o => o.createdContactIds.length > 0 || o.createdFormationIds.length > 0,
      )
      if (!hasWork) return
      const projectId = project.id
      // Flip the ghost overlay's accepted set for every captured entry:
      // accepted=false on revert (back to pending), true on redo.
      const setAccepted = (accepted: boolean): void => {
        setGhostsByAnchor(prev => {
          const next = new Map(prev)
          let changed = false
          for (const op of ops) {
            for (const { anchorId, idx } of op.acceptedEntries) {
              const existing = next.get(anchorId)
              if (!existing) continue
              if (existing.accepted.has(idx) === accepted) continue
              const nextAccepted = new Set(existing.accepted)
              if (accepted) nextAccepted.add(idx)
              else nextAccepted.delete(idx)
              next.set(anchorId, { ...existing, accepted: nextAccepted })
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      pushUndo({
        description,
        revert: async () => {
          // Contacts first — contact.formation_id FK references formation.
          for (const op of ops) {
            await Promise.all(
              op.createdContactIds.map(id =>
                api.geology.deleteContact(projectId, lithoModelId, id),
              ),
            )
            await Promise.all(
              op.createdFormationIds.map(id =>
                api.geology.deleteFormation(projectId, id),
              ),
            )
          }
          setAccepted(false)
          refetchLithoContacts()
          refetchFormations()
        },
        reapply: async () => {
          // Re-POST each body; the server mints fresh ids, so capture
          // them back onto the op for the next revert.
          for (const op of ops) {
            const res = await api.geology.acceptLithoSuggestions(
              projectId,
              lithoModelId,
              op.body,
            )
            op.createdContactIds = res.created_contact_ids.slice()
            op.createdFormationIds = res.created_formation_ids.slice()
            // Re-seed the section so the re-created contacts pass the
            // explicit-content filter (#57 invariant).
            if (res.updated_section != null && onSectionUpdated != null) {
              onSectionUpdated(res.updated_section)
            }
          }
          setAccepted(true)
          refetchLithoContacts()
          refetchFormations()
        },
      })
    },
    [project, pushUndo, refetchLithoContacts, refetchFormations],
  )

  // Accept one suggestion layer via the bulk endpoint (one-item payload).
  // The server handles formation find-or-create, straddle splits, and
  // section seeding atomically. The caller MUST forward onSectionUpdated
  // with the response's updated_section — explicit-content invariant (#57).
  const handleAcceptLithoSuggestion = useCallback(
    async (
      idx: number,
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<AcceptLithoSuggestionsResponse | null> => {
      const model = activeLithoModelRef.current
      const layers = lithoSuggestions
      if (!project || !model || idx < 0 || idx >= layers.length) return null
      // Apply user edits (drag-resized depths) before sending. effectiveLayer
      // has the user's modified top/base; the original is still in layers[idx]
      // for the future ML training log (#4).
      const layer = effectiveLithoSuggestionAt(idx) ?? layers[idx]
      const anchorKind = lithoSuggestionAnchorKind
      const anchorId = lithoSuggestionInvestigationId
      if (!anchorKind || !anchorId) return null
      log.debug(
        'geology',
        `acceptLithoSuggestion idx=${idx} lithology=${layer.suggested_lithology} depth=${layer.depth_top_m.toFixed(2)}m sectionId=${sectionId ?? 'none'}`,
      )
      try {
        // (Previous accept-time restoration logic removed 2026-05-27
        // — owner directive: "how about we don't wire it through the
        // suggestion and it immediately becomes an accepted litho
        // layer".  Restoration now happens at INSERT time in
        // SectionsCanvas.handleManualLithoUnitCreate, so this accept
        // path stays clean for the bulk-segmenter suggest-and-accept
        // flow where restoration is not needed — adjacent suggestions
        // already tile the column.)
        const body = buildLithoAcceptBody({
          anchorKind,
          anchorId,
          sectionId,
          suggestions: [layer],
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptLithoSuggestion ok idx=${idx} created=${result.created_formation_ids.length} found=${result.found_formation_ids.length} contacts=${result.created_contact_ids.length + result.found_contact_ids.length} straddle=${result.straddle_split_count}`,
        )

        // Debt #144: an accept writes to the DB immediately but must also
        // land its created rows in the session-imports manifest, or the amber
        // dirty flag never lights and the .gmproj goes silently stale on close.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: surface a warning toast when any created unit needs
        // engineer review (TIN-extrapolated parent or fully unassigned).
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        // Forward updated_section so the section's explicit-content filter
        // includes the newly seeded contacts — #57 class trap.
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark accepted so the ghost overlay shows the tick — updates
        // the focused entry in the unified Map (debt #77).
        //
        // Robust-fix (dogfeed 2026-05-30 follow-up to Slice 3): also
        // stash the contact ids the API returned for this suggestion
        // so the cross-store dispatch in ``useBoundaryDrag`` can look
        // up the matching contact by identity (not by depth match).
        // The single-suggestion accept path is the simplest case —
        // every returned contact id belongs to THIS suggestion.
        const allContactIds = [
          ...result.created_contact_ids,
          ...result.found_contact_ids,
        ]
        const focusedAcceptId = focusedSuggestAnchorIdRef.current
        if (focusedAcceptId !== null) {
          _updateGhostEntry(focusedAcceptId, existing => {
            const nextAccepted = new Set(existing.accepted)
            nextAccepted.add(idx)
            const nextContactIds = new Map(existing.contactIdsByAcceptedIdx ?? [])
            nextContactIds.set(idx, allContactIds)
            return { accepted: nextAccepted, contactIdsByAcceptedIdx: nextContactIds }
          })
        }
        // Refetch litho contacts so the committed contact lands in
        // local state. Without this the section view keeps rendering
        // off stale `lithoContacts` — when the user focuses a
        // different investigation and re-suggests, the previous
        // CPT's accepted contacts vanish from view (dogfeed bug
        // 2026-05-20). The contact IS in the DB; only local state
        // was stale.
        refetchLithoContacts()
        // Refresh the global formations list so newly-created units land
        // in the inspector + picker dialog + overlays. lithoFormations
        // is a useMemo derived from formations (debt #89) so this single
        // call updates both.
        refetchFormations()
        // Record the accept on the undo stack (dogfeed 2026-05-22 —
        // accept was the one mutation Ctrl+Z couldn't reach).
        // Re-uses focusedAcceptId (same ref, same call frame).
        pushAcceptLithoUndo(
          `Accept litho layer (${layer.suggested_lithology})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries:
                focusedAcceptId !== null ? [{ anchorId: focusedAcceptId, idx }] : [],
            },
          ],
          onSectionUpdated ?? null,
        )
        // Debt #134-C — return the API result so the caller (the
        // SectionsCanvas wrapper) can run the post-accept litho-geo
        // snap check: scan the new contact ids against the geological
        // backdrop on the same investigation and open the snap dialog
        // if any landed within tolerance.  Pre-#134-C the handler
        // returned void; consumers that ignore the return value are
        // unaffected.
        return result
      } catch (err) {
        log.error('geology', `acceptLithoSuggestion failed idx=${idx}`, err)
        toast('error', 'Could not accept the litho suggestion.')
        return null
      }
    },
    // reason: lithoSuggestions / lithoSuggestionAnchorKind / lithoSuggestionInvestigationId
    // are read synchronously inside the callback body via closure. They are listed as deps
    // so the callback identity refreshes when the active suggestion set changes (a new
    // suggest replaces all three at once). activeLithoModelRef is a ref (stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      lithoSuggestions,
      lithoSuggestionAnchorKind,
      lithoSuggestionInvestigationId,
      effectiveLithoSuggestionAt,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  // Accept ALL non-rejected suggestion layers in one bulk call.
  // Filters out already-accepted and rejected indices, then calls
  // the same endpoint with the remaining layers.  The server's
  // find-or-create is idempotent — re-accepting an already-accepted
  // layer is safe and returns found_* ids.
  const handleAcceptAllLithoSuggestions = useCallback(
    async (
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      const layers = lithoSuggestions
      const anchorKind = lithoSuggestionAnchorKind
      const anchorId = lithoSuggestionInvestigationId
      if (!project || !model || !anchorKind || !anchorId || layers.length === 0) return
      // Collect every non-rejected layer. Already-accepted layers ARE
      // re-sent (we keep no per-layer accepted state on the client); the
      // server is idempotent — find-or-create keyed on
      // model+formation+depth+anchor — so a repeat is a cheap no-op.
      const pendingIndices = layers
        .map((_, i) => i)
        .filter(i => !lithoSuggestionRejected.has(i))
      // Apply user edits (drag-resized depths) per index so the bulk
      // commit honours the same depth modifications the per-layer
      // accept handler would have sent.
      const pendingLayers = pendingIndices.map(
        i => effectiveLithoSuggestionAt(i) ?? layers[i],
      )
      if (pendingLayers.length === 0) return
      log.debug(
        'geology',
        `acceptAllLithoSuggestions ${pendingLayers.length}/${layers.length} layers sectionId=${sectionId ?? 'none'}`,
      )
      try {
        const body = buildLithoAcceptBody({
          anchorKind,
          anchorId,
          sectionId,
          suggestions: pendingLayers,
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptAllLithoSuggestions ok created=${result.created_formation_ids.length} found=${result.found_formation_ids.length} contacts=${result.created_contact_ids.length + result.found_contact_ids.length} straddle=${result.straddle_split_count} stale_tin_fallback=${result.stale_tin_fallback_count}`,
        )
        // Debt #144: record created rows so accept-all lights the dirty flag.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: see acceptLithoSuggestion site above.
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Debt #76: surface straddle-split count so the user understands why
        // "accept all" produced more contacts than ghost layers were visible.
        const straddleMsg = formatStraddleSummary(result)
        if (straddleMsg !== null) toast('warning', straddleMsg)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        // Forward updated_section — #57 invariant.
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark all pending layers accepted in the focused entry
        // (debt #77 — single + bulk now share the unified Map).
        const focusedAllId = focusedSuggestAnchorIdRef.current
        if (focusedAllId !== null) {
          _updateGhostEntry(focusedAllId, existing => {
            const nextAccepted = new Set(existing.accepted)
            for (const i of pendingIndices) nextAccepted.add(i)
            return { accepted: nextAccepted }
          })
        }
        // Refetch litho contacts so the committed contacts land in
        // local state — without this the previous investigation's
        // committed contacts vanish from the section view when the
        // user re-focuses (dogfeed bug 2026-05-20, see handler above).
        refetchLithoContacts()
        // Single global-formations refresh — lithoFormations derives
        // from it (debt #89), so the inspector roster + picker dialog
        // update automatically.
        refetchFormations()
        // One undo entry for the whole accept-all (dogfeed 2026-05-22).
        // Re-uses focusedAllId (same ref, same call frame).
        pushAcceptLithoUndo(
          `Accept all litho layers (${pendingLayers.length})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries:
                focusedAllId !== null
                  ? pendingIndices.map(i => ({ anchorId: focusedAllId, idx: i }))
                  : [],
            },
          ],
          onSectionUpdated ?? null,
        )
      } catch (err) {
        log.error('geology', 'acceptAllLithoSuggestions failed', err)
        toast('error', 'Could not accept all litho suggestions.')
      }
    },
    // reason: all suggestion state (lithoSuggestions / lithoSuggestionAnchorKind /
    // lithoSuggestionInvestigationId / lithoSuggestionRejected) is read
    // synchronously from the closure and listed as deps so the callback
    // identity refreshes on each new suggestion set. activeLithoModelRef is a
    // ref (stable identity) and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      lithoSuggestions,
      lithoSuggestionAnchorKind,
      lithoSuggestionInvestigationId,
      lithoSuggestionRejected,
      effectiveLithoSuggestionAt,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  const handleRejectLithoSuggestion = useCallback((idx: number): void => {
    // Update the focused entry in the unified Map (debt #77).
    const focusedId = focusedSuggestAnchorIdRef.current
    if (focusedId !== null) {
      _updateGhostEntry(focusedId, existing => {
        const nextRejected = new Set(existing.rejected)
        nextRejected.add(idx)
        return { rejected: nextRejected }
      })
    }
    log.debug('geology', `rejectLithoSuggestion idx=${idx}`)
  // reason: focusedSuggestAnchorIdRef is a ref (always current); _updateGhostEntry
  // is a stable useCallback with an empty dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_updateGhostEntry])

  /**
   * Undo a prior reject — return the ghost layer to pending state.
   * Debt #80 (2026-05-20 dogfeed). No-op when idx wasn't rejected.
   */
  const handleUnrejectLithoSuggestion = useCallback((idx: number): void => {
    // Direct setState (not _updateGhostEntry): the guard `!rejected.has(idx)`
    // returns `prev` unchanged, preserving Map identity and skipping a re-render.
    // _updateGhostEntry always produces a new Map so it cannot short-circuit here.
    setGhostsByAnchor(prev => {
      const focusedId = focusedSuggestAnchorIdRef.current
      if (focusedId === null) return prev
      const existing = prev.get(focusedId)
      if (!existing || !existing.rejected.has(idx)) return prev
      const nextRejected = new Set(existing.rejected)
      nextRejected.delete(idx)
      const next = new Map(prev)
      next.set(focusedId, { ...existing, rejected: nextRejected })
      return next
    })
    log.debug('geology', `unrejectLithoSuggestion idx=${idx}`)
  }, [])

  // ---------- Bulk-suggest fan-out + accept (debt #73) ----------

  /**
   * Fan out segmenter calls across N investigations in parallel
   * (capped to 5 concurrent). Replaces any prior bulk ghost state.
   * Per-anchor results stream into bulkLithoGhosts as they arrive
   * — partial state is visible mid-fetch so the user sees columns
   * fill in incrementally.
   *
   * Surface elevations come from the existing cpts/boreholes
   * lists (closures over the latest refs).
   */
  const handleSuggestAllLitho = useCallback(
    async (
      anchors: readonly {
        kind: 'cpt' | 'borehole'
        id: string
        surfaceElevationM: number | null
      }[],
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model || anchors.length === 0) return
      log.debug(
        'geology',
        `handleSuggestAllLitho fan-out anchors=${anchors.length}`,
      )
      // Wipe prior bulk state — confirmation dialog warned the user.
      // Preserve any focused (single) entry so a Suggest-all alongside
      // a focused single doesn't drop the focus (matches prior intent;
      // previously single + bulk were independent states).
      setGhostsByAnchor(prev => {
        const focusedId = focusedSuggestAnchorIdRef.current
        if (focusedId === null) return new Map()
        const entry = prev.get(focusedId)
        if (!entry) return new Map()
        return new Map([[focusedId, entry]])
      })
      setBulkLithoSuggesting(true)
      // Snapshot prefs once per fan-out so every anchor in the same bulk
      // call uses the same min-thickness — avoids race where the user
      // adjusts the slider mid-fan-out.
      const prefs = readLithoSegmenterPrefs(project.view_state)
      const CONCURRENCY = 5
      let cursor = 0
      const failures: string[] = []
      async function worker(): Promise<void> {
        while (cursor < anchors.length) {
          const anchorIdx = cursor++
          if (anchorIdx >= anchors.length) return
          const { kind, id, surfaceElevationM } = anchors[anchorIdx]
          try {
            const body =
              kind === 'cpt'
                ? {
                    cpt_id: id,
                    minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                    gunsat_kNm3: prefs.gunsatKNm3,
                    dr_compression_factor: prefs.drCompressionFactor,
                    merge_same_lithology: prefs.mergeSameLithology,
                    use_normalised_qc: prefs.useNormalisedQc,
                  }
                : {
                    borehole_id: id,
                    minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                  }
            const resp = await api.geology.suggestLitho(project!.id, model!.id, body)
            setGhostsByAnchor(prev => {
              const next = new Map(prev)
              next.set(id, {
                kind,
                suggestions: resp.layers,
                surfaceElevationM,
                accepted: new Set(),
                rejected: new Set(),
                edits: new Map(),
              })
              return next
            })
          } catch (err) {
            log.warn('geology', `bulk suggest failed anchor=${id}`, err)
            failures.push(id)
          }
        }
      }
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, anchors.length) },
        () => worker(),
      )
      try {
        await Promise.all(workers)
        log.success(
          'geology',
          `handleSuggestAllLitho done anchors=${anchors.length} failures=${failures.length}`,
        )
        if (failures.length > 0) {
          toast(
            'error',
            `Suggested ${anchors.length - failures.length}/${anchors.length} — ${failures.length} failed.`,
          )
        }
      } finally {
        setBulkLithoSuggesting(false)
      }
    },
    // reason: activeLithoModelRef is a ref (stable). Project + toast
    // are the true deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, toast],
  )

  /**
   * Accept one suggestion layer for one bulk anchor — single-item call.
   * Uses the same backend endpoint as ``handleAcceptLithoSuggestion``
   * but pulls the layer out of the bulk Map instead of the single-anchor
   * state. The accepted layer's idx is added to the anchor's accepted set
   * so the ghost overlay marks it.
   *
   * Refetches litho contacts on success so the section renders the
   * committed contact immediately (same fix shape as the single-anchor
   * path — dogfeed 2026-05-20).
   */
  const handleAcceptBulkLitho = useCallback(
    async (
      anchorId: string,
      idx: number,
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      // Read from the unified Map — debt #77 Phase 2. anchorId
      // discriminates whether this is a bulk entry or the focused
      // single; the accept logic is identical either way.
      const ghost = ghostsByAnchor.get(anchorId)
      if (!ghost || idx < 0 || idx >= ghost.suggestions.length) return
      const raw = ghost.suggestions[idx]
      const edit = ghost.edits.get(idx)
      const layer = edit
        ? {
            ...raw,
            depth_top_m: edit.depth_top_m ?? raw.depth_top_m,
            depth_base_m: edit.depth_base_m ?? raw.depth_base_m,
            suggested_lithology:
              (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
              raw.suggested_lithology,
            suggested_admixtures: edit.suggested_admixtures
              ? edit.suggested_admixtures.map(a => ({ ...a }))
              : raw.suggested_admixtures,
          }
        : raw
      try {
        const body = buildLithoAcceptBody({
          anchorKind: ghost.kind,
          anchorId,
          sectionId,
          suggestions: [layer],
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptBulkLitho ok anchor=${anchorId} idx=${idx} contacts=${result.created_contact_ids.length + result.found_contact_ids.length}`,
        )
        // Debt #144: record created rows so this bulk accept lights the dirty flag.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: warn when this single bulk accept produced any unit
        // needing review.
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark this idx accepted on the anchor (unified Map — debt #77).
        _updateGhostEntry(anchorId, existing => {
          const nextAccepted = new Set(existing.accepted)
          nextAccepted.add(idx)
          return { accepted: nextAccepted }
        })
        refetchLithoContacts()
        refetchFormations()
        // Record the accept on the undo stack (dogfeed 2026-05-22).
        pushAcceptLithoUndo(
          `Accept litho layer (${layer.suggested_lithology})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries: [{ anchorId, idx }],
            },
          ],
          onSectionUpdated ?? null,
        )
      } catch (err) {
        log.error('geology', `acceptBulkLitho failed anchor=${anchorId} idx=${idx}`, err)
        toast('error', 'Could not accept the litho suggestion.')
      }
    },
    // reason: activeLithoModelRef is a ref (stable identity); not listed.
    // ghostsByAnchor is in deps so the callback refreshes when the user
    // suggests/accepts/edits — the read of ghostsByAnchor.get(anchorId)
    // must see the latest map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      ghostsByAnchor,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  /**
   * Accept ALL non-rejected layers across ALL bulk anchors. One
   * accept-litho-suggestions call per anchor (sequential to keep the
   * section's seeded_formation_contact_ids update ordering coherent).
   * Edited depths are applied per anchor; failures per anchor are
   * surfaced via a single warning toast at the end.
   */
  const handleAcceptAllBulkLitho = useCallback(
    async (
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      // Bulk = unified Map minus the focused (single) entry. The focused
      // anchor has its own Accept-all-pending verb; this verb only
      // sweeps non-focused anchors.
      if (!project || !model || bulkGhostsByAnchor.size === 0) return
      log.debug('geology', `acceptAllBulkLitho anchors=${bulkGhostsByAnchor.size} (batch endpoint)`)
      // Snapshot the Map entries so subsequent setState calls don't mutate
      // what we iterate.
      const entries = Array.from(bulkGhostsByAnchor.entries())

      // Build one batch payload covering every anchor with pending layers.
      // Each anchor keeps a single-accept-shaped ``body`` so the undo's
      // reapply (which re-POSTs via the single endpoint) stays unchanged.
      type AnchorPlan = {
        anchorId: string
        pendingIndices: number[]
        body: AcceptLithoUndoOp['body']
      }
      const plans: AnchorPlan[] = []
      for (const [anchorId, ghost] of entries) {
        const pendingIndices = ghost.suggestions
          .map((_, i) => i)
          .filter(i => !ghost.rejected.has(i))
        if (pendingIndices.length === 0) continue
        // Apply per-index edits — depth + composition overrides (#72).
        const pendingLayers = pendingIndices.map(i => {
          const raw = ghost.suggestions[i]
          const edit = ghost.edits.get(i)
          return edit
            ? {
                ...raw,
                depth_top_m: edit.depth_top_m ?? raw.depth_top_m,
                depth_base_m: edit.depth_base_m ?? raw.depth_base_m,
                suggested_lithology:
                  (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
                  raw.suggested_lithology,
                suggested_admixtures: edit.suggested_admixtures
                  ? edit.suggested_admixtures.map(a => ({ ...a }))
                  : raw.suggested_admixtures,
              }
            : raw
        })
        plans.push({
          anchorId,
          pendingIndices,
          body: {
            ...(ghost.kind === 'cpt' ? { cpt_id: anchorId } : { borehole_id: anchorId }),
            section_id: sectionId ?? null,
            suggestions: pendingLayers,
            defer_inference: true,
          },
        })
      }
      if (plans.length === 0) return

      // ONE call: all anchors committed in a single transaction, the section
      // seeded once, and inference recomputed once — server-side (#153 batch
      // lever). Replaces the per-anchor accept loop + the separate recompute
      // call. Auto-correlate stays a separate call (its on-accept behaviour is
      // still under review — #140).
      let resp: BatchAcceptLithoSuggestionsResponse
      try {
        resp = await api.geology.batchAcceptLithoSuggestions(project.id, model.id, {
          anchors: plans.map(p => ({
            ...(p.body.cpt_id != null ? { cpt_id: p.body.cpt_id } : {}),
            ...(p.body.borehole_id != null ? { borehole_id: p.body.borehole_id } : {}),
            suggestions: p.body.suggestions,
          })),
          section_id: sectionId ?? null,
          run_inference: true,
          ...lithoAcceptTuningParams(project.view_state),
        })
      } catch (err) {
        log.error('geology', 'acceptAllBulkLitho batch call failed', err)
        toast('error', 'Could not accept litho layers.')
        return
      }

      // Index the per-anchor results by anchor id (= cpt_id or borehole_id).
      const resultByAnchor = new Map(
        resp.anchors.map(a => [(a.cpt_id ?? a.borehole_id) as string, a]),
      )
      if (resp.updated_section != null && onSectionUpdated != null) {
        onSectionUpdated(resp.updated_section)
      }
      if (resp.total_stale_tin_fallbacks > 0) {
        setLithoStaleTinSessionCount(c => c + resp.total_stale_tin_fallbacks)
      }

      // Mark accepted indices for every committed anchor in a single setState,
      // and collect one undo op per committed anchor.
      const collectedOps: AcceptLithoUndoOp[] = []
      const acceptedByAnchor = new Map<string, number[]>()
      const failures: string[] = []
      // Debt #144: aggregate every committed anchor's created rows so the
      // whole bulk accept marks the project dirty in two manifest calls
      // (one per kind), not N. Mirrors the single-accept handlers.
      const createdContactIdsAll: string[] = []
      const createdFormationIdsAll: string[] = []
      for (const plan of plans) {
        const r = resultByAnchor.get(plan.anchorId)
        if (r == null || r.error != null) {
          failures.push(plan.anchorId)
          continue
        }
        acceptedByAnchor.set(plan.anchorId, plan.pendingIndices)
        createdContactIdsAll.push(...r.created_contact_ids)
        createdFormationIdsAll.push(...r.created_formation_ids)
        collectedOps.push({
          body: plan.body,
          createdContactIds: r.created_contact_ids.slice(),
          createdFormationIds: r.created_formation_ids.slice(),
          acceptedEntries: plan.pendingIndices.map(idx => ({ anchorId: plan.anchorId, idx })),
        })
      }
      recordCreatedRows(addToSessionImports, {
        created_formation_ids: createdFormationIdsAll,
        created_contact_ids: createdContactIdsAll,
      })
      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        let changed = false
        for (const [anchorId, indices] of acceptedByAnchor) {
          const existing = next.get(anchorId)
          if (!existing) continue
          const nextAccepted = new Set(existing.accepted)
          for (const i of indices) nextAccepted.add(i)
          next.set(anchorId, { ...existing, accepted: nextAccepted })
          changed = true
        }
        return changed ? next : prev
      })

      const committedCount = plans.length - failures.length
      log.success(
        'geology',
        `acceptAllBulkLitho done anchors=${plans.length} committed=${committedCount} ` +
          `contacts=${resp.total_created_contacts} failures=${failures.length} ` +
          `inference_ran=${resp.inference_ran} extrapolated=${resp.total_extrapolated_formations} ` +
          `orphan=${resp.total_orphan_formations}`,
      )
      toast(
        'success',
        `Accepted ${committedCount} anchor${committedCount === 1 ? '' : 's'}` +
          (resp.inference_ran ? ' — inference updated.' : '.'),
      )

      // #140 (owner directive 2026-05-28): auto-correlate is DECOUPLED from
      // accept-all. Bulk accept no longer silently creates correlation edges —
      // the user runs Auto-correlate explicitly from the correlation toolbar
      // when they want it, so accepting suggestions never surprises them with
      // amber edges. (handleAutoCorrelate remains the manual entry point.)

      // Debt #87: ONE aggregated warning naming the total units needing review.
      const aggSummary = formatAcceptParentSummary({
        created_formation_ids: [],
        found_formation_ids: [],
        created_contact_ids: [],
        found_contact_ids: [],
        straddle_split_count: 0,
        stale_tin_fallback_count: 0,
        extrapolated_formation_ids: new Array(resp.total_extrapolated_formations).fill(''),
        orphan_formation_ids: new Array(resp.total_orphan_formations).fill(''),
        updated_section: null,
      })
      if (aggSummary !== null) toast(aggSummary.kind, aggSummary.message)
      if (failures.length > 0) {
        toast('error', `Accepted ${committedCount}/${plans.length} — ${failures.length} failed.`)
      }
      refetchLithoContacts()
      refetchFormations()
      pushAcceptLithoUndo(
        `Accept all litho layers (${collectedOps.length} investigation${
          collectedOps.length === 1 ? '' : 's'
        })`,
        model.id,
        collectedOps,
        onSectionUpdated ?? null,
      )
    },
    // reason: activeLithoModelRef is a ref. bulkGhostsByAnchor is in
    // deps so the snapshot the loop iterates is always the latest
    // (a stale closure would iterate yesterday's anchors).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      bulkGhostsByAnchor,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

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
    lithoStaleTinSessionCount,
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
    // Phase 2 of debt #77 (2026-05-21): bus exposes the unified Map
    // + the focused-anchor flag. Consumers compute "focused" and
    // "bulk subset" themselves (see SectionsCanvas + SectionsToolbar).
    ghostsByAnchor,
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
  }
}
