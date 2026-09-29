/**
 * DOV codelists for the borehole track editor (owner 2026-09-29: "with the dov
 * codelist ofc").
 *
 * For every field of every track kind this module answers two questions: which
 * DOV tokens may the picker offer (``codelistOptions``, each with its meaning
 * translated at the presentation boundary), and which tokens may be SAVED
 * (``allowedTokens`` — the codelist plus whatever the imported track already
 * carries, so an untouched DOV row with a legacy token still round-trips). A
 * ``null`` answer means the field is free text: only the lithological
 * description and the stratigraphy streams DOV publishes no closed list for.
 *
 * The raw token is always what is stored; the source of each list is cited in
 * ``dovTrackCodelists_constants.ts``.
 */

import type { TrackIntervalBody } from '../api/clients/borehole'
import type { FormalStratigraphyUnitResponse } from '../api/clients/codelist'
import type { Language } from '../i18n/i18n_constants'
import { getLanguage } from '../i18n/languageSelect'
import { admixtureAmountOptions, ADMIXTURE_SOIL_OPTIONS, admixtureSoilLabel } from './lithoLabels'
import { ADMIXTURE_SOIL_NL } from './lithoLabelsNl'
import { SOIL_COLORS } from './soilColors'
import {
  DOV_COLOUR_SPECIAL_EN,
  DOV_COLOUR_TOKENS,
  DOV_COLOUR_WORDS_EN,
  DOV_CONSISTENCY_TOKENS,
  DOV_MOISTURE_TOKENS,
} from './dovTrackCodelists_constants'

/** A field of a track interval that can carry a codelist token. */
export type CodelistField =
  | 'mainSoil'
  | 'admixtureSoil'
  | 'admixtureAmount'
  | 'colour'
  | 'value'
  | 'description'

/** One picker option: the raw DOV token and its translated meaning. */
export interface CodeOption {
  code: string
  label: string
}

/** Context the option lists depend on. */
export interface CodelistContext {
  /** Interface language; defaults to the active one. */
  language?: Language
  /** The DOV formal-stratigraphy catalog once loaded; absent = not loaded. */
  formalUnits?: readonly FormalStratigraphyUnitResponse[] | null
}

const CODED_KINDS = new Set(['coded_lithology', 'geotechnical_coding'])

/**
 * Translate a DOV colour token for display ("groenbruin" -> "green-brown").
 *
 * DOV colours are Dutch compounds of a small word set; the compound is split
 * greedily (longest word first) and the English parts are joined — a light /
 * dark modifier by a space, two hues by a hyphen. An unknown word falls back to
 * the raw token. Under Dutch the stored word IS the label.
 *
 * @param token - Raw DOV colour token.
 * @param language - Interface language.
 * @returns The display label.
 */
export function colourTokenLabel(token: string, language: Language = getLanguage()): string {
  if (language === 'nl') return token
  const special = DOV_COLOUR_SPECIAL_EN[token]
  if (special !== undefined) return special
  const parts: string[] = []
  let rest = token
  while (rest.length > 0) {
    const hit = DOV_COLOUR_WORDS_EN.find(([nl]) => rest.startsWith(nl))
    if (hit === undefined) return token
    parts.push(hit[1])
    rest = rest.slice(hit[0].length)
  }
  let label = ''
  parts.forEach((part, index) => {
    if (index === 0) label = part
    else label += parts[index - 1] === 'light' || parts[index - 1] === 'dark' ? ` ${part}` : `-${part}`
  })
  return label
}

/**
 * Picker text for an option: ``"FZ — fine sand"``, or just the code when the
 * label adds nothing (a Dutch colour word is its own label).
 *
 * @param option - The option to render.
 * @returns The text shown in the picker.
 */
export function optionText(option: CodeOption): string {
  if (option.code === '') return option.label
  return option.label && option.label !== option.code
    ? `${option.code} — ${option.label}`
    : option.code
}

function soilOptions(language: Language): CodeOption[] {
  return Object.entries(SOIL_COLORS).map(([code, style]) => ({
    code,
    label: language === 'nl' ? (style.source ?? style.label) : style.label,
  }))
}

function admixtureSoilOptions(language: Language): CodeOption[] {
  // DOV's <bijmenging><grondsoort> uses the hoofdnaam vocabulary; the app's
  // curated admixture list adds the aliases real DOV data carries (ZN, ...).
  const seen = new Map<string, CodeOption>()
  for (const opt of ADMIXTURE_SOIL_OPTIONS) {
    seen.set(opt.code, {
      code: opt.code,
      label: language === 'nl' ? (ADMIXTURE_SOIL_NL[opt.code] ?? admixtureSoilLabel(opt.code)) : admixtureSoilLabel(opt.code),
    })
  }
  for (const opt of soilOptions(language)) {
    if (!seen.has(opt.code)) seen.set(opt.code, opt)
  }
  return [...seen.values()]
}

function tokenOptions(
  list: ReadonlyArray<{ token: string; en: string }>,
  language: Language,
): CodeOption[] {
  return list.map(({ token, en }) => ({ code: token, label: language === 'nl' ? token : en }))
}

function colourOptions(language: Language): CodeOption[] {
  return DOV_COLOUR_TOKENS.map(token => ({ code: token, label: colourTokenLabel(token, language) }))
}

/**
 * The DOV options a field of ``kind`` offers, or ``null`` when it is free text.
 *
 * @param kind - Track kind (an observation type or a field-log kind).
 * @param field - The interval field.
 * @param ctx - Language + the formal-stratigraphy catalog when loaded.
 * @returns The options in picker order, or ``null`` for a free-text field.
 */
export function codelistOptions(
  kind: string,
  field: CodelistField,
  ctx: CodelistContext = {},
): CodeOption[] | null {
  const language = ctx.language ?? getLanguage()
  if (CODED_KINDS.has(kind)) {
    if (field === 'mainSoil') return soilOptions(language)
    if (field === 'admixtureSoil') return admixtureSoilOptions(language)
    if (field === 'admixtureAmount') {
      return admixtureAmountOptions(language).map(o => ({ code: o.code, label: o.label }))
    }
    if (field === 'colour') return colourOptions(language)
    return null
  }
  if (field === 'value') {
    if (kind === 'color') return colourOptions(language)
    if (kind === 'moisture') return tokenOptions(DOV_MOISTURE_TOKENS, language)
    if (kind === 'consistency') return tokenOptions(DOV_CONSISTENCY_TOKENS, language)
    return null
  }
  if (field === 'description' && kind === 'formal_stratigraphy' && ctx.formalUnits) {
    return ctx.formalUnits.map(u => ({ code: u.code, label: u.name_nl }))
  }
  return null
}

function originalTokens(field: CodelistField, original: readonly TrackIntervalBody[]): string[] {
  const out: string[] = []
  for (const interval of original) {
    if (field === 'mainSoil') out.push(...(interval.main_soil_codes ?? []))
    else if (field === 'admixtureSoil') out.push(...(interval.admixtures ?? []).map(a => a.soil_code))
    else if (field === 'admixtureAmount') out.push(...(interval.admixtures ?? []).map(a => a.amount))
    else if (field === 'colour' && interval.color) out.push(interval.color)
    else if (field === 'value' && interval.value) out.push(interval.value)
    else if (field === 'description' && interval.description) out.push(interval.description)
  }
  return out
}

/**
 * The tokens a field of ``kind`` may be SAVED with, or ``null`` for free text.
 *
 * The DOV codelist, plus every token the track already carries (``original``)
 * so an imported row with a legacy token is not refused on an unrelated edit.
 *
 * @param kind - Track kind.
 * @param field - The interval field.
 * @param opts.formalUnits - The formal-stratigraphy catalog when loaded.
 * @param opts.original - The track's intervals as loaded from the server.
 * @returns The allowed set, or ``null`` when the field is free text.
 */
export function allowedTokens(
  kind: string,
  field: CodelistField,
  opts: {
    formalUnits?: readonly FormalStratigraphyUnitResponse[] | null
    original?: readonly TrackIntervalBody[]
  },
): Set<string> | null {
  const options = codelistOptions(kind, field, { language: 'en', formalUnits: opts.formalUnits })
  if (options === null) return null
  const allowed = new Set(options.map(o => o.code))
  for (const token of originalTokens(field, opts.original ?? [])) allowed.add(token)
  return allowed
}
