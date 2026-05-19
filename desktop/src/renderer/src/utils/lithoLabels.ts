/**
 * Dutch display-label helpers for lithostratigraphic units.
 *
 * Domain vocabulary: base lithology codes (ZAND, KLEI, SILT, GRIND, VEEN)
 * come from the backend ``BASE_LITHOLOGIES`` constant; admixture soil codes
 * (GL, KL, SL, ZN, VE) and amount codes (W, M, V, S, Z, empty) come from
 * the DOV vocabulary stored in borehole ObservationLayer admixtures.
 *
 * The function produces labels like "matig kleiige Zand" or "siltige Klei"
 * that match the Belgian geotechnical reporting convention (Dutch mixed-case,
 * admixture adjective before the capitalised main lithology name).
 *
 * Reference: Belgian NAD geotechnical class names in ``litho_constants.py``
 * (e.g. ``"ZAND, silt-/kleihoudend, los gp"``).  The adjective form here
 * is slightly different (``"siltige"`` vs ``"silt-/kleihoudend"``) because
 * the inspector label is a short display string, not the full NAD designation.
 *
 * Translation at the presentation boundary — see CLAUDE.md §UX Conventions.
 */

import type { AdmixtureItem } from '../api/client'

// ---------------------------------------------------------------------------
// Base lithology — Dutch names (capitalised, used as the main noun).
// Keys match BASE_LITHOLOGIES in litho_constants.py.
// ---------------------------------------------------------------------------

const BASE_LITHOLOGY_NL: Record<string, string> = {
  GRIND: 'Grind',
  ZAND: 'Zand',
  SILT: 'Silt',
  KLEI: 'Klei',
  VEEN: 'Veen',
}

// ---------------------------------------------------------------------------
// Admixture soil codes → Dutch adjective form.
// Values are DOV soil-vocabulary codes stored in borehole admixtures.
// The adjective form (``kleiige``, ``siltige``, …) is used in short labels;
// the longer ``-houdend`` form lives in the NAD class names.
// ---------------------------------------------------------------------------

const ADMIXTURE_SOIL_NL: Record<string, string> = {
  GL: 'grindige', // GL = gravel (Grind)
  KL: 'kleiige',  // KL = clay (Klei)
  SL: 'siltige',  // SL = silt (Silt)
  ZN: 'zandige',  // ZN = sand (Zand)
  VE: 'venige',   // VE = peat (Veen)
  // Aliases / DOV variants encountered in real data:
  Z: 'zandige',   // "Z" = Zand shortcode in some DOV exports
  K: 'kleiige',   // "K" = Klei shortcode
  S: 'siltige',   // "S" = Silt shortcode
  G: 'grindige',  // "G" = Grind shortcode
  V: 'venige',    // "V" = Veen shortcode (context: soil code, not amount)
}

// ---------------------------------------------------------------------------
// Admixture amount codes → Dutch amount adjective (placed BEFORE soil adj).
// Source: DOV ``<hoeveelheid>`` vocabulary.
// ---------------------------------------------------------------------------

const ADMIXTURE_AMOUNT_NL: Record<string, string> = {
  W: 'weinig',  // W = weinig (little)
  M: 'matig',   // M = matig (moderate)
  V: 'veel',    // V = veel (much) — note: same letter as Veen soil code;
                // context (amount field) determines the reading
  S: 'sterk',   // S = sterk (strongly)
  Z: 'zwak',    // Z = zwak (weakly / slightly)
  WM: 'weinig tot matig',
  MV: 'matig tot veel',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format a Dutch display name for a lithostratigraphic unit.
 *
 * Combines the main lithology code and optional admixtures into a
 * short Dutch label following the Belgian geotechnical reporting style:
 * amount adjective (if any) + soil adjective + capitalised main lithology.
 *
 * Examples::
 *
 *   formatLithoDisplayName('ZAND', [])
 *   // → 'Zand'
 *
 *   formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }])
 *   // → 'matig kleiige Zand'
 *
 *   formatLithoDisplayName('KLEI', [
 *     { soil_code: 'SL', amount: 'W', locally: false },
 *     { soil_code: 'ZN', amount: '',  locally: true  },
 *   ])
 *   // → 'weinig siltige, lokaal zandige Klei'
 *
 * Parameters
 * ----------
 * mainCode
 *     Base lithology code (ZAND, KLEI, SILT, GRIND, VEEN).  Falls back
 *     to the raw code when not found in the label table.
 * admixtures
 *     Admixture items from the API (``AdmixtureItem[]``).  Empty or null
 *     returns just the main lithology name.
 *
 * Returns
 * -------
 * string
 *     Short Dutch display label.
 */
export function formatLithoDisplayName(
  mainCode: string,
  admixtures: readonly AdmixtureItem[] | null | undefined,
): string {
  const baseName = BASE_LITHOLOGY_NL[mainCode] ?? mainCode

  if (!admixtures || admixtures.length === 0) return baseName

  // Build a qualifier fragment for each admixture in order.
  const parts: string[] = admixtures.map(adm => {
    const soilAdj = ADMIXTURE_SOIL_NL[adm.soil_code] ?? adm.soil_code.toLowerCase()
    const amountAdj = adm.amount ? (ADMIXTURE_AMOUNT_NL[adm.amount] ?? adm.amount) : null

    // "lokaal" prefix when the admixture occurs only locally in the layer.
    const localPrefix = adm.locally ? 'lokaal ' : ''

    if (amountAdj) {
      return `${localPrefix}${amountAdj} ${soilAdj}`
    }
    return `${localPrefix}${soilAdj}`
  })

  return `${parts.join(', ')} ${baseName}`
}
