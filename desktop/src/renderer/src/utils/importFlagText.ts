// One import finding -> one sentence in the interface language.
//
// The DOV borehole XML import sends every finding as code + English message +
// structured ``params`` (backend ``ValidationIssue.params``). This module is
// the presentation boundary for those findings (owner dogfeed 2026-10-03:
// "the flag texts are English inside the NL report"): a per-code renderer
// reads the params and fills the ``importFlags.code.*`` catalogue entry.
//
// Fallback, by design: a code this table does not know, or a finding whose
// params are missing / malformed (an older backend), renders the backend's
// English message verbatim — a finding is never dropped or blanked.

import type { ImportFlag } from '../api/client'
import type { Translator } from '../i18n/translate'
import { EN, type MessageKey } from '../i18n/locales/en'

type Params = Record<string, unknown>
type Renderer = (p: Params, t: Translator) => string

/** Thrown by the param readers when a finding lacks a param its code needs. */
class MissingParam extends Error {}

function str(p: Params, key: string): string {
  const v = p[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  throw new MissingParam(key)
}

function optStr(p: Params, key: string): string | null {
  if (!(key in p)) throw new MissingParam(key)
  const v = p[key]
  return v === null || v === undefined || v === '' ? null : String(v)
}

function num(p: Params, key: string): number {
  const v = p[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  throw new MissingParam(key)
}

function optNum(p: Params, key: string): number | null {
  if (!(key in p)) throw new MissingParam(key)
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function list(p: Params, key: string): unknown[] {
  const v = p[key]
  if (Array.isArray(v)) return v
  throw new MissingParam(key)
}

/** Depths in the report keep the backend's two decimals (``0.50``). */
function metres(v: number): string {
  return v.toFixed(2)
}

/** A nullable depth: two decimals, or "not given". */
function optMetres(v: number | null, t: Translator): string {
  return v === null ? t('importFlags.p.notGiven') : metres(v)
}

/** Interpretation stream token (``formal_stratigraphy``) -> its borelog label. */
function streamLabel(stream: string, t: Translator): string {
  const key = `borelog.obs.${stream}`
  return key in EN ? t(key as MessageKey) : stream
}

/** Interval owner (``drill_segment`` / field-log kind / ``layer``) -> label. */
function partLabel(p: Params, t: Translator): string {
  const part = str(p, 'part')
  if (part === 'layer') {
    const index = p.layer_index
    return t('importFlags.part.layer', { index: typeof index === 'number' ? index : '?' })
  }
  const key = `importFlags.part.${part}`
  return key in EN ? t(key as MessageKey) : part
}

function reliabilitySubject(p: Params, t: Translator): string {
  const subject = str(p, 'subject')
  if (subject === 'position') return t('importFlags.subject.position')
  if (subject === 'elevation') return t('importFlags.subject.elevation')
  // An interpretation: its stream label + the DOV permkey (a DOV term, not chrome).
  return `${streamLabel(str(p, 'stream'), t)} (permkey ${optStr(p, 'permkey') ?? '?'})`
}

function gapPlaces(p: Params, t: Translator): string {
  const places = list(p, 'places').map(raw => {
    const place = raw as Params
    const kind = str(place, 'kind')
    const from = metres(num(place, 'from_m'))
    if (kind === 'start') return t('importFlags.place.start', { from })
    const to = metres(num(place, 'to_m'))
    return kind === 'gap'
      ? t('importFlags.place.gap', { from, to })
      : t('importFlags.place.overlap', { from, to })
  })
  const more = num(p, 'more')
  return places.join('; ') + (more > 0 ? t('importFlags.place.more', { n: more }) : '')
}

const RENDERERS: Record<string, Renderer> = {
  FILE_HOLDS_MANY_BORINGS: (p, t) =>
    t('importFlags.code.FILE_HOLDS_MANY_BORINGS', { count: num(p, 'count') }),
  NAME_FROM_ALTERNATIVE: (p, t) => {
    const alternatives = list(p, 'alternatives')
      .map(raw => {
        const alt = raw as Params
        return `${str(alt, 'name')} (${optStr(alt, 'type') ?? t('importFlags.p.noType')})`
      })
      .join('; ')
    return t('importFlags.code.NAME_FROM_ALTERNATIVE', { alternatives, testId: str(p, 'test_id') })
  },
  NO_LITHOLOGICAL_DESCRIPTION: (_p, t) => t('importFlags.code.NO_LITHOLOGICAL_DESCRIPTION'),
  MULTIPLE_LITHOLOGICAL_DESCRIPTIONS: (p, t) =>
    t('importFlags.code.MULTIPLE_LITHOLOGICAL_DESCRIPTIONS', {
      count: num(p, 'count'),
      usedLayers: num(p, 'used_layers'),
      usedPermkey: optStr(p, 'used_permkey') ?? '?',
      otherLayers: list(p, 'other_layers').map(String).join(', '),
    }),
  STRATIGRAPHY_PRESENT: (p, t) =>
    t('importFlags.code.STRATIGRAPHY_PRESENT', {
      stream: streamLabel(str(p, 'stream'), t),
      layers: num(p, 'layers'),
      permkey: optStr(p, 'permkey') ?? '?',
    }),
  RELIABILITY_NOT_GOOD: (p, t) =>
    t('importFlags.code.RELIABILITY_NOT_GOOD', {
      subject: reliabilitySubject(p, t),
      reliability: str(p, 'reliability'),
    }),
  ELEVATION_ZERO: (p, t) =>
    t('importFlags.code.ELEVATION_ZERO', {
      method: optStr(p, 'method') ?? t('importFlags.p.notGiven'),
    }),
  NO_FIELD_LOG: (_p, t) => t('importFlags.code.NO_FIELD_LOG'),
  DRILLMASTER_UNKNOWN: (p, t) => {
    const drillmaster = optStr(p, 'drillmaster')
    return drillmaster === null
      ? t('importFlags.code.DRILLMASTER_UNKNOWN.absent')
      : t('importFlags.code.DRILLMASTER_UNKNOWN', { drillmaster })
  },
  PURPOSE_NOT_GEOTECHNICAL: (p, t) => {
    const purpose = optStr(p, 'purpose')
    return purpose === null
      ? t('importFlags.code.PURPOSE_NOT_GEOTECHNICAL.absent')
      : t('importFlags.code.PURPOSE_NOT_GEOTECHNICAL', { purpose, expected: str(p, 'expected') })
  },
  REMARK_PRESENT: (p, t) => t('importFlags.code.REMARK_PRESENT', { remark: str(p, 'remark') }),
  ATTACHMENT_PRESENT: (p, t) =>
    t('importFlags.code.ATTACHMENT_PRESENT', {
      title: optStr(p, 'title') ?? t('importFlags.p.untitled'),
      url: optStr(p, 'url') ?? t('importFlags.p.noUrl'),
    }),
  DEPTH_MISMATCH: (p, t) => {
    const values = { total: metres(num(p, 'total_m')), end: metres(num(p, 'end_m')) }
    return str(p, 'against') === 'drill_segment'
      ? t('importFlags.code.DEPTH_MISMATCH.drill_segment', values)
      : t('importFlags.code.DEPTH_MISMATCH.lithological_description', values)
  },
  DATE_IN_FUTURE: (p, t) =>
    t('importFlags.code.DATE_IN_FUTURE', { date: str(p, 'date'), today: str(p, 'today') }),
  GROUNDWATER_ASSUMED: (p, t) => {
    const depth = optNum(p, 'depth_m')
    return t('importFlags.code.GROUNDWATER_ASSUMED', {
      depth: depth === null ? t('importFlags.p.notGiven') : `${metres(depth)} m`,
    })
  },
  START_DEPTH_NOT_ZERO: (p, t) =>
    t('importFlags.code.START_DEPTH_NOT_ZERO', { depth: metres(num(p, 'depth_m')) }),
  LITHOLOGY_GAPS_OR_OVERLAPS: (p, t) =>
    t('importFlags.code.LITHOLOGY_GAPS_OR_OVERLAPS', {
      count: num(p, 'count'),
      places: gapPlaces(p, t),
    }),
  UNKNOWN_INTERPRETATION_STREAM: (p, t) =>
    t('importFlags.code.UNKNOWN_INTERPRETATION_STREAM', { tag: str(p, 'tag') }),
  INTERPRETATION_WITHOUT_BORING: (p, t) =>
    t('importFlags.code.INTERPRETATION_WITHOUT_BORING', {
      count: num(p, 'count'),
      tags: list(p, 'tags').map(String).join(', '),
      boring: str(p, 'boring'),
    }),
  DUPLICATE_BORING_IN_FILE: (_p, t) => t('importFlags.code.DUPLICATE_BORING_IN_FILE'),
  INVALID_INTERVAL: (p, t) => {
    const reason = str(p, 'reason')
    const reasonKey = `importFlags.reason.${reason}`
    return t('importFlags.code.INVALID_INTERVAL', {
      part: partLabel(p, t),
      top: optMetres(optNum(p, 'top_m'), t),
      base: optMetres(optNum(p, 'base_m'), t),
      reason: reasonKey in EN ? t(reasonKey as MessageKey) : reason,
    })
  },
  NOT_IMPORTED: (_p, t) => t('importFlags.code.NOT_IMPORTED'),
  NO_COORDINATES: (_p, t) => t('importFlags.code.NO_COORDINATES'),
  ZERO_COORDINATES: (_p, t) => t('importFlags.code.ZERO_COORDINATES'),
  COORDINATES_OUTSIDE_CRS_BOUNDS: (p, t) =>
    t('importFlags.code.COORDINATES_OUTSIDE_CRS_BOUNDS', {
      x: num(p, 'x').toFixed(0),
      y: num(p, 'y').toFixed(0),
      crs: str(p, 'crs'),
    }),
  NO_TOTAL_DEPTH: (_p, t) => t('importFlags.code.NO_TOTAL_DEPTH'),
  NO_ELEVATION: (_p, t) => t('importFlags.code.NO_ELEVATION'),
  NO_DETAILS: (_p, t) => t('importFlags.code.NO_DETAILS'),
  INCOMPLETE_DRILL_SEGMENT: (p, t) =>
    t('importFlags.code.INCOMPLETE_DRILL_SEGMENT', {
      top: optMetres(optNum(p, 'top_m'), t),
      base: optMetres(optNum(p, 'base_m'), t),
      method: optStr(p, 'method') ?? t('importFlags.p.notGiven'),
    }),
  INCOMPLETE_FIELD_LOG: (p, t) =>
    t('importFlags.code.INCOMPLETE_FIELD_LOG', {
      part: partLabel(p, t),
      top: optMetres(optNum(p, 'top_m'), t),
      base: optMetres(optNum(p, 'base_m'), t),
    }),
  NO_LAYERS: (p, t) => t('importFlags.code.NO_LAYERS', { stream: streamLabel(str(p, 'stream'), t) }),
  INCOMPLETE_LAYER: (p, t) => t('importFlags.code.INCOMPLETE_LAYER', { index: num(p, 'layer_index') }),
  SAMPLES_PRESENT: (p, t) =>
    t('importFlags.code.SAMPLES_PRESENT', { count: num(p, 'count'), grainSize: num(p, 'grain_size') }),
  SAMPLE_WITHOUT_DEPTH: (p, t) =>
    t('importFlags.code.SAMPLE_WITHOUT_DEPTH', { sample: optStr(p, 'sample') ?? '?' }),
  SAMPLE_WITHOUT_BORING: (p, t) =>
    t('importFlags.code.SAMPLE_WITHOUT_BORING', {
      sample: optStr(p, 'sample') ?? '?',
      boring: str(p, 'boring'),
    }),
  SAMPLE_OBSERVATIONS_NOT_IMPORTED: (p, t) =>
    t('importFlags.code.SAMPLE_OBSERVATIONS_NOT_IMPORTED', {
      sample: optStr(p, 'sample') ?? '?',
      count: num(p, 'count'),
      parameters: list(p, 'parameters').map(String).join(', '),
    }),
}

/** Codes this module renders in the interface language (the rest show ``message``). */
export const TRANSLATED_IMPORT_FLAG_CODES: readonly string[] = Object.keys(RENDERERS)

/**
 * Render one import finding in the interface language.
 *
 * @param flag - The finding as the backend sent it (code, message, params).
 * @param t - Translator bound to the active language.
 * @returns The translated sentence, or the backend's English ``message`` when
 *   the code is unknown here or its params are missing (older backend).
 */
export function importFlagText(flag: ImportFlag, t: Translator): string {
  const render = RENDERERS[flag.code]
  if (render === undefined || flag.params === undefined || flag.params === null) return flag.message
  try {
    return render(flag.params, t)
  } catch (err) {
    if (err instanceof MissingParam) return flag.message
    throw err
  }
}
