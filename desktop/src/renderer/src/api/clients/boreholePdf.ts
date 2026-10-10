/**
 * Borehole PDF import client — ``/borehole/pdf/*``.
 *
 * Data → Import → Boring → "Uit een pdf-rapport": upload + triage a
 * borehole-log report (a background job with an SSE progress stream, the CPT
 * digitiser's path), page thumbnails, and the import of the ticked boreholes
 * with the user's confirmations. The report is uploaded ONCE; every later call
 * names it by the SHA-256 the triage answered with.
 *
 * The import answers like ``POST /borehole/import`` (the DOV XML file import):
 * one entry per borehole with its flags, a ``409`` that asks before replacing
 * a borehole already in the project, and a ``422`` that refuses a borehole
 * whose assumed CRS or water unit was not confirmed.
 *
 * @module clients/boreholePdf
 */

import { messageForDetail } from './apiCodeMessages'
import {
  BoreholeRefreshConfirmationRequiredError,
  toRefreshDiff,
  type ImportBoreholeFileResponse,
} from './borehole'
import { _base, ApiError, detailMessage, fetchTracked } from './shared'

/** One finding of a triaged borehole (backend ``ValidationIssue``). */
export interface BoreholePdfFinding {
  level: string
  code: string
  message: string
  params?: Record<string, unknown>
}

/** One borehole the triage lists. */
export interface BoreholePdfRow {
  /** ``"<name>@p<first page>"``: unique in the report. */
  key: string
  name: string
  profile: string
  pages: number[]
  /** ``text`` or ``ocr``. */
  text_verdict: string
  parses_rows: boolean
  x: number | null
  y: number | null
  epsg: number | null
  /** X/Y printed without a named system: read as Lambert 72, to confirm. */
  crs_assumed: boolean
  ground_level_m: number | null
  z_epsg: number | null
  date_text: string | null
  date_iso: string | null
  driller: string | null
  project_code: string | null
  project_name: string | null
  depth_top_m: number | null
  depth_base_m: number | null
  /** The key of the other print of this borehole when the two differ. */
  repeat_of: string | null
  repeat_differences: Record<string, unknown>[]
  /** The profile read its rows (a triage-only layout lists, never imports). */
  parsed: boolean
  n_intervals: number
  n_samples: number
  water_level_m: number | null
  /** A water level without unit or reference: read as cm below ground, to confirm. */
  water_unit_assumed: boolean
  findings: BoreholePdfFinding[]
  /** Parsed, with a position and a ground level. */
  importable: boolean
}

/** A print set aside: an identical repeat. */
export interface BoreholePdfDropped {
  name: string
  pages: number[]
  reason: string
  kept_key?: string
  [extra: string]: unknown
}

/** What the triage found in one report. */
export interface BoreholePdfDigest {
  file_name: string
  file_sha: string
  page_count: number
  pages_not_triaged: number
  class_counts: Record<string, number>
  needs_ocr_pages: number[]
  ocr_available: boolean
  ocr_pages: number[]
  boreholes: BoreholePdfRow[]
  dropped: BoreholePdfDropped[]
}

/** The user's confirmation of the system of X/Y printed without one. */
export interface BoreholePdfCrsConfirmation {
  epsg: number
  /** ``this``: this borehole; ``report``: every borehole of the report. */
  scope: 'this' | 'report'
}

/** One ticked borehole of ``POST /borehole/pdf/import``. */
export interface BoreholePdfImportItem {
  key: string
  crs?: BoreholePdfCrsConfirmation | null
  water_unit_confirmed?: boolean
}

/** ``POST /borehole/pdf/import`` body. */
export interface BoreholePdfImportBody {
  project_id: string
  file_sha: string
  boreholes: BoreholePdfImportItem[]
  confirm_refresh?: boolean
}

/** Thrown when the import refuses a request as asked (``422``, nothing written). */
export class BoreholePdfImportRefusedError extends Error {
  code: string
  boreholes: Record<string, unknown>[]
  constructor(message: string, code: string, boreholes: Record<string, unknown>[]) {
    super(message)
    this.name = 'BoreholePdfImportRefusedError'
    this.code = code
    this.boreholes = boreholes
  }
}

/** Typed wrappers for the ``/borehole/pdf/*`` endpoints. */
export const boreholePdfClient = {
  /**
   * Upload a report and start its triage job.
   *
   * @returns ``{ job_id, file_sha }``; attach to {@link boreholePdfClient.streamUrl}.
   * @throws ApiError on a non-2xx answer (a 409 keeps ``detail.job_id``
   *   reachable so the hook attaches to the running job).
   */
  startTriage: async (
    filePath: string,
    projectId: string,
  ): Promise<{ job_id: string; file_sha: string }> => {
    // Read via IPC — fetch('file://') is blocked in the renderer sandbox.
    const buffer: Uint8Array = await window.electron.readFile(filePath)
    const fileName = filePath.split(/[\\/]/).pop() ?? 'report.pdf'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), fileName)
    form.append('project_id', projectId)
    const res = await fetchTracked(`${_base}/borehole/pdf/triage`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(
        messageForDetail(body.detail, detailMessage(body.detail) ?? `Triage failed: ${res.status}`),
        res.status,
        { detail: body.detail, method: 'POST', path: '/borehole/pdf/triage' },
      )
    }
    return res.json()
  },

  /** URL of a triage job's SSE progress stream. */
  streamUrl: (jobId: string): string => `${_base}/borehole/pdf/triage/${jobId}`,

  /** URL of a page thumbnail PNG. */
  pageUrl: (fileSha: string, page: number, projectId: string, dpi = 80): string =>
    `${_base}/borehole/pdf/page/${fileSha}/${page}.png?project_id=${projectId}&dpi=${dpi}`,

  /**
   * Fetch a page thumbnail PNG as a Blob (shown through an object URL: the CSP
   * blocks an ``<img>`` on the local http backend).
   *
   * @throws ApiError on a non-2xx answer.
   */
  pageBlob: async (fileSha: string, page: number, projectId: string, dpi = 80): Promise<Blob> => {
    const res = await fetchTracked(boreholePdfClient.pageUrl(fileSha, page, projectId, dpi))
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(
        messageForDetail(body.detail, detailMessage(body.detail) ?? `Page thumbnail failed: ${res.status}`),
        res.status,
        { detail: body.detail, method: 'GET', path: `/borehole/pdf/page/${fileSha}/${page}.png` },
      )
    }
    return res.blob()
  },

  /**
   * Import the ticked boreholes.
   *
   * @returns One entry per borehole with its flags (the DOV XML import's shape).
   * @throws BoreholeRefreshConfirmationRequiredError on the 409 that asks
   *   before replacing boreholes already in the project (nothing written).
   * @throws BoreholePdfImportRefusedError on a 422 refusal (nothing written).
   * @throws ApiError on any other non-2xx answer.
   */
  importBoreholes: async (body: BoreholePdfImportBody): Promise<ImportBoreholeFileResponse> => {
    const res = await fetchTracked(`${_base}/borehole/pdf/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      const detail = payload.detail
      if (res.status === 409 && detail?.code === 'borehole_refresh_confirmation_required') {
        const diffs = Array.isArray(detail.diffs) ? detail.diffs : []
        throw new BoreholeRefreshConfirmationRequiredError(diffs.map(toRefreshDiff))
      }
      const message = messageForDetail(detail, detailMessage(detail) ?? `Import failed: ${res.status}`)
      if (res.status === 422 && typeof detail?.code === 'string') {
        throw new BoreholePdfImportRefusedError(
          message,
          detail.code,
          Array.isArray(detail.boreholes) ? detail.boreholes : [],
        )
      }
      throw new ApiError(message, res.status, {
        detail,
        method: 'POST',
        path: '/borehole/pdf/import',
      })
    }
    return res.json()
  },
}
