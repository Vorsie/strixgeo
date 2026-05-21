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
//
// Source: the DOV ``codetabel_hoofdnaam.csv`` (108 codes) at
// ``src/groundmodel/infrastructure/codelists/data/``.  Borehole
// ``<bijmenging><grondsoort>`` uses this same vocabulary as the main
// lithology, so the admixture's soil code can be any of the 108 entries
// — not just the five core soils (GL / ZN / SL / KL / VE).
//
// We curate an English adjective form for the codes that actually
// appear as bijmenging in practice (the core soils + grain-size
// variants + organic + carbonate + anthropogenic).  Codes we have not
// curated fall through to a lower-case version of the Dutch description
// from the codelist — handled by ``ADMIXTURE_SOIL_FALLBACK_DUTCH``
// below.  This avoids the prior failure mode where an unknown code
// rendered as its raw alphanumeric token (``om`` / ``xz``) in the user-
// facing label.
//
// Adjective form follows NEN 5104 / Belgian field-description practice
// translated to English.
// ---------------------------------------------------------------------------

const ADMIXTURE_SOIL_EN: Record<string, string> = {
  // Core five soils (most common as bijmenging).
  GL: 'gravelly',
  KL: 'clayey',
  SL: 'silty',
  ZN: 'sandy',
  VE: 'peaty',
  // Aliases / DOV variants encountered in real data:
  Z: 'sandy',
  K: 'clayey',
  S: 'silty',
  G: 'gravelly',
  V: 'peaty',
  // Hoofdnaam codes that also appear as bijmenging in real DOV data
  // (the user's "very om, N xz Silt" example surfaced OM + XZ — both
  // hoofdnaam codes used here as admixture soils).
  XZ: 'sandy',           // XZ = zand (sand, generic grain)
  XG: 'gravelly',        // XG = grind (gravel, generic grain)
  FZ: 'fine-sandy',
  MZ: 'medium-sandy',
  GZ: 'coarse-sandy',
  FG: 'fine-gravelly',
  MG: 'medium-gravelly',
  GG: 'coarse-gravelly',
  LE: 'loamy',           // LE = leem (loam)
  ZL: 'loamy-sandy',     // ZL = zandleem (sandy loam)
  // Organic admixtures.
  OM: 'organic',         // OM = organisch materiaal
  HU: 'humic',           // HU = humus
  HT: 'with wood debris', // HT = houtresten
  HC: 'with charcoal',   // HC = houtskool
  PL: 'with plant debris', // PL = plantenresten
  PC: 'with coal dust',  // PC = poederkool
  AG: 'ashy',            // AG = as
  LG: 'with lignite',    // LG = ligniet
  CO: 'with coal',       // CO = steenkool
  // Carbonate / shell admixtures.
  KA: 'calcareous',      // KA = kalk
  SC: 'with shells',     // SC = schelpen
  SF: 'with shell fragments', // SF = schelpfragmenten
  SG: 'with shell debris',    // SG = schelpgruis
  NN: 'with nummulites',      // NN = nummulieten (foraminifera fossils)
  FO: 'with fossils',         // FO = fossielen
  // Mineral / iron admixtures (encountered occasionally).
  GI: 'micaceous',       // GI = glimmers
  PY: 'with pyrite',     // PY = pyriet
  HB: 'with hematite',   // HB = hematiet
  LI: 'with limonite',   // LI = limoniet
  FE: 'ferruginous',     // FE = ijzer
  // Anthropogenic admixtures.
  PU: 'with rubble',     // PU = puin
  BK: 'with bricks',     // BK = baksteen
  BT: 'with concrete',   // BT = beton
  AF: 'with waste',      // AF = afval
  TA: 'with topsoil',    // TA = teelaarde
  GA: 'disturbed',       // GA = geroerd / gestoord
  // Misc / placeholder.
  XX: 'unknown',         // XX = onbekend
  RO: 'with rock',       // RO = rots
  ST: 'with stones',     // ST = stenen
  SN: 'with rock fragments', // SN = steenfragmenten
  RV: 'with weathered rock', // RV = verweerde rots
}

// Codelist-derived Dutch description fallback for the long-tail
// hoofdnaam codes (rock types, evaporites, metamorphics) that never
// appear as bijmenging in normal use but are still part of the DOV
// vocabulary.  Used as a last-resort label so unknown codes still read
// gracefully ("with andesite" instead of "ab").
const ADMIXTURE_SOIL_FALLBACK_DUTCH: Record<string, string> = {
  AA: 'amphibolite', AB: 'andesite', AC: 'anhydrite', AD: 'ankerite',
  AR: 'arenite', AE: 'arkose', AT: 'asphalt',
  BA: 'basalt', BB: 'bauxite', BC: 'bentonite', BS: 'blueschist',
  CA: 'with carbonate fragments', CT: 'banded chert', CB: 'conglomerate/breccia',
  DA: 'dacite', DB: 'diatomite', DC: 'diorite', DD: 'dolerite',
  DL: 'dolomite', DK: 'dolomitic limestone', DE: 'dunite',
  EC: 'eclogite', EA: 'evaporite',
  FA: 'phosphorite', FY: 'phyllite',
  GB: 'gabbro', GM: 'split metamorphic', GC: 'gypsum',
  GD: 'gneiss', GE: 'granite', GF: 'granodiorite',
  GH: 'greenschist', GS: 'greenstone',
  HA: 'halite', HD: 'hornfels',
  IA: 'with iron oolite', IN: 'intrusive rock',
  KC: 'limestone schist', KS: 'limestone', KB: 'limestone breccia',
  KR: 'chalk', KT: 'claystone', KO: 'komatiite', KW: 'quartzite',
  LA: 'lateritic', LS: 'slate',
  MA: 'marble', ME: 'with marl', MM: 'metamorphic',
  MB: 'micaschist', MI: 'migmatite', MS: 'shale', MY: 'mylonite',
  OK: 'oolitic limestone',
  PA: 'pegmatite', PB: 'peridotite', PS: 'psammite',
  PM: 'pumice', PD: 'pyroxenite',
  QU: 'quartz-bearing',
  RA: 'radiolarite', RB: 'rhyolite',
  SH: 'shaly', SK: 'schistose limestone', SO: 'scoria',
  SE: 'sedimentary', SP: 'serpentinite', SY: 'schist',
  SA: 'with siderite', SX: 'with flint', SI: 'silty',
  SS: 'siltstone',
  TB: 'tuffaceous', TS: 'tufa',
  VA: 'volcanic', VS: 'flinty',
  WA: 'wackestone',
  ZE: 'soapstone', ZS: 'sandstone',
  // Anthropogenic-water containers (rare as bijmenging).
  AN: 'with non-watertight tank', AV: 'with watertight tank',
  AW: 'with water-permeable tank',
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
  N: 'with',        // N = "n." appears in real DOV data as a generic
                    // intensity-unspecified marker; map to plain "with"
                    // rather than fall through as raw "N" in the label.
  WM: 'slightly to moderately',
  MV: 'moderately to very',
}

/**
 * Public list of curated admixture soil options for dropdowns.
 *
 * Ordered: core five first, then grain-size variants, then organics,
 * then carbonates, then anthropogenic, then long-tail fallback codes.
 * The picker dialog + ghost composition editor share this list so
 * stored values match what dropdowns can express — the previous
 * 5-option dropdown silently fell back to "Gravel (GL)" for any
 * unknown stored code, producing the user-reported mismatch where
 * the dropdown said "Gravel" but the preview showed "very om Silt".
 */
export const ADMIXTURE_SOIL_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  // Core
  { code: 'GL', label: 'Gravel (GL)' },
  { code: 'ZN', label: 'Sand (ZN)' },
  { code: 'SL', label: 'Silt (SL)' },
  { code: 'KL', label: 'Clay (KL)' },
  { code: 'VE', label: 'Peat (VE)' },
  // Grain-size variants (DOV hoofdnaam codes used as bijmenging)
  { code: 'XZ', label: 'Sand, generic (XZ)' },
  { code: 'XG', label: 'Gravel, generic (XG)' },
  { code: 'FZ', label: 'Fine sand (FZ)' },
  { code: 'MZ', label: 'Medium sand (MZ)' },
  { code: 'GZ', label: 'Coarse sand (GZ)' },
  { code: 'FG', label: 'Fine gravel (FG)' },
  { code: 'MG', label: 'Medium gravel (MG)' },
  { code: 'GG', label: 'Coarse gravel (GG)' },
  { code: 'LE', label: 'Loam (LE)' },
  { code: 'ZL', label: 'Sandy loam (ZL)' },
  // Organic
  { code: 'OM', label: 'Organic matter (OM)' },
  { code: 'HU', label: 'Humus (HU)' },
  { code: 'HT', label: 'Wood debris (HT)' },
  { code: 'HC', label: 'Charcoal (HC)' },
  { code: 'PL', label: 'Plant debris (PL)' },
  { code: 'PC', label: 'Coal dust (PC)' },
  { code: 'AG', label: 'Ash (AG)' },
  { code: 'LG', label: 'Lignite (LG)' },
  { code: 'CO', label: 'Coal (CO)' },
  // Carbonate / shells
  { code: 'KA', label: 'Calcareous (KA)' },
  { code: 'SC', label: 'Shells (SC)' },
  { code: 'SF', label: 'Shell fragments (SF)' },
  { code: 'SG', label: 'Shell debris (SG)' },
  { code: 'NN', label: 'Nummulites (NN)' },
  { code: 'FO', label: 'Fossils (FO)' },
  // Minerals
  { code: 'GI', label: 'Mica (GI)' },
  { code: 'PY', label: 'Pyrite (PY)' },
  { code: 'HB', label: 'Hematite (HB)' },
  { code: 'LI', label: 'Limonite (LI)' },
  { code: 'FE', label: 'Iron (FE)' },
  // Anthropogenic
  { code: 'PU', label: 'Rubble (PU)' },
  { code: 'BK', label: 'Bricks (BK)' },
  { code: 'BT', label: 'Concrete (BT)' },
  { code: 'AF', label: 'Waste (AF)' },
  { code: 'TA', label: 'Topsoil (TA)' },
  { code: 'GA', label: 'Disturbed (GA)' },
  // Misc
  { code: 'XX', label: 'Unknown (XX)' },
  { code: 'RO', label: 'Rock (RO)' },
  { code: 'ST', label: 'Stones (ST)' },
  { code: 'SN', label: 'Rock fragments (SN)' },
  { code: 'RV', label: 'Weathered rock (RV)' },
]

/**
 * Public list of curated amount options for dropdowns.
 * Shared with the picker dialog + ghost composition editor.
 */
export const ADMIXTURE_AMOUNT_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: '', label: '— (unspecified)' },
  { code: 'Z', label: 'Weakly (Z)' },
  { code: 'W', label: 'Slightly (W)' },
  { code: 'M', label: 'Moderately (M)' },
  { code: 'V', label: 'Very (V)' },
  { code: 'S', label: 'Strongly (S)' },
  { code: 'N', label: 'With (N)' },
  { code: 'WM', label: 'Slightly to moderately (WM)' },
  { code: 'MV', label: 'Moderately to very (MV)' },
]

/**
 * Look up the English adjective for an admixture soil code, with a
 * graceful fallback for unknown codes.  Used by ``formatLithoDisplayName``
 * AND by the dialog when it needs to label a stored value that isn't
 * in the curated options.
 */
export function admixtureSoilLabel(code: string): string {
  if (code in ADMIXTURE_SOIL_EN) return ADMIXTURE_SOIL_EN[code]
  if (code in ADMIXTURE_SOIL_FALLBACK_DUTCH) return ADMIXTURE_SOIL_FALLBACK_DUTCH[code]
  return code.toLowerCase()
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
    const soilAdj = admixtureSoilLabel(adm.soil_code)
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
