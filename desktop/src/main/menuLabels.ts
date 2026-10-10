// Native application-menu labels, in every interface language the desktop
// ships. The renderer is fully localised (``renderer/src/i18n/locales``), but the
// Electron menu bar was hard-coded English — a Dutch app with an English menu.
// This table is the single place the main process reads a menu label from, so
// the menu bar follows the app language exactly the way the renderer does.
//
// Where the language comes from
// -----------------------------
// The interface language is a DEVICE-local choice owned by the renderer
// (``renderer/src/i18n/languageSelect.ts``: localStorage ``groundmodel.language``
// → the system language → English). The main process cannot read the renderer's
// localStorage, so it does NOT re-implement that rule: the renderer reports its
// resolved language to main over IPC (``window:set-language``) and main rebuilds
// the menu — the same shape as ``window:set-title``, where the renderer drives a
// value the OS chrome shows. ``narrowMenuLanguage`` below is used only for the
// first paint, before the renderer has reported, to guess from the OS locale
// (``app.getLocale()``) so a Dutch machine does not flash an English menu; it
// mirrors the renderer's SYSTEM-language tier, not the full resolution rule.
//
// Constants in a dedicated file (CLAUDE.md §Code Conventions). The Dutch strings
// reuse the renderer catalogues' wording for the same concepts — ``common.save``
// ("Opslaan"), ``project.close`` ("Project sluiten"), ``updater.checking``
// ("Controleren op updates…"), ``data.toolbar.groupCpt`` ("Sondering (CPT)"),
// ``data.toolbar.fromDov`` ("Uit DOV (kader tekenen)"), ``settings.title``
// ("Instellingen") — so the menu and the
// renderer never disagree on a term. No em-dashes in user-facing copy (CLAUDE.md).

/** Interface languages the native menu supports. Mirrors the renderer's
 *  ``LANGUAGES`` (``i18n_constants.ts``) — the two bundles do not share code, so
 *  the enum is declared once per side, never a copy of the resolution *rule*. */
export const MENU_LANGUAGES = ['en', 'nl'] as const

/** One supported interface language. */
export type MenuLanguage = (typeof MENU_LANGUAGES)[number]

/** Stable id for every translatable menu label. Role-driven items keep their
 *  Electron role (``quit``, ``togglefullscreen``) and only override the visible
 *  label from this table; dev-only View items (reload / dev-tools) stay English
 *  roles and are deliberately absent here. */
export type MenuLabelId =
  | 'file'
  | 'edit'
  | 'view'
  | 'help'
  | 'newProject'
  | 'openProject'
  | 'openRecent'
  | 'noRecentProjects'
  | 'save'
  | 'saveAs'
  | 'closeProject'
  | 'importCptMenu'
  | 'importCptGef'
  | 'importFromDov'
  | 'importCptPdf'
  | 'importBoreholeMenu'
  | 'importBoreholeXml'
  | 'importBoreholePdf'
  | 'importDmt'
  | 'settings'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'toggleFullScreen'
  | 'gettingStarted'
  | 'tutorial'
  | 'restartTutorial'
  | 'gestureCheatsheet'
  | 'licenceActivation'
  | 'checkUpdates'
  | 'openLogFolder'
  | 'saveLogsForSupport'
  | 'about'

/**
 * Every menu label in English and Dutch, keyed by a stable id.
 *
 * The English column reproduces the labels the app has always shipped, verbatim,
 * so the English build is visually unchanged. A ``…`` is the single-character
 * ellipsis (U+2026), the affordance for "opens a dialog or takes further input";
 * the Dutch column keeps it wherever English has it.
 */
export const MENU_LABELS: Record<MenuLabelId, Record<MenuLanguage, string>> = {
  // Top-level menu titles.
  file: { en: 'File', nl: 'Bestand' },
  edit: { en: 'Edit', nl: 'Bewerken' },
  view: { en: 'View', nl: 'Beeld' },
  help: { en: 'Help', nl: 'Help' },

  // File menu.
  newProject: { en: 'New Project…', nl: 'Nieuw project…' },
  openProject: { en: 'Open Project…', nl: 'Openen…' },
  openRecent: { en: 'Open Recent', nl: 'Recent geopend' },
  noRecentProjects: { en: '(no recent projects)', nl: '(geen recente projecten)' },
  save: { en: 'Save', nl: 'Opslaan' },
  saveAs: { en: 'Save As…', nl: 'Opslaan als…' },
  closeProject: { en: 'Close Project', nl: 'Project sluiten' },
  // One import submenu per kind of investigation (owner 2026-10-04: "one
  // button for cpt's with suboptions, same for drillings"). The submenu titles
  // carry the verb, so the routes inside say only where the data comes from;
  // the route wording matches the Data toolbar's Import menu.
  importCptMenu: { en: 'Import CPT', nl: 'Sondering (CPT) importeren' },
  importCptGef: { en: '.gef files…', nl: '.gef-bestanden…' },
  importFromDov: { en: 'From DOV (draw box)…', nl: 'Uit DOV (kader tekenen)…' },
  importCptPdf: { en: 'From a PDF report…', nl: 'Uit een pdf-rapport…' },
  importBoreholeMenu: { en: 'Import boreholes', nl: 'Boringen importeren' },
  importBoreholeXml: { en: 'DOV XML files…', nl: 'DOV-XML-bestanden…' },
  importBoreholePdf: { en: 'From a PDF report…', nl: 'Uit een pdf-rapport…' },
  importDmt: { en: 'Import DMT…', nl: 'DMT importeren…' },
  settings: { en: 'Settings…', nl: 'Instellingen…' },
  quit: { en: 'Quit', nl: 'Afsluiten' },

  // Edit menu.
  undo: { en: 'Undo', nl: 'Ongedaan maken' },
  redo: { en: 'Redo', nl: 'Opnieuw' },

  // View menu (packaged builds show only Toggle Full Screen).
  toggleFullScreen: { en: 'Toggle Full Screen', nl: 'Volledig scherm' },

  // Help menu.
  gettingStarted: { en: 'Getting started…', nl: 'Aan de slag…' },
  tutorial: { en: 'Tutorial', nl: 'Tutorial' },
  restartTutorial: { en: 'Restart tutorial', nl: 'Tutorial opnieuw starten' },
  gestureCheatsheet: { en: 'Gesture cheatsheet…', nl: 'Bediening en sneltoetsen…' },
  licenceActivation: { en: 'Licence & activation…', nl: 'Licentie en activatie…' },
  checkUpdates: { en: 'Check for updates…', nl: 'Controleren op updates…' },
  openLogFolder: { en: 'Open log folder', nl: 'Logmap openen' },
  saveLogsForSupport: { en: 'Save logs for support…', nl: 'Logs opslaan voor support…' },
  about: { en: 'About StrixGeo', nl: 'Over StrixGeo' },
}

/**
 * Resolve one menu label in the given language.
 *
 * Parameters
 * ----------
 * id : MenuLabelId
 *     Stable label id from ``MENU_LABELS``.
 * language : MenuLanguage
 *     The active interface language.
 *
 * Returns
 * -------
 * string
 *     The label text for that language.
 */
export function menuLabel(id: MenuLabelId, language: MenuLanguage): string {
  return MENU_LABELS[id][language]
}

/**
 * Narrow an arbitrary locale tag or language string to a supported
 * ``MenuLanguage``, defaulting to English.
 *
 * Used for the first menu paint from the OS locale (``app.getLocale()`` returns a
 * BCP-47 tag such as ``nl-BE``; only the primary subtag decides) and to harden
 * the IPC-reported value. This is the SYSTEM-language tier of the renderer's
 * resolution rule, not the full localStorage-first rule — that stays in the
 * renderer, which reports the resolved language over IPC.
 *
 * Parameters
 * ----------
 * raw : string | null | undefined
 *     A locale tag, a bare language code, or a missing value.
 *
 * Returns
 * -------
 * MenuLanguage
 *     The matched language, or ``'en'`` for anything unsupported or missing.
 */
export function narrowMenuLanguage(raw: string | null | undefined): MenuLanguage {
  if (typeof raw !== 'string' || raw === '') return 'en'
  const primary = raw.toLowerCase().split('-')[0]
  return (MENU_LANGUAGES as readonly string[]).includes(primary) ? (primary as MenuLanguage) : 'en'
}
