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
 * TWO sources, in order (owner, dogfeed 2026-08-15: *"impossible, i'm 100% sure
 * some have gehalte aan organisch materiaal, it's even under organic matter
 * content in the data stage"*). He was right and the card was reading the wrong
 * table: on his project the TYPED organic family is empty and the measurement
 * arrives in the scalar catch-all instead. So the typed family is consulted
 * first — a project whose parser DOES route it keeps reading exactly as before
 * — and the catch-all is the fallback.
 *
 * Pure: no React, no DOM — see ``organicContentSummary.test.ts``.
 */

import type {
  OrganicContentResponse,
  ScalarLabTestResponse,
} from '../api/clients/borehole'

/**
 * Substring that identifies the DOV organic-matter parameter, lower-cased.
 *
 * The catch-all stores the upstream token verbatim, and DOV repeats the name
 * inside its own parentheses — ``"Gehalte Organische stoffen (Gehalte
 * Organische stoffen)"`` — so an equality test would never fire. It is
 * deliberately narrow enough to exclude the neighbouring "Gehalte Kalkachtige
 * stoffen" (lime) row, which sits in the same group and also reports a percent.
 */
const SCALAR_ORGANIC_MATTER_TOKEN = 'organische stof'

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
 *     The sample's TYPED organic-content tests, in the order the API returned
 *     them.
 * scalarTests : readonly ScalarLabTestResponse[]
 *     The sample's scalar catch-all rows. Consulted only when the typed family
 *     is silent; defaults to empty so a caller that has no catch-all rows to
 *     offer keeps the original one-argument shape.
 *
 * Returns
 * -------
 * OrganicContentSummary | null
 *     The first organic-matter reading in the typed list; failing that the
 *     first typed organic-carbon reading; failing that the first numeric
 *     organic-MATTER row in the scalar catch-all; ``null`` when the sample
 *     carries none of those, so the caller renders nothing at all rather than a
 *     dash or an empty row.
 */
export function selectOrganicContent(
  tests: readonly OrganicContentResponse[],
  scalarTests: readonly ScalarLabTestResponse[] = [],
): OrganicContentSummary | null {
  for (const t of tests) {
    if (t.matter_pct !== null) return { quantity: 'matter', pct: t.matter_pct }
  }
  for (const t of tests) {
    if (t.carbon_pct !== null) return { quantity: 'carbon', pct: t.carbon_pct }
  }
  for (const s of scalarTests) {
    // The catch-all row is organic MATTER by its own DOV name, so it is
    // reported as matter. A row with no number was never measured — treat it
    // exactly like an absent test rather than printing a "0 %".
    if (
      s.value_numeric !== null
      && s.parameter.toLowerCase().includes(SCALAR_ORGANIC_MATTER_TOKEN)
    ) {
      return { quantity: 'matter', pct: s.value_numeric }
    }
  }
  return null
}
