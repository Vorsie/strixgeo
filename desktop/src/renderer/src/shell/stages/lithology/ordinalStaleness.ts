// Pure RO-3 stale-ordinal predicate, extracted from LithologyInspector so
// the badge-PRESENT branch is directly unit-testable (review SF-1 — the
// in-component useMemo could only be exercised for the absent branch).

import type { GeologicalFormationResponse } from '../../../api/client'

/**
 * Whether locked instance-ordinals are stale and should show the RO-3
 * amber badge.
 *
 * A locked formation's ordinal is "stale" when the model's correlation
 * edge set has changed since the last explicit resolve — the resolver
 * has work the locked numbers do not yet reflect.
 *
 * Parameters
 * ----------
 * lithoFormations
 *     Litho units in the active model — scanned for any locked ordinal.
 * currentEdgeCount
 *     Edge count from the most recent ``listCorrelations`` fetch.
 * lastResolvedEdgeCount
 *     Edge count captured at the last explicit resolve (or the first
 *     fetch, treated as the baseline). ``null`` before any baseline
 *     exists (initial fetch in flight).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only when a baseline exists, at least one formation is
 *     locked, and the edge count diverged from the baseline. ``false``
 *     when no baseline yet, nothing locked, or the count is unchanged.
 */
export function computeOrdinalStale(
  lithoFormations: readonly GeologicalFormationResponse[],
  currentEdgeCount: number,
  lastResolvedEdgeCount: number | null,
): boolean {
  if (lastResolvedEdgeCount === null) return false
  const hasLocked = lithoFormations.some(f => f.instance_ordinal_locked)
  return hasLocked && currentEdgeCount !== lastResolvedEdgeCount
}
