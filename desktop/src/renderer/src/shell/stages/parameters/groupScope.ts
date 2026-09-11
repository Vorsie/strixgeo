// The group-expansion hinge (debt #278 D2, owner ruling 2026-09-02: "grouping
// is just for lumping things that are similar together, so we have more data").
//
// A ``geotech-body`` scope is one body's own identity. When that body was joined
// into a multi-member "Join with…" group, its statistics must pool the WHOLE
// group. This one pure hinge turns the body scope into the ``geotech-group``
// scope the statistics, the header and the fence cutout then all read through
// ``bandsForScope`` — so the tree stays body-shaped while the canvas pools the
// group.
//
// TWO callers, one hinge: the unit-list pane applies it at CLICK time (owner
// 2026-09-11 — clicking a unit from a group shows the whole group together), and
// the canvas applies it to whatever scope arrives, since a deep link still hands
// it a plain ``geotech-body``. Applying it twice is a no-op: a scope that is
// already a group comes back unchanged.

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
