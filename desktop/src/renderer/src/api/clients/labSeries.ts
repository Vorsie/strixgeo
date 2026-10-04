/**
 * Raw lab-series client — preview / import a raw lab export (oedometer
 * control listing, the newer oedometer module's raw export, triaxial per-point
 * dump), list a borehole's lab tests, read a sample's full readings, delete
 * one test.
 *
 * Mirrors ``src/groundmodel/api/routers/lab_series.py``. The import is a
 * two-step flow (owner Q4 2026-09-29: "ask user, to double check"): the
 * PREVIEW writes nothing and proposes the borehole and the sample; the IMPORT
 * stores the readings on the sample the user confirmed (or a new one).
 *
 * @module api/clients/labSeries
 */

import { messageForDetail } from './apiCodeMessages'
import { _base, del, detailMessage, fetchTracked, get } from './shared'

/** One parser finding, as the backend freezes it. */
export interface LabSeriesIssue {
  level: 'error' | 'warning' | 'info' | string
  code: string
  message: string
  rows: number[]
}

/** The lab's identity as written in the export. */
export interface LabSeriesIdentity {
  job_number: string | null
  borehole_name: string | null
  sequence_number: string | null
  sample_number: string | null
  depth_top_m: number | null
  depth_base_m: number | null
  visual_description: string | null
}

/** A sample on the proposed borehole, as the preview lists it. */
export interface LabSeriesPreviewSample {
  id: string
  depth_top_m: number
  depth_base_m: number
  sample_number: string | null
}

/** Response of ``POST /lab-series/preview`` — nothing has been written. */
export interface LabSeriesPreviewResponse {
  file_name: string
  kind: 'oedometer' | 'triaxial' | string
  source_format: string
  test_type_token: string | null
  identity: LabSeriesIdentity
  specimens: { label: string | null; n_stages: number; n_readings: number }[]
  borehole_candidates: { id: string; name: string }[]
  /** ``unique`` | ``ambiguous`` | ``none`` | ``chosen``. */
  borehole_match: string
  proposed_borehole_id: string | null
  samples: LabSeriesPreviewSample[]
  proposed_sample_id: string | null
  /** ``overlap`` | ``sample_number`` | ``none``. */
  sample_match: string
  create_sample_default: {
    depth_top_m: number
    depth_base_m: number
    sample_number: string | null
  } | null
  existing_test: { id: string; sample_id: string; same_content: boolean } | null
  issues: LabSeriesIssue[]
  has_errors: boolean
  /**
   * Set when no project borehole matched and DOV was asked for
   * ``<job>-<borehole>`` (owner 2026-09-30): ``fetched`` = imported into the
   * project and proposed; ``not_found`` = DOV has no such borehole;
   * ``unreachable`` = DOV timed out / no network / answered an error.
   */
  dov_lookup?: LabSeriesDovLookup | null
}

/** What the preview's DOV lookup of a missing borehole found. */
export interface LabSeriesDovLookup {
  status: 'fetched' | 'not_found' | 'unreachable' | string
  borehole_name: string
  borehole_id: string | null
}

/** Response of ``POST /lab-series/import``. */
export interface LabSeriesImportResponse {
  test_id: string
  sample_id: string
  kind: string
  created_sample: boolean
  refreshed: boolean
  unchanged: boolean
  has_errors: boolean
  issues: LabSeriesIssue[]
}

/** The confirmed target of an import. */
export interface LabSeriesImportTarget {
  boreholeId: string
  /** Attach to this existing sample … */
  sampleId?: string | null
  /** … or create a new one (with the lab's interval unless overridden). */
  createSample?: boolean
  sampleDepthTopM?: number | null
  sampleDepthBaseM?: number | null
  confirmRefresh?: boolean
}

/** The old-vs-new diff carried by a 409 refresh refusal. */
export interface LabSeriesRefreshDiff {
  testId: string
  oldNSpecimens: number
  newNSpecimens: number
  oldNReadings: number
  newNReadings: number
  oldSourceFileName: string
  newSourceFileName: string
}

/** Thrown when an import would replace a stored test: nothing was written. */
export class LabSeriesRefreshConfirmationRequiredError extends Error {
  readonly diff: LabSeriesRefreshDiff
  constructor(diff: LabSeriesRefreshDiff) {
    super(`lab test ${diff.testId} would be replaced`)
    this.name = 'LabSeriesRefreshConfirmationRequiredError'
    this.diff = diff
  }
}

/**
 * Thrown for a file whose format Strix does not read (400
 * ``lab_file_format_not_recognised``, owner ruling 2026-09-30). The dialog
 * words it in the user's language; the server's English message is kept.
 */
export class LabFileFormatNotRecognisedError extends Error {
  readonly fileName: string
  constructor(fileName: string, message?: string) {
    super(message ?? `${fileName}: file format not recognised`)
    this.name = 'LabFileFormatNotRecognisedError'
    this.fileName = fileName
  }
}

/** The stable code of an unknown-format refusal. */
const FORMAT_NOT_RECOGNISED = 'lab_file_format_not_recognised'

/** One channel: one value per reading of its stage. */
export interface LabSeriesChannel {
  channel_key: string
  source_label: string | null
  unit: string | null
  /** ``measured`` | ``lab_derived`` | ``derived``. */
  provenance: string
  values: (number | null)[]
  formula: string | null
  derivation_inputs: Record<string, unknown> | null
}

/** One stage (oedometer load step / triaxial shear). */
export interface LabSeriesStage {
  stage_index: number
  stage_kind: string
  direction_token: string | null
  hanger_load_kg: number | null
  target_stress_kpa: number | null
  height_at_start_mm: number | null
  lab_stage_settlement_mm: number | null
  lab_coefficient_label: string | null
  lab_coefficient: number | null
  started_at: string | null
  reading_timestamps: string[] | null
  point_numbers: number[] | null
  /** Readings repeating a timestamp at a dial re-zero — skip them in plots. */
  rezero_indices: number[]
  n_readings: number
  channels: LabSeriesChannel[]
}

/** One specimen. */
export interface LabSeriesSpecimen {
  specimen_label: string | null
  initial_height_mm: number | null
  initial_diameter_mm: number | null
  initial_wet_mass_g: number | null
  dry_mass_g: number | null
  initial_water_content_pct: number | null
  grain_density_t_m3: number | null
  strain_rate_mm_per_min: number | null
  consolidation_stress_kpa: number | null
  failure_description: string | null
  n_points: number
  stages: LabSeriesStage[]
}

/** A value the lab reported — shown read-only, never used by Strix. */
export interface LabSeriesLabResult {
  specimen_label: string | null
  stage_index: number | null
  parameter: string
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  provenance: string
}

/** Response item of ``GET /samples/{id}/lab-series``. */
export interface LabSeriesTest {
  id: string
  sample_id: string
  kind: string
  test_type_token: string | null
  lab_job_number: string | null
  lab_sample_number: string | null
  lab_borehole_name: string | null
  sampling_depth_top_m: number | null
  sampling_depth_base_m: number | null
  visual_description: string | null
  source_format: string
  source_file_name: string
  source_native_file: string | null
  import_issues: LabSeriesIssue[]
  n_specimens: number
  specimens: LabSeriesSpecimen[]
  lab_results: LabSeriesLabResult[]
}

/** Response item of ``GET /lab-series?borehole_id=`` — counts, no readings. */
export interface LabSeriesTestSummary {
  id: string
  sample_id: string
  sample_depth_top_m: number
  sample_depth_base_m: number
  sample_number: string | null
  kind: string
  test_type_token: string | null
  lab_sample_number: string | null
  source_file_name: string
  n_specimens: number
  n_stages: number
  n_readings: number
  n_warnings: number
  n_errors: number
  /** The lab's test start date (ISO), null when the file had none. Additive: older backends omit it. */
  test_start_date?: string | null
}

/** Read a local file through IPC and wrap it as a multipart form. */
async function fileForm(filePath: string, fields: Record<string, string>): Promise<FormData> {
  // fetch('file://') is blocked in the renderer sandbox — read via IPC.
  const buffer: Uint8Array = await window.electron.readFile(filePath)
  const fileName = baseName(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)]), fileName)
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return form
}

/**
 * Throw the server's message for a non-2xx answer; an unknown file format
 * becomes a LabFileFormatNotRecognisedError for ``fileName``.
 */
async function throwFor(res: Response, fallback: string, fileName: string): Promise<never> {
  const body = await res.json().catch(() => ({}))
  const detail = body.detail
  if (detail && typeof detail === 'object' && detail.code === FORMAT_NOT_RECOGNISED) {
    throw new LabFileFormatNotRecognisedError(fileName, detailMessage(detail) ?? undefined)
  }
  // A known refusal code (the 409 ``lab_borehole_conflict``) reads in the
  // app's language; anything else keeps the server's message.
  throw new Error(messageForDetail(detail, detailMessage(detail) ?? `${fallback}: ${res.status}`))
}

/** The file name at the end of a path. */
function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export const labSeriesClient = {
  /** Parse one file and propose its borehole + sample. Writes nothing. */
  preview: async (
    filePath: string,
    projectId: string,
    boreholeId?: string | null,
  ): Promise<LabSeriesPreviewResponse> => {
    const fields: Record<string, string> = { project_id: projectId }
    if (boreholeId) fields.borehole_id = boreholeId
    const res = await fetchTracked(`${_base}/lab-series/preview`, {
      method: 'POST',
      body: await fileForm(filePath, fields),
    })
    if (!res.ok) return throwFor(res, 'Lab preview failed', baseName(filePath))
    return res.json()
  },

  /** Store the file on the confirmed target. 409 → a refresh needs consent. */
  import: async (
    filePath: string,
    projectId: string,
    target: LabSeriesImportTarget,
  ): Promise<LabSeriesImportResponse> => {
    const fields: Record<string, string> = {
      project_id: projectId,
      borehole_id: target.boreholeId,
    }
    if (target.sampleId) fields.sample_id = target.sampleId
    if (target.createSample) fields.create_sample = 'true'
    if (target.sampleDepthTopM != null) fields.sample_depth_top_m = String(target.sampleDepthTopM)
    if (target.sampleDepthBaseM != null)
      fields.sample_depth_base_m = String(target.sampleDepthBaseM)
    if (target.confirmRefresh) fields.confirm_refresh = 'true'
    const res = await fetchTracked(`${_base}/lab-series/import`, {
      method: 'POST',
      body: await fileForm(filePath, fields),
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}))
      const d = body.detail ?? {}
      if (d.code === 'lab_series_refresh_confirmation_required') {
        throw new LabSeriesRefreshConfirmationRequiredError({
          testId: d.test_id,
          oldNSpecimens: d.old_n_specimens ?? 0,
          newNSpecimens: d.new_n_specimens ?? 0,
          oldNReadings: d.old_n_readings ?? 0,
          newNReadings: d.new_n_readings ?? 0,
          oldSourceFileName: d.old_source_file_name ?? '',
          newSourceFileName: d.new_source_file_name ?? '',
        })
      }
      throw new Error(detailMessage(d) ?? 'Lab import refused')
    }
    if (!res.ok) return throwFor(res, 'Lab import failed', baseName(filePath))
    return res.json()
  },

  /** The borehole's lab tests with counts (no readings). */
  listForBorehole: (projectId: string, boreholeId: string): Promise<LabSeriesTestSummary[]> =>
    get<LabSeriesTestSummary[]>(
      `/lab-series?project_id=${encodeURIComponent(projectId)}&borehole_id=${encodeURIComponent(boreholeId)}`,
    ),

  /** Every lab test of a sample with every channel's values. */
  getForSample: (projectId: string, sampleId: string): Promise<LabSeriesTest[]> =>
    get<LabSeriesTest[]>(
      `/samples/${encodeURIComponent(sampleId)}/lab-series?project_id=${encodeURIComponent(projectId)}`,
    ),

  /**
   * Delete one lab test with its whole tree (irreversible — the caller
   * confirms first). Throws the server's message; 404 = not in the project.
   */
  deleteTest: (projectId: string, testId: string): Promise<void> =>
    del(`/lab-series/${encodeURIComponent(testId)}?project_id=${encodeURIComponent(projectId)}`),
}
