// Presentation labels for the Parameters body tree — pure, no scope/band
// dependency, so the tree module (``parameterBodyTree.ts``) stays under the
// 500-line god-component cap (debt #201). The tree owns the STRUCTURE and the
// band authority; this file owns how a body / class row READS.
//
// Translate-at-presentation-boundary: the raw tokens ride tooltips at the
// render sites; these are the English display forms, built from the
// ``nadClasses.ts`` single source and the 3-D legend's body naming.

import { NAD_CLASS_ABBR } from '../../../utils/nadClasses'
import { bodyLabelOf, type BodyRosterEntry } from './parameterUnitBodies'

/**
 * The packing abbreviation of a NAD class ("SF" for slightly-firm silt) — the
 * trailing segment of ``NAD_CLASS_ABBR`` ("SILT·SF" → "SF").
 *
 * Kept out of ``nadClasses.ts`` so the tree owns its own naming; the
 * single-source ``NAD_CLASS_ABBR`` table stays authoritative.
 *
 * LANGUAGE-INDEPENDENT BY CONSTRUCTION, so this deliberately does NOT use the
 * language-aware ``nadCompactLabel``: the Dutch table (``NAD_CLASS_ABBR_NL``)
 * translates only the leading SOIL word — ``GRAVEL·MD`` becomes ``GRIND·MD``
 * — and this function returns the trailing packing segment, which is the same
 * token in both languages. The 2026-08-28 Dutch sweep flagged this call site
 * as a possible gap; it is not one. Revisit only if the packing codes
 * themselves are ever translated.
 *
 * @param nadClass  A NAD class (1..31).
 * @returns  The packing abbreviation, or ``"NAD {n}"`` for an unknown class.
 */
export function nadPackingAbbr(nadClass: number): string {
  const abbr = NAD_CLASS_ABBR[nadClass]
  if (abbr === undefined) return `NAD ${nadClass}`
  const parts = abbr.split('·')
  return parts[parts.length - 1]
}

/**
 * A litho body's label: its name, else ``"<unit name> · #<ordinal>"`` (spec §1,
 * rendered "SILT · #3").
 *
 * @param bodyId  The resolver body id.
 * @param unitName  The litho unit's display name.
 * @param roster  The litho body roster (``id → entry``), possibly incomplete.
 * @returns  A non-empty label; an id prefix when the roster does not know the body.
 */
export function lithoBodyLabel(
  bodyId: string,
  unitName: string,
  roster: ReadonlyMap<string, BodyRosterEntry>,
): string {
  const entry = roster.get(bodyId)
  const name = entry?.name?.trim()
  if (name) return name
  if (entry !== undefined) return `${unitName} · #${entry.body_ordinal}`
  // Roster still loading / stale stamp — the id-prefix fallback (never blank).
  return bodyLabelOf(bodyId, roster)
}

/**
 * A geotech body's label: its name, else ``"<class-abbr> #<ordinal>"`` (spec
 * §1, rendered "SF #1").
 *
 * @param bodyId  The resolver body id.
 * @param nadClass  The class the body's ground carries (for the abbreviation).
 * @param roster  The geotech body roster (``id → entry``), possibly incomplete.
 * @returns  A non-empty label; an id prefix when the roster does not know the body.
 */
export function geotechBodyLabel(
  bodyId: string,
  nadClass: number,
  roster: ReadonlyMap<string, BodyRosterEntry>,
): string {
  const entry = roster.get(bodyId)
  const name = entry?.name?.trim()
  if (name) return name
  if (entry !== undefined) return `${nadPackingAbbr(nadClass)} #${entry.body_ordinal}`
  return bodyLabelOf(bodyId, roster)
}
