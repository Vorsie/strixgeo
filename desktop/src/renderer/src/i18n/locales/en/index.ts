// English message catalogue — the SOURCE OF TRUTH for every user-facing string
// that has been lifted into the i18n layer. Composed from one module per
// surface so no single file grows past the 500-line ceiling and so a reviewer
// can read a surface's whole vocabulary in one screen.
//
// Rules for these files:
//
//  * Keys are ``<surface>.<element>``, dot-namespaced, FLAT (no nesting). Flat
//    keys keep ``MessageKey`` a plain string union, keep the review table a
//    plain list, and keep a missing translation a one-line diff.
//  * The VALUE here is the exact string the app renders today. Adding a key is
//    a transcription job, not a rewrite — if the wording should change, change
//    it in a separate commit so a translation review is not chasing a moving
//    target.
//  * ``{placeholder}`` marks an interpolation slot (see ``../../translate.ts``).
//    Placeholder NAMES are part of the contract: every other locale must reuse
//    them, and ``localeParity.test.ts`` fails the build if one drifts.
//  * Domain vocabulary is deliberately NOT here. Soil names, NAD packing-class
//    names and lithology labels already have Dutch-canonical sources (backend
//    ``NAD_CLASSES``, ``utils/soilColors.ts`` ``source``, ``lithoConstants``
//    ``LITHOLOGY_LABELS``, ``utils/labTestLabels.ts``). Routing them through a
//    second translation layer would create two spellings of one term and break
//    the docs/ux.md rule that the domain stores the raw upstream token. Those
//    lookups render Dutch by SELECTING the source token, not by translating —
//    see the review table's "domain canon" group.
//
// WIRED vs CATALOGUED: ``settings.*`` and ``data.toolbar.*`` are consumed by
// components today. Every other group is catalogued ahead of its component
// rewiring, so the terminology can be reviewed and approved in one pass rather
// than one dialog at a time.

import { CHROME } from './chrome'
import { DATA } from './data'
import { LAUNCH } from './launch'
import { MODELS } from './models'
import { OUTPUTS } from './outputs'
import { PANELS } from './panels'
import { SECTIONS } from './sections'
import { SETTINGS } from './settings'
import { SHEET } from './sheet'
import { TUTORIAL } from './tutorial'

/** The composed English catalogue. Module order is presentation order (shell →
 *  stages in workflow sequence → shared panels); it does not affect lookup. */
export const EN = {
  ...CHROME,
  ...DATA,
  ...SETTINGS,
  ...MODELS,
  ...SECTIONS,
  ...OUTPUTS,
  ...SHEET,
  ...PANELS,
  ...LAUNCH,
  ...TUTORIAL,
} as const

/** The per-surface modules, kept addressable so tests can assert that no key is
 *  defined twice across modules — a duplicate would be silently swallowed by the
 *  spread above, with the last module winning. */
export const EN_MODULES = {
  chrome: CHROME,
  data: DATA,
  settings: SETTINGS,
  models: MODELS,
  sections: SECTIONS,
  outputs: OUTPUTS,
  sheet: SHEET,
  panels: PANELS,
  launch: LAUNCH,
  tutorial: TUTORIAL,
} as const

/** Every key the app can translate. Derived from EN so a typo'd key is a
 *  compile error at the call site, not a silent English fallback at runtime. */
export type MessageKey = keyof typeof EN

/** A complete catalogue. Non-English locales are ``Partial<Messages>`` — a
 *  missing key falls back to EN, an unknown key fails ``tsc``. */
export type Messages = Record<MessageKey, string>
