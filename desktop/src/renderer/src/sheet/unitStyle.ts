/**
 * How a sheet region and the unit legend are coloured and labelled per axis.
 *
 * The one place the sheet branches on the fill axis. On the litho / geological
 * axes a region shows its stored formation colour and name (unchanged). On the
 * geotech axis a region shows its NAD PACKING-CLASS colour and compact label,
 * because a litho unit is subdivided into packing classes there and the stored
 * formation colour is only the litho hue the geotech row inherited — so painting
 * with it makes every packing class of one lithology look identical on paper
 * (owner finding 2026-09-03: "waarom zijn de kleuren in de pdf export niet
 * anders naargelang de pakking?").
 *
 * The colours come from ``utils/nadClasses`` — the SAME palette module the
 * section canvas uses (``geotechDisplayFormation`` → ``geotechUnitColor``) — so
 * the sheet and the screen never disagree and no second copy of the ramp exists.
 */
import { geotechUnitColor, nadCompactLabel } from '../utils/nadClasses'
import type { SheetFill, SheetPayload, SheetUnit } from './sheetPayload'

/**
 * The colour a unit's region is drawn in on a given axis.
 *
 * Geotech (and the unit carries packing-class info) → ``geotechUnitColor`` (the
 * engineer's pick where he made one, else the packing-density ramp — exactly the
 * canvas rule). Every other axis, or a unit with no packing info, → the stored
 * ``colour`` (the litho / geological formation hue, the pre-geotech default).
 *
 * @param unit  A sheet unit.
 * @param fill  The sheet's fill axis.
 * @returns  A ``#rrggbb`` colour string.
 */
export function unitFillColour(unit: SheetUnit, fill: SheetFill): string {
  if (fill === 'geotech' && unit.nadClass !== undefined) {
    return geotechUnitColor({ nad_class: unit.nadClass, color_override: unit.colorOverride ?? null })
  }
  return unit.colour
}

/**
 * The label a unit shows inside its fill and in the legend.
 *
 * Geotech (with packing-class info) → the compact ``{SOIL}·{packing}`` label
 * ("ZAND·MD"), matching the on-screen band labels; it falls back to the stored
 * ``name`` while the unit is unclassified. Every other axis → the stored ``name``.
 *
 * @param unit  A sheet unit.
 * @param fill  The sheet's fill axis.
 * @param language  The interface language ('en' | 'nl').
 * @returns  A non-empty display label.
 */
export function unitLabel(unit: SheetUnit, fill: SheetFill, language: 'en' | 'nl'): string {
  if (fill === 'geotech' && unit.nadClass !== undefined) {
    return nadCompactLabel(unit.nadClass, language) || unit.name
  }
  return unit.name
}

/** One unit-legend row: a stable key, its swatch colour, and its label. */
export interface UnitLegendEntry {
  key: string
  colour: string
  label: string
}

/**
 * The unit-legend rows for a sheet, in display order.
 *
 * Litho / geological → one row per formation that has a region on the sheet.
 * Geotech → one row per PACKING CLASS present: two litho units subdivided into
 * the same class (distinct formations, one class) collapse to a single row, so
 * the legend lists each packing class present exactly once. The existing legend
 * is a flat wrapped list, so no litho-unit grouping is applied here.
 *
 * @param payload  The sheet payload.
 * @returns  The legend rows; ``[]`` when nothing is drawn.
 */
export function unitLegendEntries(payload: SheetPayload): UnitLegendEntry[] {
  const fill = payload.settings.fill
  const present = [...payload.units]
    .filter(u => payload.regions.some(r => r.formation_id === u.formationId))
    .sort((a, b) => a.displayOrder - b.displayOrder)
  if (fill !== 'geotech') {
    return present.map(u => ({
      key: u.formationId,
      colour: unitFillColour(u, fill),
      label: unitLabel(u, fill, payload.language),
    }))
  }
  const seen = new Set<string>()
  const rows: UnitLegendEntry[] = []
  for (const u of present) {
    // null (unclassified) is one class; dedup keeps the first appearance.
    const classKey = u.nadClass == null ? 'null' : String(u.nadClass)
    if (seen.has(classKey)) continue
    seen.add(classKey)
    rows.push({ key: classKey, colour: unitFillColour(u, fill), label: unitLabel(u, fill, payload.language) })
  }
  return rows
}
