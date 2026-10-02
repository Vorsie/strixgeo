// A formation row's on-screen name — the ONE "translate a litho unit at the
// presentation boundary" helper (debt #96). Its own module because
// ``lithoLabels.ts`` is past the 500-line cap (debt #201).

import type { AdmixtureItem } from '../api/client'
import type { Language } from '../i18n/i18n_constants'
import { getLanguage } from '../i18n/languageSelect'
import { lithoDisplayName } from './lithoLabels'

/**
 * A formation row's display name: a litho unit's translated pipe label, any
 * other row's stored name.
 *
 * A litho unit's stored ``name`` is the raw DOV token ("ZAND (SL:M)"), so a
 * roster, legend or tree row that names a unit reads ``lithoDisplayName``
 * ("ZAND | matig siltig") instead; a geological formation (no soil code) keeps
 * its curated name. Callers show the raw ``name`` as the row's tooltip.
 *
 * Parameters
 * ----------
 * formation
 *     The row's ``name`` + ``litho_main_soil_code`` + ``litho_admixtures``.
 * language
 *     The locale; defaults to the active interface language.
 *
 * Returns
 * -------
 * string
 *     The display name, or ``'—'`` for a nameless non-litho row.
 */
export function formationUnitDisplayName(
  formation: {
    name?: string | null
    litho_main_soil_code?: string | null
    litho_admixtures?: readonly AdmixtureItem[] | null
  },
  language: Language = getLanguage(),
): string {
  if (formation.litho_main_soil_code != null) {
    return lithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures, language)
  }
  return formation.name ?? '—'
}
