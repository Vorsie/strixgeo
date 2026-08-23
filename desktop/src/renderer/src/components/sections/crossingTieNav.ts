/**
 * Which crossing-tie conflict the warning chip visits next.
 *
 * Owner ask 2026-08-23: *"make that clickable so it zooms to the first one, and
 * then when it is resolved it takes the second one"*. The chip has been passive
 * since it shipped, so the count was visible but the conflicts were not
 * findable — on a wide section a crossing easily sits outside the viewport.
 *
 * Pure: the caller owns the index and does the panning.
 *
 * @module components/sections/crossingTieNav
 */

/**
 * The next conflict index to centre, given the last one visited.
 *
 * Wraps at the end so the chip never dead-ends, and CLAMPS a stale index —
 * resolving a conflict shrinks the list under the caller's stored index, and a
 * press must still land on a conflict that exists.
 *
 * @param current The index last visited, or ``null`` if none yet.
 * @param total How many conflicts the section currently has.
 * @returns The index to visit, or ``null`` when there is nothing left.
 */
export function nextConflictIndex(current: number | null, total: number): number | null {
  if (total <= 0) return null
  if (current === null) return 0
  // A stale index (the list shrank, or it was already the last) restarts at 0 —
  // which is also what makes a single remaining conflict re-centre on a repeat
  // press rather than going blank.
  const next = current + 1
  return next >= total ? 0 : next
}
