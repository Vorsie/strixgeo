/**
 * CPT API client — typed wrappers for ``/cpt/*`` endpoints.
 *
 * Covers CPT list, detail, plot, batch-plot, deletion, elevation PATCH,
 * and DOV/GEF import endpoints. All request/response types for the CPT
 * domain are co-located here.
 *
 * @module clients/cpt
 */
import { _base, del, get, patch, post } from './shared'
import type { ElevationPatchBody } from './borehole'

// Re-export so callers that only need the CPT module still get the type.
export type { ElevationPatchBody } from './borehole'

// ---------------------------------------------------------------------------
// CPT types
// ---------------------------------------------------------------------------

/** Summary row returned by ``GET /cpt/``. */
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

/** Metadata response for a single CPT (no series data). */
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

/**
 * Full CPT plot payload — all depth series aligned on the same index.
 *
 * ``qt_mpa`` is CPTU corrected cone resistance (qt = qc + u2(1-a)),
 * populated for piezocones only. ``q_total_mpa`` is CPTM totaalweerstand
 * (combined tip + sleeve via a Begemann mechanical cone), CPTM only.
 * The two are physically distinct and are never stored in the same column.
 */
export interface CptPlotResponse {
  cpt_id: string
  depths_m: number[]
  qc_mpa: number[]
  fs_mpa: (number | null)[] | null
  u2_mpa: (number | null)[] | null
  rf_pct: (number | null)[] | null
  qt_mpa: (number | null)[] | null
  q_total_mpa: (number | null)[] | null
  ic: (number | null)[] | null
  rf_source: string | null
}

/** Response from ``POST /cpt/import`` (GEF file upload). */
export interface ImportCptResponse {
  cpt_id: string
  has_errors: boolean
  issues: { level: string; code: string; message: string; rows: number[] }[]
}

/** Response from ``POST /cpt/import-dov`` (DOV bbox import). */
export interface ImportDovResponse {
  imported: number
  duplicates: number
  failed: number
  cpt_ids: string[]
}

/** Thrown when ``POST /cpt/import`` returns HTTP 409. */
export class DuplicateCptError extends Error {
  cptId: string
  constructor(cptId: string) {
    super('CPT already exists in this project')
    this.name = 'DuplicateCptError'
    this.cptId = cptId
  }
}

// ---------------------------------------------------------------------------
// CPT API surface — ``api.cpt``
// ---------------------------------------------------------------------------

/** Typed wrappers for all ``/cpt/*`` endpoints. */
export const cptClient = {
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
}
