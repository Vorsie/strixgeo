// Typed fetch wrappers for the Ground Model FastAPI backend.
import { log } from '../utils/log'

// Borehole filter axis — which categorical field the user is filtering by.
// Lifted to a shared type because both the map's layer-control and the
// sidebar's row partitioning need to agree on which axis is active.
export type BoreholeAxis = 'drill_method' | 'borehole_type'

export interface CptListItem {
  id: string
  name: string
  cpt_type: string
  max_depth_m: number | null
  n_rows: number | null
  location_x: number
  location_y: number
  epsg: number | null
  // Surface elevation lives on the list item so the sidebar can render the
  // "needs Z" badge without a per-row detail fetch.
  elevation_m: number | null
  z_epsg: number | null
  // Provenance — ``"dov"`` / ``"gef"`` / ``"manual"`` / ``"none"``.
  // Used by ElevationEditor to render a tiny "(DOV)" / "(manual)" tag
  // next to the Z value (debt #8).
  elevation_source: string
  // Raw file_date from the ORM — pass-through from the GEF/DOV parser.
  // Format varies (ISO, slash-separated, year-only, null). Normalise via
  // parseInvestigationDate before any comparison or display.
  start_date: string | null
}

export interface CptResponse {
  id: string
  name: string
  cpt_type: string
  location_x: number
  location_y: number
  epsg: number | null
  elevation_m: number | null
  z_epsg: number | null
  elevation_source: string
  pre_drill_m: number
  cone_area_ratio: number | null
  max_depth_m: number | null
  n_rows: number | null
}

export interface CptPlotResponse {
  cpt_id: string
  depths_m: number[]
  qc_mpa: number[]
  fs_mpa: (number | null)[] | null
  u2_mpa: (number | null)[] | null
  rf_pct: (number | null)[] | null
  // qt_mpa: CPTU corrected cone resistance (qt = qc + u2(1-a)). Populated for
  // piezocones only.
  qt_mpa: (number | null)[] | null
  // q_total_mpa: CPTM totaalweerstand — combined tip + sleeve force read by a
  // mechanical Begemann cone in one go. Populated for CPTM only.
  q_total_mpa: (number | null)[] | null
  ic: (number | null)[] | null
  rf_source: string | null
}

export interface ImportCptResponse {
  cpt_id: string
  has_errors: boolean
  issues: { level: string; code: string; message: string; rows: number[] }[]
}

export interface ImportDovResponse {
  imported: number
  duplicates: number
  failed: number
  cpt_ids: string[]
}

// ---------------------------------------------------------------------------
// Project — mirrors api/schemas/project/. Field names match the backend
// 1:1 so the desktop's .gmproj file can be a near-direct serialisation
// of the API response.
// ---------------------------------------------------------------------------

export type ProjectPhase = 'feasibility' | 'design' | 'construction' | 'monitoring'
export type ProjectStatus = 'active' | 'on_hold' | 'completed'

export interface ProjectResponse {
  id: string
  name: string
  project_number: string | null
  client: string | null
  site_label: string | null
  description: string | null
  tags: string[]
  default_horizontal_epsg: number | null
  default_vertical_epsg: number | null
  phase: string | null  // ProjectPhase value, kept as string for forward-compat
  status: string         // ProjectStatus value, same reason
  archived_at: string | null
  created_at: string
  updated_at: string
  // Project-level view toggles (DEM overlay, hidden-by-type sets,
  // future preferences). Schema-less JSONB on the server — the keys
  // each consumer cares about are documented in their respective
  // utility module (e.g. ``demSources.readDemOverlay``).
  view_state: Record<string, unknown>
}

// Full project bundle — metadata + every CPT (with series) + every
// borehole (with its child tree). Returned by GET /projects/{id}/bundle
// and accepted by POST /projects/{id}/restore. The renderer never
// inspects the row shapes; the data dicts are opaque and round-trip
// unchanged.
export interface ProjectBundleResponse {
  format_version: number
  project: Record<string, unknown>
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
  geological_formations: Record<string, unknown>[]
  geotechnical_units: Record<string, unknown>[]
  geological_models: Record<string, unknown>[]
  cross_sections: Record<string, unknown>[]
  investigation_reviews: Record<string, unknown>[]
  /** Contact-level correlation edges (#133 Phase 2+3). Absent in older bundles. */
  litho_contact_correlation_edges?: Record<string, unknown>[]
  /** Body (litho lens) metadata rows (slice 4.1 rename). Absent in older bundles. */
  bodies?: Record<string, unknown>[]
  /** Formation absence records (Position 4). Absent in older bundles. */
  formation_absences?: Record<string, unknown>[]
  /** Body boundary shapes + control nodes (#163f Slice 2). Absent in older bundles. */
  body_boundary_shapes?: Record<string, unknown>[]
  body_boundary_nodes?: Record<string, unknown>[]
}

// Investigation-review response — per-(project, investigation) row:
// review status / notes / is_hidden flag. Polymorphic via
// ``target_kind`` + ``target_id``. Bundle-persisted: rides in the
// .gmproj on save, restored on open. Drives the sidebar's
// "remove from project" UX (is_hidden) and, in Phase 5, the
// reviewed-state filter for the geotechnical-decision workflow.
export type ReviewTargetKind = 'cpt' | 'borehole'
export type ReviewStatus = 'unreviewed' | 'in_progress' | 'reviewed'

export interface InvestigationReviewResponse {
  id: string
  app_project_id: string
  target_kind: ReviewTargetKind
  target_id: string
  review_status: ReviewStatus
  review_notes: string | null
  reviewed_at: string | null
  is_hidden: boolean
  created_at: string
  updated_at: string
}

export interface InvestigationReviewUpsertPayload {
  review_status?: ReviewStatus | null
  review_notes?: string | null
  is_hidden?: boolean | null
}

// Geological-formation response — per-project formation vocabulary
// (e.g. "Boom Klei", "Diest Zand"). The geological-model editor
// references formations by id when placing contacts; the formation
// itself owns the display attributes (name, colour, display_order).
// Bundle-persisted via ``project_bundle.geological_formations``.
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

// Slice 5: request body for PATCH .../bodies/{id} (update a body row).
export interface NameBodyRequest {
  formation_id: string
  body_ordinal: number
  name: string
  primary_section_id?: string | null
}

// Slice 5: response from PATCH .../bodies/{id}.
export interface NameBodyResponse {
  lens_id: string
  was_created: boolean
}

// Position 4: one row from GET .../formations/{id}/absences.
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

// Position 4: request body for POST .../formations/{id}/absences.
export interface UpsertFormationAbsenceRequest {
  investigation_id: string
  investigation_kind: 'borehole' | 'cpt'
  source: 'manual' | 'observed'
}

// Position 4: response from POST .../formations/{id}/absences.
export interface UpsertFormationAbsenceResponse {
  absence_id: string
  was_created: boolean
}

// Slice 5: body list item from GET .../bodies — matches BodyListItem backend schema.
// A row carries the full metadata for one body (formerly lens) in a litho model.
export interface BodyListItem {
  id: string
  app_project_id: string
  model_id: string
  formation_id: string
  body_ordinal: number
  source_investigation_id: string
  name: string | null
  primary_section_id: string | null
  extent_left_kind: string | null
  extent_left_target_contact_id: string | null
  extent_left_neighbour_inv_id: string | null
  extent_right_kind: string | null
  extent_right_target_contact_id: string | null
  extent_right_neighbour_inv_id: string | null
  created_at: string
  updated_at: string
  /** Stable identity of the body (#163f) — sorted hash of its 3 defining
   *  contact ids. Populated by the correlation-graph detector.
   *  Null on rows not yet detected since the shaping feature shipped.
   *  @deprecated LensWedgeOverlay dropped in slice 6; BodyExtentOverlay uses
   *  extent_<side>_kind fields instead. content_key retained for legacy bodies. */
  content_key?: string | null
}

// Slice 5: one control node on a body boundary (section-local).
export interface BodyBoundaryNode {
  along_m: number
  elevation_m: number
}

export type BodyRenderStyle = 'straight' | 'blocky' | 'rounded'

// Slice 5: GET/PUT .../bodies/{id}/boundary payload — the user-authored shape.
export interface BodyBoundaryResponse {
  lens_id: string
  content_key: string | null
  render_style: BodyRenderStyle
  primary_section_id: string | null
  upper_nodes: BodyBoundaryNode[]
  lower_nodes: BodyBoundaryNode[]
}

// Slice 5: one pinch-out candidate from POST .../bodies/suggest-pinch-outs.
export interface PinchOutCandidate {
  body_id: string | null
  source_investigation_id: string
  above_contact_id: string
  below_contact_id: string | null
  /** Investigation bottom depth (m below surface) for a deepest-formation
   *  open candidate, whose base is the bottom of the hole rather than a
   *  contact. null/absent for normal framed candidates. */
  below_depth_m?: number | null
  side: 'left' | 'right'
  // 'pinch_out_halfway' (interior) or 'open' (edge test → opens to the boundary).
  kind: 'pinch_out_halfway' | 'open'
  // null for an 'open' edge candidate (no halfway target).
  suggested_neighbour_investigation_id: string | null
}

export interface SuggestPinchOutsResponse {
  candidates: PinchOutCandidate[]
}

// Phase-2 Slice 3: one edge in the litho correlation graph.
// Consumed by the LithologyInspector stale-badge computation (to hash
// the edge set) and by future Slice 4 section canvas rendering.
// MODEL-level only — no section_id, no seeded_formation_contact_ids.
export interface LithoCorrelationEdge {
  id: string
  formation_a_id: string
  formation_b_id: string
  source: string
  created_at: string
}

// Contact-level correlation edge (#133 Phase 1).  Distinct from
// LithoCorrelationEdge — this connects two specific FormationContact rows
// (boundary-to-boundary), not two formations as a whole.  Shared endpoints
// between rows are permitted (#135 lens-pinch-out topology).
export interface LithoContactCorrelationEdge {
  id: string
  contact_a_id: string
  contact_b_id: string
  model_id: string
  source: string
  user_approved: boolean
  created_at: string
}

// Phase-2 Slice 3: response from POST /correlations/resolve.
export interface ResolveInstancesResponse {
  updated: Array<{ formation_id: string; new_ordinal: number }>
}

// #127: response from POST /models/{mid}/auto-correlate.
export interface AutoCorrelateResult {
  edges_created: number
  edges_skipped_existing: number
  formations_recomputed: number
  wedge_tips_materialised: number
}

// Auto-lens (2026-06-02): a pinch-out lens candidate inferred from a
// correlation crossing — the framing contacts on the source column + the
// neighbour the layer pinches toward. Rendered as an amber lens-candidate
// marker on the section after Correlate.
export interface CrossingPinchOut {
  source_investigation_id: string
  above_contact_id: string
  below_contact_id: string
  neighbour_investigation_id: string
}

// Slice 4 Half-A — re-correlate dialog: response from DELETE
// /correlations/auto.  Manual edges are never touched.
export interface DeleteAutoCorrelationsResult {
  deleted: number
}

// Geological-model response — a project can have multiple
// interpretation models; one is active at a time. Contacts live as
// child rows fetched separately so the model list response stays
// light.
// Three-level modelling hierarchy discriminator (CLAUDE.md "Modelling
// hierarchy"). ``is_active`` is scoped PER KIND on the backend — a
// geological and a lithostratigraphic model can both be active at
// once, so the frontend must select by kind, not "the first active".
export type ModelKind = 'geological' | 'lithostratigraphic' | 'geotechnical'

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

export interface GeologicalModelCreatePayload {
  name: string
  description?: string | null
  is_active?: boolean
  excluded_borehole_ids?: string[]
  kind?: ModelKind
  parent_geological_model_id?: string | null
}

export interface GeologicalModelUpdatePayload {
  name?: string | null
  description?: string | null
  excluded_borehole_ids?: string[] | null
}

// Formation contact — one (formation top) pick per investigation
// in the model. Polymorphic anchor (borehole_id XOR cpt_id); v1
// ships borehole-only, the cpt_id slot stays for the Phase 5
// Robertson-Ic-driven auto-picks.
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
export type ContactConfidence = 'high' | 'medium' | 'low'

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

// ─────────────────────────────────────────────────────────────────────
// Unified litho boundary model (A2/A2.5 backend / A3 FE cut-over).
// See docs/superpowers/specs/2026-05-30-unified-litho-boundary-model-design.md
//
// On litho models the source-of-truth is `litho_layer` (Shape A —
// layer-centric) — each row is one lithology interval at one anchor
// with explicit depth_top_m + depth_base_m + status. The A2.5 backfill
// migration ports existing FormationContact rows into this table with
// UUIDs preserved, so litho_correlation_edge / seeded_formation_contact_ids
// / parent_geo_contact_id all continue to resolve unchanged.
//
// Geological models still use FormationContactResponse — Shape A
// is litho-only.
// ─────────────────────────────────────────────────────────────────────

export type LithoLayerStatus = 'pending' | 'accepted' | 'rejected'
export type LithoLayerSource =
  | 'segmenter'
  | 'manual'
  | 'observation_layer'
  | 'observation_interpretation'
export type LithoLayerConfidence = 'low' | 'medium' | 'high'

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

export interface LithoLayerBoundaryMovePayload {
  upper_layer_id: string
  lower_layer_id: string
  new_depth_m: number
}

export interface LithoLayerBoundaryMoveResponse {
  upper: LithoLayerResponse
  lower: LithoLayerResponse
}

export interface LithoLayerBatchStatusPayload {
  layer_ids: readonly string[]
  status: LithoLayerStatus
}

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

export interface LithoLayerBatchUpdateResponse {
  updated_count: number
  layers: LithoLayerResponse[]
}

// Lithostratigraphic-suggestion (litho slice 3/4). One read-only
// proposed layer from the Robertson-2015/2009 CPT segmenter or the
// borehole ObservationLayer mapping. The user accepts → it becomes a
// real FormationContact (assisted-manual, never auto-committed).
export type LithoSuggestionConfidence = 'high' | 'medium' | 'low'

// Secondary soil component within a suggested litho layer. Mirrors the
// backend AdmixtureItem schema verbatim.
export interface AdmixtureItem {
  soil_code: string
  amount: string
  locally: boolean
}

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
  // the investigation has no geology contacts or the model has no
  // surfaces.
  parent_formation_id: string | null
  // True when this suggestion's depth interval crosses a geological-
  // formation boundary (the backend splits it into two contacts on
  // Accept). Frontend renders amber border + tooltip.
  spans_boundary: boolean
  // NAD class range [min, max] across merged source segments (debt #119).
  // (n, n) when all sources share one class; (lo, hi) when they differ;
  // null for non-clean-sand and borehole-path layers. Optional so older
  // bundles that pre-date the merge pass stay compatible.
  nad_class_range?: [number, number] | null
}

// ---------------------------------------------------------------------------
// Accept-litho-suggestions — bulk endpoint that creates litho formations
// + contacts in one server-side transaction (Phase 1 litho builder).
// ---------------------------------------------------------------------------

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
  // The caller MUST follow the batch with recomputeAllAbsences() so
  // inference runs once for the whole batch instead of N × formations.
  // Default false preserves the original per-accept behaviour.
  defer_inference?: boolean
  // When true, find-or-create the litho formation(s) for each suggestion
  // but do NOT create any contact row and do NOT seed
  // seeded_formation_contact_ids on the section. depth_top_m /
  // depth_base_m are still used for parent-formation inference (TIN
  // sampling). The caller MUST NOT call applyUpdatedSection (updated_section
  // will be null). Use case: "Add new unit" ghost flow — pre-create the
  // formation so the ghost-accept finds it by key rather than duplicating
  // it (Bug 2 dogfeed 2026-05-26). Default false.
  create_formation_only?: boolean
  // Straddle sliver guard (debt #157). When a suggestion's top or base
  // falls within this distance of a geological formation boundary, the
  // split piece is suppressed. Default 0.20 m. Range 0.01–5.0 m.
  straddle_min_piece_thickness_m?: number
  // Litho↔geo coupling coincidence tolerance (#162). A litho contact
  // within this distance of a geological contact on the same investigation
  // is linked and snapped to it. Sourced from litho_snap_tolerance_m pref.
  // Default 0.20 m. Range 0.01–5.0 m.
  couple_tolerance_m?: number
}

export interface AcceptLithoSuggestionsResponse {
  created_formation_ids: string[]
  found_formation_ids: string[]
  created_contact_ids: string[]
  found_contact_ids: string[]
  straddle_split_count: number
  // Number of straddle splits that fell back to depth-ordering because
  // the geology TIN was stale or absent (debt #68).
  stale_tin_fallback_count: number
  // Debt #87: litho formation rows created in this call whose
  // parent_formation_id was inferred from TIN extrapolation (engineer
  // must confirm). Pre-#87 clients tolerate the field absent — defaults
  // to [] when missing.
  extrapolated_formation_ids?: string[]
  // Debt #87: litho formation rows created in this call with no parent
  // (neither contact-based assignment nor TIN extrapolation succeeded).
  // Same backward-compat shape as above.
  orphan_formation_ids?: string[]
  updated_section: CrossSectionResponse | null
}

// --- Batch accept (#153 lever) — all anchors in one transaction/commit ---

export interface BatchAcceptLithoAnchor {
  // Exactly one of cpt_id / borehole_id (XOR, backend-enforced).
  cpt_id?: string | null
  borehole_id?: string | null
  suggestions: LithoLayerSuggestion[]
}

export interface BatchAcceptLithoSuggestionsRequest {
  anchors: BatchAcceptLithoAnchor[]
  // When provided, every accepted contact id across all anchors is unioned
  // into this section's seeded set in ONE update (explicit-content invariant).
  section_id?: string | null
  // When true (default), the server runs recompute-all-absences once after the
  // batch — the frontend no longer makes a separate recompute call.
  run_inference?: boolean
  // Straddle sliver guard (debt #157). Forwarded to every per-anchor accept.
  // Default 0.20 m. Range 0.01–5.0 m.
  straddle_min_piece_thickness_m?: number
  // Litho↔geo coupling coincidence tolerance (#162). Forwarded to every
  // per-anchor accept. Sourced from litho_snap_tolerance_m pref.
  // Default 0.20 m. Range 0.01–5.0 m.
  couple_tolerance_m?: number
}

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
  // Non-null when this anchor was skipped (ValueError); the rest committed.
  error: string | null
}

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

export interface LithoSuggestionResponse {
  investigation_type: 'cpt' | 'borehole'
  minimum_layer_thickness_m: number
  layers: LithoLayerSuggestion[]
}

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
}

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

// One row in a batch-update payload. Inherits every optional field
// from FormationContactUpdatePayload and adds the target id.
export interface FormationContactBatchUpdateEntry
  extends FormationContactUpdatePayload {
  contact_id: string
}

export interface FormationContactBatchUpdateResponse {
  contacts: FormationContactResponse[]
}

export interface AutoPopulateFromStratigraphyResponse {
  created_contact_ids: string[]
  created_formation_ids: string[]
  /**
   * Formation ids deleted server-side because their canonical key was not in
   * the selected_keys set. Populated only on the Fill-from-boreholes path
   * (selected_keys provided). Empty on the unfiltered Seed path.
   * The client uses this list instead of computing client-side keys, eliminating
   * the divergent-key freeze introduced by da98053.
   */
  deleted_formation_ids: string[]
  skipped_existing: number
  skipped_unmatched: number
  skipped_no_stratigraphy: number
  /**
   * Layers skipped on the Sections "Seed from stratigraphy" path because
   * their resolved formation is not one the user curated (Seed never
   * creates). Non-zero only when create_missing_formations=false. The
   * Seed handler surfaces this so dropped borehole data isn't silent.
   */
  skipped_not_in_model: number
  /**
   * Lumping collisions that occurred during execute when ``manual_map`` was
   * provided.  Empty list when no map was provided or no collision occurred.
   * Mirrors the collision list returned by the discover preview, so the dialog
   * can confirm the same warnings before the user clicks Apply.
   */
  collisions: LumpingCollisionItem[]
  /**
   * Updated section row after Seed patched seeded_formation_contact_ids.
   * Non-null only on the Seed-from-stratigraphy path (section_id was provided).
   * The frontend patches local section state from this without a separate GET.
   * Null on the Fill-from-boreholes path.
   */
  updated_section: CrossSectionResponse | null
}

/**
 * Response from POST .../contacts/seed-from-parent.
 *
 * Mirrors the backend ``SeedLithoFromParentResponse`` schema.
 * ``updated_section`` is non-null only when ``section_id`` was provided in
 * the request — the frontend patches local section state from this without a
 * separate GET.
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
   * Matches the server's ``regional_ref`` field on the ORM row.
   */
  regional_ref: string | null
  /**
   * Stable cross-borehole identity key: ``regional_ref`` when present, else
   * ``name``.  The ``selected_keys`` filter on the auto-populate endpoint is
   * expressed in these keys so discover and execute use the same identity,
   * regardless of working-name variation across boreholes sharing a formal code.
   */
  key: string
  /** Number of in-scope boreholes that carry this key. */
  borehole_count: number
}

/**
 * One lumping collision returned by the discover or auto-populate endpoint.
 *
 * A collision occurs when multiple primary layers within a single borehole
 * resolve to the same effective formation key after the ``manual_map`` is
 * applied.  The server keeps the shallowest boundary and drops the rest.
 */
export interface LumpingCollisionItem {
  /** UUID of the borehole where the collision occurred. */
  borehole_id: string
  /** Normalised effective key that multiple raw names mapped to. */
  target_formation_key: string
  /** Display name of the target formation after lumping. */
  target_formation_name: string
  /** All raw description strings (kept + dropped) that resolved to the key. */
  colliding_raw_names: string[]
  /** Top depth (m) of the surviving (shallowest) boundary. */
  kept_top_m: number
  /** Number of deeper duplicate boundaries that were dropped. */
  dropped_count: number
}

export interface DiscoverFromStratigraphyResponse {
  candidates: FormationCandidateItem[]
  /** Populated only when ``manual_map`` was provided and collisions occurred. */
  collisions: LumpingCollisionItem[]
}

export interface DeduplicateContactsResponse {
  inspected_groups: number
  duplicates_removed: number
  removed_contact_ids: string[]
}

/** Result of ``POST /projects/{pid}/geology/models/{mid}/surfaces/rebuild``.
 *
 * ``formations_considered`` counts the formations that have at least
 * one contact in the model — these are the ones the rebuild loop
 * visits. ``formations_rebuilt`` is the subset whose recomputed
 * checksum differed from the cached one (i.e. the cache write fired).
 * ``formations_reordered`` counts formations whose ``display_order``
 * the server adjusted to match the data-derived age order. All three
 * are 0 on a fully-aligned model.
 */
export interface RebuildSurfacesResponse {
  formations_considered: number
  formations_rebuilt: number
  formations_reordered?: number
}

/** API representation of a cached TIN surface — one per
 * (model, formation). Section view fetches these to render slice-
 * derived polylines (off-line picks contribute via their triangle).
 */
export interface FormationSurfaceResponse {
  id: string
  model_id: string
  formation_id: string
  method: string
  /** On-click build pivot: True when the cached TIN no longer
   * reflects the current contacts. Section view renders stale
   * surfaces faded + dashed; click Build to refresh. Optional in
   * the type (older bundles / older builds may not carry it) but
   * the backend always emits it as of the on-click pivot. */
  is_stale?: boolean
  /** ``[x_m, y_m, elevation_m]`` triples in the project's
   * horizontal CRS + the formation's vertical datum. */
  vertices: [number, number, number][]
  /** Vertex-index triples (counter-clockwise winding). Empty
   * when the formation has < 3 valid contact points. */
  triangles: [number, number, number][]
  source_contact_count: number
  created_at: string
  updated_at: string
}

// Gap validator output — the editor surfaces these as soft warnings
// per borehole (missing surface contact, duplicate depth, contact
// below test depth, etc.) AND cross-formation crossing kinds. Empty
// issues = clean stratigraphy / no surface crossings.
export interface GapIssueResponse {
  kind: string
  detail: string
  depth_m: number | null
  contact_ids: string[]
  /** Populated for ``formation_crossing`` kind as
   * ``[older_formation_id, younger_formation_id]``. Empty for
   * per-borehole kinds. */
  formation_ids: string[]
}

export interface GapValidationResponse {
  model_id: string
  borehole_id: string
  issues: GapIssueResponse[]
}

/** Body returned by ``GET /projects/{pid}/geology/models/{mid}/validate/crossings``.
 *
 * Empty ``issues`` ⇒ no two formation surfaces violate the
 * stratigraphic-order superposition rule. Each non-empty issue
 * names the offending pair via ``formation_ids = [older_id,
 * younger_id]`` and the worst Δ-elevation in ``depth_m``.
 */
export interface CrossingValidationResponse {
  model_id: string
  issues: GapIssueResponse[]
}

/** Body returned by ``POST /projects/{pid}/geology/models/{mid}/ground-surface/build``.
 *
 * Represents the DEM-sampled ground-surface TIN for the model's investigation
 * hull.  ``Geology3DViewer`` renders this as the scene base in place of the
 * flat ``EllipsoidTerrainProvider``.  ``vertices`` is empty when the model has
 * no in-scope investigations or the DEM is unavailable for the project EPSG.
 */
export interface GroundSurfaceBuildResponse {
  /** ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS. */
  vertices: [number, number, number][]
  /** Vertex-index triples (counter-clockwise winding). Empty when fewer than
   * 3 valid DEM samples exist. */
  triangles: [number, number, number][]
  /** Which DEM provider answered: ``"dhmvii"`` / ``"ahn4"`` / ``"none"``. */
  provider_id: string
  /** True when every tile was served from the local filesystem cache. */
  from_cache: boolean
  /** Validation findings — e.g. contact_above_dem, dem_cell_low_confidence. */
  issues: GapIssueResponse[]
}

// Geotechnical-unit response shape — mirrors GeotechnicalUnitResponse
// on the backend 1:1. Structure-only in v1.0 (no parameter values);
// Phase 5 extends this with γ / c' / φ' / E etc. as additive optional
// fields.
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

export interface GeotechnicalUnitCreatePayload {
  name: string
  color?: string
  code?: string | null
  display_order?: number
  description?: string | null
}

export interface GeotechnicalUnitUpdatePayload {
  name?: string | null
  color?: string | null
  code?: string | null
  display_order?: number | null
  description?: string | null
}

// POST /projects body. Optional fields default to null/[] server-side.
export interface ProjectCreatePayload {
  name: string
  project_number?: string | null
  client?: string | null
  site_label?: string | null
  description?: string | null
  tags?: string[]
  default_horizontal_epsg?: number | null
  default_vertical_epsg?: number | null
  phase?: ProjectPhase | null
  status?: ProjectStatus
}

// PATCH /projects/{id} body. Every field optional — only fields actually
// included in the JSON object are written by the server.
export interface ProjectUpdatePayload {
  name?: string
  project_number?: string | null
  client?: string | null
  site_label?: string | null
  description?: string | null
  tags?: string[]
  default_horizontal_epsg?: number | null
  default_vertical_epsg?: number | null
  phase?: ProjectPhase | null
  status?: ProjectStatus
}

// ---------------------------------------------------------------------------
// Borehole / sample / lab-test types — mirrors the FastAPI schemas in
// ``api/schemas/borehole/``.
// ---------------------------------------------------------------------------

export interface BoreholeListItem {
  id: string
  name: string
  test_id: string
  location_x: number
  location_y: number
  epsg: number | null
  elevation_m: number | null
  z_epsg: number | null
  // Provenance — ``"dov"`` / ``"gef"`` / ``"manual"`` / ``"none"``
  // (debt #8). Mirrors the API enum so the sidebar badge stays in
  // sync with the backend.
  elevation_source: string
  drill_method: string | null
  borehole_type: string | null
  total_depth_m: number | null
  start_date: string | null
  n_drill_segments: number | null
  n_field_log_intervals: number | null
}

export interface AdmixtureResponse {
  soil_code: string
  amount: string
  locally: boolean
}

export interface ObservationLayerResponse {
  id: string
  top_m: number
  base_m: number
  color: string | null
  main_soil_codes: string[]
  description: string | null
  layer_index: number
  admixtures: AdmixtureResponse[]
}

export interface ObservationResponse {
  id: string
  observation_type: string
  author: string | null
  observation_date: string | null
  reliability: string | null
  score_category: string | null
  drill_method_score: string | null
  layers: ObservationLayerResponse[]
}

export interface DrillSegmentResponse {
  id: string
  top_m: number
  base_m: number
  method: string | null
}

export interface FieldLogIntervalResponse {
  id: string
  top_m: number
  base_m: number
  kind: string
  value: string | null
}

export interface GrainSizeResponse {
  id: string
  diameters_mm: number[]
  pct_larger: number[]
  method: string | null
  test_date: string | null
  lime_removed: boolean | null
  organics_removed: boolean | null
}

export interface AtterbergLimitsResponse {
  id: string
  liquid_limit_pct: number | null
  plastic_limit_pct: number | null
  non_plastic: boolean | null
  method: string | null
  test_date: string | null
}

export interface CaCO3ContentResponse {
  id: string
  content_pct: number | null
  method: string | null
  test_date: string | null
}

export interface OrganicContentResponse {
  id: string
  carbon_pct: number | null
  matter_pct: number | null
  method: string | null
  test_date: string | null
}

export interface WaterContentResponse {
  id: string
  content_pct: number | null
  method: string | null
  test_date: string | null
}

// Catch-all for scalar lab tests outside the 5 typed families above —
// currently grain density, ASTM classification, descriptive calcareous
// content. Numeric source values land in `value_numeric`; non-numeric
// (e.g. ASTM code "CL") in `value_text`.
export interface ScalarLabTestResponse {
  id: string
  parameter_group: string
  parameter: string
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  method: string | null
  test_date: string | null
  detection_condition: string | null
}

export interface SampleResponse {
  id: string
  depth_top_m: number
  depth_base_m: number
  description: string
  sample_number: string | null
  sample_type: string | null
  composition: string | null
  instrument: string | null
  sampling_date: string | null
  grain_sizes: GrainSizeResponse[]
  atterberg_limits_tests: AtterbergLimitsResponse[]
  caco3_content_tests: CaCO3ContentResponse[]
  organic_content_tests: OrganicContentResponse[]
  water_content_tests: WaterContentResponse[]
  scalar_lab_tests: ScalarLabTestResponse[]
}

export interface BoreholeDetailResponse {
  id: string
  name: string
  test_id: string
  project_id: string
  location_x: number
  location_y: number
  epsg: number | null
  elevation_m: number | null
  z_epsg: number | null
  // Provenance — ``"dov"`` / ``"gef"`` / ``"manual"`` / ``"none"``
  // (debt #8). Threaded into BoreholeHeader → ElevationEditor.
  elevation_source: string
  start_date: string | null
  drill_method: string | null
  borehole_type: string | null
  purpose: string | null
  municipality: string | null
  executor: string | null
  total_depth_m: number | null
  water_table_depth_m: number | null
  n_drill_segments: number | null
  n_field_log_intervals: number | null
  drill_segments: DrillSegmentResponse[]
  field_log_intervals: FieldLogIntervalResponse[]
  observations: ObservationResponse[]
  samples: SampleResponse[]
}

export interface ImportBoreholeDovResponse {
  imported: number
  duplicates: number
  failed: number
  interpretations_attached: number
  interpretations_failed: number
  samples_attached: number
  samples_failed: number
  grain_sizes_attached: number
  grain_sizes_failed: number
  atterberg_attached: number
  atterberg_failed: number
  caco3_attached: number
  caco3_failed: number
  organic_attached: number
  organic_failed: number
  water_content_attached: number
  water_content_failed: number
  borehole_ids: string[]
}

// Cross-section response shape — mirrors CrossSectionResponse on the
// backend 1:1. The renderer reads endpoints + buffer + display prefs;
// future S2+ work adds rendering of the projected investigations.
export interface CrossSectionResponse {
  id: string
  app_project_id: string
  name: string
  description: string | null
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  epsg: number
  projection_buffer_m: number
  vertical_exaggeration: number
  excluded_borehole_ids: string[]
  excluded_cpt_ids: string[]
  min_depth_m: number | null
  max_depth_m: number | null
  display_order: number
  /** Schema-less display-preference bag — CPT channel toggles,
   * borehole interpretation toggles, future scale locks. Bundle
   * round-trips this verbatim so user preferences persist across
   * machines without per-toggle migrations. ``null`` on rows from
   * before the column landed; frontend defaults apply via
   * ``readCptChannels`` and similar. */
  view_state: Record<string, unknown> | null
  /**
   * Explicit-content invariant (owner directive 2026-05-17).
   * Only contact ids present in this set render on this section.
   * Empty array = freshly-drawn section, no formation content.
   * Populated by Seed-from-stratigraphy and manual-draw actions.
   */
  seeded_formation_contact_ids: string[]
  /**
   * Lens companion linkage (#101 Slice 4).
   * Set when this section was auto-created as the perpendicular companion
   * for the referenced lens; null for plain user sections. Cleared to null
   * if the lens is deleted (FK ON DELETE SET NULL).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as null.
   */
  companion_lens_id?: string | null
  /**
   * Stays true even after companion_lens_id is nulled by a lens deletion,
   * so the UI can display a "was a lens companion" badge without a separate
   * query. False for all pre-Slice-4 sections (server default).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as false.
   */
  is_lens_companion?: boolean
  /**
   * Human-readable lens name for the "Companion of: <name>" header badge
   * (#101 Slice 6).  Only populated by the perpendicular-companion endpoint
   * (which has the lens loaded); all other callers return null.  Optional
   * because most GET /sections responses omit it.
   */
  companion_lens_name?: string | null
  created_at: string
  updated_at: string
}

export interface CrossSectionCreatePayload {
  name: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  epsg: number
  description?: string | null
  projection_buffer_m?: number
  vertical_exaggeration?: number
  excluded_borehole_ids?: string[]
  excluded_cpt_ids?: string[]
  min_depth_m?: number | null
  max_depth_m?: number | null
  display_order?: number
}

export interface CrossSectionUpdatePayload {
  name?: string | null
  description?: string | null
  start_x?: number | null
  start_y?: number | null
  end_x?: number | null
  end_y?: number | null
  epsg?: number | null
  projection_buffer_m?: number | null
  vertical_exaggeration?: number | null
  excluded_borehole_ids?: string[] | null
  excluded_cpt_ids?: string[] | null
  min_depth_m?: number | null
  max_depth_m?: number | null
  display_order?: number | null
  /** Shallow-merged into the section's view_state JSONB bag. Send
   * a partial dict ({cpt_channels: {...}}) to patch single keys
   * without round-tripping the whole bag. ``null`` for a top-level
   * key removes it; ``{}`` clears the bag entirely; ``null`` for
   * the whole field is the "do not touch" sentinel. */
  view_state?: Record<string, unknown> | null
}

// DEM sample shape — mirrors the backend DemSampleLineResponse 1:1.
// ``elevation_m`` is null at NoData pixels (outside DHMVII coverage
// or known data holes); the renderer breaks the polyline there
// rather than connecting across the gap.
export interface DemSamplePoint {
  along_m: number
  elevation_m: number | null
}

export interface DemSampleLineResponse {
  source: string
  samples: DemSamplePoint[]
}

export class DuplicateCptError extends Error {
  cptId: string
  constructor(cptId: string) {
    super('CPT already exists in this project')
    this.name = 'DuplicateCptError'
    this.cptId = cptId
  }
}

/** Thrown when POST /contacts hits the (model, anchor, formation)
 * uniqueness rule. Carries the existing contact id so callers can
 * route to a "move existing" PATCH instead of surfacing an opaque
 * error to the user. */
export class DuplicateContactError extends Error {
  existingContactId: string
  constructor(existingContactId: string) {
    super('A contact for this formation already exists on this investigation')
    this.name = 'DuplicateContactError'
    this.existingContactId = existingContactId
  }
}

/** Thrown when POST /models/{mid}/bodies returns HTTP 409 (provenance rule §5.2):
 * a detector-set ``to_target`` extent already occupies the requested side and
 * must be explicitly cleared via ClearBodyExtent before the user can claim it.
 * Carries the side + kind so the ProvenanceConflictDialog can retry the claim
 * after the user confirms they want to overwrite. */
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

let _base = 'http://127.0.0.1:8765'

export function setBaseUrl(url: string): void {
  _base = url
}

// Strip query-string before logging so future license keys / session tokens
// that might land in query params don't end up in the renderer log stream.
// The thrown Error messages retain the full path for developer diagnostics.
const stripQuery = (p: string): string => p.split('?')[0]

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${_base}${path}`)
  if (!res.ok) {
    log.error('api', 'GET', stripQuery(path), res.status)
    throw new Error(`GET ${path} → ${res.status}`)
  }
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    // Surface the server's `detail` (e.g. the 409 "delete the dependent
    // model first" guard) instead of an opaque "→ 409" — mirrors patch/put.
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'DELETE', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
  }
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'PATCH', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `PATCH ${path} → ${res.status}`)
  }
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'PUT', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `PUT ${path} → ${res.status}`)
  }
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${_base}${path}`, init)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'POST', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `POST ${path} → ${res.status}`)
  }
  return res.json()
}

// Shared elevation-patch payload — the backend accepts the same shape for
// CPT and borehole, so the API surface mirrors that. ``elevation_m: null``
// clears a previously-entered value (returns the row to the "needs Z"
// state). ``z_epsg`` is omitted today because the desktop UI doesn't expose
// a CRS picker — the backend defaults to mTAW (5710) for DOV-Belgium data.
export interface ElevationPatchBody {
  elevation_m: number | null
  z_epsg?: number | null
}

// G3Dv3 stratigraphic catalog (Flanders). Returned by
// ``GET /codelists/g3dv3``. Powers the FormationDialog autocomplete +
// color autofill so engineers don't retype canonical names / RGB
// codes on every project.
export interface G3Dv3UnitResponse {
  /** Numeric G3D code (e.g. ``"0206"`` for Diest). */
  code: string
  /** G3D abbreviation (e.g. ``"NE_Di"``, ``"Q_GtAb"``, ``"A"``). */
  abbreviation: string
  rank: 'formation' | 'member'
  /** For members, the parent formation's abbreviation. */
  parent_abbreviation: string | null
  /** Dutch name (the primary user-facing label). */
  name_nl: string
  /** 0 = youngest (Antropogeen), increasing with age. */
  age_rank: number
  /** Prescribed RGB ``"#rrggbb"``; ``null`` for the rare unit with no row in the kleurcode table. */
  color_hex: string | null
}

export interface G3Dv3CatalogResponse {
  units: G3Dv3UnitResponse[]
}

// One DOV formal-stratigraphy unit — powers the informal→formal link in the
// formation dialog (picking one stores its `code` on the formation).
export interface FormalStratigraphyUnitResponse {
  /** DOV formal-stratigraphy code (e.g. "QH", "QP", "Bm", "KoAa"). */
  code: string
  /** Canonical Dutch name (e.g. "Quartair Holoceen", "Formatie van Boom"). */
  name_nl: string
  age_rank: number | null
  color_hex: string | null
}

export interface FormalStratigraphyCatalogResponse {
  units: FormalStratigraphyUnitResponse[]
}

// ---------------------------------------------------------------------------
// Virtuele Boring (DOV synthetic-borehole overlays) — informative-only
// per-investigation predictions from DOV's 3D models. Two surfaces:
//   * /dov/virtuele-boring/lagenmodellen — the model picker catalogue
//   * /projects/{id}/virtuele-boring/predictions — per-investigation
//     overlay payload (one ghost-column source per (investigation, model))
// See CLAUDE.md "Known Architectural Debt" #10 for the design rationale.
// ---------------------------------------------------------------------------

export interface VirtueleBoringLagenmodelEntry {
  code: string
  beschrijving: string
  resoluties: number[]
}

export interface VirtueleBoringLayer {
  code: string
  name: string
  beschrijving: string
  top_m_taw: number
  base_m_taw: number
  thickness_m: number
  color_hex: string | null
  ncs_link: string | null
}

export interface VirtueleBoringInvestigationPrediction {
  investigation_kind: 'cpt' | 'borehole'
  investigation_id: string
  name: string
  elevation_m_taw: number | null
  /** Keyed by the model codes the caller requested. Missing keys mean
   * the per-call fetch failed for that (investigation, model) pair. */
  predictions_by_model: Record<string, VirtueleBoringLayer[]>
}

export interface VirtueleBoringPredictionsResponse {
  models: string[]
  predictions: VirtueleBoringInvestigationPrediction[]
  skipped_count: number
}

export const api = {
  cpt: {
    list: (projectId?: string): Promise<CptListItem[]> =>
      get(`/cpt/${projectId ? `?project_id=${projectId}` : ''}`),

    // ``projectId`` is required — the backend now enforces project scope
    // on every by-id fetch (VULN-1/4). The caller always has the active
    // project in scope; the frontend never calls these without a project.
    get: (id: string, projectId: string): Promise<CptResponse> =>
      get(`/cpt/${id}?project_id=${projectId}`),

    plot: (id: string, projectId: string): Promise<CptPlotResponse> =>
      get(`/cpt/${id}/plot?project_id=${projectId}`),

    // Batched plot fetch for the cross-section panel. Folds N
    // per-CPT round-trips into one. Order of the response isn't
    // guaranteed — callers index by ``cpt_id`` on each entry.
    // Unknown ids and series-less CPTs drop silently from the
    // response (same skip-on-missing semantics the section render
    // already needs).
    //
    // ``appProjectId`` is the project scope — the backend filters
    // returned CPTs to those that belong to the project, preventing
    // a leak across projects via a guessed UUID. Always pass it
    // from the section's ``app_project_id``.
    plotBatch: (ids: string[], appProjectId: string): Promise<CptPlotResponse[]> =>
      post(`/cpt/plot-batch`, { ids, app_project_id: appProjectId }),

    // ``projectId`` is required — scope guard ensures a caller cannot
    // delete or patch a CPT from a foreign project (VULN-2/3).
    delete: (id: string, projectId: string): Promise<void> =>
      del(`/cpt/${id}?project_id=${projectId}`),

    patchElevation: (
      id: string,
      projectId: string,
      body: ElevationPatchBody,
    ): Promise<CptResponse> => patch(`/cpt/${id}/elevation?project_id=${projectId}`, body),

    importDov: async (
      bbox: { west: number; south: number; east: number; north: number },
      projectId?: string,
    ): Promise<ImportDovResponse> => {
      const res = await fetch(`${_base}/cpt/import-dov`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bbox, project_id: projectId ?? null }),
      })
      if (!res.ok) {
        // FastAPI surfaces specific reasons (network down, timeout, upstream error)
        // in body.detail; fall back to status code if the body is unparseable.
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `DOV import failed (HTTP ${res.status})`)
      }
      return res.json()
    },

    import: async (filePath: string, projectId?: string): Promise<ImportCptResponse> => {
      // Read via IPC — fetch('file://') is blocked in the renderer sandbox.
      const buffer: Buffer = await window.electron.readFile(filePath)
      const fileName = filePath.split(/[\\/]/).pop() ?? 'upload.gef'
      // Node's Buffer is ``Uint8Array<ArrayBufferLike>``; the DOM Blob
      // constructor wants ``ArrayBuffer`` specifically (not the
      // SharedArrayBuffer union member). Pass the underlying view —
      // identical wire bytes, narrower type.
      const blob = new Blob([new Uint8Array(buffer)])
      const form = new FormData()
      form.append('file', blob, fileName)
      if (projectId) form.append('project_id', projectId)
      const res = await fetch(`${_base}/cpt/import`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 409 && body.detail?.cpt_id) {
          throw new DuplicateCptError(body.detail.cpt_id)
        }
        throw new Error(body.detail?.message ?? body.detail ?? `Import failed: ${res.status}`)
      }
      return res.json()
    },
  },

  borehole: {
    list: (projectId?: string): Promise<BoreholeListItem[]> =>
      get(`/borehole/${projectId ? `?project_id=${projectId}` : ''}`),

    // ``projectId`` is required — scope guard prevents cross-project
    // borehole detail fetch and elevation mutation (VULN-6/7).
    get: (id: string, projectId: string): Promise<BoreholeDetailResponse> =>
      get(`/borehole/${id}?project_id=${projectId}`),

    /**
     * Batch the per-borehole detail GET into one round-trip (debt
     * #39). Cross-section panel uses this on open so a dense corridor
     * is one DB query instead of N. Unknown ids drop from the
     * response (skip-on-missing); body cap is 500 ids.
     *
     * ``include`` follows the per-id endpoint's contract: ``undefined``
     * loads every lab-test family (the original always-load
     * behaviour); an explicit array (including empty) narrows the
     * load. Section views typically pass ``[]`` — column glyphs don't
     * render lab data, so skipping the 6 lab-family SELECTs is pure
     * win.
     */
    detailBatch: (
      ids: string[],
      projectId: string,
      include?: string[],
    ): Promise<BoreholeDetailResponse[]> =>
      post(`/borehole/detail-batch`, {
        ids,
        app_project_id: projectId,
        include: include ?? null,
      }),

    patchElevation: (
      id: string,
      projectId: string,
      body: ElevationPatchBody,
    ): Promise<BoreholeListItem> =>
      patch(`/borehole/${id}/elevation?project_id=${projectId}`, body),

    importDov: async (
      bbox: { west: number; south: number; east: number; north: number },
      projectId?: string,
    ): Promise<ImportBoreholeDovResponse> => {
      const res = await fetch(`${_base}/borehole/import-dov`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bbox, project_id: projectId ?? null }),
      })
      if (!res.ok) {
        // Same upstream-error → message mapping as the CPT side
        // (502/503/504 surfaced by the FastAPI router).
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `DOV borehole import failed (HTTP ${res.status})`)
      }
      return res.json()
    },
  },

  project: {
    list: (includeArchived = false): Promise<ProjectResponse[]> =>
      get(`/projects/${includeArchived ? '?include_archived=true' : ''}`),

    listArchived: (): Promise<ProjectResponse[]> => get('/projects/archived'),

    get: (id: string): Promise<ProjectResponse> => get(`/projects/${id}`),

    create: (body: ProjectCreatePayload): Promise<ProjectResponse> =>
      post('/projects/', body),

    update: (id: string, body: ProjectUpdatePayload): Promise<ProjectResponse> =>
      patch(`/projects/${id}`, body),

    archive: (id: string): Promise<ProjectResponse> =>
      post(`/projects/${id}/archive`),

    unarchive: (id: string): Promise<ProjectResponse> =>
      post(`/projects/${id}/unarchive`),

    duplicate: (id: string, name?: string): Promise<ProjectResponse> =>
      post(`/projects/${id}/duplicate`, { name: name ?? null }),

    // Full project snapshot — metadata + every CPT (with series) +
    // every borehole (with its child tree). Embedded verbatim in the
    // .gmproj v2 file on save and round-tripped to /restore on open.
    bundle: (id: string): Promise<ProjectBundleResponse> =>
      get(`/projects/${id}/bundle`),

    // Idempotently materialise a project + its CPTs + boreholes from a
    // bundle when the DB has lost the rows (wiped DB / fresh install).
    // ``id`` is in the URL; the body is the same shape ``bundle()``
    // returned. Always 200 — existing rows return as-is, missing rows
    // are inserted. The .gmproj file is the user's anchor.
    //
    // ``replace=true`` (revert-to-last-save, #160): the project's child
    // collections are wiped before the insert in one transaction, so the
    // project ends up matching the bundle EXACTLY — session creates,
    // mutations, AND deletes are all reverted. Used by the "Don't Save"
    // close-flow branch.
    restore: (
      id: string,
      body: ProjectBundleResponse,
      replace = false,
    ): Promise<ProjectResponse> =>
      post(`/projects/${id}/restore${replace ? '?replace=true' : ''}`, body),

    // Shallow-merge a patch into ``project.view_state`` (project-level
    // toggle bag: DEM overlay, hidden-by-type sets, …). Each TOP-LEVEL
    // key in ``patch`` replaces the same key in the existing dict;
    // siblings are untouched. ``null`` for a key removes it. Nested
    // values are NOT deep-merged — to change one field inside a nested
    // object, include the whole subtree.
    //
    // Returns the full ProjectResponse so callers can refresh their
    // in-memory project handle without a second GET.
    patchViewState: (
      id: string,
      patchBody: Record<string, unknown>,
    ): Promise<ProjectResponse> =>
      patch(`/projects/${id}/view-state`, { patch: patchBody }),
  },

  // DEM (Digital Elevation Model) sampling — elevation profile along
  // a line in the project's horizontal CRS. Powers the SectionPanel's
  // ground-surface polyline.
  dem: {
    sampleLine: (params: {
      startX: number
      startY: number
      endX: number
      endY: number
      epsg: number
      nSamples?: number
    }): Promise<DemSampleLineResponse> => {
      const q = new URLSearchParams({
        start_x: String(params.startX),
        start_y: String(params.startY),
        end_x: String(params.endX),
        end_y: String(params.endY),
        epsg: String(params.epsg),
        n_samples: String(params.nSamples ?? 200),
      })
      return get(`/dem/sample?${q.toString()}`)
    },
  },

  // Geological model — formations vocabulary + interpretation models
  // + per-investigation contacts. The Phase 4 v1.0 MVP-gate feature
  // is built around this surface: editor places contacts on the
  // cross-section panel, exporters serialise the resulting layer
  // geometry to DXF / Plaxis. Every endpoint is project-scoped at
  // the URL and bundle-persisted via ``project_bundle.geological_*``.
  geology: {
    // Download the geological model as a runnable Plaxis 3D
    // plxscripting Python script. Returns the raw bytes so the
    // caller can pipe to the Electron save-dialog + write-file IPC
    // pair, matching the section-DXF flow. The .py is human-readable
    // — engineers can review it before running against Plaxis.
    exportPlaxis3d: async (
      projectId: string,
      modelId: string,
    ): Promise<ArrayBuffer> => {
      const res = await fetch(
        `${_base}/projects/${projectId}/geology/models/${modelId}/export/plaxis3d`,
      )
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Plaxis export failed (${res.status})`)
      }
      return res.arrayBuffer()
    },

    // --- Formations vocabulary -------------------------------------
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

    // --- Geological models ----------------------------------------
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

    activateModel: (
      projectId: string,
      modelId: string,
    ): Promise<GeologicalModelResponse> =>
      post(`/projects/${projectId}/geology/models/${modelId}/activate`, {}),

    deleteModel: (projectId: string, modelId: string): Promise<void> =>
      del(`/projects/${projectId}/geology/models/${modelId}`),

    // --- Formation contacts (per model) ---------------------------
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

    // ─────────────────────────────────────────────────────────────────
    // Unified litho boundary model — layer endpoints.
    // The model_id passed in MUST belong to a litho (kind='lithostratigraphic')
    // model. For geological models, keep using the contact endpoints above.
    // ─────────────────────────────────────────────────────────────────

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
      patch: LithoLayerUpdatePayload,
    ): Promise<LithoLayerResponse | null> => {
      const res = await fetch(
        `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
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
    deleteLayer: async (
      projectId: string,
      modelId: string,
      layerId: string,
    ): Promise<void> => {
      const res = await fetch(
        `${_base}/projects/${projectId}/geology/models/${modelId}/layers/${layerId}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 404) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `deleteLayer failed (${res.status})`)
      }
    },

    /** POST /models/{mid}/layers — bulk-create N layers in one transaction.
     *  Pass `sectionId` to seed the new layer ids into a cross-section's
     *  `seeded_formation_contact_ids` array (explicit-content invariant). */
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

    /** POST /models/{mid}/layers/{lid}/link-geo — layer-shape mirror of
     *  the contact-side link-geo. Returns the updated layer, or null
     *  when no geo contact is within snap tolerance. */
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
      // Diagnostic: drag-up cross-merge regression repro (2026-05-26) —
      // logs the PATCH body and HTTP status on every drag commit.
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

    deleteContact: (
      projectId: string,
      modelId: string,
      contactId: string,
    ): Promise<void> =>
      del(`/projects/${projectId}/geology/models/${modelId}/contacts/${contactId}`),

    // Break the litho↔geo coupling on a single contact.  Nulls
    // parent_geo_contact_id; does NOT move/delete either contact or
    // rebuild surfaces (geometry is unchanged — only the coupling label
    // is cleared).
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
    // the snap tolerance and snaps geo→litho.  Returns null when no
    // geological contact is within tolerance.
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
    // Removes contacts, correlation edges, TIN surfaces, and orphan litho
    // formations in one atomic backend call.
    // Irreversible — caller must present a confirm dialog before invoking.
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

    // All-or-nothing batch update for the multi-drag flow. The
    // backend validates every entry's scope before mutating; a single
    // miss returns 404 without committing any of the changes. Response
    // contacts come back in the same order as ``updates`` so the
    // caller can patch its local state by index.
    updateContactsBatch: (
      projectId: string,
      modelId: string,
      updates: readonly FormationContactBatchUpdateEntry[],
    ): Promise<FormationContactBatchUpdateResponse> =>
      put(
        `/projects/${projectId}/geology/models/${modelId}/contacts/batch`,
        { updates },
      ),

    // Seed the model with contacts derived from each borehole's
    // formal (or fall-through informal) stratigraphy observation.
    // Idempotent — re-running with the same scope reports the
    // dedup hits in ``skipped_existing``. Caller refreshes the local
    // formations + contacts state from the returned counts.
    //
    // ``selectedKeys`` is optional: when provided, only layers whose
    // stable key is in the set are processed (Fill-from-boreholes path).
    // When omitted / null, all layers are processed (Sections Seed path).
    //
    // ``manualMap`` is optional: when provided, all raw candidate keys that
    // appear as map keys are lumped under the target name before contacts
    // are created.  Same map used in the preceding discoverFromStratigraphy
    // preview call to preserve the discover ≡ apply invariant.
    autoPopulateFromStratigraphy: (
      projectId: string,
      modelId: string,
      boreholeIds: readonly string[],
      selectedKeys?: readonly string[],
      manualMap?: Record<string, string>,
      // Explicit-content invariant (owner directive 2026-05-17): when called
      // from the Sections Seed button the section's id is passed so the server
      // appends the created contact ids to seeded_formation_contact_ids and
      // returns the updated section row in updated_section.  Omit on the
      // Fill-from-boreholes path (Geology stage) where no section context exists.
      sectionId?: string | null,
      // Sections "Seed from stratigraphy" passes false: Seed places
      // contacts only for curated formations and never creates one
      // (CLAUDE.md explicit-content invariant). Omitted on the
      // Fill-from-boreholes path → backend default true (Fill creates).
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

    // Seed a lithostratigraphic model from its parent geological model's
    // contacts.  Copies each parent contact into the litho model with
    // source='geological_model_seed' and confidence='medium'.  Idempotent
    // on (formation_id, borehole_id) pairs — re-running skips existing pairs
    // and reports the count in skipped_existing.
    //
    // ``sectionId`` is optional: when provided the server appends the created
    // contact ids to the section's seeded_formation_contact_ids (explicit-content
    // invariant) and echoes the updated section in updated_section.
    // A4 cleanup: URL moves to /layers/seed-from-parent; the BE
    // dual-mounts both paths on the same handler.
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

    // Read-only scan: returns candidate formation names derived from
    // borehole stratigraphy observations (FORMAL preferred, INFORMAL
    // fallback). No DB mutation — the endpoint just runs the same scan
    // as auto-populate and returns what it would have created.
    //
    // ``manualMap`` is optional: when provided, the server lumps candidate
    // keys using the map and returns collisions in the response.  The
    // dialog passes this on every re-preview when the user edits groups.
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

    // List every cached TIN surface in the model. Section consumer
    // fetches once on section load + indexes by formation_id; the
    // in-browser slice service cuts each surface against the
    // section line.
    listSurfaces: (
      projectId: string,
      modelId: string,
    ): Promise<FormationSurfaceResponse[]> =>
      get(`/projects/${projectId}/geology/models/${modelId}/surfaces`),

    // One-shot cleanup for legacy duplicates (pre-uniqueness rule).
    // Walks every (model, anchor, formation) group with N>1 contacts
    // and prunes all but the highest-priority survivor (manual_pick
    // beats auto-derived; provenance beats no-provenance; most
    // recent breaks ties). Idempotent — running on a clean model
    // returns 0 removed.
    dedupeContacts: (
      projectId: string,
      modelId: string,
    ): Promise<DeduplicateContactsResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/contacts/dedupe`,
        {},
      ),

    // Manual escape hatch — force-recompute every formation's TIN
    // cache in this model. Auto-recompute hooks keep the cache in
    // sync on the happy path; click this when something bypassed
    // them (anchor elevation edited without a contact mutation,
    // bundle restored, suspected stale checksum). Idempotent.
    rebuildSurfaces: (
      projectId: string,
      modelId: string,
      method: 'tin' = 'tin',
    ): Promise<RebuildSurfacesResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/surfaces/rebuild?method=${method}`,
        {},
      ),

    // --- Gap validator (per borehole) -----------------------------
    validateBorehole: (
      projectId: string,
      modelId: string,
      boreholeId: string,
    ): Promise<GapValidationResponse> =>
      get(
        `/projects/${projectId}/geology/models/${modelId}/boreholes/${boreholeId}/validate`,
      ),

    // Cross-formation crossing validator — returns the list of
    // ``formation_crossing`` issues for the model. Walks every
    // cached TIN pair (older, younger) and looks for younger-below-
    // older anywhere in the shared (x, y) footprint. Empty list ⇒
    // every surface stack is geologically consistent.
    validateCrossings: (
      projectId: string,
      modelId: string,
    ): Promise<CrossingValidationResponse> =>
      get(`/projects/${projectId}/geology/models/${modelId}/validate/crossings`),

    // → it becomes a FormationContact via the normal createContact.
    suggestLitho: (
      projectId: string,
      modelId: string,
      body: LithoSuggestionRequest,
    ): Promise<LithoSuggestionResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/contacts/suggest-litho`,
        body,
      ),

    // Commit one or more litho-suggestion layers as real formation
    // contacts. The server handles formation find-or-create, straddle
    // splits, and section seeding atomically. The caller MUST apply
    // updated_section via applyUpdatedSection — explicit-content
    // invariant (#57 class trap, recurred 3×).
    //
    // A4 remaining-writer cut: the URL moves to /layers; the BE
    // delegates to the same AcceptLithoSuggestions use case via a
    // stacked route decorator. The use case still writes FormationContact
    // (FC→LL trigger materialises the layer mirror); a future refactor
    // would have the use case write LithoLayer natively and let
    // LL→FC create the contact mirror for legacy consumers.
    acceptLithoSuggestions: (
      projectId: string,
      modelId: string,
      body: AcceptLithoSuggestionsRequest,
    ): Promise<AcceptLithoSuggestionsResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/layers/accept-litho-suggestions`,
        body,
      ),

    // Batch accept (#153): all anchors in one transaction + one section seed +
    // one inference recompute. Replaces the per-anchor accept loop + the
    // separate recompute call for the bulk "accept all" flow.
    //
    // Same A4 URL cut as accept-litho-suggestions above.
    batchAcceptLithoSuggestions: (
      projectId: string,
      modelId: string,
      body: BatchAcceptLithoSuggestionsRequest,
    ): Promise<BatchAcceptLithoSuggestionsResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/layers/batch-accept-litho-suggestions`,
        body,
      ),

    // Build (or re-build) the DEM ground-surface TIN for the model's
    // investigation hull.  The server samples the public DEM (DHMVII
    // for BE EPSG:31370, AHN4 for NL EPSG:28992), triangulates the
    // result, and returns the raw vertex / triangle arrays.
    // ``Geology3DViewer`` renders this as the terrain base mesh.
    // Returns an empty surface (vertices=[]) when the model has no
    // in-scope investigations or the project EPSG has no DEM provider.
    buildGroundSurface: (
      projectId: string,
      modelId: string,
    ): Promise<GroundSurfaceBuildResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/ground-surface/build`,
        {},
      ),

    // --- Contact-level correlation edges (#133 Phase 1, #135 lens) ----
    //
    // Boundary-to-boundary edges between two FormationContact rows.  Shared
    // endpoints across rows are permitted — the canonical-ordered unique
    // is on the pair, not on either endpoint individually.  That's what
    // makes #135's lens-pinch-out topology expressible (two edges from one
    // source contact converging on two distinct contacts in the same target
    // investigation).
    listContactCorrelations: (
      projectId: string,
      modelId: string,
    ): Promise<LithoContactCorrelationEdge[]> =>
      get(`/projects/${projectId}/geology/models/${modelId}/contact-correlations`),

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

    // DELETE with JSON body — same shape as the formation-level uncorrelate.
    // The shared del() helper does not pass a body, so we use a raw fetch.
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

    // Propagate litho_admixtures to every formation in the BFS-reachable
    // connected component of the correlation graph.  The seed is any one
    // formation in the body; the backend walks the full component and
    // writes the new admixtures to every formation in the same transaction.
    // Returns the updated formations + component_size so the caller can
    // replace its local cache entries directly.
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

    // --- Body (formerly lens) CRUD (Slice 3 backend / Slice 5 FE rename) ------
    //
    // List all body rows for a lithostratigraphic model.
    // Used by LithologyInspector to build per-formation body-count badges.
    listBodies: (
      projectId: string,
      modelId: string,
    ): Promise<BodyListItem[]> =>
      get(`/projects/${projectId}/geology/models/${modelId}/bodies`),

    // Backwards-compat alias — slice-6 callers switch to listBodies directly.
    listLenses: (
      projectId: string,
      modelId: string,
    ): Promise<BodyListItem[]> =>
      get(`/projects/${projectId}/geology/models/${modelId}/bodies`),

    // Read the user-authored boundary shape for a body.
    // Empty node lists + 'straight' when no custom shape is stored.
    getBodyBoundary: (
      projectId: string,
      modelId: string,
      bodyId: string,
    ): Promise<BodyBoundaryResponse> =>
      get(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary`),

    // Backwards-compat alias — slice-6 callers switch to getBodyBoundary directly.
    getLensBoundary: (
      projectId: string,
      modelId: string,
      lensId: string,
    ): Promise<BodyBoundaryResponse> =>
      get(`/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}/boundary`),

    // Full-replace the boundary shape (nodes + render style). The server sorts
    // + re-indexes the node lists. 422 if the body has no content_key
    // (re-correlate) or no primary section.
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
      put(`/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/boundary`, body),

    // Backwards-compat alias — slice-6 callers switch to saveBodyBoundary directly.
    saveLensBoundary: (
      projectId: string,
      modelId: string,
      lensId: string,
      body: {
        upper_nodes: BodyBoundaryNode[]
        lower_nodes: BodyBoundaryNode[]
        render_style: BodyRenderStyle
      },
    ): Promise<BodyBoundaryResponse> =>
      put(`/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}/boundary`, body),

    // PATCH body row (currently: name update). Creates a body row on first
    // call when name is provided; updates on subsequent calls.
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

    // Backwards-compat alias — callers in slice-6 switch to nameBody directly.
    nameLensBody: (
      projectId: string,
      modelId: string,
      body: NameBodyRequest,
    ): Promise<NameBodyResponse> =>
      post(`/projects/${projectId}/geology/models/${modelId}/bodies`, body),

    // Delete a body metadata row.  Does NOT delete absence records —
    // they are formation-scoped and survive independently.
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

    // Bulk-delete every purely-detected body of a litho model. Preserves
    // user-named + user-claimed ("accepted") bodies (backend provenance rule).
    // Returns the deleted / preserved counts for the toolbar toast.
    clearDetectedBodies: async (
      projectId: string,
      modelId: string,
    ): Promise<{ bodies_deleted: number; bodies_preserved: number }> => {
      const path = `/projects/${projectId}/geology/models/${modelId}/bodies`
      const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
      }
      return res.json() as Promise<{ bodies_deleted: number; bodies_preserved: number }>
    },

    // Backwards-compat alias — slice-6 callers switch to deleteBody directly.
    deleteLens: async (
      projectId: string,
      modelId: string,
      lensId: string,
    ): Promise<void> => {
      const path = `/projects/${projectId}/geology/models/${modelId}/bodies/${lensId}`
      const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
      }
    },

    // Claim a user-extent on an existing body (addressed by body_id; the
    // resolver owns body creation, so the body always exists).
    // Returns the full BodyListItem after claim.
    // Throws ProvenanceViolationError on HTTP 409 (detector-set extent on that
    // side; caller must clear first or open the ProvenanceConflictDialog).
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
        // HTTP 409 = provenance rule §5.2: detector already claimed this side.
        // Throw a typed error so the caller can open the ProvenanceConflictDialog
        // rather than falling through to a generic error toast.
        if (res.status === 409 && detail.detail?.code === 'provenance_violation') {
          throw new ProvenanceViolationError(
            request.side,
            request.kind,
            detail.detail.message,
          )
        }
        throw new Error(detail.detail?.message ?? detail.detail ?? `POST ${path} → ${res.status}`)
      }
      return res.json() as Promise<BodyListItem>
    },

    // Clear one side's extent back to NULL.
    // Returns the updated BodyListItem, or null when the body row is reaped
    // (both sides cleared and no name).
    clearBodyExtent: async (
      projectId: string,
      modelId: string,
      bodyId: string,
      side: 'left' | 'right',
    ): Promise<BodyListItem | null> => {
      const path = `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/extents/${side}`
      const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
      }
      // 204 = body was reaped; 200 = body still alive, body contains the row.
      if (res.status === 204) return null
      return res.json() as Promise<BodyListItem>
    },

    // Ephemeral: returns pinch-out candidates for the model based on the
    // current correlation graph topology.
    suggestBodyPinchOuts: (
      projectId: string,
      modelId: string,
      // Active section → adjacency follows the section's column order (not a
      // UUID-random "skip a column" order). Omit for the section-agnostic pass.
      sectionId?: string | null,
    ): Promise<SuggestPinchOutsResponse> => {
      const q = sectionId ? `?section_id=${encodeURIComponent(sectionId)}` : ''
      return post(
        `/projects/${projectId}/geology/models/${modelId}/bodies/suggest-pinch-outs${q}`,
        {},
      )
    },

    // PATCH a body row (currently: name update).
    updateBody: (
      projectId: string,
      modelId: string,
      bodyId: string,
      request: NameBodyRequest,
    ): Promise<NameBodyResponse> =>
      patch(
        `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}`,
        request,
      ),

    // Fetch all absence records for a formation (used by InspectLensBodyPanel).
    listFormationAbsences: (
      projectId: string,
      formationId: string,
    ): Promise<FormationAbsenceItem[]> =>
      get(`/projects/${projectId}/geology/formations/${formationId}/absences`),

    // Record a user-intent absence for a formation at a specific
    // investigation (source='manual'|'observed').  The inference engine
    // owns 'inferred' rows; this endpoint only accepts user-intent sources.
    upsertFormationAbsence: (
      projectId: string,
      formationId: string,
      body: UpsertFormationAbsenceRequest,
    ): Promise<UpsertFormationAbsenceResponse> =>
      post(
        `/projects/${projectId}/geology/formations/${formationId}/absences`,
        body,
      ),

    // Trigger inference-engine recompute for one formation body.
    // Writes/retracts 'inferred' absence rows; never touches
    // 'manual'|'observed' rows.
    recomputeFormationAbsences: (
      projectId: string,
      modelId: string,
      formationId: string,
    ): Promise<{ written_count: number; retracted_count: number; skipped_no_data_count: number }> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/formations/${formationId}/absences/recompute`,
        {},
      ),

    // Bulk inference recompute — run absence inference + wedge-tip
    // materialisation for every formation with contacts in the model.
    // Called once after a defer_inference=true batch-accept sweep so
    // inference runs O(formations × sections) instead of O(N × formations).
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
      post(
        `/projects/${projectId}/geology/models/${modelId}/recompute-all-absences`,
        {},
      ),

    // Auto-create a perpendicular companion section for a body (#101 Slice 4).
    // Idempotent: returns the existing companion section if one already exists.
    // The companion section is centred on the body centroid and extends to the
    // nearest investigation on each side (fallback: max(2×buffer, 100 m)).
    // The caller should add the returned section to the local section list and
    // offer to navigate to it.
    createPerpendicularCompanion: (
      projectId: string,
      modelId: string,
      bodyId: string,
    ): Promise<CrossSectionResponse> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/bodies/${bodyId}/perpendicular-companion`,
        {},
      ),

    // --- Auto-correlate contacts (#133 Phase 2) --------------------------------
    //
    // Run the contact-level bottom-up dip-transfer algorithm across the whole
    // model.  Inserts net-new contact-level edges with source='auto'.
    // Idempotent: edges_created=0 means nothing new.
    // sectionId gates adjacency to consecutive columns ALONG that section
    // (the user's left-to-right order); null/omitted uses model-wide map-plane
    // RNG, which crosses columns for off-line investigations (dogfeed
    // 2026-05-29).
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

    // --- Accept correlations (#133 Phase 2) ------------------------------------
    //
    // Mark all pending contact-level edges as user_approved=True and recompute
    // ordinals.  Scoped to a single section when sectionId is provided;
    // model-wide when null.
    //
    // lenses_created / lenses_removed are ALWAYS 0 in the response since
    // 2026-05-31 (owner directive — see /lenses/detect).  The fields stay
    // for type-shape compatibility.
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

    // --- Accept a single correlation edge (dogfeed 2026-05-31) ---------------
    //
    // Powers the right-click "Accept correlation" menu item: flips
    // user_approved=True for one edge and re-runs the resolver in the
    // same transaction.  Idempotent — re-accepting an already-approved
    // edge returns edges_accepted=0.  lenses_created / lenses_removed
    // are ALWAYS 0 — see acceptContactCorrelations.
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

    // --- Detect bodies (explicit verb, owner directive 2026-05-31) ------------
    //
    // Runs the correlation-graph body detector and reconciles body rows for
    // one lithostratigraphic model.  Replaces the auto-detect that used to
    // fire from every edge mutation.  A single manual correlate was silently
    // spawning a body when it incidentally closed a #135 topology; this verb
    // is the only path that materialises body rows now.
    //
    // Idempotent — re-running with no topology change returns
    // lenses_created=0 lenses_removed=0.
    detectBodies: (
      projectId: string,
      modelId: string,
    ): Promise<{
      // Backend DetectBodiesResponse uses bodies_* field names — the legacy
      // lenses_* names returned undefined at the call site (dogfeed 2026-06-03).
      bodies_created: number
      bodies_removed: number
      bodies_skipped_unresolved_ordinal: number
    }> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/bodies/detect`,
        {},
      ),

    // Backwards-compat alias — SectionsToolbar migrated in slice 6.
    detectLithoLenses: (
      projectId: string,
      modelId: string,
    ): Promise<{
      // Backend DetectBodiesResponse uses bodies_* field names — the legacy
      // lenses_* names returned undefined at the call site (dogfeed 2026-06-03).
      bodies_created: number
      bodies_removed: number
      bodies_skipped_unresolved_ordinal: number
    }> =>
      post(
        `/projects/${projectId}/geology/models/${modelId}/bodies/detect`,
        {},
      ),

    // --- Materialise body companion sections (#133 Phase 3) -------------------
    //
    // For every body without a companion section, gate on all contacts in its
    // primary section having at least one approved edge, then create a
    // perpendicular companion section.
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

    // Backwards-compat alias — SectionsToolbar migrated in slice 6.
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

    // --- Re-correlate (Slice 4 Half-A) ----------------------------------------
    //
    // Delete all source='auto' edges for the model.  Manual edges are never
    // touched.  Idempotent: deleted=0 when no auto edges exist.  Called by
    // the re-correlate dialog before firing autoCorrelateContacts again.
    //
    // WHY not del(): the shared del() helper returns void, but this endpoint
    // returns a JSON body (deleted count) — use a raw fetch so the caller
    // can display "Cleared N auto edges; re-running…" in the toast.
    deleteAutoCorrelations: async (
      projectId: string,
      modelId: string,
    ): Promise<DeleteAutoCorrelationsResult> => {
      const path = `/projects/${projectId}/geology/models/${modelId}/contact-correlations/auto`
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
  },

  // Geotechnical-unit CRUD. Two-level project scope: ``/projects/{pid}
  // /geology/formations/{fid}/units``. The ``fid`` in the URL is the
  // parent formation; the unit's ``geological_formation_id`` is NOT
  // updatable (re-parent via delete + recreate, mirroring the
  // formation-contact anchor rule).
  geotechnicalUnit: {
    list: (
      projectId: string,
      formationId: string,
    ): Promise<GeotechnicalUnitResponse[]> =>
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

    delete: (
      projectId: string,
      formationId: string,
      unitId: string,
    ): Promise<void> =>
      del(`/projects/${projectId}/geology/formations/${formationId}/units/${unitId}`),
  },

  // Investigation-review CRUD. Per-(project, investigation) decisions:
  // review status / notes / is_hidden. Upsert by target — the UI knows
  // which investigation it's annotating, not the review row's id.
  // Bundle-backed: every change rides in ``GET /projects/{id}/bundle``
  // and round-trips through the .gmproj file, so hiding a CPT on PC A
  // shows up hidden when PC B opens the same .gmproj.
  review: {
    list: (projectId: string): Promise<InvestigationReviewResponse[]> =>
      get(`/projects/${projectId}/reviews`),

    upsert: (
      projectId: string,
      kind: 'cpt' | 'borehole',
      targetId: string,
      body: InvestigationReviewUpsertPayload,
    ): Promise<InvestigationReviewResponse> =>
      put(`/projects/${projectId}/reviews/${kind}/${targetId}`, body),

    // Idempotent — silently returns when no row exists for the target.
    delete: (projectId: string, kind: 'cpt' | 'borehole', targetId: string): Promise<void> =>
      del(`/projects/${projectId}/reviews/${kind}/${targetId}`),
  },

  // Cross-section CRUD. Project-scoped via the URL prefix; ``projectId``
  // is a guard that matches the URL parameter so a leaked section id
  // can't read or mutate a section in a different project.
  section: {
    list: (projectId: string): Promise<CrossSectionResponse[]> =>
      get(`/projects/${projectId}/sections`),

    get: (projectId: string, sectionId: string): Promise<CrossSectionResponse> =>
      get(`/projects/${projectId}/sections/${sectionId}`),

    create: (
      projectId: string,
      body: CrossSectionCreatePayload,
    ): Promise<CrossSectionResponse> =>
      post(`/projects/${projectId}/sections`, body),

    update: (
      projectId: string,
      sectionId: string,
      body: CrossSectionUpdatePayload,
    ): Promise<CrossSectionResponse> =>
      patch(`/projects/${projectId}/sections/${sectionId}`, body),

    delete: (projectId: string, sectionId: string): Promise<void> =>
      del(`/projects/${projectId}/sections/${sectionId}`),

    // Download the section's DXF export as raw bytes. Returns the
    // ``ArrayBuffer`` rather than parsing — callers pipe it straight
    // to a file write (Electron save dialog → fs.writeFileSync).
    // Throws on non-2xx; the 404 case (missing section / model)
    // surfaces through the caller's toast.
    exportDxf: async (
      projectId: string,
      sectionId: string,
      modelId: string,
    ): Promise<ArrayBuffer> => {
      const res = await fetch(
        `${_base}/projects/${projectId}/sections/${sectionId}/export/dxf` +
          `?model_id=${modelId}`,
      )
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Export failed (${res.status})`)
      }
      return res.arrayBuffer()
    },

    // Debt #52 slice 1: section PDF report. Same byte-pipe contract
    // as exportDxf — the caller writes the ArrayBuffer to a .pdf via
    // the Electron save dialog. The user-editable metadata (title,
    // author, notes) is forwarded as query params; the backend builds
    // sensible defaults when omitted.
    exportPdf: async (
      projectId: string,
      sectionId: string,
      modelId: string,
      metadata: { title?: string; author?: string; notes?: string },
    ): Promise<ArrayBuffer> => {
      const params = new URLSearchParams()
      params.set('model_id', modelId)
      if (metadata.title) params.set('title', metadata.title)
      if (metadata.author) params.set('author', metadata.author)
      if (metadata.notes) params.set('notes', metadata.notes)
      const res = await fetch(
        `${_base}/projects/${projectId}/sections/${sectionId}/export/pdf?${params.toString()}`,
      )
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Export failed (${res.status})`)
      }
      return res.arrayBuffer()
    },

    // Download the section's Plaxis 2D plxscripting script as raw
    // bytes (debt #29). Same byte-pipe contract as exportDxf — the
    // caller writes the ArrayBuffer straight to a .py file via the
    // Electron save dialog. Throws on non-2xx; the 404 (missing
    // section / model) surfaces through the caller's toast.
    exportPlaxis2d: async (
      projectId: string,
      sectionId: string,
      modelId: string,
    ): Promise<ArrayBuffer> => {
      const res = await fetch(
        `${_base}/projects/${projectId}/sections/${sectionId}/export/plaxis2d` +
          `?model_id=${modelId}`,
      )
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Export failed (${res.status})`)
      }
      return res.arrayBuffer()
    },
  },

  // Codelists — static reference data shipped with the backend. Today
  // serves only the G3Dv3 stratigraphic catalog; future codelists
  // (BRO, multilingual labels) plug in here.
  codelists: {
    g3dv3: (): Promise<G3Dv3CatalogResponse> => get('/codelists/g3dv3'),
    formalStratigraphy: (): Promise<FormalStratigraphyCatalogResponse> =>
      get('/codelists/formal-stratigraphy'),
  },

  // Virtuele Boring — DOV synthetic-borehole overlays (informative
  // only — no contacts are persisted). Two surfaces: the model
  // picker catalogue and the per-project predictions sweep.
  virtueleBoring: {
    lagenmodellen: (): Promise<VirtueleBoringLagenmodelEntry[]> =>
      get('/dov/virtuele-boring/lagenmodellen'),

    predictions: (
      projectId: string,
      models: string[],
    ): Promise<VirtueleBoringPredictionsResponse> => {
      const q = new URLSearchParams({ models: models.join(',') })
      return get(`/projects/${projectId}/virtuele-boring/predictions?${q.toString()}`)
    },
  },
}
