// Typed fetch wrappers for the Ground Model FastAPI backend.

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

let _base = 'http://127.0.0.1:8765'

export function setBaseUrl(url: string): void {
  _base = url
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${_base}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`)
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail ?? `PATCH ${path} → ${res.status}`)
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

export const api = {
  cpt: {
    list: (projectId?: string): Promise<CptListItem[]> =>
      get(`/cpt/${projectId ? `?project_id=${projectId}` : ''}`),

    get: (id: string): Promise<CptResponse> => get(`/cpt/${id}`),

    plot: (id: string): Promise<CptPlotResponse> => get(`/cpt/${id}/plot`),

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

    delete: (id: string): Promise<void> => del(`/cpt/${id}`),

    patchElevation: (id: string, body: ElevationPatchBody): Promise<CptResponse> =>
      patch(`/cpt/${id}/elevation`, body),

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
      const blob = new Blob([buffer])
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

    get: (id: string): Promise<BoreholeDetailResponse> => get(`/borehole/${id}`),

    patchElevation: (id: string, body: ElevationPatchBody): Promise<BoreholeListItem> =>
      patch(`/borehole/${id}/elevation`, body),

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
    restore: (id: string, body: ProjectBundleResponse): Promise<ProjectResponse> =>
      post(`/projects/${id}/restore`, body),

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
  },
}
