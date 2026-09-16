// Vertical-datum label lookup keyed by EPSG code.
//
// 5710 → mTAW (Belgium)
// 5709 → NAP  (Netherlands)
//
// Used wherever the UI shows a Z-value (chart Y-axis label, borelog header,
// tooltip, ElevationEditor). Stays in the presentation layer per the
// "translate at the boundary" rule — backend always stores EPSG ints.
//
// Adding a country: drop a new entry here. Adding a non-country/special
// datum: still drop an entry here; the user-facing label is the only thing
// that changes.

export const VCRS_LABEL_BY_EPSG: Record<number, string> = {
  5710: 'm TAW',
  5709: 'm NAP',
}

// Pragmatic fallback when the vertical EPSG is unknown or null. Better
// honest than wrong: never claim a datum we can't identify.
export const VCRS_LABEL_FALLBACK = 'm'

// EPSG codes the editor's datum-picker offers. Keep in sync with
// VCRS_LABEL_BY_EPSG; if a datum exists in the lookup but isn't pickable,
// the user can still see its label after the backend assigns it but can't
// override to it. Today every supported datum is pickable.
export const PICKABLE_VERTICAL_EPSGS: ReadonlyArray<number> = [5710, 5709]

// Horizontal CRSes the project metadata editor offers as the "default
// horizontal CRS" for manual entries. Same two countries the vertical
// list covers (BE / NL); adding a third country is a one-line entry
// here + in DEFAULT_VERTICAL_EPSG. Co-located here so any future
// horizontal-CRS picker (e.g. an ElevationEditor extension — debt #16)
// reuses the same source list.
export const PICKABLE_HORIZONTAL_EPSGS: ReadonlyArray<{
  epsg: number
  label: string
}> = [
  { epsg: 31370, label: 'BE: Lambert 72 (EPSG:31370)' },
  { epsg: 28992, label: 'NL: Amersfoort / RD New (EPSG:28992)' },
]

// Default datum the editor picker opens with when the row has no z_epsg yet
// (e.g. a fresh manual entry). mTAW is the right default while the platform
// is Belgium-first; future: derive from horizontal EPSG instead.
export const DEFAULT_PICKER_EPSG = 5710

export function verticalDatumLabel(zEpsg: number | null | undefined): string {
  if (zEpsg == null) return VCRS_LABEL_FALLBACK
  return VCRS_LABEL_BY_EPSG[zEpsg] ?? VCRS_LABEL_FALLBACK
}

// Parenthesised short form for compact contexts (axis ticks: "Level (TAW)",
// tooltip: "Level: 12.50 m TAW"). Returns '' when the datum is unknown so
// the caller can render plain "Level (m)" / "Level: 12.50 m" cleanly.
export function verticalDatumShort(zEpsg: number | null | undefined): string {
  const label = verticalDatumLabel(zEpsg)
  if (label === VCRS_LABEL_FALLBACK) return ''
  // "m TAW" → "TAW", "m NAP" → "NAP".
  return label.replace(/^m\s+/, '')
}
