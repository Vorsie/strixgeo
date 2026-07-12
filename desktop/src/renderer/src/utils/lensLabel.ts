/**
 * Display-label helpers for bodies.
 *
 * Only the lithology abbreviation survives here: the depth-rank
 * auto-labelling (lensAutoLabel / lensDisplayLabel /
 * computeDepthStacking) was retired with the BodyExtentOverlay.
 */

/** Base-lithology token → 1–2 letter abbreviation (owner directive
 *  2026-06-01): Gravel→G, Silt→Si, Sand→Sa, Clay→C, Peat→P. */
const LITHOLOGY_ABBREV: Record<string, string> = {
  GRIND: 'G',
  SILT: 'Si',
  ZAND: 'Sa',
  KLEI: 'C',
  VEEN: 'P',
}

/**
 * Abbreviate a base lithology token. Unknown tokens fall back to their first
 * two characters (title-cased) so a non-core soil still yields something.
 */
export function lithologyAbbrev(lithology: string | null | undefined): string {
  const raw = lithology?.trim()
  if (!raw) return ''
  const known = LITHOLOGY_ABBREV[raw.toUpperCase()]
  if (known) return known
  return raw.charAt(0).toUpperCase() + raw.slice(1, 2).toLowerCase()
}
