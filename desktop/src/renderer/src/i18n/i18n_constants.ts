// Constants for the desktop interface language.
//
// Kept in a dedicated ``*_constants.ts`` next to the modules that use them,
// per CLAUDE.md §Code Conventions ("Constants in a dedicated file") — the
// same shape as ``sectionsToolbar_constants.ts`` / ``toolbarOverflow_constants.ts``.

/** Interface languages the desktop ships. English is the source of truth: every
 *  key exists in ``locales/en.ts`` first, and any other locale is a partial
 *  overlay on top of it (see ``locales/nl.ts``). */
export const LANGUAGES = ['en', 'nl'] as const

export type Language = (typeof LANGUAGES)[number]

/** Default interface language.
 *
 *  EN, deliberately — the NL terminology is under owner review and must not
 *  reach anyone's screen before it is approved. Flipping this constant is the
 *  single edit that makes NL the out-of-the-box language once it is signed off. */
export const DEFAULT_LANGUAGE: Language = 'en'

/** localStorage key for the device-local language choice.
 *
 *  Namespaced ``groundmodel.<kind>`` like ``groundmodel.theme`` — docs/ux.md
 *  §Translation & persistence: a global (not project-scoped) preference, because
 *  the interface language follows the person, not the file. It must NOT travel
 *  in the .gmproj bundle (CLAUDE.md §Project files: the bundle carries
 *  engineering decisions, localStorage carries per-user UI chrome). */
export const LANGUAGE_STORAGE_KEY = 'groundmodel.language'

/** Endonyms for the language picker. A language is always offered in its OWN
 *  language — a Dutch speaker looking for their language scans for "Nederlands",
 *  not for "Dutch" (Apple HIG / W3C i18n practice). */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  nl: 'Nederlands',
}
