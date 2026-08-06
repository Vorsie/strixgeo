/**
 * When the borehole preview ghosts are allowed on the geotech axis.
 *
 * Owner ruling (dogfeed 2026-08-06): ghosts appear only once the tie work is
 * done — step 1 alone must leave borehole columns visibly EMPTY. Right after
 * "1 · Subdivide CPTs" no ties exist, so a preview could only use the flank
 * rule; the plan it showed would silently change once step 2/3 land ties,
 * and hatched bands appearing the moment step 1 runs read as "my boreholes
 * got subdivided" (the counterintuitive report this rule answers).
 *
 * Pure predicate so the rule is unit-testable without the SectionsCanvas god
 * component.
 */

import type { GeotechTieStatus } from './useGeotechTieStatus'

/**
 * Whether the divide-boreholes preview ghosts should render.
 *
 * True only when the tie counts are actually KNOWN, nothing is pending, and
 * at least one accepted tie exists — i.e. step 2/3 produced ties and the
 * engineer cleared them, so the preview shows the final tie-informed plan
 * (the same plan pressing "4 · Divide boreholes" commits, DB5 parity).
 * Flagged ties are accepted work awaiting confirmation and do not hide it.
 *
 * Parameters
 * ----------
 * status : GeotechTieStatus
 *     The model's pending / accepted / flagged counts (+ loaded flag).
 *
 * Returns
 * -------
 * boolean
 *     Whether the ghosts may render.
 */
export function shouldShowBoreholePreview(status: GeotechTieStatus): boolean {
  return status.loaded && status.pending === 0 && status.accepted > 0
}
