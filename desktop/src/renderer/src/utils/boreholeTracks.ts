/**
 * Borehole tracks as the track editor sees them (owner 2026-09-29: "i want to
 * be able to add or change any track").
 *
 * A track is one observation stream (coded lithology, a description, a
 * stratigraphy, ...) or one field-log kind (colour / moisture / consistency).
 * This module turns a borehole detail into the track list (with provenance
 * badge and the "drawn in sections" flag), holds the editor's row model, and
 * mirrors the backend's interval rules (``domain/services/
 * validate_track_intervals.py``) so the editor can point at a bad cell before
 * the round-trip. The backend stays the authority: a 422 from it is shown too.
 */

import type {
  AdmixtureResponse,
  BoreholeDetailResponse,
  TrackIntervalBody,
} from '../api/clients/borehole'
import { parseDescribedLithology, type SoilApproximation } from './describedLithologyToCodes'
import type { CodelistField } from './dovTrackCodelists'
import { MAX_ADMIXTURES_PER_INTERVAL, TRACK_DEPTH_DECIMALS } from './dovTrackCodelists_constants'

export { MAX_ADMIXTURES_PER_INTERVAL }

/** Which ORM family a track lives in. */
export type TrackFamily = 'observation' | 'field_log'

/** Provenance badge: an untouched import, a hand-made track, or an edited import. */
export type TrackBadge = 'dov' | 'manual' | 'edited'

/** What a row of a kind carries. */
export type TrackContent = 'coded' | 'value' | 'text'

/** Observation kinds, in the borelog's column order. */
export const OBSERVATION_TRACK_KINDS = [
  'coded_lithology',
  'geotechnical_coding',
  'lithological_description',
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
] as const

/** Field-log kinds (one track per kind per borehole). */
export const FIELD_LOG_TRACK_KINDS = ['color', 'moisture', 'consistency'] as const

/** Every kind the "Add track" picker offers. */
export const TRACK_KINDS: readonly string[] = [...OBSERVATION_TRACK_KINDS, ...FIELD_LOG_TRACK_KINDS]

const FIELD_LOG_KIND_SET = new Set<string>(FIELD_LOG_TRACK_KINDS)
const CODED_KIND_SET = new Set<string>(['coded_lithology', 'geotechnical_coding'])

/** Synthetic id prefix of a field-log track (the backend's ``FIELD_LOG_TRACK_ID_PREFIX``). */
export const FIELD_LOG_TRACK_ID_PREFIX = 'field_log:'

/** @returns the ORM family of ``kind``. */
export function trackFamily(kind: string): TrackFamily {
  return FIELD_LOG_KIND_SET.has(kind) ? 'field_log' : 'observation'
}

/** @returns what a row of ``kind`` carries (codes, a value, or text). */
export function trackContent(kind: string): TrackContent {
  if (FIELD_LOG_KIND_SET.has(kind)) return 'value'
  if (CODED_KIND_SET.has(kind)) return 'coded'
  return 'text'
}

/**
 * The provenance badge of a track.
 *
 * @param source - ``"dov"`` / ``"manual"``; absent reads as an import.
 * @param editedAt - Last track-editor save.
 */
export function trackBadge(source: string | undefined, editedAt: string | null | undefined): TrackBadge {
  if (source === 'manual') return 'manual'
  return editedAt ? 'edited' : 'dov'
}

/** One row of the Tracks list. */
export interface BoreholeTrackSummary {
  trackId: string
  kind: string
  family: TrackFamily
  badge: TrackBadge
  editedAt: string | null
  intervalCount: number
  /** True for the track the sections draw for its kind (the first of its kind
   *  in the backend's preference order). */
  drawnInSections: boolean
  intervals: TrackIntervalBody[]
}

/**
 * The borehole's tracks, in the detail's order (observations, then field logs).
 *
 * The backend orders observations so each kind's preferred track comes first
 * (manual, then newest edited, then date order) — so the first of a kind is
 * the one every consumer draws.
 *
 * @param detail - Borehole detail from ``GET /borehole/{id}``.
 * @returns One summary per track.
 */
export function listBoreholeTracks(detail: BoreholeDetailResponse): BoreholeTrackSummary[] {
  const seenKinds = new Set<string>()
  const out: BoreholeTrackSummary[] = []
  for (const obs of detail.observations) {
    const drawn = !seenKinds.has(obs.observation_type)
    seenKinds.add(obs.observation_type)
    out.push({
      trackId: obs.id,
      kind: obs.observation_type,
      family: 'observation',
      badge: trackBadge(obs.source, obs.edited_manually_at),
      editedAt: obs.edited_manually_at ?? null,
      intervalCount: obs.layers.length,
      drawnInSections: drawn,
      intervals: obs.layers.map(l => ({
        top_m: l.top_m,
        base_m: l.base_m,
        color: l.color,
        main_soil_codes: l.main_soil_codes,
        description: l.description,
        admixtures: l.admixtures,
      })),
    })
  }
  const byKind = new Map<string, BoreholeDetailResponse['field_log_intervals']>()
  for (const r of detail.field_log_intervals) {
    const rows = byKind.get(r.kind) ?? []
    rows.push(r)
    byKind.set(r.kind, rows)
  }
  for (const [kind, rows] of byKind) {
    const stamps = rows.map(r => r.edited_manually_at).filter((s): s is string => !!s).sort()
    const editedAt = stamps.length > 0 ? stamps[stamps.length - 1] : null
    const source = rows.some(r => r.source === 'manual') ? 'manual' : 'dov'
    const sorted = [...rows].sort((a, b) => a.top_m - b.top_m)
    out.push({
      trackId: `${FIELD_LOG_TRACK_ID_PREFIX}${kind}`,
      kind,
      family: 'field_log',
      badge: trackBadge(source, editedAt),
      editedAt,
      intervalCount: rows.length,
      drawnInSections: true,
      intervals: sorted.map(r => ({ top_m: r.top_m, base_m: r.base_m, value: r.value })),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Editor rows
// ---------------------------------------------------------------------------

/** One admixture of an editor row (raw DOV tokens). */
export type TrackAdmixtureRow = AdmixtureResponse

/** One row of the interval editor. Depths are the typed TEXT until saved. */
export interface TrackEditorRow {
  key: string
  top: string
  base: string
  value: string
  description: string
  color: string
  /** One or two equally-dominant main soils (DOV repeats <hoofdnaam>). */
  mainSoil: string[]
  admixtures: TrackAdmixtureRow[]
  /** Editor-only, never saved: the verbatim description a row's codes were
   *  read from ("Start from" a description track, owner 2026-10-01). */
  sourceText?: string
  /** Editor-only: the codes read from ``sourceText`` still wait for the
   *  person's check; Save is blocked while any row says so. */
  needsCheck?: boolean
  /** Editor-only: what the reading of ``sourceText`` could not place. */
  parseNotes?: DescriptionParseNotes
}

/** What reading a description left for the person to see (editor-only). */
export interface DescriptionParseNotes {
  /** Clauses that produced no code. */
  unmatched: string[]
  /** Soil names mapped to the nearest code (no exact DOV code). */
  approximations: SoilApproximation[]
  /** Recognised DOV moisture token a coded track does not store, or ``''``. */
  moisture: string
  /** Recognised DOV consistency token a coded track does not store, or ``''``. */
  consistency: string
}

let rowSeq = 0
function nextKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

/** An empty editor row. */
export function emptyRow(top = ''): TrackEditorRow {
  return {
    key: nextKey(),
    top,
    base: '',
    value: '',
    description: '',
    color: '',
    mainSoil: [''],
    admixtures: [],
  }
}

/**
 * The row the "Add interval" button appends: it starts where the last row ended
 * (the collar for an empty track), so typing a column is one depth per row.
 */
export function newRowAfter(rows: readonly TrackEditorRow[]): TrackEditorRow {
  const last = rows[rows.length - 1]
  return emptyRow(last ? last.base : '0')
}

/** Editor rows from stored intervals. */
export function rowsFromIntervals(intervals: readonly TrackIntervalBody[]): TrackEditorRow[] {
  return intervals.map(i => ({
    key: nextKey(),
    top: String(i.top_m),
    base: String(i.base_m),
    value: i.value ?? '',
    description: i.description ?? '',
    color: i.color ?? '',
    mainSoil: i.main_soil_codes && i.main_soil_codes.length > 0 ? [...i.main_soil_codes] : [''],
    admixtures: (i.admixtures ?? []).map(a => ({ ...a })),
  }))
}

/** Parse a typed depth; ``null`` when it is not a finite number. Accepts a comma. */
export function parseDepth(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** Snap a depth to the 1 mm grain (backend ``LITHO_LAYER_DEPTH_DECIMALS``). */
export function snapDepth(depth: number): number {
  const f = 10 ** TRACK_DEPTH_DECIMALS
  return Math.round(depth * f) / f
}

/**
 * The request intervals for ``kind`` from the editor rows (grain applied,
 * depth-ordered, only the fields the kind carries).
 */
export function rowsToIntervals(kind: string, rows: readonly TrackEditorRow[]): TrackIntervalBody[] {
  const content = trackContent(kind)
  const intervals = rows.map((r): TrackIntervalBody => {
    const top_m = snapDepth(parseDepth(r.top) ?? 0)
    const base_m = snapDepth(parseDepth(r.base) ?? 0)
    if (content === 'value') return { top_m, base_m, value: r.value.trim() }
    if (content === 'text') return { top_m, base_m, description: r.description.trim() }
    return {
      top_m,
      base_m,
      color: r.color.trim() || null,
      main_soil_codes: r.mainSoil.map(c => c.trim()).filter(c => c !== ''),
      admixtures: r.admixtures.filter(a => a.soil_code.trim() !== ''),
    }
  })
  return intervals.sort((a, b) => a.top_m - b.top_m || a.base_m - b.base_m)
}

// ---------------------------------------------------------------------------
// Validation (mirror of the backend rules)
// ---------------------------------------------------------------------------

/** The editor column an issue points at. */
export type TrackIssueField =
  | 'top'
  | 'base'
  | 'value'
  | 'description'
  | 'color'
  | 'mainSoil'
  | 'admixtures'
  | 'track'

/** One finding, in editor terms; ``code`` is translated by the UI. */
export interface TrackRowIssue {
  /** Zero-based row index; ``null`` for a track-level finding. */
  row: number | null
  field: TrackIssueField
  code: string
  params?: Record<string, string | number>
}

/** The verdict on the editor rows. */
export interface TrackRowsVerdict {
  errors: TrackRowIssue[]
  warnings: TrackRowIssue[]
}

/**
 * Judge the editor rows the way the backend will.
 *
 * @param kind - Track kind.
 * @param rows - The editor rows, in display order.
 * @param opts.totalDepthM - The borehole's drilled depth (warn below it).
 * @param opts.allowed - Allowed tokens per field (``null`` = free text); see
 *   ``allowedTokens`` in ``dovTrackCodelists.ts``.
 * @returns Blocking errors and non-blocking warnings.
 */
export function validateTrackRows(
  kind: string,
  rows: readonly TrackEditorRow[],
  opts: {
    totalDepthM: number | null
    allowed: (field: CodelistField) => ReadonlySet<string> | null
  },
): TrackRowsVerdict {
  const errors: TrackRowIssue[] = []
  const warnings: TrackRowIssue[] = []
  if (rows.length === 0) {
    errors.push({ row: null, field: 'track', code: 'no_intervals' })
    return { errors, warnings }
  }
  const content = trackContent(kind)
  const wellFormed: Array<{ row: number; top: number; base: number }> = []

  const checkToken = (row: number, field: TrackIssueField, codelist: CodelistField, token: string) => {
    const allowed = opts.allowed(codelist)
    if (allowed !== null && token !== '' && !allowed.has(token)) {
      errors.push({ row, field, code: 'not_in_codelist', params: { row: row + 1, token } })
    }
  }

  rows.forEach((r, index) => {
    const rowNo = index + 1
    const topRaw = parseDepth(r.top)
    const baseRaw = parseDepth(r.base)
    let shapeOk = true
    if (topRaw === null || baseRaw === null) {
      errors.push({ row: index, field: topRaw === null ? 'top' : 'base', code: 'invalid_number', params: { row: rowNo } })
      shapeOk = false
    } else {
      const top = snapDepth(topRaw)
      const base = snapDepth(baseRaw)
      if (top < 0) {
        errors.push({ row: index, field: 'top', code: 'negative_depth', params: { row: rowNo } })
        shapeOk = false
      } else if (base <= top) {
        errors.push({ row: index, field: 'base', code: 'base_not_below_top', params: { row: rowNo } })
        shapeOk = false
      }
      if (shapeOk) wellFormed.push({ row: index, top, base })
    }

    if (content === 'value') {
      if (r.value.trim() === '') errors.push({ row: index, field: 'value', code: 'missing_value', params: { row: rowNo } })
      else checkToken(index, 'value', 'value', r.value.trim())
    } else if (content === 'text') {
      if (r.description.trim() === '') {
        errors.push({ row: index, field: 'description', code: 'missing_description', params: { row: rowNo } })
      } else checkToken(index, 'description', 'description', r.description.trim())
    } else {
      const soils = r.mainSoil.map(c => c.trim()).filter(c => c !== '')
      if (soils.length === 0) {
        errors.push({ row: index, field: 'mainSoil', code: 'missing_main_soil_code', params: { row: rowNo } })
      }
      soils.forEach(code => checkToken(index, 'mainSoil', 'mainSoil', code))
      if (r.color.trim() !== '') checkToken(index, 'color', 'colour', r.color.trim())
      const filled = r.admixtures.filter(a => a.soil_code.trim() !== '').length
      if (filled > MAX_ADMIXTURES_PER_INTERVAL) {
        errors.push({
          row: index,
          field: 'admixtures',
          code: 'too_many_admixtures',
          params: { row: rowNo, n: MAX_ADMIXTURES_PER_INTERVAL },
        })
      }
      for (const adm of r.admixtures) {
        if (adm.soil_code.trim() === '') continue
        checkToken(index, 'admixtures', 'admixtureSoil', adm.soil_code.trim())
        const amounts = opts.allowed('admixtureAmount')
        if (amounts !== null && !amounts.has(adm.amount)) {
          errors.push({ row: index, field: 'admixtures', code: 'not_in_codelist', params: { row: rowNo, token: adm.amount } })
        }
      }
    }
  })

  const ordered = [...wellFormed].sort((a, b) => a.top - b.top || a.base - b.base)
  for (let i = 1; i < ordered.length; i++) {
    const above = ordered[i - 1]
    const below = ordered[i]
    if (below.top < above.base) {
      errors.push({ row: below.row, field: 'top', code: 'intervals_overlap', params: { row: below.row + 1 } })
    } else if (below.top > above.base) {
      warnings.push({ row: below.row, field: 'top', code: 'gap_between_intervals', params: { row: below.row + 1 } })
    }
  }
  if (opts.totalDepthM !== null && ordered.length > 0) {
    const deepest = ordered.reduce((a, b) => (b.base > a.base ? b : a))
    if (deepest.base > snapDepth(opts.totalDepthM)) {
      warnings.push({
        row: deepest.row,
        field: 'base',
        code: 'below_total_depth',
        params: { row: deepest.row + 1, depth: opts.totalDepthM },
      })
    }
  }
  return { errors, warnings }
}

// ---------------------------------------------------------------------------
// "Start from" a track (owner 2026-09-30: "it would be nice to be able to copy
// another track as template")
// ---------------------------------------------------------------------------

/** The track a new one is started from: its kind and its intervals. */
export interface TrackTemplate {
  kind: string
  intervals: readonly TrackIntervalBody[]
}

/**
 * Editor rows for a new track of ``kind`` started from ``template``.
 *
 * The depths are always copied. The content is copied only where the new kind
 * carries the same thing, so the rows never start with values the kind's
 * codelist would refuse:
 *
 * * coded <- coded: main soils, colour and admixtures (at most
 *   ``MAX_ADMIXTURES_PER_INTERVAL``);
 * * coded lithology <- a lithological description: the codes are READ from
 *   the text (``parseDescribedLithology``, owner 2026-10-01 "parse the
 *   description into codes"); each row keeps the text and needs a check;
 * * text <- text: the description, except into a formal stratigraphy (its cells
 *   are DOV unit codes, never free text) unless the template is one too;
 * * field log <- the same field-log kind: the value; a colour field log <- a
 *   coded track: the coded colour (both use DOV's colour list);
 * * everything else: depths only.
 *
 * @param kind - Kind of the new track.
 * @param template - The track to start from.
 * @returns One editor row per template interval, depth-ordered.
 */
export function rowsFromTemplate(kind: string, template: TrackTemplate): TrackEditorRow[] {
  const target = trackContent(kind)
  const source = trackContent(template.kind)
  const sorted = [...template.intervals].sort((a, b) => a.top_m - b.top_m || a.base_m - b.base_m)
  return sorted.map(i => {
    const r = emptyRow(String(i.top_m))
    r.base = String(i.base_m)
    if (target === 'coded' && source === 'coded') {
      r.mainSoil = i.main_soil_codes && i.main_soil_codes.length > 0 ? [...i.main_soil_codes] : ['']
      r.color = i.color ?? ''
      r.admixtures = (i.admixtures ?? []).slice(0, MAX_ADMIXTURES_PER_INTERVAL).map(a => ({ ...a }))
    } else if (kind === 'coded_lithology' && template.kind === 'lithological_description') {
      fillFromDescription(r, i.description ?? '')
    } else if (target === 'text' && source === 'text') {
      if (kind !== 'formal_stratigraphy' || template.kind === kind) r.description = i.description ?? ''
    } else if (target === 'value') {
      if (template.kind === kind) r.value = i.value ?? ''
      else if (kind === 'color' && source === 'coded') r.value = i.color ?? ''
    }
    return r
  })
}

/**
 * Fill a coded row from a DOV description and mark it for the person's check
 * (owner 2026-10-01: "make sure the person using it checks everything").
 *
 * @param row - The row to fill (mutated: it is fresh from ``emptyRow``).
 * @param description - The template interval's description verbatim.
 */
function fillFromDescription(row: TrackEditorRow, description: string): void {
  const draft = parseDescribedLithology(description)
  row.mainSoil = draft.mainSoil.length > 0 ? draft.mainSoil : ['']
  row.color = draft.color
  row.admixtures = draft.admixtures
  row.sourceText = description
  row.needsCheck = true
  row.parseNotes = {
    unmatched: draft.unmatched,
    approximations: draft.approximations,
    moisture: draft.moisture,
    consistency: draft.consistency,
  }
}

/** The rows whose codes, read from a description, still wait for a check. */
export function rowsNeedingCheck(rows: readonly TrackEditorRow[]): number {
  return rows.filter(r => r.needsCheck === true).length
}

/** Every unmatched clause of the rows, once each, in row order. */
export function unmatchedClauses(rows: readonly TrackEditorRow[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    for (const clause of r.parseNotes?.unmatched ?? []) if (!out.includes(clause)) out.push(clause)
  }
  return out
}

// ---------------------------------------------------------------------------
// The reference pane (owner 2026-09-30: "When adding a coded lithology it
// would be nice to see the info that is already there in other tracks")
// ---------------------------------------------------------------------------

/**
 * One reference interval as a line of text: the field-log value, the
 * description, or the compact code (``FZ/MZ + KL(W, locally) · bruin``).
 * Raw DOV tokens: the pane shows what is stored, like the borelog's cells.
 *
 * @param interval - A stored interval of another track.
 * @param locallyWord - The translated word for a local admixture.
 * @returns The text shown after the depths.
 */
export function referenceIntervalText(interval: TrackIntervalBody, locallyWord = 'locally'): string {
  if (interval.value) return interval.value
  if (interval.description) return interval.description
  const soils = (interval.main_soil_codes ?? []).join('/')
  const admixtures = (interval.admixtures ?? []).map(a => {
    const qualifiers = [a.amount, a.locally ? locallyWord : ''].filter(q => q !== '')
    return qualifiers.length > 0 ? `${a.soil_code}(${qualifiers.join(', ')})` : a.soil_code
  })
  let text = soils
  if (admixtures.length > 0) text += ` + ${admixtures.join(', ')}`
  if (interval.color) text += ` · ${interval.color}`
  return text
}

/**
 * True when a reference interval shares a depth slice with the row being
 * typed. Touching intervals do not overlap (a 0-1.5 reference is not "at"
 * a 1.5-3.2 row). A row with only a valid top marks the interval that
 * contains that depth, so the pane follows the cursor from the first keystroke.
 *
 * @param interval - A reference interval.
 * @param row - The editor row that has the focus.
 */
export function referenceOverlapsRow(
  interval: Pick<TrackIntervalBody, 'top_m' | 'base_m'>,
  row: TrackEditorRow,
): boolean {
  const top = parseDepth(row.top)
  const base = parseDepth(row.base)
  if (top === null) return false
  if (base === null || base <= top) return interval.top_m <= top && top < interval.base_m
  return interval.top_m < base && interval.base_m > top
}
