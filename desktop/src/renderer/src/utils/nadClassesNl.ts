// Dutch (Flemish) NAD packing-class labels — the presentation-boundary NL forms
// of ``nadClasses.ts``'s English tables.
//
// Split out of ``nadClasses.ts`` (500-line ceiling, debt #201) and to keep the
// NL vocabulary in one reviewable place.
//
// The full names are the backend's OWN canonical Dutch strings, verbatim from
// ``NAD_CLASSES`` in ``src/groundmodel/shared/constants/litho_constants.py`` —
// rendering Dutch here is SELECTING the source token, not inventing one. "gp" is
// the norm sheet's abbreviation for "gepakt" (packed).
//
// FLAG (owner): (1) the full names keep the norm's terse "gp" — say if you would
// rather see it expanded to "gepakt" in the UI. (2) The compact abbreviations
// translate only the SOIL prefix (ZAND / KLEI / SILT / VEEN / GRIND); the packing
// codes (MD / D / VD / L / SF / MF / FF / F) and the admixture markers ((f)/(s))
// are left in the English short form — say if you want Dutch packing codes.

/**
 * NAD class number (1..31) → canonical Dutch packing-class label.
 *
 * Verbatim from the backend ``NAD_CLASSES`` source tokens. Split at the first
 * ``", "`` gives the soil word (ZAND / KLEI / ...), matching how the English
 * table is split — so the same soil-family + packing helpers work unchanged.
 */
export const NAD_CLASS_NAMES_NL: Readonly<Record<number, string>> = {
  1: 'GRIND, matig gp',
  2: 'GRIND, dicht gp',
  3: 'GRIND, silt-/kleihoudend, matig gp',
  4: 'GRIND, silt- of kleihoudend, dicht gp',
  5: 'ZAND, los gp',
  6: 'ZAND, matig gp',
  7: 'ZAND, dicht gp',
  8: 'ZAND, zeer dicht gp',
  9: 'ZAND, silt-/kleihoudend, los gp',
  10: 'ZAND, silt-/kleihoudend, matig gp',
  11: 'ZAND, silt-/kleihoudend, dicht gp',
  12: 'ZAND, silt-/kleihoudend, zeer dicht gp',
  13: 'SILT, weinig vast',
  14: 'SILT, matig vast',
  15: 'SILT, vrij vast',
  16: 'SILT, vast',
  17: 'SILT, zandhoudend, weinig vast',
  18: 'SILT, zandhoudend, matig vast',
  19: 'SILT, zandhoudend, vrij vast',
  20: 'SILT, zandhoudend, vast',
  21: 'KLEI, weinig vast',
  22: 'KLEI, matig vast',
  23: 'KLEI, vrij vast',
  24: 'KLEI, vast',
  25: 'KLEI, zandhoudend, weinig vast',
  26: 'KLEI, zandhoudend, matig vast',
  27: 'KLEI, zandhoudend, vrij vast',
  28: 'KLEI, zandhoudend, vast',
  29: 'VEEN, weinig vast',
  30: 'VEEN, matig vast',
  31: 'VEEN, vast',
} as const

/**
 * NAD class number (1..31) → compact ``{SOIL}·{packing}`` label, Dutch soil word.
 *
 * Parallel to the English ``NAD_CLASS_ABBR``: only the leading soil word is
 * translated to the Dutch source token; the packing codes are the same short
 * form the English abbreviation uses (see the FLAG above).
 */
export const NAD_CLASS_ABBR_NL: Readonly<Record<number, string>> = {
  1: 'GRIND·MD',
  2: 'GRIND·D',
  3: 'GRIND(f)·MD',
  4: 'GRIND(f)·D',
  5: 'ZAND·L',
  6: 'ZAND·MD',
  7: 'ZAND·D',
  8: 'ZAND·VD',
  9: 'ZAND(f)·L',
  10: 'ZAND(f)·MD',
  11: 'ZAND(f)·D',
  12: 'ZAND(f)·VD',
  13: 'SILT·SF',
  14: 'SILT·MF',
  15: 'SILT·FF',
  16: 'SILT·F',
  17: 'SILT(s)·SF',
  18: 'SILT(s)·MF',
  19: 'SILT(s)·FF',
  20: 'SILT(s)·F',
  21: 'KLEI·SF',
  22: 'KLEI·MF',
  23: 'KLEI·FF',
  24: 'KLEI·F',
  25: 'KLEI(s)·SF',
  26: 'KLEI(s)·MF',
  27: 'KLEI(s)·FF',
  28: 'KLEI(s)·F',
  29: 'VEEN·SF',
  30: 'VEEN·MF',
  31: 'VEEN·F',
} as const

/** Dutch wording a unit with no packing class shows. English: "not yet classified". */
export const UNCLASSIFIED_QUALIFIER_NL = 'nog niet ingedeeld'
