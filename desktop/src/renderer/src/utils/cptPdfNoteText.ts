// The PDF remarks said in the app language: the per-row notes of the triage
// list and the per-sounding issues of the import report.
//
// The backend builds each remark twice: an English sentence (what an older
// client renders) and a stable code + params. The sentence the user reads is
// chosen here, at the presentation boundary, from the ``cptPdf.note.<code>`` /
// ``cptPdf.issue.<code>`` keys of the EN/NL catalogues (owner dogfeed
// 2026-10-04: the triage rows and the import report read English inside the
// Dutch app). A code this build does not know, or a remark whose params do not
// fill every slot of its sentence, keeps the backend's English sentence
// instead of rendering a raw key or a bare ``{placeholder}``.
import type { CptPdfImportIssue, CptPdfNote, CptPdfSounding } from '../api/clients/cptPdf'
import type { MessageKey } from '../i18n/locales/en'
import type { MessageParams, Translator } from '../i18n/translate'
import { drilledIntervalsText, parseDrilledIntervals } from './drilledIntervals'

/** Catalogue key per known note code. A typed map, so a key missing from the
 *  EN catalogue is a ``tsc`` error rather than a key rendered on screen. */
const NOTE_KEYS: Readonly<Record<string, MessageKey>> = {
  TICKS_UNAVAILABLE_NO_OCR: 'cptPdf.note.TICKS_UNAVAILABLE_NO_OCR',
  TICKS_NOT_READ: 'cptPdf.note.TICKS_NOT_READ',
  NO_POSITION_PRINTED: 'cptPdf.note.NO_POSITION_PRINTED',
  ELEVATION_AXIS: 'cptPdf.note.ELEVATION_AXIS',
  ELEVATION_AXIS_NO_GROUND_LEVEL: 'cptPdf.note.ELEVATION_AXIS_NO_GROUND_LEVEL',
  CLIPPED_POINTS: 'cptPdf.note.CLIPPED_POINTS',
  READ_FROM_IMAGE: 'cptPdf.note.READ_FROM_IMAGE',
  DRILLED_INTERVALS: 'cptPdf.note.DRILLED_INTERVALS',
  SHEET_AXIS_GAP: 'cptPdf.note.SHEET_AXIS_GAP',
  COORDINATE_OUT_OF_RANGE: 'cptPdf.note.COORDINATE_OUT_OF_RANGE',
  READ_FROM_PRINTED_TABLE: 'cptPdf.note.READ_FROM_PRINTED_TABLE',
  TABLE_ROWS_REJECTED: 'cptPdf.note.TABLE_ROWS_REJECTED',
  TABLE_RF_MISMATCH: 'cptPdf.note.TABLE_RF_MISMATCH',
  PRE_DRILL_FLOOR_ROWS: 'cptPdf.note.PRE_DRILL_FLOOR_ROWS',
}

/** Catalogue key per known import-issue code (``POST /cpt/pdf/import``). */
const ISSUE_KEYS: Readonly<Record<string, MessageKey>> = {
  PDF_CLIPPED_POINTS: 'cptPdf.issue.PDF_CLIPPED_POINTS',
  PDF_DEPTH_FROM_ELEVATION: 'cptPdf.issue.PDF_DEPTH_FROM_ELEVATION',
  PDF_DRILLED_INTERVALS: 'cptPdf.issue.PDF_DRILLED_INTERVALS',
  PDF_NO_XY: 'cptPdf.issue.PDF_NO_XY',
  PDF_OCR_UNAVAILABLE: 'cptPdf.issue.PDF_OCR_UNAVAILABLE',
  PDF_TABLE_RF_MISMATCH: 'cptPdf.issue.PDF_TABLE_RF_MISMATCH',
  PDF_TABLE_LEVEL_MISMATCH: 'cptPdf.issue.PDF_TABLE_LEVEL_MISMATCH',
  PDF_TABLE_ROWS_REJECTED: 'cptPdf.issue.PDF_TABLE_ROWS_REJECTED',
  PDF_TABLE_COLUMNS_NOT_IMPORTED: 'cptPdf.issue.PDF_TABLE_COLUMNS_NOT_IMPORTED',
  PDF_TABLE_PRE_DRILL_FLOOR_ROWS: 'cptPdf.issue.PDF_TABLE_PRE_DRILL_FLOOR_ROWS',
  PDF_TABLE_QTOTAL_CONE_AREA: 'cptPdf.issue.PDF_TABLE_QTOTAL_CONE_AREA',
}

/** A ``{name}`` slot interpolation left unfilled. */
const UNFILLED_SLOT = /\{\w+\}/

/**
 * The params of a remark as its sentence shows them. A remark that carries
 * drilled stretches (``intervals``) names each one ("32.0 to 32.3 m", one
 * decimal) joined by commas under ``list``, in the app language.
 *
 * The axis depths of a sheet axis gap (``d1``, ``d2``) and the first real row
 * of a printed table (``depth``) are written to the centimetre. A list of
 * printed column names (``columns``) is written comma-separated.
 *
 * @returns The message params, or null when the ``intervals`` are malformed or empty.
 */
function remarkParams(params: Record<string, unknown>, t: Translator): MessageParams | null {
  if (!Object.prototype.hasOwnProperty.call(params, 'intervals')) {
    return axisDepthParams(messageParams(params))
  }
  const intervals = parseDrilledIntervals(params.intervals)
  if (intervals === null || intervals.length === 0) return null
  return { ...messageParams(params), list: drilledIntervalsText(intervals, t) }
}

/**
 * One coded remark in the app language.
 *
 * @param keys - The catalogue key per known code.
 * @param code - The remark's stable code.
 * @param params - The values its sentence names.
 * @param fallback - The backend's English sentence for the same remark.
 * @param t - The active-language translator.
 * @returns The translated sentence; ``fallback`` (else the code) for an
 *   unknown code or params that leave a slot of the sentence unfilled.
 */
function codedText(
  keys: Readonly<Record<string, MessageKey>>,
  code: string,
  params: Record<string, unknown>,
  fallback: string,
  t: Translator,
): string {
  const key = Object.prototype.hasOwnProperty.call(keys, code) ? keys[code] : undefined
  if (key === undefined) return fallback || code
  const filled = remarkParams(params, t)
  if (filled === null) return fallback || code
  const text = t(key, filled)
  return UNFILLED_SLOT.test(text) ? fallback || code : text
}

/** The params that name a depth read to the centimetre: ``SHEET_AXIS_GAP``
 *  (where one sheet's axis ends, where the next one's starts) and
 *  ``PRE_DRILL_FLOOR_ROWS`` (the first real row of a printed table). */
const CENTIMETRE_DEPTH_PARAMS = ['d1', 'd2', 'depth'] as const

/** Write those depths to the centimetre, as the backend's English sentence. */
function axisDepthParams(params: MessageParams): MessageParams {
  const out: Record<string, string | number> = { ...params }
  for (const name of CENTIMETRE_DEPTH_PARAMS) {
    const value = out[name]
    if (typeof value === 'number') out[name] = value.toFixed(2)
  }
  return out
}

/** Keep only the params a message can show: strings, numbers, and a list of
 *  strings (printed column names) written comma-separated. */
function messageParams(params: Record<string, unknown>): MessageParams {
  const out: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') out[name] = value
    else if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
      out[name] = value.join(', ')
    }
  }
  return out
}

/**
 * One note in the app language.
 *
 * @param note - The note's code and params.
 * @param fallback - The backend's English sentence for the same note.
 * @param t - The active-language translator.
 * @returns The translated sentence, or ``fallback`` for an unknown code.
 */
export function cptPdfNoteText(note: CptPdfNote, fallback: string, t: Translator): string {
  return codedText(NOTE_KEYS, note.code, note.params ?? {}, fallback, t)
}

/**
 * One issue of a PDF import result in the app language.
 *
 * @param issue - The issue's code, English ``message`` and, from a current
 *   backend, its ``params``.
 * @param t - The active-language translator.
 * @returns The translated sentence, or the English ``message`` for an unknown
 *   code or an issue from a backend that sent no params.
 */
export function cptPdfIssueText(
  issue: Pick<CptPdfImportIssue, 'code' | 'message' | 'params'>,
  t: Translator,
): string {
  return codedText(ISSUE_KEYS, issue.code, issue.params ?? {}, issue.message, t)
}

/**
 * The notes of one triage row, in order, in the app language.
 *
 * @param sounding - The row's English ``warnings`` and, from a current backend, its ``notes``.
 * @param t - The active-language translator.
 * @returns One sentence per note; the English ``warnings`` as they are when the
 *   backend sent no notes.
 */
export function cptPdfNoteTexts(
  sounding: Pick<CptPdfSounding, 'warnings' | 'notes'>,
  t: Translator,
): string[] {
  const notes = sounding.notes ?? []
  if (notes.length === 0) return [...sounding.warnings]
  return notes.map((note, i) => cptPdfNoteText(note, sounding.warnings[i] ?? '', t))
}
