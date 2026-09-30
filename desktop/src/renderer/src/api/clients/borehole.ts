/**
 * Borehole API client — typed wrappers for `/borehole/*` endpoints.
 *
 * Covers the borehole list, detail, batch-detail, elevation PATCH, and
 * DOV import endpoints. All request/response types for the borehole
 * domain are co-located here.
 *
 * @module clients/borehole
 */
import { _base, del, detailMessage, fetchTracked, get, patch, post, put } from './shared'

// ---------------------------------------------------------------------------
// Borehole / sample / lab-test types — mirrors the FastAPI schemas in
// ``api/schemas/borehole/``.
// ---------------------------------------------------------------------------

/** Borehole filter axis — which categorical field the user is filtering by.
 *
 * Lifted to a shared type because both the map's layer-control and the
 * sidebar's row partitioning need to agree on which axis is active.
 */
export type BoreholeAxis = 'drill_method' | 'borehole_type'

/** Summary row returned by ``GET /borehole/``. */
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
  /**
   * Raw lab tests (oedometer / triaxial series) on the borehole's samples
   * (additive, 2026-09-30). Absent / null on answers that do not count them
   * (the elevation PATCH); the list always carries it.
   */
  lab_series_count?: number | null
}

/** One admixture within an observation layer. */
export interface AdmixtureResponse {
  soil_code: string
  amount: string
  locally: boolean
}

/** One lithology interval in a borehole visual log. */
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

/** A single DOV/GEF visual-log observation with its layers. */
export interface ObservationResponse {
  id: string
  observation_type: string
  author: string | null
  observation_date: string | null
  reliability: string | null
  score_category: string | null
  drill_method_score: string | null
  layers: ObservationLayerResponse[]
  /** Provenance (2026-09-29): ``"dov"`` or ``"manual"``. Optional so an
   *  older backend / fixture without the field reads as an untouched import. */
  source?: string
  /** Last save from the track editor; ``null`` for an untouched import. */
  edited_manually_at?: string | null
  /** Upstream DOV identity an edited import keeps; ``null`` for a manual track. */
  dov_permkey?: string | null
}

/** One drilling segment within a borehole. */
export interface DrillSegmentResponse {
  id: string
  top_m: number
  base_m: number
  method: string | null
}

/** One field-log interval (water table, casing, …). */
export interface FieldLogIntervalResponse {
  id: string
  top_m: number
  base_m: number
  kind: string
  value: string | null
  /** Provenance of the field-log track the row belongs to (2026-09-29). */
  source?: string
  edited_manually_at?: string | null
}

// ---------------------------------------------------------------------------
// Hand-edited tracks (owner 2026-09-29) — ``/borehole/{id}/tracks``.
// ---------------------------------------------------------------------------

/** One interval of a track, in the ONE shape every kind shares. A field-log
 *  kind fills ``value``; a coded kind fills ``main_soil_codes`` (+ admixtures,
 *  colour); every other kind fills ``description``. Raw DOV tokens only. */
export interface TrackIntervalBody {
  top_m: number
  base_m: number
  value?: string | null
  description?: string | null
  color?: string | null
  main_soil_codes?: string[]
  admixtures?: AdmixtureResponse[]
}

/** One validator finding; ``loc`` is the dotted request path. */
export interface TrackIssueResponse {
  loc: string
  code: string
  message: string
}

/** A track after a create / replace. ``track_id`` is the observation UUID or
 *  ``"field_log:<kind>"``. */
export interface BoreholeTrackResponse {
  track_id: string
  kind: string
  family: 'observation' | 'field_log'
  source: string
  edited_manually_at: string | null
  dov_permkey: string | null
  intervals: TrackIntervalBody[]
  warnings: TrackIssueResponse[]
}

/** The answer of a Reset to DOV: the rewritten tracks (manual tracks are kept
 *  and only counted). */
export interface BoreholeTrackResetResponse {
  tracks: BoreholeTrackResponse[]
  discarded_edits: number
  kept_manual: number
}

/** The 409 code of a Reset to DOV with no DOV XML behind it. */
export const RESET_NO_DOV_SOURCE_CODE = 'borehole_reset_no_dov_source'

/** Grain-size distribution curve for one sample. */
export interface GrainSizeResponse {
  id: string
  diameters_mm: number[]
  pct_larger: number[]
  method: string | null
  test_date: string | null
  lime_removed: boolean | null
  organics_removed: boolean | null
}

/** Atterberg limits test result (liquid limit + plastic limit). */
export interface AtterbergLimitsResponse {
  id: string
  liquid_limit_pct: number | null
  plastic_limit_pct: number | null
  non_plastic: boolean | null
  method: string | null
  test_date: string | null
}

/** Calcium carbonate content test. */
export interface CaCO3ContentResponse {
  id: string
  content_pct: number | null
  method: string | null
  test_date: string | null
}

/** Organic content test (carbon or matter percent). */
export interface OrganicContentResponse {
  id: string
  carbon_pct: number | null
  matter_pct: number | null
  method: string | null
  test_date: string | null
}

/** Water content (gravimetric) test. */
export interface WaterContentResponse {
  id: string
  content_pct: number | null
  method: string | null
  test_date: string | null
}

/**
 * Catch-all for scalar lab tests outside the 5 typed families.
 *
 * Currently covers grain density, ASTM classification, descriptive
 * calcareous content. Numeric values land in `value_numeric`;
 * non-numeric (e.g. ASTM code "CL") in `value_text`.
 */
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

/** Sample with its attached lab-test families. */
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
  // Geotech provenance — null when not yet subdivided or borehole has no
  // CPT within the body corridor.
  geotech_body_id: string | null
  geotech_nad_class: number | null
  /** "cpt_interpolated" | "body_min" | "absolute_min" | "unresolved" | null */
  geotech_assignment_source: string | null
  grain_sizes: GrainSizeResponse[]
  atterberg_limits_tests: AtterbergLimitsResponse[]
  caco3_content_tests: CaCO3ContentResponse[]
  organic_content_tests: OrganicContentResponse[]
  water_content_tests: WaterContentResponse[]
  scalar_lab_tests: ScalarLabTestResponse[]
}

/** Full borehole detail including drill segments, field log, observations, and samples. */
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

// Shared elevation-patch payload — the backend accepts the same shape for
// CPT and borehole, so the API surface mirrors that. ``elevation_m: null``
// clears a previously-entered value (returns the row to the "needs Z"
// state). ``z_epsg`` is omitted today because the desktop UI doesn't expose
// a CRS picker — the backend defaults to mTAW (5710) for DOV-Belgium data.
export interface ElevationPatchBody {
  elevation_m: number | null
  z_epsg?: number | null
}

// ---------------------------------------------------------------------------
// Local DOV borehole XML import — ``POST /borehole/import``
// ---------------------------------------------------------------------------

/** One parse finding / import flag, as the backend sends it. */
export interface ImportFlag {
  level: 'error' | 'warning' | 'info' | string
  code: string
  /** English sentence; shown as the raw tooltip next to the translation. */
  message: string
  rows: number[]
  /** The message's variable parts (names, counts, depths, permkeys), keyed per
   *  code; ``utils/importFlagText.ts`` renders the finding in the interface
   *  language from them. Absent from an older backend (the message is shown). */
  params?: Record<string, unknown>
}

/** What happened to one boring of an imported DOV XML file. */
export interface ImportedBoring {
  /** New or refreshed borehole id; null when the boring was not imported. */
  borehole_id: string | null
  /** DOV alternative name when present, else the identificatie. */
  name: string
  /** DOV identificatie, the dedup key. */
  test_id: string
  has_errors: boolean
  /** Every flag for this boring; each message names the boring. */
  issues: ImportFlag[]
  refreshed: boolean
  imported: boolean
}

/** Response from ``POST /borehole/import``. */
export interface ImportBoreholeFileResponse {
  boreholes: ImportedBoring[]
  /** Findings that belong to no single boring. */
  file_issues: ImportFlag[]
}

/** The old-vs-new numbers one boring's replacement is decided on. */
export interface BoreholeRefreshDiff {
  boreholeId: string
  name: string
  testId: string
  oldTotalDepthM: number | null
  newTotalDepthM: number | null
  oldNLithoLayers: number
  newNLithoLayers: number
  /** Issue counts from the FRESH parse. */
  nErrors: number
  nWarnings: number
}

/** Thrown when ``POST /borehole/import`` would overwrite boreholes already in
 * the project. Nothing was written: the backend is asking. The file is
 * re-posted with ``confirmRefresh`` if the engineer agrees. */
export class BoreholeRefreshConfirmationRequiredError extends Error {
  diffs: BoreholeRefreshDiff[]
  constructor(diffs: BoreholeRefreshDiff[]) {
    super(`${diffs.length} borehole(s) already in this project`)
    this.name = 'BoreholeRefreshConfirmationRequiredError'
    this.diffs = diffs
  }
}

/** Map one backend diff row (snake_case) to the renderer's shape. */
function toRefreshDiff(raw: Record<string, unknown>): BoreholeRefreshDiff {
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  return {
    boreholeId: String(raw.borehole_id ?? ''),
    name: String(raw.name ?? ''),
    testId: String(raw.test_id ?? ''),
    oldTotalDepthM: num(raw.old_total_depth_m),
    newTotalDepthM: num(raw.new_total_depth_m),
    oldNLithoLayers: num(raw.old_n_litho_layers) ?? 0,
    newNLithoLayers: num(raw.new_n_litho_layers) ?? 0,
    nErrors: num(raw.n_errors) ?? 0,
    nWarnings: num(raw.n_warnings) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Borehole API surface — ``api.borehole``
// ---------------------------------------------------------------------------

/** Typed wrappers for all ``/borehole/*`` endpoints. */
export const boreholeClient = {
  list: (projectId?: string): Promise<BoreholeListItem[]> =>
    get(`/borehole/${projectId ? `?project_id=${projectId}` : ''}`),

  // ``projectId`` is required — scope guard prevents cross-project
  // borehole detail fetch and elevation mutation (VULN-6/7).
  get: (id: string, projectId: string): Promise<BoreholeDetailResponse> =>
    get(`/borehole/${id}?project_id=${projectId}`),

  /**
   * Batch the per-borehole detail GET into one round-trip (debt #39).
   *
   * Cross-section panel uses this on open so a dense corridor is one DB
   * query instead of N. Unknown ids drop from the response (skip-on-missing);
   * body cap is 500 ids.
   *
   * ``include`` follows the per-id endpoint's contract: ``undefined`` loads
   * every lab-test family (the original always-load behaviour); an explicit
   * array (including empty) narrows the load. Section views typically pass
   * ``[]`` — column glyphs don't render lab data, so skipping the 6
   * lab-family SELECTs is pure win.
   *
   * Parameters
   * ----------
   * ids : string[]
   *   Borehole UUIDs to fetch.
   * projectId : string
   *   Project scope — backend filters to prevent cross-project leakage.
   * include : string[], optional
   *   Lab-test families to include; undefined = all.
   *
   * Returns
   * -------
   * Promise<BoreholeDetailResponse[]>
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

  /** Add a hand-typed track of ``kind`` (stored ``source = "manual"``). */
  createTrack: (
    id: string,
    projectId: string,
    kind: string,
    intervals: TrackIntervalBody[],
  ): Promise<BoreholeTrackResponse> =>
    post(`/borehole/${id}/tracks?project_id=${projectId}`, { kind, intervals }),

  /** Replace every interval of one track (imported tracks included). */
  replaceTrack: (
    id: string,
    projectId: string,
    trackId: string,
    intervals: TrackIntervalBody[],
  ): Promise<BoreholeTrackResponse> =>
    put(
      `/borehole/${id}/tracks/${encodeURIComponent(trackId)}?project_id=${projectId}`,
      { intervals },
    ),

  /** Delete one whole track with its intervals (the UI confirms first). */
  deleteTrack: (id: string, projectId: string, trackId: string): Promise<void> =>
    del(`/borehole/${id}/tracks/${encodeURIComponent(trackId)}?project_id=${projectId}`),

  /** Reset the borehole's DOV tracks (or ``trackId`` alone) to what DOV
   *  published, from the cached DOV XML (owner 2026-09-30). Rejects 409
   *  ``borehole_reset_no_dov_source`` when the cache holds no XML for it. */
  resetTracksToDov: (
    id: string,
    projectId: string,
    trackId: string | null,
  ): Promise<BoreholeTrackResetResponse> => {
    const track = trackId === null ? '' : `&track_id=${encodeURIComponent(trackId)}`
    return post(`/borehole/${id}/tracks/reset-dov?project_id=${projectId}${track}`)
  },

  // A local DOV borehole XML file (one or several borings). ``confirmRefresh``
  // carries the engineer's answer to the replace-these-boreholes dialog: left
  // false, a file whose borings are already in the project writes NOTHING and
  // throws BoreholeRefreshConfirmationRequiredError with one diff per boring
  // (the CPT re-import rule, docs/ux.md "Reversible vs irreversible").
  importFile: async (
    filePath: string,
    projectId?: string,
    confirmRefresh = false,
  ): Promise<ImportBoreholeFileResponse> => {
    // Read via IPC: fetch('file://') is blocked in the renderer sandbox.
    const buffer: Uint8Array = await window.electron.readFile(filePath)
    const fileName = filePath.split(/[\\/]/).pop() ?? 'upload.xml'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buffer)]), fileName)
    if (projectId) form.append('project_id', projectId)
    if (confirmRefresh) form.append('confirm_refresh', 'true')
    const res = await fetchTracked(`${_base}/borehole/import`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = body.detail
      if (res.status === 409 && detail?.code === 'borehole_refresh_confirmation_required') {
        const diffs = Array.isArray(detail.diffs) ? detail.diffs : []
        throw new BoreholeRefreshConfirmationRequiredError(diffs.map(toRefreshDiff))
      }
      throw new Error(detailMessage(detail) ?? `Import failed: ${res.status}`)
    }
    return res.json()
  },
}
