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

import type { MessageKey } from '../i18n/locales/en'
import { t } from '../i18n/translate'

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

/** The catalogue key that names each statistic in the interface language. */
const GEOTECH_STATISTIC_LABEL_KEY = {
  median: 'sections.geotech.statisticName.median',
  arithmetic: 'sections.geotech.statisticName.arithmetic',
  harmonic: 'sections.geotech.statisticName.harmonic',
  geometric: 'sections.geotech.statisticName.geometric',
} as const satisfies Record<GeotechStatistic, MessageKey>

/**
 * The statistic as the user reads it, in the interface language.
 *
 * Owner ruling 2026-09-13 ("token of course needs translation in dutch
 * version"): the wire token stays English everywhere it travels (request,
 * model row, store), and is translated only where it is DISPLAYED — the qc
 * dropdown label and rows, the inspector line, the band dialog, the toasts.
 * A token the catalogue does not know (a newer backend) shows verbatim rather
 * than as a key.
 *
 * @param statistic  The wire token (``median`` / ``arithmetic`` / ...).
 * @returns  The translated name, or the token itself when unknown.
 */
export function geotechStatisticLabel(statistic: string): string {
  const key = (GEOTECH_STATISTIC_LABEL_KEY as Record<string, MessageKey | undefined>)[statistic]
  return key === undefined ? statistic : t(key)
}
