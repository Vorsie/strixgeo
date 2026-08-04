/**
 * Geology API client — typed wrappers for all geological-model, litho,
 * body, and geotechnical-unit endpoints.
 *
 * Covers:
 *   - ``/projects/{pid}/geology/formations/*`` — geological formation vocabulary
 *   - ``/projects/{pid}/geology/models/*`` — model CRUD, activation, surface build
 *   - ``/projects/{pid}/geology/models/{mid}/contacts/*`` — formation contacts
 *   - ``/projects/{pid}/geology/models/{mid}/layers/*`` — litho layers (Shape A)
 *   - ``/projects/{pid}/geology/models/{mid}/bodies/*`` — body (lens) entities
 *   - ``/projects/{pid}/geology/models/{mid}/contact-correlations/*`` — edges
 *   - ``/projects/{pid}/geology/formations/{fid}/units`` — geotechnical units
 *   - ``/projects/{pid}/geology/models/{mid}/export/plaxis3d`` — 3D export
 *
 * ``CrossSectionResponse`` is imported from the section module because
 * several response shapes embed an ``updated_section`` field.
 *
 * @module clients/geology
 */
import {
  _base,
  del,
  delReturning,
  detailMessage,
  fetchTracked,
  get,
  getBytes,
  patch,
  post,
  put,
} from './shared'
import { geotechBandsClient } from './geotechBands'
import { log } from '../../utils/log'
import type { CrossSectionResponse } from './section'
import type { VoxelBuildRequest } from '../../utils/buildVoxelRequest'

// All request/response types live in geology.types.ts; re-export the
// full catalogue so existing callers keep importing from this module.
export * from './geology.types'

import { DuplicateContactError } from './geology.types'
import type {
  GeologicalFormationResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationUpdatePayload,
  GeologicalModelResponse,
  GeologicalModelCreatePayload,
  GeologicalModelUpdatePayload,
  FormationContactResponse,
  FormationContactCreatePayload,
  FormationContactUpdatePayload,
  FormationContactBatchUpdateEntry,
  FormationContactBatchUpdateResponse,
  LithoLayerStatus,
  LithoLayerResponse,
  LithoLayerUpdatePayload,
  LithoLayerCreateItem,
  LithoLayerBoundaryMovePayload,
  LithoLayerBoundaryMoveResponse,
  LithoLayerBatchUpdateItem,
  LithoLayerBatchUpdateResponse,
  LithoSuggestionResponse,
  LithoSuggestionRequest,
  AcceptLithoSuggestionsRequest,
  AcceptLithoSuggestionsResponse,
  BatchAcceptLithoSuggestionsRequest,
  BatchAcceptLithoSuggestionsResponse,
  AutoPopulateMode,
  AutoPopulateFromStratigraphyResponse,
  DiscoverFromStratigraphyResponse,
  DeduplicateContactsResponse,
  LithoBodySolidResponse,
  RebuildLithoSolidsResponse,
  UpdateBodyColorResponse,
  RebuildSurfacesResponse,
  FormationSurfaceResponse,
  CrossingValidationResponse,
  GroundSurfaceBuildResponse,
  LithoContactCorrelationEdge,
  CrossingPinchOut,
  DeleteAutoCorrelationsResult,
  NameBodyRequest,
  NameBodyResponse,
  FormationAbsenceItem,
  UpsertFormationAbsenceRequest,
  UpsertFormationAbsenceResponse,
  BodyListItem,
  BodyBoundaryNode,
  BodyRenderStyle,
  BodyBoundaryResponse,
  ClearBoundariesResponse,
  SubdivideAllBodiesResponse,
  DivideBoreholePreviewResponse,
  DivideBoreholeResponse,
  AutoCorrelateGeotechResponse,
} from './geology.types'

// ---------------------------------------------------------------------------
// Geology API surface — ``api.geology``
// ---------------------------------------------------------------------------

/** Typed wrappers for all geology-domain endpoints. */
export const geologyClient = {
  // Geotech packing-band hand edits (split / merge, preview + commit) live in their own
  // module — this file is already past the 500-line god-module line (debt #201).
  ...geotechBandsClient,

  // Download the geological model as a runnable Plaxis 3D
  // plxscripting Python script. Returns the raw bytes so the
  // caller can pipe to the Electron save-dialog + write-file IPC pair.
  exportPlaxis3d: (projectId: string, modelId: string): Promise<ArrayBuffer> =>
    getBytes(
      `/projects/${projectId}/geology/models/${modelId}/export/plaxis3d`,
      'Plaxis export failed',
    ),

  // --- Formations vocabulary -------------------------------------------
  listFormations: (projectId: string): Promise<GeologicalFormationResponse[]> =>
    get(`/projects/${projectId}/geology/formations`),

  createFormation: (
    projectId: string,
    body: GeologicalFormationCreatePayload,
  ): Promise<GeologicalFormationResponse> =>
    post(`/projects/${projectId}/geology/formations`, body),

  updateFormation: (
    projectId: string,
    formationId: string,
    body: GeologicalFormationUpdatePayload,
  ): Promise<GeologicalFormationResponse> =>
    patch(`/projects/${projectId}/geology/formations/${formationId}`, body),

  deleteFormation: (projectId: string, formationId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/formations/${formationId}`),

  // --- Geological models -----------------------------------------------
  listModels: (projectId: string): Promise<GeologicalModelResponse[]> =>
    get(`/projects/${projectId}/geology/models`),

  createModel: (
    projectId: string,
    body: GeologicalModelCreatePayload,
  ): Promise<GeologicalModelResponse> =>
    post(`/projects/${projectId}/geology/models`, body),

  updateModel: (
    projectId: string,
    modelId: string,
    body: GeologicalModelUpdatePayload,
  ): Promise<GeologicalModelResponse> =>
    patch(`/projects/${projectId}/geology/models/${modelId}`, body),

  activateModel: (projectId: string, modelId: string): Promise<GeologicalModelResponse> =>
    post(`/projects/${projectId}/geology/models/${modelId}/activate`, {}),

  deleteModel: (projectId: string, modelId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/models/${modelId}`),

  // --- Formation contacts (per model) ----------------------------------
  listContacts: (
    projectId: string,
    modelId: string,
    filters?: { boreholeId?: string; formationId?: string },
  ): Promise<FormationContactResponse[]> => {
    const q = new URLSearchParams()
    if (filters?.boreholeId) q.set('borehole_id', filters.boreholeId)
    if (filters?.formationId) q.set('formation_id', filters.formationId)
    const qs = q.toString()
    return get(
      `/projects/${projectId}/geology/models/${modelId}/contacts${qs ? `?${qs}` : ''}`,
    )
  },

  // ─────────────────────────────────────────────────────────────────────
  // Unified litho boundary model — layer endpoints.
  // The model_id passed in MUST belong to a litho (kind='lithostratigraphic')
  // model. For geological models, keep using the contact endpoints above.
  // ─────────────────────────────────────────────────────────────────────

  /** GET /models/{mid}/layers — list every layer for one litho model. */
  listLayers: (
    projectId: string,
    modelId: string,
    filters?: {
      boreholeId?: string
      cptId?: string
      formationId?: string
      status?: LithoLayerStatus
    },
  ): Promise<LithoLayerResponse[]> => {
    const q = new URLSearchParams()
    if (filters?.boreholeId) q.set('borehole_id', filters.boreholeId)
    if (filters?.cptId) q.set('cpt_id', filters.cptId)
    if (filters?.formationId) q.set('formation_id', filters.formationId)
    if (filters?.status) q.set('status', filters.status)
    const qs = q.toString()
    return get(
      `/projects/${projectId}/geology/models/${modelId}/layers${qs ? `?${qs}` : ''}`,
    )
  },

  /** PATCH /models/{mid}/layers/{lid} — partial update on one layer. */
  updateLayer: async (
    projectId: string,
    modelId: string,
    layerId: string,
    patchPayload: LithoLayerUpdatePayload,
  ): Promise<LithoLayerResponse | null> => {
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      },
    )
    if (res.status === 404) return null
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `updateLayer failed (${res.status})`)
    }
    return res.json()
  },

  /** DELETE /models/{mid}/layers/{lid} — hard delete. */
  deleteLayer: async (projectId: string, modelId: string, layerId: string): Promise<void> => {
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 404) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `deleteLayer failed (${res.status})`)
    }
  },

  /** POST /models/{mid}/layers — bulk-create N layers in one transaction. */
  bulkCreateLayers: (
    projectId: string,
    modelId: string,
    layers: readonly LithoLayerCreateItem[],
    sectionId?: string | null,
  ): Promise<LithoLayerResponse[]> => {
    const body: { layers: readonly LithoLayerCreateItem[]; section_id?: string } = { layers }
    if (sectionId) body.section_id = sectionId
    return post(
      `/projects/${projectId}/geology/models/${modelId}/layers`,
      body,
      'bulkCreateLayers failed',
    )
  },

  /** PATCH /models/{mid}/layers/boundary-move — atomic shared-boundary move. */
  moveLayerBoundary: (
    projectId: string,
    modelId: string,
    payload: LithoLayerBoundaryMovePayload,
  ): Promise<LithoLayerBoundaryMoveResponse> =>
    patch(
      `/projects/${projectId}/geology/models/${modelId}/layers/boundary-move`,
      payload,
      'moveLayerBoundary failed',
    ),

  /** PATCH /models/{mid}/layers/batch-update — atomic N-row PATCH. */
  batchUpdateLayers: (
    projectId: string,
    modelId: string,
    updates: readonly LithoLayerBatchUpdateItem[],
  ): Promise<LithoLayerBatchUpdateResponse> =>
    patch(
      `/projects/${projectId}/geology/models/${modelId}/layers/batch-update`,
      { updates },
      'batchUpdateLayers failed',
    ),

  /** POST /models/{mid}/layers/{lid}/link-geo — link layer to nearest geo contact. */
  linkLayerToGeo: async (
    projectId: string,
    modelId: string,
    layerId: string,
  ): Promise<LithoLayerResponse | null> => {
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}/link-geo`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `linkLayerToGeo failed (${res.status})`)
    }
    // 200 with a JSON `null` body is the no-match-in-range outcome.
    const text = await res.text()
    if (!text || text === 'null') return null
    return JSON.parse(text)
  },

  createContact: async (
    projectId: string,
    modelId: string,
    body: FormationContactCreatePayload,
  ): Promise<FormationContactResponse> => {
    // Inline-handled instead of routing through the generic ``post``
    // helper because we need to surface the 409 ``existing_contact_id``
    // as a typed DuplicateContactError so the caller can route to a
    // "move existing" PATCH instead of an opaque toast.
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/contacts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      if (
        res.status === 409 &&
        detail.detail?.code === 'duplicate_contact' &&
        typeof detail.detail.existing_contact_id === 'string'
      ) {
        throw new DuplicateContactError(detail.detail.existing_contact_id)
      }
      throw new Error(
        detailMessage(detail.detail) ?? `Create contact failed: ${res.status}`,
      )
    }
    return res.json()
  },

  updateContact: async (
    projectId: string,
    modelId: string,
    contactId: string,
    body: FormationContactUpdatePayload,
  ): Promise<FormationContactResponse | null> => {
    // 204 No Content = drag-down cross-merge absorbed the dragger.
    // The generic patch<T> helper unconditionally calls res.json() which
    // throws a SyntaxError on an empty body — handle 204 explicitly here
    // so callers can detect absorption and prune local state.
    log.debug('api', '[api.updateContact] →', { contactId, modelId, patch: body })
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    log.debug('api', '[api.updateContact] ←', { contactId, status: res.status })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `PATCH contacts/${contactId} → ${res.status}`)
    }
    if (res.status === 204) return null
    return res.json()
  },

  deleteContact: (projectId: string, modelId: string, contactId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}`),

  // Clear ALL content from a lithostratigraphic model (debt #94 fix).
  clearLithoModel: async (
    projectId: string,
    modelId: string,
  ): Promise<{ contacts: number; edges: number; surfaces: number; formations: number }> => {
    const res = await fetchTracked(
      `${_base}/projects/${projectId}/geology/models/${modelId}/contacts`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(
        detailMessage(detail.detail) ?? `Clear litho model failed: ${res.status}`,
      )
    }
    return res.json()
  },

  // All-or-nothing batch update for the multi-drag flow.
  updateContactsBatch: (
    projectId: string,
    modelId: string,
    updates: readonly FormationContactBatchUpdateEntry[],
  ): Promise<FormationContactBatchUpdateResponse> =>
    put(`/projects/${projectId}/geology/models/${modelId}/contacts/batch`, { updates }),

  // Seed the model with contacts derived from each borehole's formal stratigraphy.
  autoPopulateFromStratigraphy: (
    projectId: string,
    modelId: string,
    boreholeIds: readonly string[],
    selectedKeys?: readonly string[],
    manualMap?: Record<string, string>,
    sectionId?: string | null,
    createMissingFormations?: boolean,
    // What to do with formations NOT in selectedKeys. Omitted → the server's
    // 'add' default, which deletes nothing. Only send 'overwrite' after the
    // user has confirmed it against a named list of the units that will go.
    mode?: AutoPopulateMode,
  ): Promise<AutoPopulateFromStratigraphyResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contacts/auto-populate`,
      {
        borehole_ids: boreholeIds,
        ...(selectedKeys !== undefined ? { selected_keys: selectedKeys } : {}),
        ...(manualMap !== undefined && Object.keys(manualMap).length > 0
          ? { manual_map: manualMap }
          : {}),
        ...(sectionId != null ? { section_id: sectionId } : {}),
        ...(createMissingFormations === false
          ? { create_missing_formations: false }
          : {}),
        ...(mode !== undefined ? { mode } : {}),
      },
    ),

  // Read-only scan: returns candidate formation names from borehole stratigraphy.
  discoverFromStratigraphy: (
    projectId: string,
    modelId: string,
    boreholeIds: readonly string[],
    manualMap?: Record<string, string>,
  ): Promise<DiscoverFromStratigraphyResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contacts/discover-from-stratigraphy`,
      {
        borehole_ids: boreholeIds,
        ...(manualMap !== undefined && Object.keys(manualMap).length > 0
          ? { manual_map: manualMap }
          : {}),
      },
    ),

  // List every cached TIN surface in the model.
  listSurfaces: (
    projectId: string,
    modelId: string,
  ): Promise<FormationSurfaceResponse[]> =>
    get(`/projects/${projectId}/geology/models/${modelId}/surfaces`),

  // One-shot cleanup for legacy duplicates.
  dedupeContacts: (projectId: string, modelId: string): Promise<DeduplicateContactsResponse> =>
    post(`/projects/${projectId}/geology/models/${modelId}/contacts/dedupe`, {}),

  // Manual escape hatch — force-recompute every formation's TIN cache.
  rebuildSurfaces: (
    projectId: string,
    modelId: string,
    method: 'tin' = 'tin',
  ): Promise<RebuildSurfacesResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/surfaces/rebuild?method=${method}`,
      {},
    ),

  // --- Litho body solids (3-D watertight solids per lithostratigraphic body) ---

  /** GET .../litho-solids — list every cached solid for a litho model. */
  listLithoSolids: (
    projectId: string,
    modelId: string,
  ): Promise<LithoBodySolidResponse[]> =>
    get(`/projects/${projectId}/geology/models/${modelId}/litho-solids`),

  /**
   * POST .../litho-solids/build-voxel — build the 3-D solids from the frontend's
   * validated 2-D voxel partitions (the ``computeSectionFill`` source of truth).
   *
   * Labels a 3-D voxel grid from the supplied per-section partitions and
   * extracts each body's watertight mesh.  ``force`` defaults to true
   * server-side (the on-click Build always re-meshes), so it is not passed
   * here.  (The retired strat-field ``rebuildLithoSolids`` sibling was
   * deleted with its backend endpoint — #237.)
   *
   * Parameters
   * ----------
   * projectId
   *     Project scope guard.
   * modelId
   *     The active lithostratigraphic model id.
   * request
   *     The assembled ``VoxelBuildRequest`` (per-section partitions + spacings).
   */
  buildVoxelLithoModel: (
    projectId: string,
    modelId: string,
    request: VoxelBuildRequest,
  ): Promise<RebuildLithoSolidsResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/litho-solids/build-voxel`,
      request,
    ),

  /**
   * PATCH .../bodies/{bodyId}/color — set or clear the per-body display colour.
   *
   * Pass ``color: null`` to reset to the formation's lithology colour in the
   * 3-D viewer.  Uses the ``/color`` sub-route, not the generic PATCH body
   * endpoint (which requires a non-empty ``name``).
   */
  setBodyColor: (
    projectId: string,
    modelId: string,
    bodyId: string,
    color: string | null,
  ): Promise<UpdateBodyColorResponse> =>
    patch(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/color`, {
      display_color: color,
    }),

  validateCrossings: (
    projectId: string,
    modelId: string,
  ): Promise<CrossingValidationResponse> =>
    get(`/projects/${projectId}/geology/models/${modelId}/validate/crossings`),

  suggestLitho: (
    projectId: string,
    modelId: string,
    body: LithoSuggestionRequest,
  ): Promise<LithoSuggestionResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contacts/suggest-litho`,
      body,
    ),

  acceptLithoSuggestions: (
    projectId: string,
    modelId: string,
    body: AcceptLithoSuggestionsRequest,
  ): Promise<AcceptLithoSuggestionsResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/layers/accept-litho-suggestions`,
      body,
    ),

  batchAcceptLithoSuggestions: (
    projectId: string,
    modelId: string,
    body: BatchAcceptLithoSuggestionsRequest,
  ): Promise<BatchAcceptLithoSuggestionsResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/layers/batch-accept-litho-suggestions`,
      body,
    ),

  // Build the DEM ground-surface TIN for the model's investigation hull.
  buildGroundSurface: (projectId: string, modelId: string): Promise<GroundSurfaceBuildResponse> =>
    post(`/projects/${projectId}/geology/models/${modelId}/ground-surface/build`, {}),

  // --- Contact-level correlation edges (#133 Phase 1, #135 lens) -------
  listContactCorrelations: (
    projectId: string,
    modelId: string,
    // Optional section scope (owner directive 2026-06-08): when given, only
    // edges AUTHORED on this section (edge.section_id === sectionId) are
    // returned — so the section view renders only its own ribbons and the
    // auto-correlate pre-check counts this section's suggestions, not the
    // whole model's.
    sectionId?: string | null,
  ): Promise<LithoContactCorrelationEdge[]> =>
    get(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations` +
        (sectionId ? `?section_id=${sectionId}` : ''),
    ),

  createContactCorrelation: (
    projectId: string,
    modelId: string,
    layerAId: string,
    layerBId: string,
    requestSectionId?: string | null,
    // Per-endpoint side (bottom-tie spec 2026-06-17). Both 'base' = a
    // bottom-tie. Default 'top' keeps every existing caller unchanged; the
    // base-handle gesture (Task 8) passes 'base'/'base'.
    layerASide: 'top' | 'base' = 'top',
    layerBSide: 'top' | 'base' = 'top',
  ): Promise<{ edge_id: string; was_created: boolean }> =>
    post(`/projects/${projectId}/geology/models/${modelId}/contact-correlations`, {
      layer_a_id: layerAId,
      layer_b_id: layerBId,
      source: 'manual',
      request_section_id: requestSectionId ?? null,
      layer_a_side: layerASide,
      layer_b_side: layerBSide,
    }),

  // DELETE with JSON body — the shared del() helper does not pass a body.
  deleteContactCorrelation: async (
    projectId: string,
    modelId: string,
    layerAId: string,
    layerBId: string,
    requestSectionId?: string | null,
    // Side must match the edge being deleted — a base-tie and a top-tie on the
    // same pair are distinct rows (bottom-tie spec 2026-06-17). Default 'top'.
    layerASide: 'top' | 'base' = 'top',
    layerBSide: 'top' | 'base' = 'top',
  ): Promise<void> => {
    const path = `/projects/${projectId}/geology/models/${modelId}/contact-correlations`
    const res = await fetchTracked(`${_base}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layer_a_id: layerAId,
        layer_b_id: layerBId,
        request_section_id: requestSectionId ?? null,
        layer_a_side: layerASide,
        layer_b_side: layerBSide,
      }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `DELETE ${path} → ${res.status}`)
    }
  },

  propagateCorrelatedLithoAdmixtures: (
    projectId: string,
    modelId: string,
    formationId: string,
    admixtures: Array<{ soil_code: string; amount: string; locally: boolean }>,
  ): Promise<{ updated_formations: GeologicalFormationResponse[]; component_size: number }> =>
    patch(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/admixtures`,
      { formation_id: formationId, admixtures },
    ),

  // --- Body (formerly lens) CRUD (Slice 3 backend / Slice 5 FE rename) --
  listLenses: (projectId: string, modelId: string): Promise<BodyListItem[]> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies`),

  getBodyBoundary: (
    projectId: string,
    modelId: string,
    bodyId: string,
  ): Promise<BodyBoundaryResponse> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary`),

  saveBodyBoundary: (
    projectId: string,
    modelId: string,
    bodyId: string,
    body: {
      upper_nodes: BodyBoundaryNode[]
      lower_nodes: BodyBoundaryNode[]
      render_style: BodyRenderStyle
    },
    sectionId?: string,
  ): Promise<BodyBoundaryResponse> =>
    put(
      `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary` +
        (sectionId ? `?section_id=${sectionId}` : ''),
      body,
    ),

  nameBody: (
    projectId: string,
    modelId: string,
    bodyId: string,
    body: NameBodyRequest,
  ): Promise<NameBodyResponse> =>
    patch(
      `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}`,
      body,
    ),

  deleteBody: (projectId: string, modelId: string, bodyId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}`),

  /**
   * DELETE /models/{mid}/boundaries — reset all hand-drawn body boundaries.
   *
   * The "Reset manual points" bulk action: clears every user-authored
   * boundary shape (+ its control nodes) for the litho model, so all bodies
   * return to their engine-computed shape. Returns the number of shapes
   * cleared.
   */
  resetManualBoundaries: (
    projectId: string,
    modelId: string,
  ): Promise<ClearBoundariesResponse> =>
    delReturning(`/projects/${projectId}/geology/models/${modelId}/boundaries`),

  listFormationAbsences: (
    projectId: string,
    formationId: string,
  ): Promise<FormationAbsenceItem[]> =>
    get(`/projects/${projectId}/geology/formations/${formationId}/absences`),

  upsertFormationAbsence: (
    projectId: string,
    formationId: string,
    body: UpsertFormationAbsenceRequest,
  ): Promise<UpsertFormationAbsenceResponse> =>
    post(`/projects/${projectId}/geology/formations/${formationId}/absences`, body),

  createPerpendicularCompanion: (
    projectId: string,
    modelId: string,
    bodyId: string,
  ): Promise<CrossSectionResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/perpendicular-companion`,
      {},
    ),

  // --- Auto-correlate contacts (#133 Phase 2) --------------------------
  autoCorrelateContacts: (
    projectId: string,
    modelId: string,
    depthWindowM?: number | null,
    sectionId?: string | null,
  ): Promise<{
    edges_created: number
    edges_skipped_existing: number
    edges_dropped_crossing: number
    crossing_pinch_outs: CrossingPinchOut[]
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/auto`,
      { base_depth_threshold_m: depthWindowM ?? null, section_id: sectionId ?? null },
    ),

  // --- Accept correlations (#133 Phase 2) ------------------------------
  acceptContactCorrelations: (
    projectId: string,
    modelId: string,
    sectionId?: string | null,
  ): Promise<{
    edges_accepted: number
    ordinals_changed: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/accept`,
      { section_id: sectionId ?? null },
    ),

  // Accept a single correlation edge.
  acceptSingleContactCorrelation: (
    projectId: string,
    modelId: string,
    edgeId: string,
  ): Promise<{
    edges_accepted: number
    ordinals_changed: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/${edgeId}/accept`,
      {},
    ),

  // --- Confirm a flagged edge (2026-08-02) -----------------------------
  // A re-subdivide that could not place an accepted tie confidently carries it
  // with a `review_reason` instead of deleting it. Confirming clears that flag;
  // the other way to resolve one is the existing delete.
  confirmEdgeReview: (
    projectId: string,
    modelId: string,
    edgeId: string,
  ): Promise<{ edges_confirmed: number }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/${edgeId}/confirm-review`,
      {},
    ),

  // Confirm every flagged edge of the model at once.
  confirmAllEdgeReviews: (
    projectId: string,
    modelId: string,
  ): Promise<{ edges_confirmed: number }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/confirm-review`,
      {},
    ),

  materialiseBodyCompanions: (
    projectId: string,
    modelId: string,
  ): Promise<{
    companion_sections_created: number
    skipped_no_primary: number
    skipped_unfinished_section: number
    errored: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/body-companions/materialise`,
      {},
    ),

  // --- Geotech subdivision -------------------------------------------------

  /**
   * POST .../geotech/subdivide-all-bodies — classify + materialise geotech NAD
   * bodies for the entire lithostratigraphic model in one shot.
   *
   * ``lithoModelId`` is the lithostratigraphic model whose bodies are subdivided.
   * The server reuses the existing child geotechnical model (or creates one if
   * absent) and materialises real geotech spatial bodies via litho_layer +
   * edge inserts.
   *
   * The operation is model-wide — layers are written once per investigation;
   * geotech edges are derived per-section from the litho model's approved edges.
   * Pass ``lithoModelId`` as the body ``litho_model_id`` for forward-compatibility.
   */
  subdivideAllBodies: (
    projectId: string,
    lithoModelId: string,
  ): Promise<SubdivideAllBodiesResponse> =>
    post(
      `/projects/${projectId}/geology/models/${lithoModelId}/geotech/subdivide-all-bodies`,
      { litho_model_id: lithoModelId },
    ),

  /**
   * POST .../geotech/divide-boreholes — materialise TIN-divided borehole bands.
   *
   * Must be called AFTER ``subdivideAllBodies`` so the CPT geotech layers exist.
   * Idempotent: prior borehole bands are replaced by the new division.
   */
  divideBoreholes: (
    projectId: string,
    lithoModelId: string,
  ): Promise<DivideBoreholeResponse> =>
    post(
      `/projects/${projectId}/geology/models/${lithoModelId}/geotech/divide-boreholes`,
      {},
    ),

  /**
   * POST .../geotech/divide-boreholes/preview — what the divide WOULD write.
   *
   * A dry run of the same planner ``divideBoreholes`` commits: no rows are
   * written, nothing is deleted, and no correlation is touched. The geotech
   * axis draws the result as ghost bands over the still-empty borehole
   * columns, so the engineer can see what packing each borehole gets before
   * pressing a button that rebuilds them.
   *
   * Takes the LITHO model id, exactly like ``divideBoreholes``. 404s until
   * ``subdivideAllBodies`` has created the geotech model.
   */
  previewDivideBoreholes: (
    projectId: string,
    lithoModelId: string,
  ): Promise<DivideBoreholePreviewResponse> =>
    post(
      `/projects/${projectId}/geology/models/${lithoModelId}/geotech/divide-boreholes/preview`,
      {},
    ),

  /**
   * POST .../geotech/auto-correlate — propose the automatic packing ties again.
   *
   * ``geotechModelId`` is the GEOTECHNICAL model (every other geotech verb in
   * this client takes the litho parent — this one does not). Proposals insert
   * unapproved, so they render as amber suggestions until the engineer accepts
   * them, and existing correlations are never deleted or re-approved.
   *
   * ``sectionId`` scopes the run to one section so the engineer can see what
   * was proposed; ``null`` proposes across every section of the project.
   */
  autoCorrelateGeotech: (
    projectId: string,
    geotechModelId: string,
    sectionId?: string | null,
  ): Promise<AutoCorrelateGeotechResponse> =>
    post(
      `/projects/${projectId}/geology/models/${geotechModelId}/geotech/auto-correlate`,
      { section_id: sectionId ?? null },
    ),

  // Delete source='auto' edges for the model. With sectionId (debt #3), only
  // edges whose BOTH endpoints are on that section's columns are cleared, so
  // re-correlating one section can't wipe a neighbouring section's suggestions.
  deleteAutoCorrelations: async (
    projectId: string,
    modelId: string,
    sectionId?: string | null,
  ): Promise<DeleteAutoCorrelationsResult> => {
    const path =
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/auto` +
      (sectionId ? `?section_id=${sectionId}` : '')
    const res = await fetchTracked(`${_base}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detailMessage(detail.detail) ?? `DELETE ${path} → ${res.status}`)
    }
    return res.json() as Promise<DeleteAutoCorrelationsResult>
  },
}
