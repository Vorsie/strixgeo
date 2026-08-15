/**
 * The one organic-content number a compact preview may show for a sample.
 *
 * Owner ask (dogfeed 2026-08-15): *"maybe put organic matter content some where
 * in the psd popup on hover too"*.
 *
 * A sample can carry several organic-content tests, and each row can report
 * organic MATTER, organic CARBON, or both. They are DIFFERENT quantities —
 * matter is carbon scaled by a conversion factor that depends on the soil — so
 * showing a carbon value under a "matter" label is a data-integrity error, not
 * a wording nicety. This picks one value and says which quantity it is; the
 * caller must print the label this returns, never a fixed one.
 *
 * Matter is preferred ACROSS the whole test list before carbon is considered:
 * given one carbon-only row and one matter row, the answer is the matter, since
 * the alternative is either a label that lies or an arbitrary first-row rule
 * that would report carbon while the matter it asked for is right there.
 *
 * Pure: no React, no DOM — see ``organicContentSummary.test.ts``.
 */

import type { OrganicContentResponse } from '../api/clients/borehole'

/** The organic quantity actually measured — never interchangeable. */
export type OrganicQuantity = 'matter' | 'carbon'

/** One organic-content reading, with the quantity it is a reading OF. */
export interface OrganicContentSummary {
  quantity: OrganicQuantity
  /** Percent by weight. */
  pct: number
}

/**
 * Pick the organic-content value a preview should show, if any.
 *
 * Parameters
 * ----------
 * tests : readonly OrganicContentResponse[]
 *     The sample's organic-content tests, in the order the API returned them.
 *
 * Returns
 * -------
 * OrganicContentSummary | null
 *     The first organic-matter reading in the list; failing that the first
 *     organic-carbon reading; ``null`` when the sample carries neither, so the
 *     caller renders nothing at all rather than a dash or an empty row.
 */
export function selectOrganicContent(
  tests: readonly OrganicContentResponse[],
): OrganicContentSummary | null {
  for (const t of tests) {
    if (t.matter_pct !== null) return { quantity: 'matter', pct: t.matter_pct }
  }
  for (const t of tests) {
    if (t.carbon_pct !== null) return { quantity: 'carbon', pct: t.carbon_pct }
  }
  return null
}
