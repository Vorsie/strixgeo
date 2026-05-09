// Categorical colours for DOV field-log values used by the field-log
// track in the borelog. The track has three sub-stripes:
//
// * ``color`` — soil colour observed by the driller (groenbruin,
//   bruingroen, groengrijs, ...). DOV uses Dutch compound words; we
//   parse the first colour token and pick a representative hex.
// * ``moisture`` — vochtgehalte: weinig vochtig / vochtig / nat
// * ``consistency`` — slap / matig / stevig / hard
//
// The colours are visual cues only; the literal value text is shown
// in the cell so users always see the source-vocabulary string.

const COLOR_KEYWORDS: Record<string, string> = {
  // Base hues
  bruin: '#8b6f47',
  groen: '#6b8e23',
  grijs: '#888888',
  rood: '#a83232',
  geel: '#d8b04a',
  zwart: '#222222',
  wit: '#ededed',
  blauw: '#4682b4',
}

/**
 * Pick a representative hex for a DOV soil-colour string.
 *
 * DOV uses compound words like "groenbruin" (greenish-brown). We match
 * the FIRST keyword found and return its base hue — close enough for a
 * visual stripe, and the literal string is also shown in the cell so
 * the exact source value isn't lost.
 *
 * Returns a neutral grey for unrecognised input.
 */
export function fieldColorFill(value: string | null | undefined): string {
  if (!value) return '#dddddd'
  const lower = value.toLowerCase()
  for (const [keyword, hex] of Object.entries(COLOR_KEYWORDS)) {
    if (lower.includes(keyword)) return hex
  }
  return '#dddddd'
}

/**
 * Map DOV moisture vocabulary to a wetness gradient (dry → wet).
 */
export function moistureFill(value: string | null | undefined): string {
  if (!value) return '#dddddd'
  const v = value.toLowerCase()
  if (v.includes('droog')) return '#f5d18a' // dry — sandy yellow
  if (v.includes('weinig')) return '#9bbcd4' // weakly moist — light blue
  if (v.includes('nat')) return '#1f5077' // wet — deep blue
  if (v.includes('vochtig')) return '#5b96bd' // moist — mid blue
  return '#dddddd'
}

/**
 * Map DOV consistency vocabulary to a hardness gradient (soft → hard).
 */
export function consistencyFill(value: string | null | undefined): string {
  if (!value) return '#dddddd'
  const v = value.toLowerCase()
  if (v.includes('slap')) return '#fce5b8' // soft — pale
  if (v.includes('matig')) return '#e8b88a' // moderate — tan
  if (v.includes('stevig')) return '#a87645' // firm — brown
  if (v.includes('hard')) return '#5a3d1f' // hard — dark brown
  return '#dddddd'
}
