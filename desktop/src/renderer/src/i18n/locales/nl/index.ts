// Dutch (Belgium) message catalogue — professional Flemish geotechnical
// register, composed from one module per surface, mirroring ``locales/en/``.
//
// Typed ``Partial<Messages>`` on purpose:
//
//  * A key that exists in EN but not here falls back to the English string at
//    runtime — a half-translated app is usable, a crashing one is not.
//  * A key that does NOT exist in EN is a ``tsc`` error, so a rename on the EN
//    side cannot leave an orphaned NL string behind.
//
// Terminology rules this catalogue follows:
//
//  * **BE register, not NL-NL.** Where Flemish and Netherlands practice differ
//    the Flemish form wins ("kleefweerstand" over "plaatselijke
//    wrijvingsweerstand", "grondwatertafel" over "grondwaterstand"), because
//    the buyers are BE/NL consultancies and the owner writes BE.
//  * **Domain tokens are never translated here.** Soil names, NAD packing-class
//    names, DOV codelist values and lithology labels come from sources that are
//    already Dutch (see ``locales/en/index.ts``). Translating them a second time
//    would produce two spellings of one term.
//  * **A term is FLAGGED when the choice is a judgement call, not a lookup.**
//    Those keys carry a ``// FLAG alt: a | b — why`` comment directly above
//    them; ``scripts/build_nl_translation_table.mjs`` reads exactly those
//    comments, so the review table cannot drift from the source files.

import type { Messages } from '../en'
import { BED_OVERRIDE_NL } from './bedOverride'
import { CHROME_NL } from './chrome'
import { DATA_NL } from './data'
import { LAUNCH_NL } from './launch'
import { MODELS_NL } from './models'
import { OUTPUTS_NL } from './outputs'
import { PANELS_NL } from './panels'
import { SECTIONS_NL } from './sections'
import { SETTINGS_NL } from './settings'
import { SHEET_NL } from './sheet'
import { TUTORIAL_NL } from './tutorial'

/** The composed Dutch catalogue. */
export const NL: Partial<Messages> = {
  ...CHROME_NL,
  ...DATA_NL,
  ...BED_OVERRIDE_NL,
  ...SETTINGS_NL,
  ...MODELS_NL,
  ...SECTIONS_NL,
  ...OUTPUTS_NL,
  ...SHEET_NL,
  ...PANELS_NL,
  ...LAUNCH_NL,
  ...TUTORIAL_NL,
}

/** Per-surface modules, kept addressable so the parity test can report which
 *  surface a missing or duplicated key belongs to. */
export const NL_MODULES = {
  chrome: CHROME_NL,
  data: DATA_NL,
  bedOverride: BED_OVERRIDE_NL,
  settings: SETTINGS_NL,
  models: MODELS_NL,
  sections: SECTIONS_NL,
  outputs: OUTPUTS_NL,
  sheet: SHEET_NL,
  panels: PANELS_NL,
  launch: LAUNCH_NL,
  tutorial: TUTORIAL_NL,
} as const
