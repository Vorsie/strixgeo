// The canvas group-expansion (debt #278 D2, owner ruling 2026-09-02: "grouping
// is just for lumping things that are similar together, so we have more data").
//
// The unit-list pane selects a leaf as a ``geotech-body`` scope — the leaf's own
// identity. But when that body was joined into a multi-member "Join with…"
// group, its statistics must pool the WHOLE group. This one pure hinge turns the
// selected body scope into the ``geotech-group`` scope the statistics, the
// header and the fence cutout then all read through ``bandsForScope`` — so the
// tree stays body-shaped while the canvas pools the group.

import { geotechGroupMembers } from '../../../utils/geotechGroupOrdinals'
import type { ParameterUnitScope } from '../../ShellContext'

/**
 * The scope the Parameters canvas actually pools for a selection.
 *
 * A ``geotech-body`` selection that belongs to a multi-member group expands to a
 * ``geotech-group`` scope carrying every member's body id; anything else — an
 * ungrouped body, or any non-geotech-body kind — is returned UNCHANGED (the same
 * reference, so a memo keyed on it does not needlessly recompute).
 *
 * Parameters
 * ----------
 * scope
 *     The selected scope from the unit-list pane / deep link.
 * groupOrdinals
 *     ``geotechGroupOrdinals`` map (``body id → group number``) for the active
 *     geotech model; empty when nothing is grouped.
 *
 * Returns
 * -------
 * ParameterUnitScope
 *     The group-expanded scope, or ``scope`` unchanged.
 */
export function effectiveGroupScope(
  scope: ParameterUnitScope,
  groupOrdinals: ReadonlyMap<string, number>,
): ParameterUnitScope {
  if (scope.kind !== 'geotech-body') return scope
  const group = geotechGroupMembers(groupOrdinals, scope.bodyId)
  if (group === null) return scope
  return {
    kind: 'geotech-group',
    unitId: scope.unitId,
    groupNumber: group.groupNumber,
    memberBodyIds: group.memberBodyIds,
  }
}
