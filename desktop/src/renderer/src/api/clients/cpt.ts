/**
 * CPT API client — typed wrappers for ``/cpt/*`` endpoints.
 *
 * Covers CPT list, detail, plot, batch-plot, deletion, elevation PATCH,
 * and DOV/GEF import endpoints. All request/response types for the CPT
 * domain are co-located here.
 *
 * @module clients/cpt
 */
import { _base, del, detailMessage, fetchTracked, get, patch, post } from './shared'
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
  // Provenance — ``"dov"`` / ``"gef"`` / ``"pdf"`` / ``"manual"`` / ``"none"``.
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
  // Depth to groundwater below ground surface (positive down), or null when
  // none is recorded — every DOV-imported CPT is in that state.
  water_depth_m: number | null
  // Provenance — ``"gef"`` (parsed from MEASUREMENTVAR 14) or ``"engineer"``
  // (typed in the Parameters inspector; NOT overwritten by a re-import).
  water_depth_source: string | null
  max_depth_m: number | null
  n_rows: number | null
  // How a CPT that did not come from a data file was made — the PDF
  // digitiser's ``source: "pdf-digitised"``, report file, pages, calibration,
  // digitiser version. Absent / null for GEF and DOV imports. Optional so an
  // older backend's response still parses.
  import_provenance?: Record<string, unknown> | null
}

/** Where the water table a derived profile used came from. */
export type GwtProvenance = 'recorded' | 'engineer' | 'assumed'

/**
 * Both Robertson SBT classifications per depth point, from
 * ``GET /cpt/{id}/sbt-profile``.
 *
 * All arrays are parallel to ``depths_m`` and ordered shallow → deep, matching
 * ``CptPlotResponse`` so both render on one shared depth axis. ``null`` marks a
 * depth point neither classifier could evaluate (missing sleeve friction) —
 * never a filled-in guess.
 *
 * ``gwt_m`` / ``gwt_source`` are the provenance of the NORMALISED columns: any
 * surface drawing them must say which water table they were derived under
 * (Data Integrity Rule 1). The non-normalised columns do not use it.
 */
export interface CptSbtProfileResponse {
  cpt_id: string
  depths_m: number[]
  /** Normalised Ic (Robertson 2015 pipeline) — identical to ``plot.ic``. */
  ic: (number | null)[]
  /** Robertson (2009) chart zone 1–9, incl. the extended organic/peat outcome. */
  zone_normalised: (number | null)[]
  /** Non-normalised index I_SBT (Robertson 2010) — no stress profile needed. */
  i_sbt: (number | null)[]
  /** SBT zone 2–7 from ``i_sbt``; zones 1/8/9 are not identifiable from it. */
  zone_non_normalised: (number | null)[]
  gwt_m: number
  gwt_source: GwtProvenance
}

/** Body of ``PATCH /cpt/{id}/water-table``. ``null`` clears the value. */
export interface WaterTablePatchBody {
  water_depth_m: number | null
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
  /** Parse findings. ``details`` carries the numbers a finding's message
   * names (e.g. ``pre_drill_m`` / ``first_depth_m`` on
   * ``PRE_DRILL_NOT_APPLIED``) so the renderer can word it in the UI language;
   * absent from a backend that predates it. */
  issues: {
    level: string
    code: string
    message: string
    rows: number[]
    details?: Record<string, number>
  }[]
  /** True when the file was already in this project and the EXISTING row was
   * refreshed in place (same ``cpt_id``, series + header replaced from the
   * fresh parse). The endpoint answers 200 then, 201 for a new CPT. */
  refreshed: boolean
  /** Display name the backend persisted — used to name the CPT in the
   * "refreshed" message without a follow-up fetch. */
  name: string
}

/** The old-vs-new diff a refresh confirmation is decided on.
 *
 * Sent by the backend with HTTP 409 ``code = "cpt_refresh_confirmation_required"``
 * when a re-import would overwrite an existing row. Nothing has been written at
 * that point — the engineer decides on these numbers, then the client re-posts
 * with ``confirmRefresh``.
 */
export interface CptRefreshDiff {
  cptId: string
  /** Display name of the STORED CPT, so the dialog names the row not the file. */
  name: string
  oldMaxDepthM: number | null
  newMaxDepthM: number | null
  oldNRows: number | null
  newNRows: number | null
  /** Issue counts from the FRESH parse. */
  nErrors: number
  nWarnings: number
}

/** Thrown when ``POST /cpt/import`` would overwrite an existing CPT.
 *
 * Not an error condition in the usual sense — it is the backend asking. The
 * import is retried with ``confirmRefresh: true`` if the user agrees, and
 * simply dropped if they do not.
 */
export class CptRefreshConfirmationRequiredError extends Error {
  diff: CptRefreshDiff
  constructor(diff: CptRefreshDiff) {
    super(`CPT ${diff.name} is already in this project`)
    this.name = 'CptRefreshConfirmationRequiredError'
    this.diff = diff
  }
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

// Backend cap on ids per ``POST /cpt/plot-batch`` — CptPlotBatchRequest.ids
// carries ``Field(min_length=1, max_length=500)``, so a body over 500 ids is
// rejected 422. A dense project can project up to ~5000 CPTs onto one section
// corridor, so ``plotBatch`` splits into ≤500-id requests and merges. Kept in
// sync with ``api/schemas/cpt/cpt_plot_batch_request.py``.
const PLOT_BATCH_MAX_IDS = 500

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

  // Both Robertson classifications per depth point — drives the Parameters
  // stage's per-CPT plot surface. Derived on read; nothing is stored, so this
  // is always fetched fresh after a water-table edit.
  //
  // ``unitWeights`` MUST carry the engineer's Settings → Litho segmenter
  // values, the same ones ``buildSuggestBody`` sends to suggest-litho. The
  // normalised strip and the ghost boundaries are then normalised against ONE
  // effective-stress profile; omit them and moving γ_unsat 16 → 19 makes the
  // two surfaces disagree for a reason the strip cannot show.
  sbtProfile: (
    id: string,
    projectId: string,
    unitWeights?: { gunsatKNm3?: number; gwaterKNm3?: number },
  ): Promise<CptSbtProfileResponse> => {
    const params = new URLSearchParams({ project_id: projectId })
    if (unitWeights?.gunsatKNm3 !== undefined) {
      params.set('gunsat_kNm3', String(unitWeights.gunsatKNm3))
    }
    if (unitWeights?.gwaterKNm3 !== undefined) {
      params.set('gwater_kNm3', String(unitWeights.gwaterKNm3))
    }
    return get(`/cpt/${id}/sbt-profile?${params.toString()}`)
  },

  // The engineer's own water table. Stamps provenance ``engineer`` server-side,
  // which a later re-import of the same file will not overwrite. Sending
  // ``water_depth_m: null`` clears it back to "nothing recorded".
  patchWaterTable: (
    id: string,
    projectId: string,
    body: WaterTablePatchBody,
  ): Promise<CptResponse> => patch(`/cpt/${id}/water-table?project_id=${projectId}`, body),

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
  //
  // Chunked to the backend's 500-id cap (M7d): >500 ids in one body is a 422,
  // so a dense corridor is split into ≤500-id requests fired in parallel and
  // merged in chunk order — which preserves the input id order among the
  // present rows. An empty id set makes no request (min_length=1 would 422).
  plotBatch: async (ids: string[], appProjectId: string): Promise<CptPlotResponse[]> => {
    if (ids.length === 0) return []
    if (ids.length <= PLOT_BATCH_MAX_IDS) {
      return post<CptPlotResponse[]>(`/cpt/plot-batch`, { ids, app_project_id: appProjectId })
    }
    const requests: Promise<CptPlotResponse[]>[] = []
    for (let start = 0; start < ids.length; start += PLOT_BATCH_MAX_IDS) {
      requests.push(
        post<CptPlotResponse[]>(`/cpt/plot-batch`, {
          ids: ids.slice(start, start + PLOT_BATCH_MAX_IDS),
          app_project_id: appProjectId,
        }),
      )
    }
    // Promise.all resolves in array order regardless of completion order, so
    // flattening keeps chunk 0's rows ahead of chunk 1's — input order.
    const chunked = await Promise.all(requests)
    return chunked.flat()
  },

  // ``projectId`` is required on patch — scope guard ensures a caller
  // cannot patch a CPT from a foreign project (VULN-2/3).
  patchElevation: (
    id: string,
    projectId: string,
    body: ElevationPatchBody,
  ): Promise<CptResponse> => patch(`/cpt/${id}/elevation?project_id=${projectId}`, body),

  // ``confirmRefresh`` carries the user's answer to the replace-this-CPT
  // dialog. Left false, a re-import of a file already in the project writes
  // NOTHING and throws CptRefreshConfirmationRequiredError with the diff:
  // replacing a stored series is irreversible, so it is consented per file
  // (docs/ux.md "Reversible vs irreversible").
  import: async (
    filePath: string,
    projectId?: string,
    confirmRefresh = false,
  ): Promise<ImportCptResponse> => {
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
    if (confirmRefresh) form.append('confirm_refresh', 'true')
    const res = await fetchTracked(`${_base}/cpt/import`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = body.detail
      if (res.status === 409 && detail?.code === 'cpt_refresh_confirmation_required') {
        throw new CptRefreshConfirmationRequiredError({
          cptId: detail.cpt_id,
          name: detail.name,
          oldMaxDepthM: detail.old_max_depth_m ?? null,
          newMaxDepthM: detail.new_max_depth_m ?? null,
          oldNRows: detail.old_n_rows ?? null,
          newNRows: detail.new_n_rows ?? null,
          nErrors: detail.n_errors ?? 0,
          nWarnings: detail.n_warnings ?? 0,
        })
      }
      if (res.status === 409 && detail?.cpt_id) {
        throw new DuplicateCptError(detail.cpt_id)
      }
      throw new Error(detailMessage(detail) ?? `Import failed: ${res.status}`)
    }
    return res.json()
  },
}
