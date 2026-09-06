/**
 * English display-label helpers for lithostratigraphic units.
 *
 * Domain vocabulary: base lithology codes (ZAND, KLEI, SILT, GRIND, VEEN)
 * come from the backend ``BASE_LITHOLOGIES`` constant; admixture soil codes
 * (GL, KL, SL, ZN, VE) and amount codes (W, M, V, S, Z, empty) come from
 * the DOV vocabulary stored in borehole ObservationLayer admixtures. The
 * raw codes stay Dutch in the DB / API (translate at the presentation
 * boundary, never at ingest — see CLAUDE.md §UX Conventions); this
 * module is the boundary.
 *
 * The function produces pipe-delimited labels — the main soil in upper
 * case, then one admixture per ``|``-separated field, e.g.
 * "SAND | clayey | little shell debris" or "CLAY | slightly silty |
 * locally sandy". The raw DOV codes remain visible elsewhere (codelist
 * dropdowns, tooltips) so engineers can cross-check.
 *
 * Base-lithology names are imported from ``utils/lithoConstants.ts``
 * (``LITHOLOGY_LABELS``) — that file is the single source of truth so
 * the picker dialog, the composition editor, and the ghost overlay all
 * agree on "Sand" / "Clay" / etc.
 *
 * Format history: produced Dutch prose until 2026-05-21 (English prose
 * for UI consistency), then the pipe format on 2026-05-22 — the prose
 * form produced broken English ("slightly with shell debris Sand")
 * when an amount adverb collided with a "with X" admixture phrase. The
 * raw Dutch tokens are unchanged in the DB.
 */

import type { AdmixtureItem } from '../api/client'
import { LITHOLOGY_LABELS, LITHOLOGY_LABELS_NL } from './lithoConstants'
import { getLanguage } from '../i18n/languageSelect'
import type { Language } from '../i18n/i18n_constants'
import {
  ADMIXTURE_AMOUNT_NL,
  ADMIXTURE_AMOUNT_QUANTITY_NL,
  ADMIXTURE_SOIL_NL,
} from './lithoLabelsNl'

// ---------------------------------------------------------------------------
// Admixture soil codes → English adjective form.
//
// Source: the DOV ``codetabel_hoofdnaam.csv`` (108 codes) at
// ``src/groundmodel/infrastructure/codelists/data/``.  Borehole
// ``<bijmenging><grondsoort>`` uses this same vocabulary as the main
// lithology, so the admixture's soil code can be any of the 108 entries
// — not just the five core soils (GL / ZN / SL / KL / VE).
//
// We curate an English adjective form for the codes that actually
// appear as bijmenging in practice (the core soils + grain-size
// variants + organic + carbonate + anthropogenic).  Codes we have not
// curated fall through to a lower-case version of the Dutch description
// from the codelist — handled by ``ADMIXTURE_SOIL_FALLBACK_DUTCH``
// below.  This avoids the prior failure mode where an unknown code
// rendered as its raw alphanumeric token (``om`` / ``xz``) in the user-
// facing label.
//
// Adjective form follows NEN 5104 / Belgian field-description practice
// translated to English.
// ---------------------------------------------------------------------------

const ADMIXTURE_SOIL_EN: Record<string, string> = {
  // Core five soils (most common as bijmenging).
  GL: 'gravelly',
  KL: 'clayey',
  SL: 'silty',
  ZN: 'sandy',
  VE: 'peaty',
  // Aliases / DOV variants encountered in real data:
  Z: 'sandy',
  K: 'clayey',
  S: 'silty',
  G: 'gravelly',
  V: 'peaty',
  // Hoofdnaam codes that also appear as bijmenging in real DOV data
  // (the user's "very om, N xz Silt" example surfaced OM + XZ — both
  // hoofdnaam codes used here as admixture soils).
  XZ: 'sandy',           // XZ = zand (sand, generic grain)
  XG: 'gravelly',        // XG = grind (gravel, generic grain)
  FZ: 'fine-sandy',
  MZ: 'medium-sandy',
  GZ: 'coarse-sandy',
  FG: 'fine-gravelly',
  MG: 'medium-gravelly',
  GG: 'coarse-gravelly',
  LE: 'loamy',           // LE = leem (loam)
  ZL: 'loamy-sandy',     // ZL = zandleem (sandy loam)
  // Organic admixtures.
  OM: 'organic',         // OM = organisch materiaal
  HU: 'humic',           // HU = humus
  HT: 'with wood debris', // HT = houtresten
  HC: 'with charcoal',   // HC = houtskool
  PL: 'with plant debris', // PL = plantenresten
  PC: 'with coal dust',  // PC = poederkool
  AG: 'ashy',            // AG = as
  LG: 'with lignite',    // LG = ligniet
  CO: 'with coal',       // CO = steenkool
  // Carbonate / shell admixtures.
  KA: 'calcareous',      // KA = kalk
  SC: 'with shells',     // SC = schelpen
  SF: 'with shell fragments', // SF = schelpfragmenten
  SG: 'with shell debris',    // SG = schelpgruis
  NN: 'with nummulites',      // NN = nummulieten (foraminifera fossils)
  FO: 'with fossils',         // FO = fossielen
  // Mineral / iron admixtures (encountered occasionally).
  GI: 'micaceous',       // GI = glimmers
  PY: 'with pyrite',     // PY = pyriet
  HB: 'with hematite',   // HB = hematiet
  LI: 'with limonite',   // LI = limoniet
  FE: 'ferruginous',     // FE = ijzer
  // Anthropogenic admixtures.
  PU: 'with rubble',     // PU = puin
  BK: 'with bricks',     // BK = baksteen
  BT: 'with concrete',   // BT = beton
  AF: 'with waste',      // AF = afval
  TA: 'with topsoil',    // TA = teelaarde
  GA: 'disturbed',       // GA = geroerd / gestoord
  // Misc / placeholder.
  XX: 'unknown',         // XX = onbekend
  RO: 'with rock',       // RO = rots
  ST: 'with stones',     // ST = stenen
  SN: 'with rock fragments', // SN = steenfragmenten
  RV: 'with weathered rock', // RV = verweerde rots
}

// Codelist-derived Dutch description fallback for the long-tail
// hoofdnaam codes (rock types, evaporites, metamorphics) that never
// appear as bijmenging in normal use but are still part of the DOV
// vocabulary.  Used as a last-resort label so unknown codes still read
// gracefully ("with andesite" instead of "ab").
const ADMIXTURE_SOIL_FALLBACK_DUTCH: Record<string, string> = {
  AA: 'amphibolite', AB: 'andesite', AC: 'anhydrite', AD: 'ankerite',
  AR: 'arenite', AE: 'arkose', AT: 'asphalt',
  BA: 'basalt', BB: 'bauxite', BC: 'bentonite', BS: 'blueschist',
  CA: 'with carbonate fragments', CT: 'banded chert', CB: 'conglomerate/breccia',
  DA: 'dacite', DB: 'diatomite', DC: 'diorite', DD: 'dolerite',
  DL: 'dolomite', DK: 'dolomitic limestone', DE: 'dunite',
  EC: 'eclogite', EA: 'evaporite',
  FA: 'phosphorite', FY: 'phyllite',
  GB: 'gabbro', GM: 'split metamorphic', GC: 'gypsum',
  GD: 'gneiss', GE: 'granite', GF: 'granodiorite',
  GH: 'greenschist', GS: 'greenstone',
  HA: 'halite', HD: 'hornfels',
  IA: 'with iron oolite', IN: 'intrusive rock',
  KC: 'limestone schist', KS: 'limestone', KB: 'limestone breccia',
  KR: 'chalk', KT: 'claystone', KO: 'komatiite', KW: 'quartzite',
  LA: 'lateritic', LS: 'slate',
  MA: 'marble', ME: 'with marl', MM: 'metamorphic',
  MB: 'micaschist', MI: 'migmatite', MS: 'shale', MY: 'mylonite',
  OK: 'oolitic limestone',
  PA: 'pegmatite', PB: 'peridotite', PS: 'psammite',
  PM: 'pumice', PD: 'pyroxenite',
  QU: 'quartz-bearing',
  RA: 'radiolarite', RB: 'rhyolite',
  SH: 'shaly', SK: 'schistose limestone', SO: 'scoria',
  SE: 'sedimentary', SP: 'serpentinite', SY: 'schist',
  SA: 'with siderite', SX: 'with flint', SI: 'silty',
  SS: 'siltstone',
  TB: 'tuffaceous', TS: 'tufa',
  VA: 'volcanic', VS: 'flinty',
  WA: 'wackestone',
  ZE: 'soapstone', ZS: 'sandstone',
  // Anthropogenic-water containers (rare as bijmenging).
  AN: 'with non-watertight tank', AV: 'with watertight tank',
  AW: 'with water-permeable tank',
}

// ---------------------------------------------------------------------------
// Admixture amount codes → English amount adverb (placed BEFORE soil adj).
// Source: DOV ``<hoeveelheid>`` vocabulary.
// ---------------------------------------------------------------------------

const ADMIXTURE_AMOUNT_EN: Record<string, string> = {
  W: 'slightly',    // W = weinig (little)
  M: 'moderately',  // M = matig (moderate)
  V: 'very',        // V = veel (much) — note: same letter as Veen soil code;
                    // context (amount field) determines the reading
  S: 'strongly',    // S = sterk (strongly)
  Z: 'weakly',      // Z = zwak (weakly / slightly)
  N: 'with',        // N = "n." appears in real DOV data as a generic
                    // intensity-unspecified marker; map to plain "with"
                    // rather than fall through as raw "N" in the label.
  WM: 'slightly to moderately',
  MV: 'moderately to very',
}

// ---------------------------------------------------------------------------
// Admixture amount codes → English quantity word for NOUN-PHRASE
// admixtures (the "with X" group: shell debris, fossils, wood debris,
// charcoal, ...). These read as a quantity in front of the noun
// ("little shell debris") — an amount ADVERB ("slightly") only works
// in front of an adjective ("slightly clayey"), so the two groups need
// separate vocabulary. ADMIXTURE_AMOUNT_EN above handles the adjective
// group.
// ---------------------------------------------------------------------------

const ADMIXTURE_AMOUNT_QUANTITY_EN: Record<string, string> = {
  Z: 'trace',    // Z = zwak (weakly) → trace amount
  W: 'little',   // W = weinig (little)
  M: 'some',     // M = matig (moderate)
  V: 'much',     // V = veel (much)
  S: 'abundant', // S = sterk (strongly)
  N: '',         // N = intensity-unspecified marker — just the noun
  WM: 'little to some',
  MV: 'some to much',
}

/**
 * Public list of curated admixture soil options for dropdowns.
 *
 * Ordered: core five first, then grain-size variants, then organics,
 * then carbonates, then anthropogenic, then long-tail fallback codes.
 * The picker dialog + ghost composition editor share this list so
 * stored values match what dropdowns can express — the previous
 * 5-option dropdown silently fell back to "Gravel (GL)" for any
 * unknown stored code, producing the user-reported mismatch where
 * the dropdown said "Gravel" but the preview showed "very om Silt".
 */
export const ADMIXTURE_SOIL_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  // Core
  { code: 'GL', label: 'Gravel (GL)' },
  { code: 'ZN', label: 'Sand (ZN)' },
  { code: 'SL', label: 'Silt (SL)' },
  { code: 'KL', label: 'Clay (KL)' },
  { code: 'VE', label: 'Peat (VE)' },
  // Grain-size variants (DOV hoofdnaam codes used as bijmenging)
  { code: 'XZ', label: 'Sand, generic (XZ)' },
  { code: 'XG', label: 'Gravel, generic (XG)' },
  { code: 'FZ', label: 'Fine sand (FZ)' },
  { code: 'MZ', label: 'Medium sand (MZ)' },
  { code: 'GZ', label: 'Coarse sand (GZ)' },
  { code: 'FG', label: 'Fine gravel (FG)' },
  { code: 'MG', label: 'Medium gravel (MG)' },
  { code: 'GG', label: 'Coarse gravel (GG)' },
  { code: 'LE', label: 'Loam (LE)' },
  { code: 'ZL', label: 'Sandy loam (ZL)' },
  // Organic
  { code: 'OM', label: 'Organic matter (OM)' },
  { code: 'HU', label: 'Humus (HU)' },
  { code: 'HT', label: 'Wood debris (HT)' },
  { code: 'HC', label: 'Charcoal (HC)' },
  { code: 'PL', label: 'Plant debris (PL)' },
  { code: 'PC', label: 'Coal dust (PC)' },
  { code: 'AG', label: 'Ash (AG)' },
  { code: 'LG', label: 'Lignite (LG)' },
  { code: 'CO', label: 'Coal (CO)' },
  // Carbonate / shells
  { code: 'KA', label: 'Calcareous (KA)' },
  { code: 'SC', label: 'Shells (SC)' },
  { code: 'SF', label: 'Shell fragments (SF)' },
  { code: 'SG', label: 'Shell debris (SG)' },
  { code: 'NN', label: 'Nummulites (NN)' },
  { code: 'FO', label: 'Fossils (FO)' },
  // Minerals
  { code: 'GI', label: 'Mica (GI)' },
  { code: 'PY', label: 'Pyrite (PY)' },
  { code: 'HB', label: 'Hematite (HB)' },
  { code: 'LI', label: 'Limonite (LI)' },
  { code: 'FE', label: 'Iron (FE)' },
  // Anthropogenic
  { code: 'PU', label: 'Rubble (PU)' },
  { code: 'BK', label: 'Bricks (BK)' },
  { code: 'BT', label: 'Concrete (BT)' },
  { code: 'AF', label: 'Waste (AF)' },
  { code: 'TA', label: 'Topsoil (TA)' },
  { code: 'GA', label: 'Disturbed (GA)' },
  // Misc
  { code: 'XX', label: 'Unknown (XX)' },
  { code: 'RO', label: 'Rock (RO)' },
  { code: 'ST', label: 'Stones (ST)' },
  { code: 'SN', label: 'Rock fragments (SN)' },
  { code: 'RV', label: 'Weathered rock (RV)' },
]

/**
 * Public list of curated amount options for dropdowns.
 * Shared with the picker dialog + ghost composition editor.
 */
export const ADMIXTURE_AMOUNT_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: '', label: '— (unspecified)' },
  { code: 'Z', label: 'Weakly (Z)' },
  { code: 'W', label: 'Slightly (W)' },
  { code: 'M', label: 'Moderately (M)' },
  { code: 'V', label: 'Very (V)' },
  { code: 'S', label: 'Strongly (S)' },
  { code: 'N', label: 'With (N)' },
  { code: 'WM', label: 'Slightly to moderately (WM)' },
  { code: 'MV', label: 'Moderately to very (MV)' },
]

/**
 * Capitalise the first letter of a vocabulary word.
 *
 * The NL admixture tables store lowercase field words ("kleiig" / "veel"); a
 * dropdown option row reads better with a leading capital. Presentation-only;
 * the raw token is unchanged.
 *
 * @param word - the word to capitalise.
 * @returns the word with its first character upper-cased.
 */
function capitaliseFirst(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Curated admixture-SOIL dropdown options in the active interface language.
 *
 * The ghost composition editor shows one soil per admixture row. The option
 * VALUE stays the raw DOV code; the visible LABEL is translated at the
 * presentation boundary (owner ruling 2026-09-06, the dialog rendered English
 * "Clay (KL)" in the Dutch UI). Under ``'nl'`` the word is the existing NL
 * admixture adjective (``ADMIXTURE_SOIL_NL``, e.g. "kleiig"), with the English
 * adjective as the graceful fallback for the long-tail codes the NL table does
 * not curate; every other locale is byte-identical to ``ADMIXTURE_SOIL_OPTIONS``.
 * The raw code stays in the label parens AND is repeated as the option's
 * ``title`` tooltip so a domain expert can verify the mapping (CLAUDE.md §UX).
 *
 * @param language - locale to render in; defaults to the active language.
 * @returns option rows: raw ``code``, translated ``label``, raw-token ``title``.
 */
export function admixtureSoilOptions(
  language: Language = getLanguage(),
): ReadonlyArray<{ code: string; label: string; title: string }> {
  return ADMIXTURE_SOIL_OPTIONS.map(opt => ({
    code: opt.code,
    label:
      language === 'nl'
        ? `${capitaliseFirst(ADMIXTURE_SOIL_NL[opt.code] ?? admixtureSoilLabel(opt.code))} (${opt.code})`
        : opt.label,
    title: opt.code,
  }))
}

/**
 * Curated admixture-AMOUNT dropdown options in the active interface language.
 *
 * Same presentation-boundary rule as {@link admixtureSoilOptions}: the value
 * stays the raw DOV amount code, the label is translated (NL from
 * ``ADMIXTURE_AMOUNT_NL``, e.g. "veel"), the raw token is the ``title`` tooltip.
 * The leading "unspecified" row has no code, so it carries no tooltip and reads
 * "Onbepaald" under ``'nl'``.
 *
 * @param language - locale to render in; defaults to the active language.
 * @returns option rows: raw ``code``, translated ``label``, raw-token ``title``.
 */
export function admixtureAmountOptions(
  language: Language = getLanguage(),
): ReadonlyArray<{ code: string; label: string; title: string }> {
  return ADMIXTURE_AMOUNT_OPTIONS.map(opt => {
    if (opt.code === '') {
      return { code: '', label: language === 'nl' ? 'Onbepaald' : opt.label, title: '' }
    }
    return {
      code: opt.code,
      label:
        language === 'nl'
          ? `${capitaliseFirst(ADMIXTURE_AMOUNT_NL[opt.code] ?? opt.code)} (${opt.code})`
          : opt.label,
      title: opt.code,
    }
  })
}

/**
 * Look up the English adjective for an admixture soil code, with a
 * graceful fallback for unknown codes.  Used by ``formatLithoDisplayName``
 * AND by the dialog when it needs to label a stored value that isn't
 * in the curated options.
 */
export function admixtureSoilLabel(code: string): string {
  if (code in ADMIXTURE_SOIL_EN) return ADMIXTURE_SOIL_EN[code]
  if (code in ADMIXTURE_SOIL_FALLBACK_DUTCH) return ADMIXTURE_SOIL_FALLBACK_DUTCH[code]
  return code.toLowerCase()
}

/**
 * The admixture adjective for a soil code in the active UI language.
 *
 * ``'nl'`` selects the Dutch adjective (``siltig`` / ``kleiig`` / ``zandig``),
 * every other locale the English one, with the English adjective as the
 * graceful fallback for codes the NL table does not curate — the same
 * language switch ``NL_VOCAB.soil`` makes. The geotech admixture prompt uses it
 * to NAME the admixture it found (owner ruling 2026-09-05).
 *
 * @param code - the admixture ``soil_code`` (e.g. ``'SL'``, ``'KL'``, ``'XZ'``).
 * @param language - the locale to render in; defaults to the active language.
 * @returns the adjective (e.g. ``'silty'`` / ``'siltig'``).
 */
export function admixtureSoilAdjective(
  code: string,
  language: Language = getLanguage(),
): string {
  if (language === 'nl') return ADMIXTURE_SOIL_NL[code] ?? admixtureSoilLabel(code)
  return admixtureSoilLabel(code)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format a pipe-delimited display name for a lithostratigraphic unit.
 *
 * Main soil in upper case, then one admixture per ``|``-separated
 * field. Adjective admixtures ("clayey", "silty") take an amount
 * adverb; noun-phrase admixtures (the "with X" group — shell debris,
 * fossils, ...) drop the "with" and take a quantity word instead.
 *
 * Examples::
 *
 *   formatLithoDisplayName('ZAND', [])
 *   // → 'SAND'
 *
 *   formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }])
 *   // → 'SAND | moderately clayey'
 *
 *   formatLithoDisplayName('KLEI', [
 *     { soil_code: 'SL', amount: 'W', locally: false },
 *     { soil_code: 'ZN', amount: '',  locally: true  },
 *   ])
 *   // → 'CLAY | slightly silty | locally sandy'
 *
 *   formatLithoDisplayName('ZAND', [{ soil_code: 'SG', amount: 'W', locally: false }])
 *   // → 'SAND | little shell debris'
 *
 * Parameters
 * ----------
 * mainCode
 *     Base lithology code (ZAND, KLEI, SILT, GRIND, VEEN). Falls back
 *     to the raw code (upper-cased) when not found in the label table.
 * admixtures
 *     Admixture items from the API (``AdmixtureItem[]``). Empty or null
 *     returns just the main lithology name.
 *
 * Returns
 * -------
 * string
 *     Pipe-delimited display label.
 */
export function formatLithoDisplayName(
  mainCode: string,
  admixtures: readonly AdmixtureItem[] | null | undefined,
): string {
  return composeLithoName(mainCode, admixtures, EN_VOCAB)
}

/**
 * The vocabulary + connectives the composer needs, per language. Selecting the
 * table by language is the whole language switch — the composition logic in
 * ``composeLithoName`` is shared, so EN and NL can never format differently.
 */
interface LithoVocab {
  base: Record<string, string>
  soil(code: string): string
  amount: Record<string, string>
  quantity: Record<string, string>
  locallyPrefix: string
  /** The connective a "with X" noun-phrase admixture begins with in this locale. */
  withPrefix: string
}

const EN_VOCAB: LithoVocab = {
  base: LITHOLOGY_LABELS,
  soil: admixtureSoilLabel,
  amount: ADMIXTURE_AMOUNT_EN,
  quantity: ADMIXTURE_AMOUNT_QUANTITY_EN,
  locallyPrefix: 'locally ',
  withPrefix: 'with ',
}

const NL_VOCAB: LithoVocab = {
  base: LITHOLOGY_LABELS_NL,
  // NL first, English adjective as the graceful fallback for uncurated codes.
  soil: (code: string): string => ADMIXTURE_SOIL_NL[code] ?? admixtureSoilLabel(code),
  amount: ADMIXTURE_AMOUNT_NL,
  quantity: ADMIXTURE_AMOUNT_QUANTITY_NL,
  locallyPrefix: 'plaatselijk ',
  withPrefix: 'met ',
}

/**
 * Strip the leading "with "/"met " connective from a noun-phrase admixture.
 *
 * The NL fallback can hand back an English adjective that still begins "with ",
 * so both connectives are recognised regardless of the active vocab — a mixed
 * fallback must never leave a stray "with" in a Dutch label.
 */
function stripWithPrefix(label: string): { isNounPhrase: boolean; core: string } {
  for (const prefix of ['with ', 'met ']) {
    if (label.startsWith(prefix)) return { isNounPhrase: true, core: label.slice(prefix.length) }
  }
  return { isNounPhrase: false, core: label }
}

/**
 * Compose the pipe-delimited litho display name from a vocabulary.
 *
 * The pipe format + noun-phrase handling is identical across locales; only the
 * WORDS differ, which is exactly what ``vocab`` supplies. Extracted so
 * ``formatLithoDisplayName`` (English, the export/canonical form) and
 * ``lithoDisplayName`` (the active-language UI form) share one implementation.
 *
 * Parameters
 * ----------
 * mainCode
 *     Base lithology code (ZAND, KLEI, ...).
 * admixtures
 *     Admixture items; empty/null yields the bare main-lithology name.
 * vocab
 *     The per-language label tables + connectives.
 *
 * Returns
 * -------
 * string
 *     Pipe-delimited display label in the vocabulary's language.
 */
function composeLithoName(
  mainCode: string,
  admixtures: readonly AdmixtureItem[] | null | undefined,
  vocab: LithoVocab,
): string {
  const baseName = (vocab.base[mainCode] ?? mainCode).toUpperCase()
  if (!admixtures || admixtures.length === 0) return baseName

  const fields: string[] = admixtures.map(adm => {
    const soilLabel = vocab.soil(adm.soil_code)
    const { isNounPhrase, core } = stripWithPrefix(soilLabel)

    const amountWord = adm.amount
      ? isNounPhrase
        ? (vocab.quantity[adm.amount] ?? adm.amount)
        : (vocab.amount[adm.amount] ?? adm.amount)
      : ''

    const localPrefix = adm.locally ? vocab.locallyPrefix : ''
    return `${localPrefix}${amountWord ? `${amountWord} ` : ''}${core}`
  })

  return `${baseName} | ${fields.join(' | ')}`
}

/**
 * The pipe-delimited litho display name in the ACTIVE interface language.
 *
 * This is the UI-facing formatter — every on-screen litho unit label (legend
 * rows, inspector, section band names, 3-D legend) should call this so the name
 * follows the language toggle. ``formatLithoDisplayName`` stays the ENGLISH,
 * language-stable form and is what the export path (fence DXF layer names) uses:
 * an export is a contract that must read identically whatever the UI language.
 *
 * Parameters
 * ----------
 * mainCode
 *     Base lithology code (ZAND, KLEI, ...).
 * admixtures
 *     Admixture items from the API.
 * language
 *     The locale to render in; defaults to the active interface language.
 *
 * Returns
 * -------
 * string
 *     Pipe-delimited display label; English under ``'en'`` (identical to
 *     ``formatLithoDisplayName``), Flemish Dutch under ``'nl'``.
 */
export function lithoDisplayName(
  mainCode: string,
  admixtures: readonly AdmixtureItem[] | null | undefined,
  language: Language = getLanguage(),
): string {
  return composeLithoName(mainCode, admixtures, language === 'nl' ? NL_VOCAB : EN_VOCAB)
}

/**
 * The TITLE-CASE base-lithology label ("Sand" / "Zand"), in the active language.
 *
 * For dropdown / option rows that show only the bare soil name and want it in
 * sentence case, not the upper-case ``lithoDisplayName`` band form. Selecting the
 * source-token table is the whole translation.
 *
 * @param code  Base lithology code (ZAND, KLEI, ...).
 * @param language  The locale; defaults to the active interface language.
 * @returns  The base label, or the raw code when it is not one of the five.
 */
export function lithoBaseLabel(code: string, language: Language = getLanguage()): string {
  const labels = language === 'nl' ? LITHOLOGY_LABELS_NL : LITHOLOGY_LABELS
  return labels[code] ?? code
}
