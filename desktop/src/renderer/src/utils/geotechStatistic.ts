// The representative-qc statistic vocabulary, shared by the toolbar selector
// and the subdivide press that carries the choice.
//
// Owner rulings 7 + 8 (docs/debt.md #227) made the statistic a per-geotech-model
// choice; ruling 2026-08-15 ("i can't choose harmonic qc before first subdivide,
// that's friction we don't need?") made it choosable BEFORE that model exists,
// which is why the token type now travels from the toolbar into the subdivide
// request instead of living inline in one menu.
//
// The four tokens are the backend's ``REPRESENTATIVE_STATISTICS``
// (``domain/services/representative_statistic.py``) and the CHECK-constraint
// vocabulary of ``geological_model.representative_statistic`` (migration
// 9f8e7d6c5b4a). A fifth token here would be a 422 there.

/** One of the four statistics the NAD classifier can read a band's qc with. */
export type GeotechStatistic = 'median' | 'arithmetic' | 'harmonic' | 'geometric'

/**
 * Menu order for the four statistics.
 *
 * Median leads because it is the backend's ``DEFAULT_STATISTIC`` — the one a
 * model is created under when the engineer expresses no preference.
 */
export const GEOTECH_STATISTICS: readonly GeotechStatistic[] = [
  'median',
  'arithmetic',
  'harmonic',
  'geometric',
]

/** What a model with no explicit choice classifies with (backend default). */
export const DEFAULT_GEOTECH_STATISTIC: GeotechStatistic = 'median'
