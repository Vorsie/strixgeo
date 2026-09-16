/**
 * NAD geotechnical packing-class lookup table: names + colours.
 *
 * Translate-at-presentation-boundary rule: the backend stores raw NAD class
 * integers (1..31) with the canonical DUTCH labels (``litho_constants.py``
 * NAD_CLASSES, ported verbatim from the NAD-NEN sheet); this module is the
 * single frontend translation point and renders them in ENGLISH (the app's UI
 * language).
 *
 * The two vocabularies NEVER cross (owner ruling 2026-08-26: "moderately firm
 * sand just does not exist"). A GRANULAR soil is described by how densely it is
 * packed — GRAVEL + SAND take loose / medium dense / dense / very dense, the
 * backend's ``los / matig / dicht / zeer dicht gp`` (gp = gepakt). A COHESIVE
 * soil is described by how firm it is — SILT + CLAY + PEAT take slightly firm /
 * moderately firm / fairly firm / firm, the backend's ``weinig vast / matig
 * vast / vrij vast / vast``. Re-word these labels freely, but a sand may never
 * be called firm and a clay may never be called dense; pins V1/V2 in
 * ``nadClasses.test.ts`` hold the line.
 *
 * Colour ramp note: the palette below maps packing density to lightness within
 * each soil family (loosest = lightest, densest = darkest), reading the 31
 * classes in their natural order. It is a placeholder palette for v1 —
 * a designer should refine it before public release, but the deterministic
 * class→hex mapping must never change shape (it is the stable identity key
 * for legend + band fill in the geotech inspector).
 *
 * Never use amber hues here (#fbbf24 family) — amber is the reserved
 * unsaved-state indicator throughout the Strix UI.
 */

import { LITHOLOGY_COLORS, LITHOLOGY_LABELS, LITHOLOGY_LABELS_NL } from './lithoConstants'
import { getLanguage } from '../i18n/languageSelect'
import type { Language } from '../i18n/i18n_constants'
import {
  NAD_CLASS_ABBR_NL,
  NAD_CLASS_NAMES_NL,
  UNCLASSIFIED_QUALIFIER_NL,
} from './nadClassesNl'

// ---------------------------------------------------------------------------
// Name table (31 entries, 1-indexed)
// ---------------------------------------------------------------------------

/**
 * NAD class number (1..31) → English packing-class label (presentation).
 *
 * The canonical Dutch labels live in the backend ``NAD_CLASSES`` dict
 * (``src/groundmodel/shared/constants/litho_constants.py``); these are their
 * English translations for the UI. The class number (integer key) is the stable
 * Phase-5 join key into the NAD-NEN parameter sheet; the label is presentation
 * only, so translating it here changes nothing downstream.
 */
export const NAD_CLASS_NAMES: Readonly<Record<number, string>> = {
  // GRAVEL — 2 densities x clean/silty. The NAD table has no loose and no very
  // dense gravel: ANB Tabel 2.1 gives gravel a single 20 MPa threshold where
  // sand gets four bands (see nad_classification_constants.NAD_QC_BANDS).
  1: 'GRAVEL, medium dense',
  2: 'GRAVEL, dense',
  3: 'GRAVEL, silty/clayey, medium dense',
  4: 'GRAVEL, silty/clayey, dense',
  // SAND — 8 density classes (loose/medium dense/dense/very dense × clean/silty)
  5: 'SAND, loose',
  6: 'SAND, medium dense',
  7: 'SAND, dense',
  8: 'SAND, very dense',
  9: 'SAND, silty/clayey, loose',
  10: 'SAND, silty/clayey, medium dense',
  11: 'SAND, silty/clayey, dense',
  12: 'SAND, silty/clayey, very dense',
  // SILT — 8 consistency classes (slightly/moderately/fairly firm/firm × clean/sandy)
  13: 'SILT, slightly firm',
  14: 'SILT, moderately firm',
  15: 'SILT, fairly firm',
  16: 'SILT, firm',
  17: 'SILT, sandy, slightly firm',
  18: 'SILT, sandy, moderately firm',
  19: 'SILT, sandy, fairly firm',
  20: 'SILT, sandy, firm',
  // CLAY — 8 consistency classes (slightly/moderately/fairly firm/firm × clean/sandy)
  21: 'CLAY, slightly firm',
  22: 'CLAY, moderately firm',
  23: 'CLAY, fairly firm',
  24: 'CLAY, firm',
  25: 'CLAY, sandy, slightly firm',
  26: 'CLAY, sandy, moderately firm',
  27: 'CLAY, sandy, fairly firm',
  28: 'CLAY, sandy, firm',
  // PEAT — 3 consistency classes
  29: 'PEAT, slightly firm',
  30: 'PEAT, moderately firm',
  31: 'PEAT, firm',
} as const

/**
 * NAD class number (1..31) → compact ``{LITHO}·{packing-abbr}`` label.
 *
 * Parallel to ``NAD_CLASS_NAMES`` (the full names) — same shape + ordering as
 * the ``_NAD_CLASS_COLORS`` table below — for the geotech per-column section
 * bands. The full name ("SAND, medium dense") truncates to the lithology alone
 * ("SAND") in a narrow column, so a litho unit subdivided into several packing
 * classes shows bands that read identically and differ only by near-adjacent
 * NAD colour shades — "correlating on colour alone". The compact form keeps the
 * packing class on one short line that survives truncation.
 *
 * Abbreviations — density: loose=L, medium dense=MD, dense=D, very dense=VD;
 * firmness: slightly firm=SF, moderately firm=MF, fairly firm=FF, firm=F.
 * Admixture marker: ``(f)`` = silty/clayey fines (gravel/sand), ``(s)`` = sandy
 * (silt/clay). The FULL name stays available via ``nadClassName`` for the band's
 * hover tooltip, so the abbreviations are never the only expansion.
 */
export const NAD_CLASS_ABBR: Readonly<Record<number, string>> = {
  // GRAVEL
  1: 'GRAVEL·MD',
  2: 'GRAVEL·D',
  3: 'GRAVEL(f)·MD',
  4: 'GRAVEL(f)·D',
  // SAND
  5: 'SAND·L',
  6: 'SAND·MD',
  7: 'SAND·D',
  8: 'SAND·VD',
  9: 'SAND(f)·L',
  10: 'SAND(f)·MD',
  11: 'SAND(f)·D',
  12: 'SAND(f)·VD',
  // SILT
  13: 'SILT·SF',
  14: 'SILT·MF',
  15: 'SILT·FF',
  16: 'SILT·F',
  17: 'SILT(s)·SF',
  18: 'SILT(s)·MF',
  19: 'SILT(s)·FF',
  20: 'SILT(s)·F',
  // CLAY
  21: 'CLAY·SF',
  22: 'CLAY·MF',
  23: 'CLAY·FF',
  24: 'CLAY·F',
  25: 'CLAY(s)·SF',
  26: 'CLAY(s)·MF',
  27: 'CLAY(s)·FF',
  28: 'CLAY(s)·F',
  // PEAT
  29: 'PEAT·SF',
  30: 'PEAT·MF',
  31: 'PEAT·F',
} as const

// ---------------------------------------------------------------------------
// Colour table
// ---------------------------------------------------------------------------

// Placeholder v1 palette — density-to-lightness ramp within each soil family.
// GRIND: warm orange-brown ramp (2 densities × 2 admixture variants)
// ZAND: yellow ramp, darker = denser; matches the base LITHOLOGY_COLORS[ZAND]
//       family (#fbbf24) but shifted away from it to avoid amber confusion
// SILT: green-yellow ramp
// KLEI: blue-grey ramp
// VEEN: brown ramp
// null / undefined → mid-grey (#9ca3af, same as LITHOLOGY_FALLBACK_COLOR)
const _NAD_CLASS_COLORS: Readonly<Record<number, string>> = {
  // GRIND (warm sandy-brown family, matig→dicht)
  1: '#c8966e', // GRIND, matig gp
  2: '#a37048', // GRIND, dicht gp
  3: '#b88560', // GRIND, silt-/kleihoudend, matig gp
  4: '#8c5e3a', // GRIND, silt- of kleihoudend, dicht gp
  // ZAND (yellow-orange family, los→zeer dicht; desaturated from base amber)
  5: '#e8d48a', // ZAND, los gp          — lightest
  6: '#d4b84a', // ZAND, matig gp
  7: '#b8963a', // ZAND, dicht gp
  8: '#8c7028', // ZAND, zeer dicht gp   — darkest
  9: '#d4cc8a', // ZAND, silt-/kleihoudend, los gp
  10: '#b8b04a', // ZAND, silt-/kleihoudend, matig gp
  11: '#9a943a', // ZAND, silt-/kleihoudend, dicht gp
  12: '#787228', // ZAND, silt-/kleihoudend, zeer dicht gp
  // SILT (yellow-green family, weinig vast→vast)
  13: '#d4e89a', // SILT, weinig vast     — lightest
  14: '#aac84a', // SILT, matig vast
  15: '#84a832', // SILT, vrij vast
  16: '#5e8420', // SILT, vast            — darkest
  17: '#c4d490', // SILT, zandhoudend, weinig vast
  18: '#9ab840', // SILT, zandhoudend, matig vast
  19: '#749a28', // SILT, zandhoudend, vrij vast
  20: '#4e7a14', // SILT, zandhoudend, vast
  // KLEI (blue-grey family, weinig vast→vast)
  21: '#b0bec8', // KLEI, weinig vast     — lightest
  22: '#8a9fb0', // KLEI, matig vast
  23: '#677e92', // KLEI, vrij vast
  24: '#506c87', // KLEI, vast            — darkest (lightened from near-black #445e74)
  25: '#a0b0c0', // KLEI, zandhoudend, weinig vast
  26: '#7a92a8', // KLEI, zandhoudend, matig vast
  27: '#587288', // KLEI, zandhoudend, vrij vast
  28: '#45607a', // KLEI, zandhoudend, vast (lightened from near-black #375268)
  // VEEN (dark-brown family, weinig vast→vast)
  29: '#a07050', // VEEN, weinig vast     — lightest
  30: '#7a5030', // VEEN, matig vast
  31: '#6b4630', // VEEN, vast            — darkest (lightened from near-black #54321a)
} as const

/** Neutral fallback colour for a degenerate null class (zero CPTs of a lithology). */
const _NULL_CLASS_COLOR = '#9ca3af' // mid-grey (same as LITHOLOGY_FALLBACK_COLOR)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the canonical packing-class label for a NAD class number.
 *
 * A null/undefined class is a rare degenerate case (no CPTs present for a
 * lithology).  Boreholes are classified by extrapolating the nearest CPT's
 * packing class, so null is never the normal borehole case.  Returning ``""``
 * for null lets the caller decide whether to render a label at all — the
 * partition-fill overlay skips empty strings (no label renders on a degenerate
 * band), and the geotech inspector row simply shows a neutral swatch.
 *
 * @param n  NAD class (1..31), null, or undefined.
 * @param language  The locale to render in; defaults to the active interface
 *                  language. Pass ``'en'`` explicitly for a language-STABLE
 *                  value (the logic/reverse-map/sort paths do exactly that).
 * @returns  The packing-class label in ``language`` for a valid class; ``""`` for
 *           null/undefined (degenerate — no label); or a safe numeric fallback
 *           ``"NAD {n}"`` for any out-of-range integer.
 */
export function nadClassName(
  n: number | null | undefined,
  language: Language = getLanguage(),
): string {
  if (n == null) return ''
  return nadNamesFor(language)[n] ?? `NAD ${n}`
}

/**
 * The name table for a language — ``'nl'`` selects the backend's canonical
 * Dutch source tokens, every other locale the English presentation table.
 * Selecting the table (never inventing) is the whole translation, per the
 * docs/ux.md domain-token rule.
 */
function nadNamesFor(language: Language): Readonly<Record<number, string>> {
  return language === 'nl' ? NAD_CLASS_NAMES_NL : NAD_CLASS_NAMES
}

/**
 * The compact ``{SOIL}·{packing}`` label for a NAD class, in the active language.
 *
 * The language-aware twin of a bare ``NAD_CLASS_ABBR[n]`` lookup — for a render
 * site (a band-edit menu, a ghost preview) that holds the class NUMBER rather
 * than the full name. Under ``'nl'`` the soil prefix is the Dutch source token
 * (ZAND / KLEI / …); out-of-range integers fall back to ``"NAD {n}"``.
 *
 * @param n  NAD class (1..31), null, or undefined.
 * @param language  The locale to render in; defaults to the active language.
 * @returns  The compact label; ``""`` for null/undefined (consistent with
 *           ``nadClassName``); ``"NAD {n}"`` for an out-of-range class.
 */
export function nadCompactLabel(
  n: number | null | undefined,
  language: Language = getLanguage(),
): string {
  if (n == null) return ''
  const table = language === 'nl' ? NAD_CLASS_ABBR_NL : NAD_CLASS_ABBR
  return table[n] ?? `NAD ${n}`
}

// The canonical names are ``"{SOIL}, {packing}"`` — "SAND, medium dense",
// "SILT, sandy, fairly firm". Splitting at the FIRST comma is therefore the
// soil/packing boundary for all 31 entries, and it keeps NAD_CLASS_NAMES the
// single source of truth (a parallel table would be a second place to edit
// when a label is refined).
const _NAD_NAME_SPLIT = ', '

/**
 * Return the SOIL-family word of a NAD class ("SAND" for 5..12).
 *
 * Presentation helper for grouped legends: the family header shows the soil,
 * the rows beneath it show the packing (``nadPackingLabel``), so neither
 * repeats the other.
 *
 * @param n  NAD class (1..31), null, or undefined.
 * @returns  The upper-case soil word; ``""`` for null/undefined; the whole
 *           fallback string for an out-of-range integer.
 */
export function nadSoilFamilyName(
  n: number | null | undefined,
  language: Language = getLanguage(),
): string {
  const full = nadClassName(n, language)
  const i = full.indexOf(_NAD_NAME_SPLIT)
  return i === -1 ? full : full.slice(0, i)
}

/**
 * Return the PACKING (density / firmness) part of a NAD class label.
 *
 * "SAND, medium dense" → ``"medium dense"``; "SILT, sandy, fairly firm" →
 * ``"sandy, fairly firm"`` (the admixture variant belongs to the packing side,
 * because it is what distinguishes class 18 from class 14 within one soil).
 *
 * @param n  NAD class (1..31), null, or undefined.
 * @returns  The packing phrase; ``""`` for null/undefined (the caller decides
 *           what an unclassified row says); the whole fallback string
 *           ``"NAD {n}"`` for an out-of-range integer.
 */
export function nadPackingLabel(
  n: number | null | undefined,
  language: Language = getLanguage(),
): string {
  const full = nadClassName(n, language)
  const i = full.indexOf(_NAD_NAME_SPLIT)
  return i === -1 ? full : full.slice(i + _NAD_NAME_SPLIT.length)
}

/**
 * The wording a unit with no packing class shows instead of nothing.
 *
 * A geotech unit exists before it is classified: the borehole materialiser
 * creates one per litho unit it subdivides and leaves ``nad_class`` null when
 * no cone reached that soil. ``nadClassName`` answers ``""`` for null by
 * design (the band overlay draws no label for an empty string), so every
 * roster that asked IT for the row text rendered a blank row — the bare "0"
 * rows in the owner's Geotech-units pane, 2026-08-26.
 *
 * Blank is the one thing these rows must not be: they are the ledger of
 * ground the model has not classified yet, so the row has to name the ground
 * and state the gap.
 */
const UNCLASSIFIED_QUALIFIER = 'not yet classified'

/** Joins the soil word to the unclassified qualifier ("SAND, not yet classified"). */
const UNCLASSIFIED_SEPARATOR = ', '

/**
 * Return the soil-family word for a geotech unit ("SAND", "CLAY", ...).
 *
 * A geotech unit knows its soil twice over and the two answers must agree, so
 * this is the single place that picks between them:
 *
 * * **Classified** (``nad_class`` set) → ``nadSoilFamilyName`` (the leading
 *   word of the class name; the split is exact for all 31 entries, pinned by
 *   ``L13``).
 * * **Unclassified** → the inherited ``litho_main_soil_code`` translated
 *   through ``LITHOLOGY_LABELS`` and upper-cased, which yields the SAME five
 *   words (ZAND → SAND, KLEI → CLAY, ...). A skeleton therefore groups under
 *   the same header as the classified units of its own ground.
 * * Neither available → the stored ``name``, so the unit is still identified
 *   rather than reduced to an empty header.
 *
 * @param unit  A geotech formation (``nad_class`` / ``litho_main_soil_code`` / ``name``).
 * @returns  The soil-family word used as the roster group header.
 */
export function geotechUnitSoil(
  unit: {
    nad_class: number | null | undefined
    litho_main_soil_code?: string | null
    name?: string | null
  },
  language: Language = getLanguage(),
): string {
  if (unit.nad_class != null && NAD_CLASS_NAMES[unit.nad_class] !== undefined) {
    return nadSoilFamilyName(unit.nad_class, language)
  }
  const soilCode = unit.litho_main_soil_code
  if (soilCode != null && soilCode !== '') {
    const labels = language === 'nl' ? LITHOLOGY_LABELS_NL : LITHOLOGY_LABELS
    return (labels[soilCode] ?? soilCode).toUpperCase()
  }
  return unit.name ?? ''
}

/**
 * Return the firmness / density part of a NAD class name — the soil word removed.
 *
 * The roster nests NAD classes under a soil header, so repeating the soil on
 * every child row ("SAND ▸ SAND, medium dense") is noise. Classified values
 * delegate to ``nadPackingLabel`` (one split, one source of truth); the null
 * case answers the unclassified wording instead of ``""`` because a ROSTER
 * row, unlike a band label, must never be blank.
 *
 * @param n  NAD class (1..31), or null for a unit with no class yet.
 * @returns  The qualifier for a known class; ``"not yet classified"`` for
 *           null; ``"NAD {n}"`` for an out-of-range integer.
 */
export function nadClassQualifier(
  n: number | null | undefined,
  language: Language = getLanguage(),
): string {
  if (n == null) return language === 'nl' ? UNCLASSIFIED_QUALIFIER_NL : UNCLASSIFIED_QUALIFIER
  if (NAD_CLASS_NAMES[n] === undefined) return `NAD ${n}`
  return nadPackingLabel(n, language)
}

/**
 * Return the roster display name for a geotech unit — never the empty string.
 *
 * This is the formatter every geotech ROSTER surface uses (inspector rows,
 * the selected-body panel, the 3D body legend). ``nadClassName`` stays the raw
 * 1..31 table lookup and keeps answering ``""`` for null, because the section
 * band overlay relies on an empty label meaning "draw no text".
 *
 * * Classified → the packing-class name, unchanged ("SAND, medium dense").
 * * Unclassified → ``"{SOIL} — not yet classified"``, optionally followed by
 *   the source litho unit in parentheses.
 *
 * ``sourceLithoName`` is a DISAMBIGUATOR, passed only when several
 * unclassified units of the same soil are on screen together — the owner
 * project carries five separate "KLEI (geotech)" skeletons, each born from a
 * different litho formation, which read as five copies of one row without it.
 * Passing it unconditionally would put a parenthetical on rows that have
 * nothing to be told apart from.
 *
 * @param unit  A geotech formation (``nad_class`` / ``litho_main_soil_code`` / ``name``).
 * @param sourceLithoName  Display name of the source litho unit, or null/undefined
 *                         when there is nothing to disambiguate against.
 * @returns  A non-empty display label.
 */
export function geotechUnitLabel(
  unit: {
    nad_class: number | null | undefined
    litho_main_soil_code?: string | null
    name?: string | null
  },
  sourceLithoName?: string | null,
  language: Language = getLanguage(),
): string {
  if (unit.nad_class != null) {
    const full = nadNamesFor(language)[unit.nad_class]
    if (full !== undefined) return full
  }
  const soil = geotechUnitSoil(unit, language)
  const base = `${soil}${UNCLASSIFIED_SEPARATOR}${nadClassQualifier(unit.nad_class, language)}`
  return sourceLithoName == null || sourceLithoName === '' ? base : `${base} (${sourceLithoName})`
}

/**
 * Return a deterministic ``#rrggbb`` colour for a NAD class number.
 *
 * The palette encodes packing density as lightness within each soil family
 * (loosest = lightest, densest = darkest). It is a placeholder v1 palette
 * suitable for the geotech section bands + inspector legend.
 *
 * @param n  NAD class (1..31), null, or undefined.
 * @returns  A six-digit hex colour string. null/undefined returns the neutral
 *           mid-grey ``#9ca3af`` (degenerate-band state — no CPTs for this lithology).
 */
export function nadClassColor(n: number | null | undefined): string {
  if (n == null) return _NULL_CLASS_COLOR
  return _NAD_CLASS_COLORS[n] ?? _NULL_CLASS_COLOR
}

/**
 * The colour a geotech unit is drawn in — the ONE rule, for every surface.
 *
 * An explicitly picked colour wins over the automatic NAD packing colour, on
 * the pane swatch, the section fills, the 3-D solids and the legend alike.
 * Owner ruling 2026-08-26: *"Colours on the right hand pane need to be
 * choosable if user wants."*
 *
 * ``color_override`` is the pick and ``null`` means nobody picked, which is why
 * the pick is a separate field rather than a value compared against the
 * automatic colour: the engineer is allowed to choose exactly the colour the
 * NAD ramp would have produced, and that choice must survive the unit later
 * changing class. It is also why ``color`` is NOT consulted here — on a geotech
 * unit that field holds the lithology colour ``GeotechBoreholeMaterialiser``
 * copied from the source litho unit at create, a machine default that says
 * nothing about intent.
 *
 * UNCLASSIFIED GRAVEL is the exception to the null grey (owner ruling, installer
 * #26 2026-09-08: *"is gravel grey in color, seems too close to clay for me?"*).
 * A null-class band normally reads neutral grey — "no CPT covers this, classify
 * it". Gravel, though, is routinely UN-classifiable: CPTs refuse in gravel, so a
 * gravel band expected to stay unclassified drawn in the same grey as clay's
 * blue-greys is a confusion, not a to-do. So an unclassified gravel unit is
 * drawn in its LITHOLOGY colour (amber) instead — it reads as gravel, distinct
 * from clay. Every other soil keeps the neutral grey, where "unclassified" IS a
 * missing-CPT exception worth flagging. An engineer's ``color_override`` still
 * wins over both.
 *
 * @param unit  A geotech unit — ``nad_class`` + optional ``color_override`` and
 *              ``litho_main_soil_code`` (the soil; only read for the null-class
 *              gravel exception).
 * @returns  A ``#rrggbb`` colour.
 */
export function geotechUnitColor(unit: {
  nad_class: number | null | undefined
  color_override?: string | null
  litho_main_soil_code?: string | null
}): string {
  if (unit.color_override != null) return unit.color_override
  // Unclassified gravel reads as gravel (its lithology amber), not the null
  // grey that clashes with clay — CPTs cannot penetrate gravel, so its
  // unclassified state is expected, not a missing-CPT exception.
  if (unit.nad_class == null && unit.litho_main_soil_code === 'GRIND') {
    return LITHOLOGY_COLORS.GRIND
  }
  return nadClassColor(unit.nad_class)
}

/**
 * Return copies of the given formations with each ``color`` replaced by the
 * colour the unit is drawn in (``geotechUnitColor``).
 *
 * Presentation-boundary transform for the 3D geotech body viewer. A geotech
 * (``kind='geotechnical'``) formation stores the *lithology* colour it inherited
 * from its source litho formation (``SubdivideAllBodies._find_or_create_classified``
 * copies ``source_litho.color``), but a geotech body must be coloured by its NAD
 * packing class — or by the engineer's own pick where he made one, which is what
 * ``geotechUnitColor`` decides. The 3D viewer (``Geology3DViewer``) colours each
 * body solid by ``solid.display_color ?? formation.color`` matched on
 * ``formation_id``, so recolouring the formations here is the seam that reaches
 * the built geotech 3D bodies without any backend or viewer change.
 *
 * The input is never mutated — a shallow copy is returned per formation. Non-colour
 * fields are carried through verbatim, ``color_override`` included, so a consumer
 * downstream can still tell a pick from a default.
 *
 * @typeParam T  Any object carrying ``nad_class`` and ``color`` (e.g.
 *               ``GeologicalFormationResponse``), optionally ``color_override``.
 * @param formations  The geotech formations to recolour.
 * @returns  A new array of shallow copies with ``color`` set to the drawn
 *           colour; ``[]`` for empty input.
 */
export function nadColoredFormations<
  T extends { nad_class: number | null; color: string; color_override?: string | null },
>(formations: readonly T[]): T[] {
  return formations.map(f => ({ ...f, color: geotechUnitColor(f) }))
}

// Reverse map full NAD name → compact label, built once from the parallel
// 1..31 tables (no string parsing — an exact-name lookup). Lets a render site
// that holds only the full ``formationName`` string (the section band label)
// derive the compact form without re-plumbing ``nad_class`` through the band.
//
// BOTH languages are keyed: the section band's ``formationName`` is itself a
// display name (``nadClassName``), so under NL it is the Dutch full name and the
// reverse lookup must still resolve it — to the Dutch compact. The map is
// language-independent BY covering every language, not by ignoring language.
const _FULLNAME_TO_COMPACT: ReadonlyMap<string, string> = new Map([
  ...Object.entries(NAD_CLASS_NAMES).map(
    ([key, fullName]) => [fullName, NAD_CLASS_ABBR[Number(key)]] as const,
  ),
  ...Object.entries(NAD_CLASS_NAMES_NL).map(
    ([key, fullName]) => [fullName, NAD_CLASS_ABBR_NL[Number(key)]] as const,
  ),
])

/**
 * Translate a full NAD name ("SAND, medium dense") to its compact form
 * ("SAND·MD"). Any string that is not a known NAD name (e.g. the
 * "ZAND (geotech)" fallback for an unclassified band, or a non-geotech
 * formation name) is returned unchanged, so the caller can apply this
 * unconditionally on the geotech axis.
 *
 * @param fullName  A formation display name.
 * @returns  The compact label if ``fullName`` is a known NAD name; otherwise
 *           ``fullName`` verbatim.
 */
export function nadCompactFromName(fullName: string): string {
  return _FULLNAME_TO_COMPACT.get(fullName) ?? fullName
}

/**
 * The NAD class-number ranges per soil family, both variants included.
 *
 * A hand-set class must stay inside the band's own soil family; the server
 * validates against the norm table, this map only drives the MENU so it never
 * offers a class the server would refuse. Mirrors the ``NAD_CLASS_NAMES``
 * grouping above — the class numbers are stable norm facts (ANB Tabel 2.1).
 */
const NAD_FAMILY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 4], // GRAVEL
  [5, 12], // SAND
  [13, 20], // SILT
  [21, 28], // CLAY
  [29, 31], // PEAT
]

/**
 * The soil-family words in NAD class-number order — GRAVEL, SAND, SILT, CLAY,
 * PEAT.
 *
 * Derived from the ranges above rather than hand-listed, so it can never drift
 * from ``NAD_CLASS_NAMES``. Grouped legends sort their family rows by this
 * order (the norm's own order, which is also loosest-soil-last).
 */
// English-canonical: this is a LOGIC order (legend family sorting keys off it),
// so it must never shift with the interface language — ``'en'`` pins it.
export const NAD_SOIL_FAMILY_ORDER: readonly string[] = NAD_FAMILY_RANGES.map(
  ([lo]) => nadSoilFamilyName(lo, 'en'),
)

// There is deliberately NO `nadClassFamily(nadClass)` here — a "the family of
// the class this band happens to carry" helper. It existed until 2026-08-26 and
// it was what built the hand-set menu, which meant a band stamped with a
// foreign class offered only more classes of that wrong family: the one state
// that needs correcting was the one state the UI could not correct. The
// question a picker asks is what this GROUND can be, and `nadClassesForSoil`
// below is the only helper that answers it. Re-adding the class-keyed form
// fails `nadClasses.test.ts` ("the coupling is asked of the soil").

// Raw soil code -> that soil's class range, derived from the two tables that
// already exist rather than hand-listed: LITHOLOGY_LABELS translates the code
// to the English word ("ZAND" -> "Sand"), and NAD_CLASS_NAMES' own leading word
// is what NAD_FAMILY_RANGES' first class reports. Nothing here is a third
// statement of the coupling, so nothing here can drift from the other two.
const _RANGE_BY_SOIL_CODE: ReadonlyMap<string, readonly [number, number]> = new Map(
  Object.keys(LITHOLOGY_LABELS)
    .map(code => {
      const word = (LITHOLOGY_LABELS[code] ?? code).toUpperCase()
      // English on both sides — a stable coupling key, never language-dependent.
      const range = NAD_FAMILY_RANGES.find(([lo]) => nadSoilFamilyName(lo, 'en') === word)
      return range === undefined ? null : ([code, range] as const)
    })
    .filter((entry): entry is readonly [string, readonly [number, number]] => entry !== null),
)

/**
 * Every NAD class a unit of this SOIL may carry.
 *
 * Owner ruling 2026-08-26: *"no a zand body can never carry a silt packing
 * class"* — *"the nad coupling is absolute."* A packing class describes one
 * soil column, so the ground decides the menu, not whatever class the band
 * happens to hold. This is the frontend twin of the backend's
 * ``hand_settable_classes_for``; the server validates against the norm table
 * either way, and this only keeps the menu from offering something it would
 * refuse.
 *
 * @param soilCode  Raw ``litho_main_soil_code`` of the band's parent litho
 *                  unit ("ZAND", "KLEI", ...) — the upstream token, untranslated.
 * @returns  The soil's class numbers ascending; ``[]`` for a soil the norm
 *           table does not know (the caller offers nothing rather than
 *           guessing a family).
 */
export function nadClassesForSoil(soilCode: string | null | undefined): readonly number[] {
  if (soilCode == null || soilCode === '') return []
  const range = _RANGE_BY_SOIL_CODE.get(soilCode)
  if (range === undefined) return []
  const [lo, hi] = range
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

/**
 * Whether a class sits on ground of a different soil family — a "stranger".
 *
 * Two cases are deliberately NOT strangers, because neither has a foreign
 * family to convict: an unclassified band (no class at all), and a unit whose
 * soil the norm table does not know (no family to judge against). Mirrors the
 * backend predicate ``class_belongs_to_soil`` so the two surfaces agree about
 * which rows are legacy strangers.
 *
 * @param nadClass  The class the band currently carries, or null.
 * @param soilCode  Raw ``litho_main_soil_code`` of the parent litho unit.
 * @returns  ``true`` only when both families are known and they differ.
 */
export function nadClassIsForeignToSoil(
  nadClass: number | null | undefined,
  soilCode: string | null | undefined,
): boolean {
  if (nadClass == null) return false
  const own = nadClassesForSoil(soilCode)
  if (own.length === 0) return false
  return !own.includes(nadClass)
}
