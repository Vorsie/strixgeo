// Presentation labels for the Parameters body tree — pure, no scope/band
// dependency, so the tree module (``parameterBodyTree.ts``) stays under the
// 500-line god-component cap (debt #201). The tree owns the STRUCTURE and the
// band authority; this file owns how a body / class row READS.
//
// Translate-at-presentation-boundary: the raw tokens ride tooltips at the
// render sites; these are the English display forms, built from the
// ``nadClasses.ts`` single source and the 3-D legend's body naming.

import { geotechBodyAutoLabel } from '../../../utils/geotechBodyLabel'
import { bodyLabelOf, type BodyRosterEntry } from './parameterUnitBodies'

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
 * A geotech body's label: its name, else the UNIFIED auto label ``"<soil> ·
 * <packing> #<ordinal>"`` (rendered "SILT · SF #0").
 *
 * Owner dogfeed 2026-09-01: the packing-only "SF #0" read like a litho body's
 * "SILT · #0" and confused which was which. The auto form now carries the soil
 * word too (``geotechBodyAutoLabel``, the ONE shared vocabulary), so every
 * surface — this scope header, the Parameters pane rows and the section body-menu
 * header — reads the geotech body identically and never collides with the litho
 * body label.
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
  if (entry !== undefined) return geotechBodyAutoLabel(nadClass, entry.body_ordinal)
  return bodyLabelOf(bodyId, roster)
}
