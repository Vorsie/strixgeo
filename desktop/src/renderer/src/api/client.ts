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
}
