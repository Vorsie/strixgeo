// The English display name of each litho unit, keyed by its id — the map every
// geotech surface needs to say WHICH ground a geotech unit subdivides.
//
// Why this exists at all: a geotech formation's stored ``name`` is a raw token
// ("KLEI (geotech)", "Diest (NAD 7)"), and its ``parent_formation_name`` is
// ALWAYS null — the server resolves that field from ``parent_formation_id``
// (``api/routers/geology/formations.py``), which the geotech materialiser never
// sets. A geotech unit points at its source litho unit through
// ``source_litho_formation_id`` instead, so the name has to be looked up
// through THAT id, from the litho roster the shell already holds.
//
// Extracted from ``GeotechnicalUnitRoster`` when the Parameters stage needed
// the same map (CLAUDE.md: extract on the second copy). Getting it wrong is
// invisible rather than loud — the affected column simply reads "—" on every
// row, and same-soil units become indistinguishable, which is the exact defect
// the geotech pane's disambiguation rule exists to prevent.

import type { GeologicalFormationResponse } from '../api/client'
import { lithoDisplayName } from './lithoLabels'

/**
 * Build the ``litho formation id → English display name`` map.
 *
 * The name is the formatted lithology + admixtures (debt #96 — the roster reads
 * in English, not in the stored Dutch token), falling back to the stored
 * ``name`` for a unit that carries no soil code.
 *
 * Parameters
 * ----------
 * lithoFormations
 *     The project's litho units, as the shell bus carries them.
 *
 * Returns
 * -------
 * Map<string, string>
 *     One entry per litho unit. Callers look up
 *     ``geotechUnit.source_litho_formation_id``.
 */
export function buildSourceLithoNameMap(
  lithoFormations: readonly GeologicalFormationResponse[],
): Map<string, string> {
  const names = new Map<string, string>()
  for (const formation of lithoFormations) {
    names.set(
      formation.id,
      formation.litho_main_soil_code != null
        ? lithoDisplayName(
            formation.litho_main_soil_code,
            formation.litho_admixtures,
          )
        : formation.name,
    )
  }
  return names
}

/**
 * The source litho unit's name for one geotech unit, or ``null``.
 *
 * ``null`` when the unit has no source id or the map has no entry for it —
 * both meaning "nothing to name", which is what ``geotechUnitLabel`` wants for
 * its optional disambiguating parenthetical.
 *
 * Parameters
 * ----------
 * unit
 *     A geotech formation.
 * names
 *     The map from {@link buildSourceLithoNameMap}.
 *
 * Returns
 * -------
 * string | null
 *     The source litho unit's display name, or ``null``.
 */
export function sourceLithoNameOf(
  unit: { source_litho_formation_id?: string | null },
  names: ReadonlyMap<string, string>,
): string | null {
  const sourceId = unit.source_litho_formation_id
  if (sourceId == null) return null
  return names.get(sourceId) ?? null
}
