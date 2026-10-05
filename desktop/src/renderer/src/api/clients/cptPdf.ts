/**
 * CPT PDF import client — ``/cpt/pdf/*``.
 *
 * Data → Import → "Import CPTs from a PDF report": upload + triage a report
 * (a background job with an SSE progress stream, the DOV import pattern), page
 * thumbnails, one sounding read through the calibration the user settles on,
 * and the import of the ticked soundings. The report is uploaded ONCE; every
 * later call names it by the SHA-256 the triage answered with.
 *
 * @module clients/cptPdf
 */

import { messageForDetail } from './apiCodeMessages'
import { _base, ApiError, detailMessage, fetchTracked, post } from './shared'

// ---------------------------------------------------------------------------
// Calibration — the exact dict shape of the backend's PageCalibration.to_dict()
// ---------------------------------------------------------------------------

/** A panel frame in the page's coordinate space (PDF points or image pixels). */
export interface FrameDict {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A linear axis through two anchors: coordinate → value. */
export interface AxisScaleDict {
  coord_a: number
  value_a: number
  coord_b: number
  value_b: number
  max_residual?: number
}

/** The quantity a panel plots (backend ``PanelKind``). */
export type PanelKindValue = 'qc' | 'fs' | 'rf' | 'u2' | 'inclination' | 'unknown'

/** One graph panel's calibration. */
export interface PanelCalibrationDict {
  kind: PanelKindValue
  frame: FrameDict
  value_scale: AxisScaleDict | null
  depth_scale: AxisScaleDict | null
  unit: string
  to_storage_factor: number
  /** RGB 0..1 of the curve traced in this panel. */
  curve_colour: [number, number, number] | null
  source: string
  assumptions: string[]
}

/** One page's calibration (what the calibration overlay edits). */
export interface PageCalibrationDict {
  page_number: number
  /** ``pdf-pt`` (vector) or ``image-px`` (raster, at ``dpi``). */
  coordinate_space: string
  dpi: number | null
  /** ``depth`` (depth below ground) or ``elevation`` (m TAW). */
  depth_reference: string
  panels: PanelCalibrationDict[]
  ground_level_m: number | null
  sounding_id: string | null
  profile_name: string
  assumptions: string[]
}

// ---------------------------------------------------------------------------
// Triage digest
// ---------------------------------------------------------------------------

/**
 * One note on a triaged sounding as a stable code + params (backend
 * ``ReportSoundingNote``); rendered in the app language by
 * ``utils/cptPdfNoteText.ts``.
 */
export interface CptPdfNote {
  code: string
  params: Record<string, unknown>
}

/** One sounding the triage offers (campaign) or lists apart (unknown). */
export interface CptPdfSounding {
  key: string
  sounding_id: string | null
  origin: 'campaign' | 'unknown'
  page_numbers: number[]
  sheet_count: number
  graph_kind: 'vector' | 'raster'
  profile_name: string
  ground_level_m: number | null
  z_epsg: number | null
  x: number | null
  y: number | null
  epsg: number | null
  test_date: string | null
  curves: string[]
  clipped_points: number
  digitised: boolean
  /** The notes as English sentences (what an older client renders). */
  warnings: string[]
  /** The same notes as codes, one per warning, same order; absent from a
   *  backend that predates them (then ``warnings`` is shown as is). */
  notes?: CptPdfNote[]
  /** The project number printed on the sheet ("23.15-002"); absent from an
   *  older backend. */
  project_number?: string | null
  /** The report's campaign code, the stand-in project when the sheet prints none. */
  campaign_code?: string | null
  /** The name the imported CPT is shown under ("23.15-002-S110"); absent
   *  from an older backend (then the printed sounding id is shown). */
  display_name?: string
}

/** A sheet set aside: a desk-study reprint, a repeat, or an unreadable sheet. */
export interface CptPdfDroppedSheet {
  sounding_id: string
  page_numbers: number[]
  reason: 'desk-study' | 'duplicate' | 'unread'
  note: string
}

/** What the triage found in one report. */
export interface CptPdfDigest {
  file_sha: string
  page_count: number
  class_counts: Record<string, number>
  campaign: CptPdfSounding[]
  unknown: CptPdfSounding[]
  dropped: CptPdfDroppedSheet[]
  desk_study_ids: string[]
  report_code: string | null
  campaign_codes: string[]
  project_numbers: string[]
  /** False → "tick reading unavailable: type the axis values". */
  ocr_available: boolean
  raster_pages_unread: number
  profiles: string[]
}

// ---------------------------------------------------------------------------
// Digitise
// ---------------------------------------------------------------------------

/** One overlay image: the page, the frames and the orange digitised curve. */
export interface CptPdfOverlay {
  page_number: number
  dpi: number
  width: number
  height: number
  png_base64: string
}

/** The sheet header as printed (null where the sheet printed nothing). */
export interface CptPdfSheetHeader {
  x: number | null
  y: number | null
  epsg: number | null
  ground_level_m: number | null
  z_epsg: number | null
  test_date: string | null
}

/** ``POST /cpt/pdf/digitise`` answer. */
export interface CptPdfDigitised {
  sounding_id: string
  page_numbers: number[]
  /** ``depth_m``, ``qc_mpa``, … plus ``<name>_clipped`` flag lists. */
  series: Record<string, (number | boolean | null)[]>
  sampling: string | null
  calibrations: PageCalibrationDict[]
  assumptions: string[]
  clipped_count: number
  printed_values: [number, string][]
  header: CptPdfSheetHeader
  warnings: string[]
  /** The same notes as codes (see {@link CptPdfSounding.notes}). */
  notes?: CptPdfNote[]
  overlays: CptPdfOverlay[]
}

/** ``POST /cpt/pdf/digitise`` body. */
export interface CptPdfDigitiseBody {
  project_id: string
  file_sha: string
  sounding_id: string
  calibrations?: PageCalibrationDict[]
  ground_level_m?: number | null
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Header values the user typed for one sounding (all optional). */
export interface CptPdfHeaderEdit {
  x?: number | null
  y?: number | null
  epsg?: number | null
  ground_level_m?: number | null
  test_date?: string | null
  /** Project number for a sheet that prints none (the dialog's "Projectnummer"
   *  field); stored as the CPT's project id. Sent only when set: a backend
   *  that predates the field refuses it as an extra input. */
  project_number?: string | null
}

/** ``POST /cpt/pdf/import`` body. */
export interface CptPdfImportBody {
  project_id: string
  file_sha: string
  sounding_ids: string[]
  calibrations?: Record<string, PageCalibrationDict[]>
  headers?: Record<string, CptPdfHeaderEdit>
  confirm_refresh?: boolean
}

/** Per-sounding outcome status. */
export type CptPdfImportStatus =
  | 'imported'
  | 'refreshed'
  | 'confirmation_required'
  | 'refused'
  | 'failed'

/** One sounding's outcome of ``POST /cpt/pdf/import``. */
export interface CptPdfImportResult {
  sounding_id: string
  status: CptPdfImportStatus
  name: string
  cpt_id: string | null
  code: string | null
  message: string | null
  diff: {
    name: string
    old_max_depth_m: number | null
    new_max_depth_m: number | null
    old_n_rows: number | null
    new_n_rows: number | null
    n_errors: number
    n_warnings: number
  } | null
  /** The parse findings. ``params`` / ``details`` carry the values the
   *  English ``message`` names, so the report words each finding in the app
   *  language; absent from an older backend. */
  issues: CptPdfImportIssue[]
}

/** One parse finding of a PDF import result. */
export interface CptPdfImportIssue {
  level: string
  code: string
  message: string
  rows: number[]
  details?: Record<string, number>
  params?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * The running job a triage POST was refused for, if any.
 *
 * The backend keys a triage job on the project and the report's SHA-256; a
 * second upload of the same report while its job runs answers ``409`` with
 * ``detail.job_id`` naming the running job. The caller attaches to that job's
 * stream instead of failing (the job was spawned for this very report).
 *
 * @param err - A rejection of {@link cptPdfClient.startTriage}.
 * @returns The running job id, or ``null`` for any other failure.
 */
export function runningTriageJobId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null
  const jobId = (err.detail as { job_id?: unknown } | null | undefined)?.job_id
  return typeof jobId === 'string' && jobId.length > 0 ? jobId : null
}

/** Typed wrappers for the ``/cpt/pdf/*`` endpoints. */
export const cptPdfClient = {
  /**
   * Upload a report and start its triage job.
   *
   * @returns ``{ job_id, file_sha }``; attach to {@link cptPdfClient.streamUrl}.
   * @throws ApiError on a non-2xx answer; ``detail`` is the server's detail, so
   *   a 409 "already running" refusal keeps the running ``job_id`` reachable
   *   (see {@link runningTriageJobId}).
   */
  startTriage: async (
    filePath: string,
    projectId: string,
  ): Promise<{ job_id: string; file_sha: string }> => {
    // Read via IPC — fetch('file://') is blocked in the renderer sandbox.
    const buffer: Buffer = await window.electron.readFile(filePath)
    const fileName = filePath.split(/[\\/]/).pop() ?? 'report.pdf'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), fileName)
    form.append('project_id', projectId)
    const res = await fetchTracked(`${_base}/cpt/pdf/triage`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(
        messageForDetail(body.detail, detailMessage(body.detail) ?? `Triage failed: ${res.status}`),
        res.status,
        { detail: body.detail, method: 'POST', path: '/cpt/pdf/triage' },
      )
    }
    return res.json()
  },

  /** URL of a triage job's SSE progress stream. */
  streamUrl: (jobId: string): string => `${_base}/cpt/pdf/triage/${jobId}`,

  /** URL of a page thumbnail PNG. */
  pageUrl: (fileSha: string, page: number, projectId: string, dpi = 80): string =>
    `${_base}/cpt/pdf/page/${fileSha}/${page}.png?project_id=${projectId}&dpi=${dpi}`,

  /**
   * Fetch a page thumbnail PNG as a Blob.
   *
   * The renderer's CSP allows images only from ``'self'``, ``data:``,
   * ``blob:`` and ``https:``, so an ``<img>`` cannot point at the local http
   * backend; the caller shows the Blob through an object URL instead
   * (``hooks/usePdfPageThumbnail``). Goes through ``fetchTracked`` like every
   * other call, so a dead backend is noticed here too.
   *
   * @throws ApiError on a non-2xx answer.
   */
  pageBlob: async (fileSha: string, page: number, projectId: string, dpi = 80): Promise<Blob> => {
    const res = await fetchTracked(cptPdfClient.pageUrl(fileSha, page, projectId, dpi))
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(
        messageForDetail(body.detail, detailMessage(body.detail) ?? `Page thumbnail failed: ${res.status}`),
        res.status,
        { detail: body.detail, method: 'GET', path: `/cpt/pdf/page/${fileSha}/${page}.png` },
      )
    }
    return res.blob()
  },

  /** Read one sounding (optionally through edited calibrations). */
  digitise: (body: CptPdfDigitiseBody): Promise<CptPdfDigitised> =>
    post<CptPdfDigitised>('/cpt/pdf/digitise', body),

  /** Import ticked soundings; one outcome each. */
  importSoundings: (body: CptPdfImportBody): Promise<{ results: CptPdfImportResult[] }> =>
    post<{ results: CptPdfImportResult[] }>('/cpt/pdf/import', body),
}
