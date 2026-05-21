/**
 * English display-label helpers for lithostratigraphic units.
 *
 * Domain vocabulary: base lithology codes (ZAND, KLEI, SILT, GRIND, VEEN)
 * come from the backend ``BASE_LITHOLOGIES`` constant; admixture soil codes
 * (GL, KL, SL, ZN, VE) and amount codes (W, M, V, S, Z, empty) come from
 * the DOV vocabulary stored in borehole ObservationLayer admixtures. The
 * raw codes stay Dutch in the DB / API (translate at the presentation
 * boundary, never at ingest — see CLAUDE.md §UX Conventions); this
 * module is the boundary.
 *
 * The function produces labels like "moderately clayey Sand" or "silty
 * Clay" that mirror the Belgian/Dutch NEN 5104 reporting style adjective-
 * before-noun, in English so the labels match the rest of the program's
 * UI chrome. The raw DOV codes remain visible elsewhere (codelist
 * dropdowns, tooltips) so engineers can cross-check.
 *
 * Base-lithology names are imported from ``utils/lithoConstants.ts``
 * (``LITHOLOGY_LABELS``) — that file is the single source of truth so
 * the picker dialog, the composition editor, and the ghost overlay all
 * agree on "Sand" / "Clay" / etc.
 *
 * Translation history: this module produced Dutch labels until
 * 2026-05-21 when the owner asked for UI consistency with the rest of
 * the (English) program. The raw Dutch tokens are unchanged in the DB.
 */

import type { AdmixtureItem } from '../api/client'
import { LITHOLOGY_LABELS } from './lithoConstants'

// ---------------------------------------------------------------------------
// Admixture soil codes → English adjective form.
// Values are DOV soil-vocabulary codes stored in borehole admixtures.
// The adjective form (``clayey``, ``silty``, ...) follows NEN 5104 /
// Belgian field-description practice translated to English.
// ---------------------------------------------------------------------------

const ADMIXTURE_SOIL_EN: Record<string, string> = {
  GL: 'gravelly', // GL = gravel (Grind)
  KL: 'clayey',   // KL = clay (Klei)
  SL: 'silty',    // SL = silt (Silt)
  ZN: 'sandy',    // ZN = sand (Zand)
  VE: 'peaty',    // VE = peat (Veen)
  // Aliases / DOV variants encountered in real data:
  Z: 'sandy',    // "Z" = Zand shortcode in some DOV exports
  K: 'clayey',   // "K" = Klei shortcode
  S: 'silty',    // "S" = Silt shortcode
  G: 'gravelly', // "G" = Grind shortcode
  V: 'peaty',    // "V" = Veen shortcode (context: soil code, not amount)
}

// ---------------------------------------------------------------------------
// Admixture amount codes → English amount adverb (placed BEFORE soil adj).
// Source: DOV ``<hoeveelheid>`` vocabulary.
// ---------------------------------------------------------------------------

const ADMIXTURE_AMOUNT_EN: Record<string, string> = {
  W: 'slightly',    // W = weinig (little)
  M: 'moderately',  // M = matig (moderate)
  V: 'very',        // V = veel (much) — note: same letter as Veen soil code;
                    // context (amount field) determines the reading
  S: 'strongly',    // S = sterk (strongly)
  Z: 'weakly',      // Z = zwak (weakly / slightly)
  WM: 'slightly to moderately',
  MV: 'moderately to very',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format an English display name for a lithostratigraphic unit.
 *
 * Combines the main lithology code and optional admixtures into a
 * short English label following NEN 5104 / Belgian-style reporting
 * order: amount adverb (if any) + soil adjective + capitalised main
 * lithology.
 *
 * Examples::
 *
 *   formatLithoDisplayName('ZAND', [])
 *   // → 'Sand'
 *
 *   formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }])
 *   // → 'moderately clayey Sand'
 *
 *   formatLithoDisplayName('KLEI', [
 *     { soil_code: 'SL', amount: 'W', locally: false },
 *     { soil_code: 'ZN', amount: '',  locally: true  },
 *   ])
 *   // → 'slightly silty, locally sandy Clay'
 *
 * Parameters
 * ----------
 * mainCode
 *     Base lithology code (ZAND, KLEI, SILT, GRIND, VEEN). Falls back
 *     to the raw code when not found in the label table.
 * admixtures
 *     Admixture items from the API (``AdmixtureItem[]``). Empty or null
 *     returns just the main lithology name.
 *
 * Returns
 * -------
 * string
 *     Short English display label.
 */
export function formatLithoDisplayName(
  mainCode: string,
  admixtures: readonly AdmixtureItem[] | null | undefined,
): string {
  const baseName = LITHOLOGY_LABELS[mainCode] ?? mainCode

  if (!admixtures || admixtures.length === 0) return baseName

  // Build a qualifier fragment for each admixture in order.
  const parts: string[] = admixtures.map(adm => {
    const soilAdj = ADMIXTURE_SOIL_EN[adm.soil_code] ?? adm.soil_code.toLowerCase()
    const amountAdv = adm.amount ? (ADMIXTURE_AMOUNT_EN[adm.amount] ?? adm.amount) : null

    // "locally" prefix when the admixture occurs only locally in the layer.
    const localPrefix = adm.locally ? 'locally ' : ''

    if (amountAdv) {
      return `${localPrefix}${amountAdv} ${soilAdj}`
    }
    return `${localPrefix}${soilAdj}`
  })

  return `${parts.join(', ')} ${baseName}`
}
