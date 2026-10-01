// Translation tables for DOV lab-test parameter strings + USCS / ASTM
// classification codes.
//
// Per project memory rule "translation lives at the presentation
// boundary" — these tables only ever drive what the user sees in the
// LabTestPanel. The API + DB still ship raw DOV tokens, so exports and
// future integrations stay tied to the source vocabulary.
//
// Source for parameter strings: live DOV WFS responses (verified
// 2026-05-09). Source for ASTM/USCS code descriptions: ASTM D2487
// "Standard Practice for Classification of Soils for Engineering
// Purposes (USCS)".

const PARAMETER_GROUP_LABELS: Record<string, string> = {
  // trailing-space variants are how DOV ships them — match exactly.
  'Volumemassa-watergehalte ': 'Density & water content',
  'Volumemassa-watergehalte': 'Density & water content',
  'Onderkenning-grondsoort': 'Soil identification',
  'Onderkenning - proeven': 'Identification tests',
  Bodem_chemisch: 'Soil chemistry',
  Bodem_fysisch_vocht: 'Soil moisture',
  'Onderkenningsproeven-korrelverdeling ': 'Grain-size analysis',
  'Onderkenningsproeven-korrelverdeling': 'Grain-size analysis',
}

// Parameter strings — keyed on the form WITHOUT the doubled paren tail
// (e.g. "Korrelvolumemassa" rather than "Korrelvolumemassa
// (korrelvolumemassa)") because we already strip that tail before lookup.
const PARAMETER_LABELS: Record<string, string> = {
  Korrelvolumemassa: 'Grain density',
  'Volumemassa nat': 'Wet bulk density',
  Watergehalte: 'Water content',
  'Grondsoort volgens ASTM, de code': 'ASTM classification',
  'Grondsoort volgens ASTM, de beschrijving': 'ASTM classification (text)',
  'Grondsoort volgens BGGG norm': 'BGGG soil classification',
  'Gehalte Kalkachtige stoffen': 'Calcareous content (descriptive)',
  'Gehalte Organische stoffen': 'Organic matter content',
  // The DOV parameter name itself contains "(MB)" (methylene blue method),
  // so after stripping the doubled-tail in `labelForParameter` the key is
  // "Bepaling kleihoudendheid in fractie 0-2 mm (MB)" (NOT just "...0-2 mm").
  'Bepaling kleihoudendheid in fractie 0-2 mm (MB)': 'Clay content (methylene blue, 0–2 mm)',
  Calciumcarbonaatgehalte: 'Calcium carbonate (CaCO₃)',
  'Organische C - percentage': 'Organic carbon',
  'Vochtgehalte luchtdroge grond': 'Water content (air-dried)',
  'Consistentiegrenzen - Vloeigrens': 'Liquid limit',
  'Consistentiegrenzen - Uitrolgrens': 'Plastic limit',
}

// USCS / ASTM D2487 soil classification codes. Single-symbol codes plus
// the common dual-symbol borderline classifications. Lower-case lookup
// for resilience against case variation in DOV's data.
const ASTM_CODE_LABELS: Record<string, string> = {
  // Coarse-grained — gravels
  gw: 'Well-graded gravel',
  gp: 'Poorly-graded gravel',
  gm: 'Silty gravel',
  gc: 'Clayey gravel',
  'gw-gm': 'Well-graded silty gravel',
  'gw-gc': 'Well-graded clayey gravel',
  'gp-gm': 'Poorly-graded silty gravel',
  'gp-gc': 'Poorly-graded clayey gravel',
  'gc-gm': 'Silty-clayey gravel',
  // Coarse-grained — sands
  sw: 'Well-graded sand',
  sp: 'Poorly-graded sand',
  sm: 'Silty sand',
  sc: 'Clayey sand',
  'sw-sm': 'Well-graded silty sand',
  'sw-sc': 'Well-graded clayey sand',
  'sp-sm': 'Poorly-graded silty sand',
  'sp-sc': 'Poorly-graded clayey sand',
  'sc-sm': 'Silty-clayey sand',
  // Fine-grained — low plasticity (LL < 50)
  ml: 'Silt (low plasticity)',
  cl: 'Clay (lean, low plasticity)',
  ol: 'Organic silt or clay (low plasticity)',
  'cl-ml': 'Silty clay (low plasticity)',
  // Fine-grained — high plasticity (LL ≥ 50)
  mh: 'Silt (high plasticity, elastic)',
  ch: 'Clay (fat, high plasticity)',
  oh: 'Organic silt or clay (high plasticity)',
  // Highly organic
  pt: 'Peat',
}

/**
 * Translate a DOV parametergroep string to an English label.
 *
 * Falls back to the trimmed source string when no translation exists,
 * so unknown groups still display something readable.
 */
export function labelForParameterGroup(raw: string): string {
  const exact = PARAMETER_GROUP_LABELS[raw]
  if (exact) return exact
  return raw.trim() || '—'
}

/**
 * Strip DOV's doubled-token tail from a parameter string.
 *
 * DOV ships e.g. ``Korrelvolumemassa (korrelvolumemassa)`` or
 * ``Grondsoort volgens ASTM, de code (ASTM_code)``: the name, then the
 * same parameter again as a slug in parentheses. Only the LAST parenthesised
 * group goes, so a name that itself ends in "(MB)" keeps it.
 *
 * @param raw - The parameter string as the API returns it.
 * @returns The name without the tail, trimmed.
 */
export function stripDovDoubledTail(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

/**
 * Translate a DOV parameter string to an English label.
 *
 * The DOV doubled-token-in-parens tail (e.g. ``Korrelvolumemassa
 * (korrelvolumemassa)``) is stripped before lookup so callers can pass
 * the raw value as it arrives from the API.
 */
export function labelForParameter(raw: string): string {
  const trimmed = stripDovDoubledTail(raw)
  const exact = PARAMETER_LABELS[trimmed]
  if (exact) return exact
  return trimmed || raw
}

/**
 * Return the English description for a USCS / ASTM D2487 soil code, or
 * ``null`` if the code isn't recognised. Case-insensitive: ``"CL"``,
 * ``"Cl"``, and ``"cl"`` all resolve.
 */
export function astmDescription(code: string | null | undefined): string | null {
  if (!code) return null
  return ASTM_CODE_LABELS[code.trim().toLowerCase()] ?? null
}

/**
 * True when the supplied parameter is the ASTM classification — the one
 * scalar test whose value is a categorical CODE rather than a number,
 * needing a description below.
 */
export function isAstmClassification(rawParameter: string): boolean {
  return rawParameter.startsWith('Grondsoort volgens ASTM')
}
