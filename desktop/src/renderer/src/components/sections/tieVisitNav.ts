/**
 * Which item a section-editor "find the next one" chip visits next.
 *
 * Owner ask 2026-08-23, for the crossing-tie warning chip: *"make that
 * clickable so it zooms to the first one, and then when it is resolved it takes
 * the second one"*. Owner ask 2026-08-25, for the geotech pending-tie chip:
 * *"Why don't we make that clickable so it highlights the tie?"* Same walk,
 * same wrap, same stale-index problem — so one function, per the project's
 * extract-on-the-second-copy rule.
 *
 * Pure: the caller owns the stored index and does the centring.
 *
 * @module components/sections/tieVisitNav
 */

/**
 * The next index to visit, given the last one visited.
 *
 * Wraps at the end so a chip never dead-ends, and CLAMPS a stale index —
 * resolving an item shrinks the list under the caller's stored index, and a
 * press must still land on something that exists.
 *
 * @param current The index last visited, or ``null`` if none yet.
 * @param total How many items the section currently has.
 * @returns The index to visit, or ``null`` when there is nothing left.
 */
export function nextVisitIndex(current: number | null, total: number): number | null {
  if (total <= 0) return null
  if (current === null) return 0
  // A stale index (the list shrank, or it was already the last) restarts at 0 —
  // which is also what makes a single remaining item re-centre on a repeat
  // press rather than going blank.
  const next = current + 1
  return next >= total ? 0 : next
}
