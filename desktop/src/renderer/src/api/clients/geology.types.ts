/**
 * Geology API types — request/response shapes for all geological-model,
 * litho, body, and geotechnical-unit endpoints.
 *
 * Split out of ``clients/geology.ts`` (debt #201 round 2) so the type
 * catalogue and the client surface are separately readable. The client
 * module re-exports everything here, so callers keep importing from
 * ``clients/geology`` (or the ``api/client`` barrel) unchanged.
 *
 * ``CrossSectionResponse`` is imported from the section module because
 * several response shapes embed an ``updated_section`` field.
 *
 * @module clients/geology.types
 */
import type { CrossSectionResponse } from './section'

// Re-export so callers that build the voxel payload can reach the request type
// through the geology client surface.
export type { VoxelBuildRequest } from '../../utils/buildVoxelRequest'

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
  // Geotech-stage dual-reference columns.
  // ``source_litho_formation_id`` — the lithostratigraphic formation this
  // geotech unit subdivides.  null on geological- and litho-model rows.
  // ``source_geo_formation_id`` — the geological formation the unit sits
  // within.  null on geological- and litho-model rows.
  // Both are additive optional/null fields so legacy API consumers and
  // older .strix bundles continue to function without modification.
  // These are the CORRECT discriminators for formation kind — see
  // formationKind.ts.  A geotech formation (classified OR skeleton) has
  // source_litho_formation_id !== null; litho and geological formations
  // have it null.
  source_litho_formation_id: string | null
  source_geo_formation_id: string | null
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
  parent_model_id: string | null
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
  parent_model_id?: string | null
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
  // Litho↔geo coupling coincidence tolerance (#162).
  couple_tolerance_m?: number
}

/** Response from ``POST .../layers/accept-litho-suggestions``. */
export interface AcceptLithoSuggestionsResponse {
  created_formation_ids: string[]
  found_formation_ids: string[]
  created_contact_ids: string[]
  found_contact_ids: string[]
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
  error: string | null
}

/** Response from ``POST .../layers/batch-accept-litho-suggestions``. */
export interface BatchAcceptLithoSuggestionsResponse {
  anchors: BatchAcceptLithoAnchorResult[]
  total_created_contacts: number
  total_found_contacts: number
  total_created_formations: number
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

/**
 * One cached watertight 3-D solid per (model, body).
 *
 * Analogous to ``FormationSurfaceResponse`` for the geological TIN cache;
 * this schema carries a lithostratigraphic body solid built by the
 * LithoSolidBuilder.  ``display_color`` comes from the BodyOrm row — it
 * overrides the formation's lithology colour in the 3-D viewer.
 */
export interface LithoBodySolidResponse {
  id: string
  model_id: string
  body_id: string
  formation_id: string
  /** The body's ordinal within its formation's naming group (0-based). Combined with the lithology gives a stable human handle e.g. "SILT #3". */
  body_ordinal: number
  method: string
  /** ``[x_m, y_m, z_m]`` triples in the project CRS. Empty for flagged slabs. */
  vertices: [number, number, number][]
  /** Vertex-index triples (outward right-hand-rule). Empty for flagged slabs. */
  triangles: [number, number, number][]
  /** True when a contact mutation has invalidated the cached solid. */
  is_stale?: boolean
  /** True when the builder emitted a best-effort slab due to a structural anomaly. */
  is_flagged?: boolean
  /** Per-body colour override; null = fall back to the formation lithology colour. */
  display_color?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * Result of ``POST .../litho-solids/build-voxel``.
 *
 * Mirrors ``RebuildSurfacesResponse`` for the geological TIN pipeline,
 * extended with the freshly rebuilt solid list so the 3-D viewer can
 * update its cache in a single round-trip.  (The name predates the voxel
 * builder: the retired strat-field ``rebuild`` endpoint returned the same
 * shape — deleted with #237.)
 */
export interface RebuildLithoSolidsResponse {
  bodies_considered: number
  bodies_built: number
  bodies_skipped_checksum: number
  bodies_flagged: number
  orphans_deleted: number
  /** Full solid list after the rebuild — equivalent to GET .../litho-solids. */
  solids: LithoBodySolidResponse[]
}

/**
 * Response from ``PATCH .../bodies/{body_id}/color``.
 *
 * Carries the persisted per-body display colour after the update.
 */
export interface UpdateBodyColorResponse {
  body_id: string
  display_color: string | null
}

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

/** Contact-level correlation edge (#133 Phase 1). */
export interface LithoContactCorrelationEdge {
  id: string
  layer_a_id: string
  layer_b_id: string
  /** Side of contact_a the edge joins — `'top'` (default) or `'base'`. */
  layer_a_side: 'top' | 'base'
  /**
   * Side of contact_b the edge joins. A `('base','base')` pair is a
   * **bottom-tie** (bottom-tie spec 2026-06-17): it correlates the deepest
   * layer's base so the deepest unit can band.
   */
  layer_b_side: 'top' | 'base'
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
  /** The BodyOrm row id. Backend field is ``body_id`` (audit #3). */
  body_id: string
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
  /** The BodyOrm row id. Backend field is ``body_id`` (audit #3). */
  body_id: string
  content_key: string | null
  render_style: BodyRenderStyle
  primary_section_id: string | null
  upper_nodes: BodyBoundaryNode[]
  lower_nodes: BodyBoundaryNode[]
}


// ---------------------------------------------------------------------------
// Geotech subdivision types
// ---------------------------------------------------------------------------

/**
 * Response from ``POST .../geotech/subdivide-all-bodies``.
 *
 * ``mid`` in the request path is the lithostratigraphic model id.
 * The operation is model-wide — layers are written once per investigation,
 * edges are derived per-section from the litho model's approved edges.
 */
export interface SubdivideAllBodiesResponse {
  /** The geotechnical model used (created by an earlier build call or reused). */
  geotech_model_id: string
  /** Classified geotech formation rows created in this call. */
  created_formation_ids: string[]
  /** Total litho_layer rows inserted into the geotech model. */
  layer_count: number
  /** Total BodyOrm rows created after resolution. */
  body_count: number
  /** Body groups that received a consistent multi-band split. */
  split_body_count: number
  /** Body groups assigned one representative NAD class. */
  one_class_body_count: number
  /** Body groups that were borehole-only (no CPT qc data). */
  borehole_only_count: number
  /** Number of project sections for which geotech edges were derived. */
  section_count: number
}

/**
 * Response of ``POST .../geotech/divide-boreholes``.
 *
 * DivideBoreholes is a standalone step run after SubdivideAllBodies.
 * It reads the CPT geotech layers already in the model, rebuilds the
 * packing-transition surfaces, and materialises borehole bands via TIN
 * interpolation.
 */
export interface DivideBoreholeResponse {
  /** The geotechnical model that was updated. */
  geotech_model_id: string
  /** Borehole columns that received ≥ 2 TIN-divided packing bands. */
  divided_borehole_count: number
  /** Borehole columns assigned a single band (no CPT split surfaces in their body group). */
  single_band_borehole_count: number
  /** Total litho_layer rows inserted for boreholes. */
  layer_count: number
  /** Newly created geotech geological_formation rows. */
  created_formation_ids: string[]
}

