// The per-row notes of the PDF triage list, said in the app language.
//
// The triage backend builds each note twice: an English sentence in
// ``warnings`` (what an older client renders) and a stable code + params in
// ``notes`` (``ReportSoundingNote``). The sentence the user reads is chosen
// here, at the presentation boundary, from the ``cptPdf.note.<code>`` keys of
// the EN/NL catalogues (owner dogfeed 2026-10-04: the rows read English inside
// the Dutch app). A code this build does not know keeps the backend's English
// sentence instead of rendering a raw key.
import type { CptPdfNote, CptPdfSounding } from '../api/clients/cptPdf'
import type { MessageKey } from '../i18n/locales/en'
import type { MessageParams, Translator } from '../i18n/translate'

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
}

/** The ``[top, base]`` pairs of a ``DRILLED_INTERVALS`` note, or null when malformed. */
function drilledIntervals(params: Record<string, unknown>): Array<[number, number]> | null {
  const raw = params.intervals
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: Array<[number, number]> = []
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [top, base] = pair as unknown[]
    if (typeof top !== 'number' || typeof base !== 'number') return null
    out.push([top, base])
  }
  return out
}

/**
 * The params of a note as its sentence shows them. A drilled-interval note
 * carries its stretches as a list; the sentence names each one ("32.0 to
 * 32.3 m", one decimal) joined by commas, in the app language.
 *
 * @returns The message params, or null when the note's params are malformed.
 */
function noteParams(note: CptPdfNote, t: Translator): MessageParams | null {
  const params = note.params ?? {}
  if (note.code !== 'DRILLED_INTERVALS') return messageParams(params)
  const intervals = drilledIntervals(params)
  if (intervals === null) return null
  const list = intervals
    .map(([top, base]) => t('cptPdf.drilledInterval', { top: top.toFixed(1), base: base.toFixed(1) }))
    .join(', ')
  return { ...messageParams(params), list }
}

/** Keep only the params a message can show (strings and numbers). */
function messageParams(params: Record<string, unknown>): MessageParams {
  const out: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') out[name] = value
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
  const key = Object.prototype.hasOwnProperty.call(NOTE_KEYS, note.code) ? NOTE_KEYS[note.code] : undefined
  if (key === undefined) return fallback || note.code
  const params = noteParams(note, t)
  if (params === null) return fallback || note.code
  return t(key, params)
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
