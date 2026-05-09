// Solid colours for DOV soil-type tokens, used by ``BoreholeLog`` to fill
// observation-layer rectangles in the borelog.
//
// The colours follow international geotechnical convention (ENISO 14689 /
// USCS-style colour cues, adapted from DOV's PDF report):
//
// * sands      → tan / yellow
// * clays      → blue-grey
// * silts      → tan-grey
// * loam       → brown
// * lime/chalk → off-white
// * glauconite → distinctive green
// * sandstone  → brown-grey
// * stones     → dark grey
// * shells     → cream
//
// PR 4a uses solid fills only. PR 4b will replace these with SVG ``<pattern>``
// hatching that mirrors DOV's PDF (dotted for sand, diagonal for clay,
// V-chevrons for glauconite, brick for stones, …).

export interface SoilStyle {
  /** CSS-compatible fill colour for the layer rectangle. */
  fill: string
  /** Short English label shown in the legend; raw DOV token is the `code`. */
  label: string
}

/**
 * Lookup table from DOV soil-token to colour + English label.
 *
 * Token list comes from the project's ``reference_dov_codelists`` memory:
 * FZ = fijn zand (fine sand), KL = klei (clay), GL = glauconiet, LE = leem,
 * KA = kalk, SI = silt, ZG = grof zand (coarse sand), XZ = stenen (stones),
 * ZS = zandsteen (sandstone), NN = schelpgruis (shell fragments).
 *
 * If we encounter a token that isn't in this table, callers fall through to
 * `FALLBACK` so rendering never breaks; the legend will show "unknown" and
 * we'll add the missing entry as soon as a real-data import surfaces it.
 */
export const SOIL_COLORS: Record<string, SoilStyle> = {
  // Sands — yellow-to-tan family
  ZG: { fill: '#f0c668', label: 'coarse sand' },
  FZ: { fill: '#f5e0a4', label: 'fine sand' },
  // Clays — muted blue-grey
  KL: { fill: '#7d8da0', label: 'clay' },
  // Silts — pale tan-grey
  SI: { fill: '#c9b88d', label: 'silt' },
  // Loam — earthy brown
  LE: { fill: '#a08868', label: 'loam' },
  // Lime / chalk — almost white
  KA: { fill: '#e8e6d8', label: 'lime' },
  // Glauconite — saturated olive-green
  GL: { fill: '#6b8e23', label: 'glauconite' },
  // Sandstone — warm brown
  ZS: { fill: '#8b6f47', label: 'sandstone' },
  // Stones / fragments — dark slate
  XZ: { fill: '#5a5a5a', label: 'stones' },
  // Shell fragments — cream
  NN: { fill: '#e6dfc8', label: 'shell fragments' },
}

const FALLBACK: SoilStyle = { fill: '#cccccc', label: 'unknown' }

/**
 * Resolve a DOV soil-token to its render style.
 *
 * Returns the `FALLBACK` (grey, label "unknown") for empty / null /
 * unrecognised tokens — the borelog renders something visible regardless of
 * dictionary coverage; missing tokens are a content gap to fix with new
 * `SOIL_COLORS` entries, never a runtime error.
 */
export function soilStyle(code: string | null | undefined): SoilStyle {
  if (!code) return FALLBACK
  return SOIL_COLORS[code] ?? FALLBACK
}
