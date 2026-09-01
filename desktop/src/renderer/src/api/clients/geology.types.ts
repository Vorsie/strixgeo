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
// Imported as well as re-exported below: ``RebuildLithoSolidsResponse`` embeds
// the report, and a bare ``export type ... from`` does not bring a name into
// local scope.
import type { GaplessBuildReport } from '../../utils/gaplessGate/types'

// Re-export so callers that build the voxel payload can reach the request type
// through the geology client surface.
export type { VoxelBuildRequest } from '../../utils/buildVoxelRequest'

// The seven-clause gapless gate. Declared with the gate itself (the renderer
// computes four of the seven clauses and ships them out with the build
// payload), re-exported here so API callers get it from the same place as
// every other wire type.
export type {
  GaplessBuildReport,
  GaplessClause,
  GaplessClauseEntry,
  GaplessClauseInput,
  GaplessClauseKey,
  GaplessClauseStatus,
  GaplessMeasure,
  GaplessVerdict,
} from '../../utils/gaplessGate/types'

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
  // The colour the ENGINEER picked, or null when nobody has. It wins over the
  // automatic colour wherever the unit is drawn — see ``geotechUnitColor``.
  // Separate from ``color`` because ``color`` is a machine default (the geotech
  // materialiser copies the source litho unit's colour at create), so a value
  // sitting there says nothing about intent. Optional on the type so pre-change
  // fixtures still typecheck; the API always sends it.
  color_override?: string | null
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
  // Send a hex string to set the engineer's colour, an explicit null to reset
  // the unit to its automatic colour. Omit the key to leave his choice alone —
  // the backend PATCH is ``exclude_unset``, so those three cases are distinct.
  color_override?: string | null
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
  /**
   * Representative-qc statistic pair (rulings 7+8) — meaningful for
   * kind='geotechnical' only. Bands are stale when classified differs from
   * representative (derived, never stored).
   */
  representative_statistic?: string
  classified_with_statistic?: string | null
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
  // The accepted litho band a geotech band subdivides; the Parameters tree
  // derives the band's litho body live through it. NULL on litho-model rows and
  // on a geotech band with no covering litho band (a true orphan). Optional so
  // pre-slice-A payloads and hand-built fixtures stay valid.
  parent_litho_layer_id?: string | null
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

/**
 * What auto-populate may do to the formations the caller did NOT select.
 *
 * ``'add'`` — create / update the selected keys only; nothing is ever deleted.
 * ``'overwrite'`` — the model becomes exactly the selection.
 *
 * Both the server default and every client default are ``'add'``: sending
 * ``selected_keys`` is a statement about what to create, never consent to
 * delete (2026-08-03 data-loss ruling).
 */
export type AutoPopulateMode = 'add' | 'overwrite'

/** Response from ``POST .../contacts/auto-populate``. */
export interface AutoPopulateFromStratigraphyResponse {
  created_contact_ids: string[]
  created_formation_ids: string[]
  /**
   * Formation ids deleted server-side because their canonical key was not in
   * the selected_keys set. Populated only in ``overwrite`` mode on the
   * Fill-from-boreholes path. Empty otherwise.
   */
  deleted_formation_ids: string[]
  /** Display names of ``deleted_formation_ids``, same order — toast material. */
  deleted_formation_names?: string[]
  /** The mode the server actually ran under. */
  mode?: AutoPopulateMode
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
 * Result of ``POST .../bodies/recompute`` — the geometric-body-identity recompute
 * (slice 5). The backend consumes the FE's per-section partitions + LAYER-id
 * groups (label-independent evidence — body-id evidence oscillated in
 * production), rewrites the geometry facts, and re-resolves body identity.
 */
export interface RecomputeBodiesResponse {
  /** Geometry-fact rows written by this recompute. */
  facts_written: number
  /** Stale fact rows dropped (superseded by this payload). */
  facts_dropped_stale: number
  /** Bodies unified by the re-resolve. */
  bodies_merged: number
  /** Bodies split apart by the re-resolve. */
  bodies_split: number
  /** Bodies whose display name was displaced by a merge/split. */
  renamed: string[]
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
  /**
   * Investigations that fall OUTSIDE the model footprint and got NO 3-D model
   * at all — the data footprint fragmented and only its largest component was
   * modelled.  Non-empty means the build is INCOMPLETE even though it
   * succeeded, so the toast must not read as a plain success.  Optional: a
   * backend built before this field existed simply omits it.
   */
  uncovered_test_ids?: string[]
  /**
   * Why the build produced no bodies, when it produced none.  A degenerate
   * build DELETES the stored 3-D model, yet its counts read exactly like a
   * happy build of zero bodies — so this is what stops the client reporting a
   * green "Built 0 bodies" over a model that was just erased.  ``null`` /
   * absent whenever at least one body was built.
   */
  empty_reason?: string | null
  /**
   * THE SEVEN-CLAUSE GAPLESS GATE for this build — the answer to the owner's
   * constraint that the model carries no gaps and no fallbacks except where a
   * user made a mistake.
   *
   * The gate fails the REPORT, never the build: a build that trips a clause
   * still writes its solids and still returns 200, and this is where it says
   * so. Reading it as an error would hide the model from the engineer who
   * needs to look at it.
   *
   * Assembled server-side from the four 2-D clauses this client sent in the
   * request plus the three 3-D clauses the label grid answers. Optional: a
   * backend older than the gate omits it, and so does a build that never
   * reached the assembler.
   */
  gapless_report?: GaplessBuildReport | null
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
  /**
   * Why this edge needs a second look, or `null` when it does not.
   *
   * Set by the geotech re-anchor when a re-subdivide could not identify the band
   * the tie was drawn on: `'class_changed'` (nothing of the tie's own packing
   * class overlaps its old depths any more) or `'ambiguous_band'` (several
   * same-class bands do). The tie is carried and flagged rather than deleted —
   * an accepted edge never disappears without the user deleting it.
   *
   * A flagged edge is still `user_approved`: it is awaiting confirmation, not
   * pending acceptance, so it renders as a warning rather than as a proposal.
   */
  review_reason?: string | null
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
  /**
   * Every geological formation this body crosses, shallowest first (debt #278,
   * R2). A body may span geological boundaries, so its geological attribution is
   * a LIST, not just the majority singular above. Absent on old cached responses
   * — consumers fall back to the singular field.
   */
  geo_formations?: { id: string; name: string }[]
  /**
   * The litho-model body this body descends from (debt #278 D1). On a GEOTECH
   * model body it is the parent litho body id — the geometrically-disconnected
   * litho mass a packing body was carved out of, which the geotech units pane
   * uses as its middle grouping level (soil ▸ litho body ▸ packing body). On a
   * LITHO model body it is null (a litho body has no litho parent). Optional +
   * nullable: additive, and absent on an old cached response, so consumers read
   * it as ``?? null``.
   */
  parent_litho_body_id?: string | null
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

/** Response from ``DELETE .../models/{mid}/boundaries`` (Reset manual points). */
export interface ClearBoundariesResponse {
  /** Number of hand-drawn boundary shapes removed (one per hand-shaped body). */
  shapes_deleted: number
}

// ---------------------------------------------------------------------------
// Body-separation ("Separate" verb) types — debt #278 R5
// ---------------------------------------------------------------------------

/**
 * Response from ``POST .../models/{mid}/body-separations`` — the "Separate" verb.
 *
 * A separation is a cannot-link constraint in LAYER-id space: the resolver reads
 * it and drops any union (however indirect) that would merge the two anchors, so
 * the two bodies stay separate until an explicit Rejoin (DELETE). The verb is
 * reversible, so a duplicate is a ``200`` with the existing row (``was_created``
 * ``false``), never a ``409``.
 */
export interface BodySeparationResponse {
  /** Primary key of the canonical separation row (new or pre-existing). */
  separation_id: string
  model_id: string
  /** Canonical lesser anchor (the backend orders the pair). */
  layer_a_id: string
  /** Canonical greater anchor. */
  layer_b_id: string
  /** ``true`` when a new separation was inserted; ``false`` on an idempotent re-call. */
  was_created: boolean
  /** Bodies created or removed when the resolver re-ran in the same request. */
  bodies_changed: number
  /** Unit names displaced by the re-resolve's lineage adoption — toast material. */
  renamed: string[]
}

/**
 * Server-resolved display info for one anchor of a separation.
 *
 * The FE renders "Rejoin with <label>" without owning a resolution map: the
 * server reports each anchor's CURRENT body (its ``litho_layer.body_id`` at
 * request time), so the label always reflects the live partition.
 */
export interface BodySeparationAnchorInfo {
  layer_id: string
  /** The body the anchor currently belongs to; ``null`` when unstamped. */
  body_id: string | null
  /** The body's user name; ``null`` when unnamed (FE derives an ordinal label). */
  body_name: string | null
  /** The body's ordinal within its naming group; ``null`` when unstamped. */
  body_ordinal: number | null
  /** The body's formation row — lets the FE compose a soil-coded label. */
  formation_id: string | null
}

/**
 * One separation returned by ``GET .../models/{mid}/body-separations``.
 *
 * Carries both anchors' current-body display info so the FE can label the
 * "Rejoin with <label>" item without resolving bodies itself.
 */
export interface BodySeparationListItem {
  /** Primary key of the ``body_separation`` row. */
  id: string
  model_id: string
  layer_a_id: string
  layer_b_id: string
  anchor_a: BodySeparationAnchorInfo
  anchor_b: BodySeparationAnchorInfo
  created_at: string
}

/**
 * Response from ``DELETE .../models/{mid}/body-separations/{sep_id}`` (Rejoin).
 *
 * Lifting the cannot-link constraint lets the two anchors re-union if the ties /
 * geometry still connect them; the resolver re-runs in the same request.
 */
export interface BodySeparationRejoinResponse {
  /** Bodies created or removed when the resolver re-ran after the lift. */
  bodies_changed: number
  /** Unit names displaced by the re-resolve's lineage adoption. */
  renamed: string[]
}

// ---------------------------------------------------------------------------
// Body-union ("Join with…" verb) types — debt #278 (owner ruling 2026-08-31)
// ---------------------------------------------------------------------------

/**
 * Response from ``POST .../models/{mid}/body-unions`` — the "Join with…" verb.
 *
 * A union is a must-link constraint in LAYER-id space: the resolver reads it and
 * merges the two anchors even when no edge connects them, so the engineer can
 * state "this body IS the same as that body". The additive counterpart to
 * Separate. The verb is reversible, so a duplicate pair answers ``200`` with the
 * existing row (``was_created: false``), never a ``409``.
 */
export interface BodyUnionResponse {
  /** Primary key of the canonical union row (new or pre-existing). */
  union_id: string
  model_id: string
  /** Canonical lesser anchor (the backend orders the pair). */
  layer_a_id: string
  /** Canonical greater anchor. */
  layer_b_id: string
  /** ``true`` when a new union was inserted; ``false`` on an idempotent re-call. */
  was_created: boolean
  /** Bodies created or removed when the resolver re-ran in the same request. */
  bodies_changed: number
  /** Unit names displaced by the re-resolve's lineage adoption — toast material. */
  renamed: string[]
  /**
   * ``true`` when the in-request resolve SUPPRESSED this join — a standing
   * separation overruled it (cannot-link wins), so the two bodies stayed apart
   * despite the row being written. Lets the toast say "join blocked by a
   * separation" instead of a misleading ``was_created: true, bodies_changed: 0``.
   * Additive: absent on an older backend → normalised to false by the consumer.
   */
  suppressed: boolean
  /**
   * ``true`` when the in-request resolve found this join INERT — the two anchors
   * re-derived to different masses (class mismatch), so it can never make one
   * body. Also normally refused 422 at write time.
   */
  inert: boolean
}

/**
 * Server-resolved display info for one anchor of a union.
 *
 * Structurally identical to ``BodySeparationAnchorInfo`` — the FE renders
 * "Disjoin {label}" without owning a resolution map: the server reports each
 * anchor's CURRENT body (its ``litho_layer.body_id`` at request time), so the
 * label always reflects the live partition.
 */
export interface BodyUnionAnchorInfo {
  layer_id: string
  /** The body the anchor currently belongs to; ``null`` when unstamped. */
  body_id: string | null
  /** The body's user name; ``null`` when unnamed (FE derives an ordinal label). */
  body_name: string | null
  /** The body's ordinal within its naming group; ``null`` when unstamped. */
  body_ordinal: number | null
  /** The body's formation row — lets the FE compose a soil-coded label. */
  formation_id: string | null
}

/**
 * One union returned by ``GET .../models/{mid}/body-unions``.
 *
 * Carries both anchors' current-body display info so the FE can label the
 * "Disjoin {label}" item without resolving bodies itself.
 */
export interface BodyUnionListItem {
  /** Primary key of the ``body_union`` row. */
  id: string
  model_id: string
  layer_a_id: string
  layer_b_id: string
  anchor_a: BodyUnionAnchorInfo
  anchor_b: BodyUnionAnchorInfo
  created_at: string
}

/**
 * Response from ``DELETE .../models/{mid}/body-unions/{union_id}`` (Disjoin).
 *
 * Lifting the must-link lets the two anchors fall back to whatever ties /
 * geometry facts connect them; where none do, they split. The counts report how
 * many OTHER unions the post-Disjoin resolve still finds suppressed / inert.
 */
export interface BodyUnionDisjoinResponse {
  /** Bodies created or removed when the resolver re-ran after the union was lifted. */
  bodies_changed: number
  /** Unit names displaced by the re-resolve's lineage adoption. */
  renamed: string[]
  /** OTHER unions still suppressed by a standing separation after the Disjoin. */
  suppressed_unions: number
  /** OTHER unions found inert (class mismatch) after the Disjoin. */
  inert_unions: number
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
  /**
   * Accepted packing ties carried across the rebuild.  A rebuilt band is the
   * band the tie pointed at when the investigation, the depth interval and the
   * NAD class all match exactly (owner ruling 2026-08-01), so the tie is
   * re-created against it — still accepted, still carrying its provenance.
   */
  reanchored_tie_count?: number
  /**
   * Accepted packing ties whose band is not in the rebuild, so they could not
   * be carried.  These are gone; only the engineer can redraw them.
   */
  lost_tie_count?: number
  /**
   * Why the lost ties were lost — ``class_changed`` (the qc re-derived a
   * different packing class over the same depths), ``interval_moved`` (a
   * boundary shifted), ``band_absent`` (the rebuild no longer draws that
   * geology), ``borehole_endpoint_deferred`` (the endpoint is a borehole
   * column, filled by the later Divide-boreholes step).
   */
  lost_tie_reasons?: Record<string, number>
  /**
   * One line per lost tie naming BOTH investigations and each endpoint's depth
   * range — e.g. ``"GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m"``.
   *
   * A count alone tells the engineer that accepted work vanished and nothing
   * about where to redraw it; the endpoint ids only ever reached a server log
   * (audit 2026-08-02). Optional so a response from a backend that predates
   * the field still parses.
   */
  lost_tie_labels?: string[]
  /**
   * Accepted ties the rebuild carried but could not place with confidence,
   * keyed by why (`class_changed` / `ambiguous_band`).
   *
   * NOT losses — these survived and are included in `reanchored_tie_count`.
   * They render with a badge on the section until the engineer confirms or
   * deletes them.
   */
  review_tie_reasons?: Record<string, number>
  /**
   * Whether this call also PROPOSED packing ties.
   *
   * ``subdivide-cpts`` (pipeline step 1) answers ``false`` — the engineer's
   * next press is auto-correlate. The combined ``subdivide-all-bodies`` verb
   * answers ``true``. Optional so a response from a backend that predates the
   * four-step pipeline still parses.
   */
  edges_derived?: boolean
  /** Packing ties proposed by this call, all unapproved (0 when step 1). */
  proposed_tie_count?: number
  /**
   * Interpreted investigations left OUT of the model because they project onto
   * no cross-section in scope (owner ruling 2026-08-15). Optional so an older
   * backend simply reports nothing rather than a misleading zero.
   *
   * NOT shown to the engineer — owner, same day: *"wtf are of section skips,
   * this is useless info for the user?"*. The pair stays on the wire (and in
   * the backend's INFO log) as the audit trail for a model that came out
   * smaller than the sidebar's count; the toast says nothing about it.
   */
  skipped_off_section_count?: number
  /** Names of those investigations — the log's, not the toast's. */
  skipped_off_section_labels?: string[]
}

/**
 * Response of ``GET .../geotech/tie-status`` — pipeline step 3's counter.
 *
 * The question "is there correlation work outstanding?", asked before the
 * divide-boreholes gate answers it with a 422. Lets the toolbar disable step 4
 * and say how much is left, instead of the engineer learning it from an error.
 */
export interface GeotechTieStatusResponse {
  /** The geotechnical model the counts belong to. */
  geotech_model_id: string
  /** Proposed ties the engineer has not accepted (or deleted) yet. */
  pending_tie_count: number
  /** Ties already accepted — these are what the resolver and the build read. */
  accepted_tie_count: number
  /** Accepted ties flagged for review by a rebuild (the violet ``!`` badges). */
  flagged_tie_count: number
  /**
   * ``section_id → pending count``; sections with none are omitted.
   *
   * Optional so a backend predating it degrades to the bare model total
   * instead of to a confident "0 sections pending" (see
   * ``geotechPendingScope.ts``). Added 2026-08-15 with the section-scoped
   * steps 2 and 3: step 4 stays model-wide, so the gate has to name the OTHER
   * sections still holding it shut.
   */
  pending_by_section?: Record<string, number>
}

/** One column whose litho stack moved after its packing bands were made. */
export interface StaleGeotechColumn {
  /** The CPT or borehole the stale bands sit on. */
  investigation_id: string
  /** Its display name — what the chip and the toast call the column. */
  label: string
}

/**
 * Response of ``GET .../geotech/litho-staleness`` — debt #266.
 *
 * Packing bands are derived from the litho stack under them, and nothing used
 * to link the two: drag a litho contact and the geotech axis kept drawing the
 * old bands as though they were current, right through to a client-facing
 * export. This answers "which columns is that true of right now".
 *
 * Derived server-side on every read (the digest the last press stamped vs the
 * litho as it stands), so it clears itself when the named columns are
 * re-pressed. There is nothing to acknowledge and nothing to reset.
 */
export interface GeotechLithoStalenessResponse {
  /** The geotechnical model the answer describes. */
  geotech_model_id: string
  /** Its parent litho model — what the comparison is against. */
  litho_model_id?: string | null
  /** The columns to re-press, sorted by label. */
  stale_columns: StaleGeotechColumn[]
  /** ``stale_columns.length``, so the chip need not read the list. */
  stale_column_count: number
  /** Columns carrying at least one band. */
  banded_column_count: number
  /**
   * Banded columns with no record of what they were built from.
   *
   * NOT stale — unknown provenance is not evidence the ground moved, and
   * calling it stale would flag every pre-#266 project on first open. Carried
   * separately because an export guard has to tell "verified current" from
   * "cannot say".
   */
  unstamped_column_count: number
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
  /**
   * Accepted packing ties on a borehole column that were carried onto the
   * rebuilt bands. Re-dividing deletes every borehole band, and the endpoint
   * FKs cascade, so a hand-drawn tie would otherwise vanish on every re-click.
   * Includes the flagged ones counted in `review_tie_reasons`.
   */
  reanchored_tie_count?: number
  /**
   * Carried ties the engineer has to confirm, per reason (`class_changed` /
   * `ambiguous_band`). NOT losses — they survived, with a review flag.
   */
  review_tie_reasons?: Record<string, number>
  /** Accepted borehole ties the rebuild left nowhere to anchor. */
  lost_tie_count?: number
  /** Breakdown of `lost_tie_count`. */
  lost_tie_reasons?: Record<string, number>
  /**
   * One line per lost tie naming BOTH investigations and each endpoint's depth
   * range — e.g. ``"GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m"``.
   *
   * A count alone tells the engineer that accepted work vanished and nothing
   * about where to redraw it; the endpoint ids only ever reached a server log
   * (audit 2026-08-02). Optional so a response from a backend that predates
   * the field still parses.
   */
  lost_tie_labels?: string[]
  /**
   * Bridged CPT↔CPT jump ties deleted because the borehole-mediated chain now
   * carries the same connection (owner ruling 2026-08-14: the chain REPLACES
   * the jump tie — hand-drawn or machine, accepted or pending). Optional so a
   * response from a backend that predates the field still parses.
   */
  superseded_jump_tie_count?: number
  /**
   * Accepted CPT↔CPT ties Phase 8.6 auto-deleted because they still crossed a
   * borehole's banded range after the split and no hop could be made (owner
   * ruling 2026-08-24: "if no hops can be made, you just auto delete the
   * crossing correlation"). Optional so a response from a backend that
   * predates the field still parses.
   */
  deleted_crossing_span_count?: number
}

/**
 * One packing band the "Divide boreholes" commit would write on a borehole.
 *
 * Produced by the same planner the commit runs, so a ghost drawn from this is
 * a promise the button keeps. There is no `body_id`: the commit re-resolves
 * body identity after the borehole-mediated edges exist, so no plan can know
 * it in advance (see the backend schema's note).
 */
/** One CPT a previewed band's packing was read from (tooltip provenance). */
export interface DivideBoreholePreviewDonor {
  /** Donor CPT display name. */
  name: string
  /** `left` | `right` on the section; `nearest` in the map-distance fallback. */
  side: string
  /** Distance along the section line (m); null in the map-distance fallback. */
  along_distance_m: number | null
  /** Straight-line map distance (m). */
  map_distance_m: number | null
}

export interface DivideBoreholePreviewBand {
  /** Top of the band, m below the borehole collar. */
  depth_top_m: number
  /** Base of the band, m below the collar. */
  depth_base_m: number
  /** NAD packing class 1–31. Label via `nadClassName` at the render boundary. */
  nad_class: number
  /** `cpt_interpolated` | `body_min` | `absolute_min` — how the class was reached. */
  source: string
  /** `high` | `low`, exactly as the committed row would carry it. */
  confidence: string
  /**
   * `flank_interpolated` | `single_donor` | `nearest_fallback` — which arm of
   * the flanking-donor rule spoke. Absent from responses of a pre-rule
   * backend; the tooltip then falls back to `source` prose.
   */
  mode?: string | null
  /** The CPT(s) the class was read from; empty for conservative fills. */
  donors?: DivideBoreholePreviewDonor[]
  /** Section the donors were read along; null outside the flank modes. */
  section_name?: string | null
}

/** Every planned band on one borehole column, top to bottom. */
export interface DivideBoreholePreviewColumn {
  /** The borehole the bands sit on. */
  borehole_id: string
  /** Borehole display name. */
  name: string
  /** Planned bands, sorted by `depth_top_m`. */
  bands: DivideBoreholePreviewBand[]
}

/**
 * Response of ``POST .../geotech/divide-boreholes/preview`` — a dry run.
 *
 * Nothing is written. The endpoint exists because "Subdivide all bodies"
 * leaves every borehole column empty on the geotech axis, so without it the
 * engineer has to press an idempotent-but-destructive rebuild blind to find
 * out what packing the boreholes get.
 */
export interface DivideBoreholePreviewResponse {
  /** The geotech model a commit would write into. */
  geotech_model_id: string
  /** One entry per borehole that would receive planned bands. */
  columns: DivideBoreholePreviewColumn[]
  /** Number of borehole columns in `columns`. */
  borehole_count: number
  /** Body-group fills that would produce ≥ 2 bands. */
  divided_borehole_count: number
  /** Body-group fills that would produce exactly 1 band. */
  single_band_borehole_count: number
  /** Total litho_layer rows a commit would insert. */
  layer_count: number
  /** Accepted borehole ties a commit would carry (includes the flagged ones). */
  carried_tie_count: number
  /** Carried-but-flagged ties per reason: `class_changed` / `ambiguous_band`. */
  review_tie_reasons: Record<string, number>
  /** Accepted borehole ties a commit could not carry. */
  lost_tie_count: number
  /** Why they would be lost: `class_changed` / `interval_moved` / `band_absent`. */
  lost_tie_reasons: Record<string, number>
}

/**
 * Response of ``POST .../geotech/auto-correlate``.
 *
 * The standalone geotech counterpart of the litho auto-correlate verb. It
 * PROPOSES packing ties as unapproved suggestions and never touches an
 * existing correlation, so it is safe to press part-way through a manual
 * correlation session — unlike ``subdivide-all-bodies``, which rewrites the
 * whole geotech model.
 */
export interface AutoCorrelateGeotechResponse {
  /** Net-new unapproved ties inserted; they render amber until accepted. */
  edges_proposed: number
  /** Restated litho ties born accepted (owner refinement 2026-08-06). */
  edges_accepted?: number
  /** Candidate ties left untouched because an edge already joined those bands. */
  edges_skipped_existing: number
  /** Sections that carried an approved litho correlation and were examined. */
  sections_processed: number
  /** Correlated litho units whose two packing stacks share no NAD class. */
  skipped_no_lcs: number
  /** Correlated litho units where one column carries no geotech bands. */
  skipped_empty_stack: number
}


/**
 * One interval a hand split or merge would produce, with its re-derived class.
 *
 * The class is DERIVED, never carried (owner ruling 3, docs/debt.md #227): after an edit
 * the NAD class of each resulting interval is recomputed from the CPT qc over that
 * interval, so ``nad_class`` may differ from ``previous_nad_class`` on both halves of a
 * split and from BOTH inputs of a merge.
 */
export interface GeotechBandIntervalItem {
  /** Interval top in metres below the collar. */
  depth_top_m: number
  /** Interval base in metres below the collar. */
  depth_base_m: number
  /**
   * DEPRECATED name — same value as ``representative_qc_mpa``, kept for older
   * clients (the field predates ruling 7's selectable statistic).
   */
  median_qc_mpa: number | null
  /**
   * Representative qc over the interval in MPa, under the MODEL'S chosen
   * statistic (the plan's ``statistic`` field names it — ruling 7). Label it
   * "representative qc" in the UI rather than "average qc"; a consequence
   * computed with any other statistic would promise a reclassification that
   * never happens (ruling 6).
   */
  representative_qc_mpa?: number | null
  /** The re-derived NAD packing class, or null when the qc cannot answer. */
  nad_class: number | null
  /** The class the interval's material carries today. */
  previous_nad_class: number | null
  /** Whether the re-derivation moved the class. */
  class_changed: boolean
  /** Why no class could be derived; null on the happy path. */
  unclassifiable_reason: string | null
}

/**
 * One advisory consequence of a hand edit.
 *
 * Advisory, never blocking (owner ruling 5 — manual override always wins). Known codes:
 * ``qc_pull_down`` / ``qc_pull_up`` (the material moving between layers drags the receiving
 * layer's representative qc, and the message says what class results), ``qc_unavailable``,
 * and ``below_minimum_thickness``.
 */
export interface GeotechBandWarningItem {
  /** Warning code the UI switches on. */
  code: string
  /** Plain-language consequence, authored server-side. */
  message: string
  /** Top of the interval the warning names, in metres. */
  depth_top_m: number
  /** Base of the interval the warning names, in metres. */
  depth_base_m: number
  /** The band the warning names, when it names one. */
  band_id: string | null
}

/** What a proposed split / merge / move would do — the preview payload, no write. */
export interface GeotechBandEditPlanResponse {
  /** ``"split"``, ``"merge"`` or ``"move"``. */
  kind: string
  /** The representative-qc statistic every number in this plan used (ruling 7). */
  statistic?: string
  /** Top of the enclosing litho body in metres — the hard upper wall. */
  parent_top_m: number
  /** Base of the enclosing litho body in metres — the hard lower wall. */
  parent_base_m: number
  /** Resulting intervals, top to bottom. */
  intervals: GeotechBandIntervalItem[]
  /** Advisory consequences; never blocking. */
  warnings: GeotechBandWarningItem[]
}

/** Result of a committed hand split / merge / move. */
export interface GeotechBandEditResponse {
  /** The geotechnical model that was written. */
  geotech_model_id: string
  /** The only column that changed — recalculation is local (owner ruling 4). */
  investigation_id: string
  /** What was committed. */
  plan: GeotechBandEditPlanResponse
  /** The resulting band rows on the edited column. */
  layer_ids: string[]
  /** Rows inserted. */
  created_layer_ids: string[]
  /** Rows removed. */
  deleted_layer_ids: string[]
  /**
   * Correlations REMOVED — since flag-not-drop (2026-08-07) this is pending
   * mismatches + cascades + transfer drops only; accepted mismatches survive
   * in ``flagged_edge_ids`` instead.
   */
  deleted_edge_ids: string[]
  /**
   * The subset of ``deleted_edge_ids`` the engineer had ACCEPTED. Optional so
   * an older backend simply reports nothing here rather than mislabelling.
   */
  deleted_accepted_edge_ids?: string[]
  /** ACCEPTED ties flagged for review (violet badge) — never silently gone. */
  flagged_edge_ids?: string[]
  /** Ties whose restored class match self-healed an earlier flag. */
  cleared_edge_ids?: string[]
}

/**
 * Response of ``geotech/contact/move`` — the band outcome plus what else moved.
 *
 * Extends the band-edit payload because the geotech half of this gesture IS a
 * band move. What it adds is the answer to "what else did I just change": a
 * restated contact is one boundary recorded in two or three models, and the
 * engineer has to be told which ones the drag will carry.
 */
export interface RestatedContactMoveResponse extends GeotechBandEditResponse {
  /** The litho layer above the contact; its base moved. */
  litho_upper_layer_id: string
  /** The litho layer below; its top moved. */
  litho_lower_layer_id: string
  /**
   * The geological contact carried with it, or null when the litho row is not
   * derived from one. About a third are, so neither answer is the safe default.
   */
  geo_contact_id: string | null
}

/**
 * Response from ``GET .../models/{model_id}/footprint``.
 *
 * The model's footprint boundary — the alpha hull the 3-D build clipped the
 * labelling to, re-derived server-side from the persisted build payload so the
 * ring the viewer draws is the build's OWN boundary and not a client-side
 * approximation of it.
 *
 * Never an error state: a model that was never built, whose investigations do
 * not frame an area, or whose stored payload cannot be read all answer 200
 * with an empty ``polygon`` and a plain-English ``unavailable_reason``.
 */
export interface ModelFootprintResponse {
  /**
   * Closed ring of ``[x_m, y_m]`` in the project CRS, WITHOUT a repeated last
   * vertex. Empty when no ring is available — see ``unavailable_reason``.
   */
  polygon: number[][]
  /** The build generation the ring came from; null when never built. */
  generation_id: string | null
  /** That generation's timestamp; null alongside ``generation_id``. */
  built_at: string | null
  /** Why ``polygon`` is empty, when it is. Null when a ring was returned. */
  unavailable_reason: string | null
}

/** The statistic state of a geotech model after a change (rulings 7+8). */
export interface GeotechStatisticResponse {
  /** The choice now stored on the model. */
  representative_statistic: string
  /** What the last full "Subdivide all bodies" classified with; null before any build. */
  classified_with_statistic: string | null
  /** Choice differs from the last build's stamp — a re-subdivide is due. */
  bands_stale: boolean
}
