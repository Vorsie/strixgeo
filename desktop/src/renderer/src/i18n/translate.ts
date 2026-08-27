// The ``t()`` lookup — the presentation boundary for interface chrome.
//
// docs/ux.md §Translation & persistence already states the rule this module
// implements: translate at the presentation boundary, never at ingest. What
// changes is only WHICH boundary. Domain vocabulary (soil names, NAD packing
// classes, DOV codelists) keeps its existing per-lookup boundary in
// ``utils/soilColors.ts`` / ``utils/lithoLabels.ts`` / ``utils/labTestLabels.ts``,
// where the raw upstream token is the key and the Dutch source text is already
// carried alongside the English label. Interface chrome — verbs, headings,
// hints, empty states — goes through here instead.
//
// Resolution order for a key: active locale → English → the key itself. The
// last step is deliberate: a missing key renders as ``settings.title`` on
// screen, which is loud, greppable and harmless, rather than as an empty
// element that silently swallows a button's label.

import { EN, type MessageKey } from './locales/en'
import { NL } from './locales/nl'
import { getLanguage, useLanguage } from './languageSelect'
import type { Language } from './i18n_constants'
import { log } from '../utils/log'

/** Values a ``{placeholder}`` may be filled with. Numbers are formatted by the
 *  caller, not here — a decimal separator is a locale decision the numeric
 *  input layer already owns (``ui/NumericInput.tsx``), and duplicating it here
 *  would give two answers for "12,5". */
export type MessageParams = Readonly<Record<string, string | number>>

/** All catalogues, keyed by language. EN is complete; every other locale is a
 *  partial overlay that falls back to it. */
const CATALOGUES: Record<Language, Partial<Record<MessageKey, string>>> = {
  en: EN,
  nl: NL,
}

/** Keys already reported as missing, so a key looked up inside a render loop
 *  warns once instead of once per frame. */
const reportedMissing = new Set<string>()

/**
 * Substitute ``{name}`` placeholders in a resolved message.
 *
 * An unknown placeholder is left verbatim rather than blanked: on screen
 * ``{count}`` is a visible defect, whereas an empty gap reads as intentional
 * copy and survives review.
 *
 * Parameters
 * ----------
 * template : string
 *     The resolved message, possibly containing ``{name}`` slots.
 * params : MessageParams | undefined
 *     Values to substitute. ``undefined`` skips substitution entirely.
 *
 * Returns
 * -------
 * string
 *     The message with every known placeholder replaced.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template
  // hasOwnProperty via call, not Object.hasOwn: this tsconfig's lib target
  // predates ES2022 and the renderer bundle must build under it unchanged.
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  )
}

/**
 * Translate a key into the given language.
 *
 * Parameters
 * ----------
 * language : Language
 *     The catalogue to read first.
 * key : MessageKey
 *     The message key. Typed against the EN catalogue, so a typo is a ``tsc``
 *     error at the call site rather than a runtime fallback.
 * params : MessageParams, optional
 *     Values for ``{name}`` placeholders in the message.
 *
 * Returns
 * -------
 * string
 *     The translated message, the English message when the locale lacks the
 *     key, or the key itself when neither catalogue has it.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const localised = CATALOGUES[language]?.[key]
  if (localised !== undefined) return interpolate(localised, params)

  const english = EN[key]
  if (english !== undefined) return interpolate(english, params)

  // Neither catalogue has it. This can only happen when a key is constructed
  // dynamically past the type system (a cast, or data from the API) — worth a
  // one-time warning, never worth throwing.
  if (!reportedMissing.has(key)) {
    reportedMissing.add(key)
    log.warn('i18n', `no message for key "${key}" in ${language} or en — rendering the key`)
  }
  return key
}

/**
 * Translate a key in the CURRENT language, outside React.
 *
 * For call sites that are not components — toast builders, file-dialog filter
 * lists, undo-stack action labels. Reads the language at call time, so it is
 * always current without a subscription (same contract as
 * ``computeSectionFillActive``).
 *
 * Parameters
 * ----------
 * key : MessageKey
 *     The message key.
 * params : MessageParams, optional
 *     Values for ``{name}`` placeholders.
 *
 * Returns
 * -------
 * string
 *     The translated message.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(getLanguage(), key, params)
}

/** The translator a component receives from {@link useT}. */
export type Translator = (key: MessageKey, params?: MessageParams) => string

/**
 * React hook: a translator bound to the active language.
 *
 * Subscribing through ``useLanguage`` is what makes a component re-render when
 * the Settings toggle flips — a component that called the module-level ``t()``
 * instead would keep its old strings until something else re-rendered it.
 *
 * Returns
 * -------
 * Translator
 *     ``(key, params?) => string`` in the active language.
 */
export function useT(): Translator {
  const language = useLanguage()
  return (key, params) => translate(language, key, params)
}
