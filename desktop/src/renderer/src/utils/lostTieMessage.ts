// Copy for "these accepted packing ties could not be carried across a rebuild".
//
// Audit 2026-08-02: the toast said "See the console for which" — an accepted
// correlation the engineer must redraw had no in-app list, and DEBUG stripping
// plus a closed DevTools make a packaged build's console unreachable. The
// backend now returns ``lost_tie_labels`` (investigation name + depth range per
// endpoint); this module turns them into the sentence both geotech rebuild
// verbs show, so Subdivide and Divide-boreholes cannot word it differently.

/** How many ties the message names before it summarises the rest. */
export const MAX_NAMED_LOST_TIES = 3

/**
 * The error-toast text for a set of lost packing ties.
 *
 * Parameters
 * ----------
 * count : number
 *     How many accepted ties were lost (the backend's ``lost_tie_count``).
 * labels : readonly string[] | undefined
 *     One line per lost tie from ``lost_tie_labels`` — investigation names and
 *     depth ranges. ``undefined`` / empty when the response came from a
 *     backend that predates the field, in which case the message degrades to
 *     the count plus the server-log pointer rather than lying about detail it
 *     does not have.
 *
 * Returns
 * -------
 * string
 *     One sentence naming up to :data:`MAX_NAMED_LOST_TIES` ties and counting
 *     any remainder.
 */
export function lostTieMessage(count: number, labels: readonly string[] | undefined): string {
  const plural = count === 1 ? '' : 's'
  const head =
    `${count} accepted packing tie${plural} could not be kept: ` +
    `the band ${count === 1 ? 'it was' : 'they were'} drawn on changed, so ` +
    `${count === 1 ? 'it has' : 'they have'} to be redrawn`
  if (labels === undefined || labels.length === 0) {
    return `${head}. The server log lists which.`
  }
  const named = labels.slice(0, MAX_NAMED_LOST_TIES)
  // The remainder is counted off the LABEL list, not off ``count``: if the
  // backend sent fewer labels than losses, claiming "and 0 more" would hide
  // the gap.
  const rest = labels.length - named.length
  const tail = rest > 0 ? ` (and ${rest} more)` : ''
  return `${head}: ${named.join('; ')}${tail}.`
}
