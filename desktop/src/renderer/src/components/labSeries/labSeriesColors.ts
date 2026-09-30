// Mark colours of the lab-series charts.
//
// Specimens (a / b / c) are IDENTITY → categorical slots 1-3 of the reference
// palette, which validate all-pairs for CVD in light and dark (dataviz skill,
// references/palette.md). A fourth specimen folds back to slot 1: the legend
// and the "Specimen x" label carry identity, never colour alone.
//
// Stages are an ORDERED sequence (load step 1 → n) → one sequential blue ramp,
// light → dark, so "later stage = darker" reads without a legend lookup.

/** Categorical slots 1-3 (blue, orange, aqua). */
export const SPECIMEN_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'] as const

// Ends of the sequential stage ramp (light blue → deep blue).
const RAMP_LIGHT = [0x9c, 0xc3, 0xf0]
const RAMP_DARK = [0x0d, 0x3b, 0x78]

/** Colour of the specimen at ``index`` (0-based). */
export function specimenColor(index: number): string {
  return SPECIMEN_COLORS[index % SPECIMEN_COLORS.length]
}

/** Colour of stage ``index`` (0-based) out of ``count`` on the sequential ramp. */
export function stageColor(index: number, count: number): string {
  const f = count <= 1 ? 1 : index / (count - 1)
  const rgb = RAMP_LIGHT.map((a, i) => Math.round(a + (RAMP_DARK[i] - a) * f))
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
}
