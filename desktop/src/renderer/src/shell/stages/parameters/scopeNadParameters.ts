/**
 * The scoped unit's NAD packing class and its characteristic values (owner
 * ruling 2026-09-05).
 *
 * The Parameters pane's "NAD characteristic values" block shows *"one general
 * value per body"* — so it needs the ONE class a body (or a group) resolves to,
 * and the table row for that class. Both are pure reads:
 *
 * * {@link scopeNadClass} folds a scope's accepted geotech bands to the single
 *   NAD class they all share, or ``null`` when they span more than one (a litho
 *   unit, or a mixed scope has no single value to show);
 * * {@link nadParametersForClass} reads the backend-computed ``nad_parameters``
 *   off a geotech formation carrying that class — the table is NEVER duplicated
 *   here, the values come from the API's ``parameters_for_class`` (the same row
 *   the D-Series exporters read).
 */

import type {
  GeologicalFormationResponse,
  LithoLayerResponse,
  NadCharacteristicValues,
} from '../../../api/clients/geology.types'

/**
 * The single NAD class a set of geotech bands all share, or ``null``.
 *
 * ``null`` when the bands carry no class (a litho scope) or span two or more
 * classes (nothing to show one value for). A group pools members of one class
 * (Join = one export class), so it resolves to that class.
 *
 * @param scopeBands - the scope's accepted bands (from ``bandsForScope``).
 * @param nadClassByFormationId - formation id → NAD class (``nadClassIndex``).
 * @returns the shared class, or null.
 */
export function scopeNadClass(
  scopeBands: readonly LithoLayerResponse[],
  nadClassByFormationId: ReadonlyMap<string, number | null>,
): number | null {
  const classes = new Set<number>()
  for (const band of scopeBands) {
    const nadClass = nadClassByFormationId.get(band.formation_id)
    if (nadClass != null) classes.add(nadClass)
  }
  return classes.size === 1 ? [...classes][0] : null
}

/**
 * The NAD characteristic values for a class, read off a geotech formation.
 *
 * The values are a pure function of the class (the table row), so any geotech
 * formation carrying the class serves — the first one whose backend response
 * populated ``nad_parameters``. ``null`` when the class is null, no formation
 * carries it, or none carries the parameters (an older response without the
 * field): the block then shows nothing rather than a guessed value.
 *
 * @param nadClass - the class from {@link scopeNadClass}.
 * @param geotechFormations - the geotech model's formations.
 * @returns the characteristic values, or null.
 */
export function nadParametersForClass(
  nadClass: number | null,
  geotechFormations: readonly GeologicalFormationResponse[],
): NadCharacteristicValues | null {
  if (nadClass === null) return null
  for (const formation of geotechFormations) {
    if (formation.nad_class === nadClass && formation.nad_parameters != null) {
      return formation.nad_parameters
    }
  }
  return null
}
