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
import { _base, del, get, patch, post, put } from './shared'
import { log } from '../../utils/log'
import type { CrossSectionResponse } from './section'

// Re-export so callers that only need geology still get the section type.
export type { CrossSectionResponse } from './section'

// ---------------------------------------------------------------------------
// Geological-formation types
// ---------------------------------------------------------------------------

/**
 * Geological-formation response — per-project formation vocabulary.
 *
 * Geological models use this for formation definitions (e.g. "Boom Klei",
 * "Diest Zand"). Lithostratigraphic models extend it with lithology /
 * admixture / NAD-class fields; geotechnical models with packing class.
 * Bundle-persisted via ``project_bundle.geological_formations``.
 */
export interface GeologicalFormationResponse {
  id: string
  app_project_id: string
  name: string
  color: string
  code: string | null
  display_order: number
  // Debt #35: true once the user has manually drag-reordered this
  // formation — Build's age-inference then leaves its order alone.
  pinned_order: boolean
  regional_ref: string | null
  description: string | null
  // Three-level hierarchy unit attributes — null on a geological
  // formation; set on litho (lithology) / geotech (nad_class) units.
  lithology: string | null
  nad_class: number | null
  // Litho-builder Phase 1 fields — null on geological-model rows.
  // parent_formation_id: the geological GeologicalFormation this litho
  // unit refines. null on geological-model formations.
  parent_formation_id: string | null
  litho_main_soil_code: string | null
  // JSONB list of {soil_code, amount, locally} dicts from the backend.
  // null on geological rows; [] on a litho unit with no admixtures.
  litho_admixtures: AdmixtureItem[] | null
  // instance_ordinal: Phase-2 correlation ordinal. null in Phase 1.
  instance_ordinal: number | null
  instance_ordinal_locked: boolean
  // Slice 5 / debt #67: server-resolved display name of the parent geological
  // formation. Populated from the project-formation id→name map at response
  // time; never stored in the DB. null on geological rows and on orphaned
  // litho units whose parent id is not present in the project set.
  parent_formation_name: string | null
  // Server-resolved ``code`` of the parent geological formation (DOV codelist
  // code). Drives the lens auto-name (``{parent code}{lithology abbrev}{depth
  // rank}`` e.g. ``QPSa1``). null on geological rows / parents without a code.
  parent_formation_code?: string | null
  // Debt #87: true when parent_formation_id was inferred via TIN extrapolation
  // (no geology contact at this investigation covered the suggestion's depth).
  // The LithologyInspector renders an amber dot + tooltip + confirm dialog
  // when set. Cleared via PATCH parent_extrapolated=false on Confirm.
  parent_extrapolated: boolean
  created_at: string
  updated_at: string
}

/** Request body for ``POST /projects/{pid}/geology/formations``. */
export interface GeologicalFormationCreatePayload {
  name: string
  color?: string
  code?: string | null
  display_order?: number
  pinned_order?: boolean
  regional_ref?: string | null
  description?: string | null
  lithology?: string | null
  nad_class?: number | null
  // Litho-unit fields — supply these when creating a lithostratigraphic
  // child formation without a contact ("Add new unit" ghost flow, Bug 2
  // dogfeed 2026-05-26).  Omitted for geological-formation creation.
  parent_formation_id?: string | null
  litho_main_soil_code?: string | null
  litho_admixtures?: AdmixtureItem[] | null
}

/** Request body for ``PATCH /projects/{pid}/geology/formations/{fid}``. */
export interface GeologicalFormationUpdatePayload {
  name?: string | null
  color?: string | null
  code?: string | null
  display_order?: number | null
  pinned_order?: boolean | null
  regional_ref?: string | null
  description?: string | null
  lithology?: string | null
  nad_class?: number | null
  // Legacy formation-level ordinal lock. The litho instance resolver no
  // longer reads it (per-instance bodies are auto-ranked by depth); the
  // field is retained on the PATCH contract for backwards compatibility.
  instance_ordinal_locked?: boolean | null
  // Debt #87: cleared to false when the engineer confirms the
  // TIN-extrapolated parent. Detach action sends false + parent_formation_id
  // null in one PATCH. Never sent true from the UI — only AcceptLitho stamps
  // true server-side.
  parent_extrapolated?: boolean | null
  parent_formation_id?: string | null
}

// ---------------------------------------------------------------------------
// Geological-model types
// ---------------------------------------------------------------------------

/**
 * Discriminator for the three-level modelling hierarchy.
 *
 * ``is_active`` is scoped PER KIND on the backend — a geological and a
 * lithostratigraphic model can both be active at once; select by kind, not
 * "the first active".
 */
export type ModelKind = 'geological' | 'lithostratigraphic' | 'geotechnical'

/** Geological-model response — project can have multiple interpretation models. */
export interface GeologicalModelResponse {
  id: string
  app_project_id: string
  name: string
  description: string | null
  is_active: boolean
  excluded_borehole_ids: string[]
  kind: ModelKind
  // Mandatory for litho/geotech (a litho model refines a geological
  // one; geotech refines a litho one); null only for geological.
  parent_geological_model_id: string | null
  created_at: string
  updated_at: string
}

/** Request body for ``POST /projects/{pid}/geology/models``. */
export interface GeologicalModelCreatePayload {
  name: string
  description?: string | null
  is_active?: boolean
  excluded_borehole_ids?: string[]
  kind?: ModelKind
  parent_geological_model_id?: string | null
}

/** Request body for ``PATCH /projects/{pid}/geology/models/{mid}``. */
export interface GeologicalModelUpdatePayload {
  name?: string | null
  description?: string | null
  excluded_borehole_ids?: string[] | null
}

// ---------------------------------------------------------------------------
// Formation-contact types (geological models)
// ---------------------------------------------------------------------------

/** Contact-source provenance tag. */
export type ContactSource =
  | 'borehole_observation'
  | 'manual_pick'
  | 'interpolated'
  // Contacts seeded from the parent geological model into a lithostratigraphic
  // model via the seed-from-parent endpoint.
  | 'geological_model_seed'
  // Synthetic contact committed by the pinch-out extrapolation tool.
  // Has no borehole/CPT anchor — carries synthetic_x/y/elevation_m.
  | 'pinch_out_extrapolation'

/** Contact confidence level. */
export type ContactConfidence = 'high' | 'medium' | 'low'

/**
 * Formation-contact row — one boundary pick per investigation per formation.
 *
 * Polymorphic anchor: ``borehole_id`` XOR ``cpt_id``; v1 ships borehole-only,
 * the cpt_id slot is reserved for Robertson-Ic-driven auto-picks (Phase 5).
 */
export interface FormationContactResponse {
  id: string
  model_id: string
  formation_id: string
  borehole_id: string | null
  cpt_id: string | null
  // Set only on synthetic pinch-out contacts (no borehole/CPT anchor);
  // null otherwise. Absolute tip elevation is synthetic_elevation_m.
  synthetic_x: number | null
  synthetic_y: number | null
  synthetic_elevation_m: number | null
  depth_top_m: number
  source: ContactSource
  confidence: ContactConfidence
  observation_id: string | null
  observation_layer_id: string | null
  // Litho↔geo coupling (#162): set on a lithostratigraphic contact,
  // pointing at the geological contact it is the same physical surface as.
  // null = not coupled (default for all existing contacts).
  parent_geo_contact_id?: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Request body for ``POST /projects/{pid}/geology/models/{mid}/contacts``. */
export interface FormationContactCreatePayload {
  formation_id: string
  depth_top_m: number
  borehole_id?: string | null
  cpt_id?: string | null
  source?: ContactSource
  confidence?: ContactConfidence
  observation_id?: string | null
  observation_layer_id?: string | null
  notes?: string | null
  /**
   * Explicit-content invariant (owner directive 2026-05-17).
   * When drawing a contact on a section, pass the section's id so the
   * router appends the created contact to seeded_formation_contact_ids.
   * Omit when creating contacts from the Geology stage (no section context).
   */
  section_id?: string | null
}

/** Request body for ``PATCH /projects/{pid}/geology/models/{mid}/contacts/{cid}``. */
export interface FormationContactUpdatePayload {
  formation_id?: string | null
  depth_top_m?: number | null
  // Anchor re-pick: BOTH fields must be present together when either
  // changes (one of them null). The backend's XOR validator rejects
  // partial anchor updates with a 422 — see CLAUDE.md API list.
  borehole_id?: string | null
  cpt_id?: string | null
  source?: ContactSource | null
  confidence?: ContactConfidence | null
  notes?: string | null
}

/** One row in a batch-update payload (inherits every optional field + target id). */
export interface FormationContactBatchUpdateEntry extends FormationContactUpdatePayload {
  contact_id: string
}

/** Response from ``PUT .../contacts/batch``. */
export interface FormationContactBatchUpdateResponse {
  contacts: FormationContactResponse[]
}

/** Thrown when ``POST /contacts`` hits the (model, anchor, formation) uniqueness rule. */
export class DuplicateContactError extends Error {
  existingContactId: string
  constructor(existingContactId: string) {
    super('A contact for this formation already exists on this investigation')
    this.name = 'DuplicateContactError'
    this.existingContactId = existingContactId
  }
}

// ---------------------------------------------------------------------------
// Litho-layer types (Shape A — lithostratigraphic models)
// ---------------------------------------------------------------------------

/** Layer status in the assisted-manual accept flow. */
export type LithoLayerStatus = 'pending' | 'accepted' | 'rejected'

/** Provenance tag for how a litho layer was created. */
export type LithoLayerSource =
  | 'segmenter'
  | 'manual'
  | 'observation_layer'
  | 'observation_interpretation'

/** Confidence level for a litho layer. */
export type LithoLayerConfidence = 'low' | 'medium' | 'high'

/**
 * Litho-layer row — Shape A (layer-centric, lithostratigraphic models only).
 *
 * Each row represents one lithology interval at one anchor with explicit
 * ``depth_top_m`` + ``depth_base_m`` + ``status``. The LL row is the
 * source of truth; a defensive FC↔LL trigger pair keeps a
 * ``formation_contact`` mirror in sync for legacy readers.
 */
export interface LithoLayerResponse {
  id: string
  model_id: string
  formation_id: string
  // Anchor XOR — exactly one of borehole_id / cpt_id is set.
  borehole_id: string | null
  cpt_id: string | null
  depth_top_m: number
  depth_base_m: number
  status: LithoLayerStatus
  source: LithoLayerSource
  confidence: LithoLayerConfidence
  observation_id: string | null
  observation_layer_id: string | null
  // Litho↔geo coupling (#162) — points at the geological contact this
  // layer's TOP boundary is the same physical surface as.
  parent_geo_contact_id: string | null
  // The body (instance) this layer belongs to; NULL until the resolver runs.
  body_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Request body for ``PATCH .../layers/{lid}``. */
export interface LithoLayerUpdatePayload {
  formation_id?: string
  depth_top_m?: number
  depth_base_m?: number
  status?: LithoLayerStatus
  // Source can change on a drag commit (snapped → observation_layer,
  // unsnapped → manual). Backend allows it; A2 schema omitted it.
  source?: LithoLayerSource
  confidence?: LithoLayerConfidence
  borehole_id?: string | null
  cpt_id?: string | null
  observation_id?: string | null
  observation_layer_id?: string | null
  parent_geo_contact_id?: string | null
  notes?: string | null
}

/** One layer in a bulk-create payload for ``POST .../layers``. */
export interface LithoLayerCreateItem {
  formation_id: string
  depth_top_m: number
  depth_base_m: number
  status?: LithoLayerStatus
  source?: LithoLayerSource
  confidence?: LithoLayerConfidence
  borehole_id?: string | null
  cpt_id?: string | null
  observation_id?: string | null
  observation_layer_id?: string | null
  parent_geo_contact_id?: string | null
  notes?: string | null
}

/** Request body for ``PATCH .../layers/boundary-move``. */
export interface LithoLayerBoundaryMovePayload {
  upper_layer_id: string
  lower_layer_id: string
  new_depth_m: number
}

/** Response from ``PATCH .../layers/boundary-move``. */
export interface LithoLayerBoundaryMoveResponse {
  upper: LithoLayerResponse
  lower: LithoLayerResponse
}

/** Request body for ``POST .../layers/batch-status``. */
export interface LithoLayerBatchStatusPayload {
  layer_ids: readonly string[]
  status: LithoLayerStatus
}

/** Response from ``POST .../layers/batch-status``. */
export interface LithoLayerBatchStatusResponse {
  updated_count: number
  layers: LithoLayerResponse[]
}

/** One per-row patch in a layer batch update (A4 slice 4b). */
export interface LithoLayerBatchUpdateItem {
  layer_id: string
  formation_id?: string
  depth_top_m?: number
  depth_base_m?: number
  status?: LithoLayerStatus
  source?: LithoLayerSource
  confidence?: LithoLayerConfidence
  // Anchor XOR: if either is sent, both must appear with exactly one
  // non-null. The schema rejects half-anchor patches with a 422.
  borehole_id?: string | null
  cpt_id?: string | null
  parent_geo_contact_id?: string | null
  notes?: string | null
}

/** Response from ``PATCH .../layers/batch-update``. */
export interface LithoLayerBatchUpdateResponse {
  updated_count: number
  layers: LithoLayerResponse[]
}

// ---------------------------------------------------------------------------
// Litho-suggestion types
// ---------------------------------------------------------------------------

/** Confidence level for a litho suggestion. */
export type LithoSuggestionConfidence = 'high' | 'medium' | 'low'

/** Secondary soil component within a suggested litho layer. */
export interface AdmixtureItem {
  soil_code: string
  amount: string
  locally: boolean
}

/**
 * One read-only proposed layer from the Robertson-2015/2010 CPT segmenter
 * or the borehole ObservationLayer mapping.
 *
 * The user accepts → it becomes a real LithoLayer (assisted-manual, never
 * auto-committed).
 */
export interface LithoLayerSuggestion {
  depth_top_m: number
  depth_base_m: number
  suggested_lithology: string
  suggested_nad_class: number | null
  mean_qc_mpa: number | null
  dr_pct: number | null
  confidence: LithoSuggestionConfidence
  source: string
  // Phase 1 additions — defaulted on the backend so older clients stay
  // compatible; always present on fresh responses.
  suggested_admixtures: AdmixtureItem[]
  // Id of the geological formation this layer falls within. null when
  // the investigation has no geology contacts or the model has no surfaces.
  parent_formation_id: string | null
  // True when this suggestion's depth interval crosses a geological-
  // formation boundary (the backend splits it into two contacts on Accept).
  // Frontend renders amber border + tooltip.
  spans_boundary: boolean
  // NAD class range [min, max] across merged source segments (debt #119).
  // (n, n) when all sources share one class; (lo, hi) when they differ;
  // null for non-clean-sand and borehole-path layers. Optional so older
  // bundles that pre-date the merge pass stay compatible.
  nad_class_range?: [number, number] | null
}

/** Response from ``POST .../contacts/suggest-litho``. */
export interface LithoSuggestionResponse {
  investigation_type: 'cpt' | 'borehole'
  minimum_layer_thickness_m: number
  layers: LithoLayerSuggestion[]
}

/** Request body for ``POST .../contacts/suggest-litho``. */
export interface LithoSuggestionRequest {
  cpt_id?: string | null
  borehole_id?: string | null
  minimum_layer_thickness_m?: number
  gunsat_kNm3?: number
  gwater_kNm3?: number
  dr_compression_factor?: number
  // Owner directive 2026-05-25: merge adjacent same-lithology CPT segments
  // by default. False exposes un-merged Robertson-SBT splits.
  merge_same_lithology?: boolean
  // CPT path only. False selects the non-normalised Robertson 2010 I_SBT
  // classifier (qc/pa + Rf, no stress profile) over the default normalised
  // 2015 pipeline. Dr / NAD are left blank in non-normalised mode.
  use_normalised_qc?: boolean
}

// ---------------------------------------------------------------------------
// Accept-litho types
// ---------------------------------------------------------------------------

/** Request body for ``POST .../layers/accept-litho-suggestions``. */
export interface AcceptLithoSuggestionsRequest {
  // Exactly one of cpt_id / borehole_id must be present (XOR enforced
  // by the backend validator).
  cpt_id?: string | null
  borehole_id?: string | null
  // When provided, accepted contact ids are unioned into this section's
  // seeded_formation_contact_ids (explicit-content invariant — #57).
  section_id?: string | null
  suggestions: LithoLayerSuggestion[]
  // When true, skip the per-accept R7 inference + wedge-tip pass.
  defer_inference?: boolean
  // When true, find-or-create the litho formation(s) but do NOT create any
  // contact row and do NOT seed seeded_formation_contact_ids.
  create_formation_only?: boolean
  // Litho↔geo coupling coincidence tolerance (#162).
  couple_tolerance_m?: number
}

/** Response from ``POST .../layers/accept-litho-suggestions``. */
export interface AcceptLithoSuggestionsResponse {
  created_formation_ids: string[]
  found_formation_ids: string[]
  created_contact_ids: string[]
  found_contact_ids: string[]
  straddle_split_count: number
  stale_tin_fallback_count: number
  extrapolated_formation_ids?: string[]
  orphan_formation_ids?: string[]
  updated_section: CrossSectionResponse | null
}

/** One anchor entry in the batch-accept request. */
export interface BatchAcceptLithoAnchor {
  cpt_id?: string | null
  borehole_id?: string | null
  suggestions: LithoLayerSuggestion[]
}

/** Request body for ``POST .../layers/batch-accept-litho-suggestions``. */
export interface BatchAcceptLithoSuggestionsRequest {
  anchors: BatchAcceptLithoAnchor[]
  section_id?: string | null
  run_inference?: boolean
  couple_tolerance_m?: number
}

/** Per-anchor result within the batch-accept response. */
export interface BatchAcceptLithoAnchorResult {
  cpt_id: string | null
  borehole_id: string | null
  created_formation_ids: string[]
  found_formation_ids: string[]
  created_contact_ids: string[]
  found_contact_ids: string[]
  straddle_split_count: number
  stale_tin_fallback_count: number
  extrapolated_formation_ids: string[]
  orphan_formation_ids: string[]
  error: string | null
}

/** Response from ``POST .../layers/batch-accept-litho-suggestions``. */
export interface BatchAcceptLithoSuggestionsResponse {
  anchors: BatchAcceptLithoAnchorResult[]
  total_created_contacts: number
  total_found_contacts: number
  total_created_formations: number
  total_straddle_splits: number
  total_stale_tin_fallbacks: number
  total_extrapolated_formations: number
  total_orphan_formations: number
  failed_anchor_count: number
  inference_ran: boolean
  updated_section: CrossSectionResponse | null
}

/** Response from ``POST .../contacts/auto-populate``. */
export interface AutoPopulateFromStratigraphyResponse {
  created_contact_ids: string[]
  created_formation_ids: string[]
  /**
   * Formation ids deleted server-side because their canonical key was not in
   * the selected_keys set. Populated only on the Fill-from-boreholes path
   * (selected_keys provided). Empty on the unfiltered Seed path.
   */
  deleted_formation_ids: string[]
  skipped_existing: number
  skipped_unmatched: number
  skipped_no_stratigraphy: number
  /**
   * Layers skipped on the Sections "Seed from stratigraphy" path because
   * their resolved formation is not one the user curated.
   */
  skipped_not_in_model: number
  /**
   * Lumping collisions that occurred during execute when ``manual_map`` was
   * provided.
   */
  collisions: LumpingCollisionItem[]
  /**
   * Updated section row after Seed patched seeded_formation_contact_ids.
   * Non-null only on the Seed-from-stratigraphy path.
   */
  updated_section: CrossSectionResponse | null
}

/**
 * Response from ``POST .../contacts/seed-from-parent``.
 *
 * ``updated_section`` is non-null only when ``section_id`` was provided in
 * the request.
 */
export interface SeedLithoFromParentResponse {
  created_contact_ids: string[]
  skipped_existing: number
  updated_section: CrossSectionResponse | null
}

/** One candidate formation returned by discover-from-stratigraphy. */
export interface FormationCandidateItem {
  /** Working display name (informal description preferred; formal as fallback). */
  name: string
  /**
   * Formal stratigraphy code when present; null for informal-only boreholes.
   */
  regional_ref: string | null
  /**
   * Stable cross-borehole identity key: ``regional_ref`` when present, else ``name``.
   */
  key: string
  /** Number of in-scope boreholes that carry this key. */
  borehole_count: number
}

/**
 * One lumping collision returned by the discover or auto-populate endpoint.
 *
 * Occurs when multiple primary layers within one borehole resolve to the same
 * effective formation key after ``manual_map`` is applied.
 */
export interface LumpingCollisionItem {
  borehole_id: string
  target_formation_key: string
  target_formation_name: string
  colliding_raw_names: string[]
  kept_top_m: number
  dropped_count: number
}

/** Response from ``POST .../contacts/discover-from-stratigraphy``. */
export interface DiscoverFromStratigraphyResponse {
  candidates: FormationCandidateItem[]
  collisions: LumpingCollisionItem[]
}

/** Response from ``POST .../contacts/dedupe``. */
export interface DeduplicateContactsResponse {
  inspected_groups: number
  duplicates_removed: number
  removed_contact_ids: string[]
}

// ---------------------------------------------------------------------------
// Surface / validation types
// ---------------------------------------------------------------------------

/** Result of ``POST .../surfaces/rebuild``. */
export interface RebuildSurfacesResponse {
  formations_considered: number
  formations_rebuilt: number
  formations_reordered?: number
}

/** One cached TIN surface — one per (model, formation). */
export interface FormationSurfaceResponse {
  id: string
  model_id: string
  formation_id: string
  method: string
  /** True when the cached TIN no longer reflects the current contacts. */
  is_stale?: boolean
  /** ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS. */
  vertices: [number, number, number][]
  /** Vertex-index triples (counter-clockwise winding). */
  triangles: [number, number, number][]
  source_contact_count: number
  created_at: string
  updated_at: string
}

/** One validation issue (gap validator or crossing validator). */
export interface GapIssueResponse {
  kind: string
  detail: string
  depth_m: number | null
  contact_ids: string[]
  /** Populated for ``formation_crossing`` kind. */
  formation_ids: string[]
}

/** Response from ``GET .../boreholes/{bid}/validate``. */
export interface GapValidationResponse {
  model_id: string
  borehole_id: string
  issues: GapIssueResponse[]
}

/** Response from ``GET .../validate/crossings``. */
export interface CrossingValidationResponse {
  model_id: string
  issues: GapIssueResponse[]
}

/** Response from ``POST .../ground-surface/build``. */
export interface GroundSurfaceBuildResponse {
  /** ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS. */
  vertices: [number, number, number][]
  triangles: [number, number, number][]
  provider_id: string
  from_cache: boolean
  issues: GapIssueResponse[]
}

// ---------------------------------------------------------------------------
// Correlation-edge types
// ---------------------------------------------------------------------------

/** Formation-level correlation edge (Phase-2 Slice 3). */
export interface LithoCorrelationEdge {
  id: string
  formation_a_id: string
  formation_b_id: string
  source: string
  created_at: string
}

/** Contact-level correlation edge (#133 Phase 1). */
export interface LithoContactCorrelationEdge {
  id: string
  contact_a_id: string
  contact_b_id: string
  model_id: string
  section_id: string
  source: string
  user_approved: boolean
  created_at: string
}

/** Response from ``POST /correlations/resolve``. */
export interface ResolveInstancesResponse {
  updated: Array<{ formation_id: string; new_ordinal: number }>
}

/** Response from ``POST /models/{mid}/auto-correlate``. */
export interface AutoCorrelateResult {
  edges_created: number
  edges_skipped_existing: number
  formations_recomputed: number
  wedge_tips_materialised: number
}

/**
 * Pinch-out lens candidate inferred from a correlation crossing.
 *
 * Rendered as an amber lens-candidate marker on the section after Correlate.
 */
export interface CrossingPinchOut {
  source_investigation_id: string
  above_contact_id: string
  below_contact_id: string
  neighbour_investigation_id: string
}

/** Response from ``DELETE /correlations/auto``. */
export interface DeleteAutoCorrelationsResult {
  deleted: number
}

// ---------------------------------------------------------------------------
// Body (formerly lens) types
// ---------------------------------------------------------------------------

/** Slice 5: request body for ``PATCH .../bodies/{id}``. */
export interface NameBodyRequest {
  formation_id: string
  body_ordinal: number
  name: string
  primary_section_id?: string | null
}

/** Slice 5: response from ``PATCH .../bodies/{id}``. */
export interface NameBodyResponse {
  lens_id: string
  was_created: boolean
}

/** One formation-absence record. */
export interface FormationAbsenceItem {
  id: string
  formation_id: string
  investigation_id: string
  investigation_kind: 'borehole' | 'cpt'
  /** 'inferred' | 'manual' | 'observed' */
  source: string
  created_at: string
  updated_at: string
}

/** Request body for ``POST .../formations/{fid}/absences``. */
export interface UpsertFormationAbsenceRequest {
  investigation_id: string
  investigation_kind: 'borehole' | 'cpt'
  source: 'manual' | 'observed'
}

/** Response from ``POST .../formations/{fid}/absences``. */
export interface UpsertFormationAbsenceResponse {
  absence_id: string
  was_created: boolean
}

/**
 * Body list item — full metadata for one body (formerly lens) in a litho model.
 *
 * Returned by ``GET .../bodies``.
 */
export interface BodyListItem {
  id: string
  app_project_id: string
  model_id: string
  formation_id: string
  body_ordinal: number
  source_investigation_id: string
  name: string | null
  primary_section_id: string | null
  /** A2-derived geological-formation label (thickness-weighted majority). */
  geo_formation_id?: string | null
  geo_formation_name?: string | null
  created_at: string
  updated_at: string
  /** Stable identity hash of the body's 3 defining contact ids. */
  content_key?: string | null
}

/** One control node on a body boundary (section-local). */
export interface BodyBoundaryNode {
  along_m: number
  elevation_m: number
}

/** Render style for a body boundary shape. */
export type BodyRenderStyle = 'straight' | 'blocky' | 'rounded'

/** Response from ``GET/PUT .../bodies/{id}/boundary``. */
export interface BodyBoundaryResponse {
  lens_id: string
  content_key: string | null
  render_style: BodyRenderStyle
  primary_section_id: string | null
  upper_nodes: BodyBoundaryNode[]
  lower_nodes: BodyBoundaryNode[]
}

/**
 * Thrown when ``POST /models/{mid}/bodies`` returns HTTP 409 (provenance rule §5.2).
 *
 * A detector-set ``to_target`` extent already occupies the requested side.
 * Carries the side + kind so ``ProvenanceConflictDialog`` can retry the claim.
 */
export class ProvenanceViolationError extends Error {
  side: 'left' | 'right'
  kind: string
  constructor(side: 'left' | 'right', kind: string, message?: string) {
    super(message ?? `Provenance conflict on side=${side}`)
    this.name = 'ProvenanceViolationError'
    this.side = side
    this.kind = kind
  }
}

// ---------------------------------------------------------------------------
// Geotechnical-unit types
// ---------------------------------------------------------------------------

/** Geotechnical-unit response — structure-only in v1.0 (no parameter values). */
export interface GeotechnicalUnitResponse {
  id: string
  app_project_id: string
  geological_formation_id: string
  name: string
  color: string
  code: string | null
  display_order: number
  description: string | null
  created_at: string
  updated_at: string
}

/** Request body for ``POST .../formations/{fid}/units``. */
export interface GeotechnicalUnitCreatePayload {
  name: string
  color?: string
  code?: string | null
  display_order?: number
  description?: string | null
}

/** Request body for ``PATCH .../formations/{fid}/units/{uid}``. */
export interface GeotechnicalUnitUpdatePayload {
  name?: string | null
  color?: string | null
  code?: string | null
  display_order?: number | null
  description?: string | null
}

// ---------------------------------------------------------------------------
// Geology API surface — ``api.geology`` + ``api.geotechnicalUnit``
// ---------------------------------------------------------------------------

/** Typed wrappers for all geology-domain endpoints. */
export const geologyClient = {
  // Download the geological model as a runnable Plaxis 3D
  // plxscripting Python script. Returns the raw bytes so the
  // caller can pipe to the Electron save-dialog + write-file IPC pair.
  exportPlaxis3d: async (projectId: string, modelId: string): Promise<ArrayBuffer> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/export/plaxis3d`,
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `Plaxis export failed (${res.status})`)
    }
    return res.arrayBuffer()
  },

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
    const res = await fetch(
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
      throw new Error(detail.detail ?? `updateLayer failed (${res.status})`)
    }
    return res.json()
  },

  /** DELETE /models/{mid}/layers/{lid} — hard delete. */
  deleteLayer: async (projectId: string, modelId: string, layerId: string): Promise<void> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 404) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `deleteLayer failed (${res.status})`)
    }
  },

  /** POST /models/{mid}/layers — bulk-create N layers in one transaction. */
  bulkCreateLayers: async (
    projectId: string,
    modelId: string,
    layers: readonly LithoLayerCreateItem[],
    sectionId?: string | null,
  ): Promise<LithoLayerResponse[]> => {
    const body: { layers: readonly LithoLayerCreateItem[]; section_id?: string } = { layers }
    if (sectionId) body.section_id = sectionId
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `bulkCreateLayers failed (${res.status})`)
    }
    return res.json()
  },

  /** PATCH /models/{mid}/layers/boundary-move — atomic shared-boundary move. */
  moveLayerBoundary: async (
    projectId: string,
    modelId: string,
    payload: LithoLayerBoundaryMovePayload,
  ): Promise<LithoLayerBoundaryMoveResponse> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/boundary-move`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `moveLayerBoundary failed (${res.status})`)
    }
    return res.json()
  },

  /** PATCH /models/{mid}/layers/batch-update — atomic N-row PATCH. */
  batchUpdateLayers: async (
    projectId: string,
    modelId: string,
    updates: readonly LithoLayerBatchUpdateItem[],
  ): Promise<LithoLayerBatchUpdateResponse> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/batch-update`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `batchUpdateLayers failed (${res.status})`)
    }
    return res.json()
  },

  /** POST /models/{mid}/layers/batch-status — accept-all / reject-all. */
  batchUpdateLayerStatus: async (
    projectId: string,
    modelId: string,
    payload: LithoLayerBatchStatusPayload,
  ): Promise<LithoLayerBatchStatusResponse> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/batch-status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `batchUpdateLayerStatus failed (${res.status})`)
    }
    return res.json()
  },

  /** POST /models/{mid}/layers/{lid}/link-geo — link layer to nearest geo contact. */
  linkLayerToGeo: async (
    projectId: string,
    modelId: string,
    layerId: string,
  ): Promise<LithoLayerResponse | null> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}/link-geo`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `linkLayerToGeo failed (${res.status})`)
    }
    // 200 with a JSON `null` body is the no-match-in-range outcome.
    const text = await res.text()
    if (!text || text === 'null') return null
    return JSON.parse(text)
  },

  /** POST /models/{mid}/layers/{lid}/unlink-geo — clears parent_geo_contact_id. */
  unlinkLayerFromGeo: async (
    projectId: string,
    modelId: string,
    layerId: string,
  ): Promise<LithoLayerResponse> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}/unlink-geo`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `unlinkLayerFromGeo failed (${res.status})`)
    }
    return res.json()
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
    const res = await fetch(
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
        detail.detail?.message ?? detail.detail ?? `Create contact failed: ${res.status}`,
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
    const res = await fetch(
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
      throw new Error(detail.detail ?? `PATCH contacts/${contactId} → ${res.status}`)
    }
    if (res.status === 204) return null
    return res.json()
  },

  deleteContact: (projectId: string, modelId: string, contactId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}`),

  // Break the litho↔geo coupling on a single contact. Nulls
  // parent_geo_contact_id; does NOT move/delete either contact or
  // rebuild surfaces (geometry is unchanged — only the coupling label is cleared).
  unlinkLithoFromGeo: (
    projectId: string,
    modelId: string,
    contactId: string,
  ): Promise<FormationContactResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}/unlink-geo`,
      {},
    ),

  // Establish a litho↔geo coupling on a single lithostratigraphic contact.
  // Sets parent_geo_contact_id to the nearest geological contact within
  // the snap tolerance and snaps geo→litho. Returns null when no geological
  // contact is within tolerance.
  linkLithoToGeo: (
    projectId: string,
    modelId: string,
    contactId: string,
  ): Promise<FormationContactResponse | null> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}/link-geo`,
      {},
    ),

  // Clear ALL content from a lithostratigraphic model (debt #94 fix).
  clearLithoModel: async (
    projectId: string,
    modelId: string,
  ): Promise<{ contacts: number; edges: number; surfaces: number; formations: number }> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/geology/models/${modelId}/contacts`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(
        detail.detail?.message ?? detail.detail ?? `Clear litho model failed: ${res.status}`,
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
      },
    ),

  // Seed a lithostratigraphic model from its parent geological model's contacts.
  seedLithoFromParent: (
    projectId: string,
    modelId: string,
    boreholeIds: readonly string[],
    sectionId?: string | null,
  ): Promise<SeedLithoFromParentResponse> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/layers/seed-from-parent`,
      {
        borehole_ids: boreholeIds,
        ...(sectionId != null ? { section_id: sectionId } : {}),
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

  // --- Gap validator (per borehole) ------------------------------------
  validateBorehole: (
    projectId: string,
    modelId: string,
    boreholeId: string,
  ): Promise<GapValidationResponse> =>
    get(
      `/projects/${projectId}/geology/models/${modelId}/boreholes/${boreholeId}/validate`,
    ),

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
    contactAId: string,
    contactBId: string,
    requestSectionId?: string | null,
  ): Promise<{ edge_id: string; was_created: boolean }> =>
    post(`/projects/${projectId}/geology/models/${modelId}/contact-correlations`, {
      contact_a_id: contactAId,
      contact_b_id: contactBId,
      source: 'manual',
      request_section_id: requestSectionId ?? null,
    }),

  // DELETE with JSON body — the shared del() helper does not pass a body.
  deleteContactCorrelation: async (
    projectId: string,
    modelId: string,
    contactAId: string,
    contactBId: string,
    requestSectionId?: string | null,
  ): Promise<void> => {
    const path = `/projects/${projectId}/geology/models/${modelId}/contact-correlations`
    const res = await fetch(`${_base}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_a_id: contactAId,
        contact_b_id: contactBId,
        request_section_id: requestSectionId ?? null,
      }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
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
  listBodies: (projectId: string, modelId: string): Promise<BodyListItem[]> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies`),

  // Backwards-compat alias.
  listLenses: (projectId: string, modelId: string): Promise<BodyListItem[]> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies`),

  getBodyBoundary: (
    projectId: string,
    modelId: string,
    bodyId: string,
  ): Promise<BodyBoundaryResponse> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary`),

  // Backwards-compat alias.
  getLensBoundary: (
    projectId: string,
    modelId: string,
    lensId: string,
  ): Promise<BodyBoundaryResponse> =>
    get(`/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}/boundary`),

  saveBodyBoundary: (
    projectId: string,
    modelId: string,
    bodyId: string,
    body: {
      upper_nodes: BodyBoundaryNode[]
      lower_nodes: BodyBoundaryNode[]
      render_style: BodyRenderStyle
    },
  ): Promise<BodyBoundaryResponse> =>
    put(
      `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary`,
      body,
    ),

  // Backwards-compat alias.
  saveLensBoundary: (
    projectId: string,
    modelId: string,
    lensId: string,
    body: {
      upper_nodes: BodyBoundaryNode[]
      lower_nodes: BodyBoundaryNode[]
      render_style: BodyRenderStyle
    },
    sectionId?: string,
  ): Promise<BodyBoundaryResponse> =>
    put(
      `/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}/boundary` +
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

  // Backwards-compat alias.
  nameLensBody: (
    projectId: string,
    modelId: string,
    body: NameBodyRequest,
  ): Promise<NameBodyResponse> =>
    post(`/projects/${projectId}/geology/models/${modelId}/bodies`, body),

  deleteBody: async (
    projectId: string,
    modelId: string,
    bodyId: string,
  ): Promise<void> => {
    const path = `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}`
    const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
    }
  },

  // Backwards-compat alias.
  deleteLens: async (projectId: string, modelId: string, lensId: string): Promise<void> => {
    const path = `/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}`
    const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
    }
  },

  // Claim a user-extent on an existing body.
  claimBodyExtent: async (
    projectId: string,
    modelId: string,
    request: {
      body_id: string
      side: 'left' | 'right'
      kind: 'pinch_out_halfway' | 'extrapolated' | 'open'
      source_investigation_id?: string | null
      neighbour_inv_id?: string | null
      primary_section_id?: string | null
      anchor_layer_id?: string | null
    },
  ): Promise<BodyListItem> => {
    const path = `/projects/${projectId}/geology/models/${modelId}/bodies`
    const res = await fetch(`${_base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      if (res.status === 409 && detail.detail?.code === 'provenance_violation') {
        throw new ProvenanceViolationError(request.side, request.kind, detail.detail.message)
      }
      throw new Error(
        detail.detail?.message ?? detail.detail ?? `POST ${path} → ${res.status}`,
      )
    }
    return res.json() as Promise<BodyListItem>
  },

  updateBody: (
    projectId: string,
    modelId: string,
    bodyId: string,
    request: NameBodyRequest,
  ): Promise<NameBodyResponse> =>
    patch(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}`, request),

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

  recomputeFormationAbsences: (
    projectId: string,
    modelId: string,
    formationId: string,
  ): Promise<{ written_count: number; retracted_count: number; skipped_no_data_count: number }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/formations/${formationId}/absences/recompute`,
      {},
    ),

  recomputeAllAbsences: (
    projectId: string,
    modelId: string,
  ): Promise<{
    formations_processed: number
    total_written: number
    total_retracted: number
    total_wedge_tips_created: number
    total_wedge_tips_deleted: number
  }> =>
    post(`/projects/${projectId}/geology/models/${modelId}/recompute-all-absences`, {}),

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
    lenses_created: number
    lenses_removed: number
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
    lenses_created: number
    lenses_removed: number
    ordinals_changed: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/contact-correlations/${edgeId}/accept`,
      {},
    ),

  // --- Detect bodies (explicit verb, owner directive 2026-05-31) -------
  detectBodies: (
    projectId: string,
    modelId: string,
    sectionId?: string,
  ): Promise<{
    bodies_created: number
    bodies_removed: number
    bodies_skipped_unresolved_ordinal: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/bodies/detect` +
        (sectionId ? `?section_id=${sectionId}` : ''),
      {},
    ),

  // Fuse host halves split by a local lens.
  mergeEnclosedLenses: (
    projectId: string,
    modelId: string,
    sectionId: string,
  ): Promise<{ edges_created: number; edges_skipped_existing: number }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/bodies/merge-enclosed-lenses` +
        `?section_id=${sectionId}`,
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
      `/projects/${projectId}/geology/models/${modelId}/lens-companions/materialise`,
      {},
    ),

  // Backwards-compat alias.
  materialiseLensCompanions: (
    projectId: string,
    modelId: string,
  ): Promise<{
    companion_sections_created: number
    skipped_no_primary: number
    skipped_unfinished_section: number
    errored: number
  }> =>
    post(
      `/projects/${projectId}/geology/models/${modelId}/lens-companions/materialise`,
      {},
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
    const res = await fetch(`${_base}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
    }
    return res.json() as Promise<DeleteAutoCorrelationsResult>
  },
}

/** Typed wrappers for geotechnical-unit endpoints. */
export const geotechnicalUnitClient = {
  list: (projectId: string, formationId: string): Promise<GeotechnicalUnitResponse[]> =>
    get(`/projects/${projectId}/geology/formations/${formationId}/units`),

  create: (
    projectId: string,
    formationId: string,
    body: GeotechnicalUnitCreatePayload,
  ): Promise<GeotechnicalUnitResponse> =>
    post(`/projects/${projectId}/geology/formations/${formationId}/units`, body),

  update: (
    projectId: string,
    formationId: string,
    unitId: string,
    body: GeotechnicalUnitUpdatePayload,
  ): Promise<GeotechnicalUnitResponse> =>
    patch(
      `/projects/${projectId}/geology/formations/${formationId}/units/${unitId}`,
      body,
    ),

  delete: (projectId: string, formationId: string, unitId: string): Promise<void> =>
    del(`/projects/${projectId}/geology/formations/${formationId}/units/${unitId}`),
}
