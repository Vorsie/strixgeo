/**
 * NAD geotechnical packing-class lookup table: names + colours.
 *
 * Translate-at-presentation-boundary rule: the backend stores raw NAD class
 * integers (1..31) with the canonical DUTCH labels (``litho_constants.py``
 * NAD_CLASSES, ported verbatim from the NAD-NEN sheet); this module is the
 * single frontend translation point and renders them in ENGLISH (the app's UI
 * language). Density terms are the standard CPT classes (loose / medium dense /
 * dense / very dense); fines use firmness (slightly / moderately / fairly firm /
 * firm) — refine the exact geotech terminology here if preferred.
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
  // GRAVEL — 4 density classes
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
 * @returns  The verbatim backend label for a valid class; ``""`` for
 *           null/undefined (degenerate — no label); or a safe numeric fallback
 *           ``"NAD {n}"`` for any out-of-range integer.
 */
export function nadClassName(n: number | null | undefined): string {
  if (n == null) return ''
  return NAD_CLASS_NAMES[n] ?? `NAD ${n}`
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
