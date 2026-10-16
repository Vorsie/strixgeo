// Pure builder for the native application menu template.
//
// Extracted from ``index.ts`` so the menu structure can be built and inspected
// without an Electron runtime (main test files must not import 'electron' —
// vitest.config.ts runs them in jsdom). ``buildMenu`` in index.ts feeds the
// result to ``Menu.buildFromTemplate`` / ``Menu.setApplicationMenu``; the click
// handlers, the recent list and the packaging flags are injected so this module
// stays free of app state.
//
// Every visible label comes from ``menuLabels.ts`` in the active language, so the
// menu bar follows the app language like the renderer. Accelerators and roles are
// LANGUAGE-INVARIANT constants defined here once — a shortcut never depends on
// which language the label is shown in.

import type { MenuItemConstructorOptions } from 'electron'

import { menuLabel, type MenuLanguage } from './menuLabels'

/** One entry of the "Open Recent" submenu. Structural mirror of the main
 *  process's ``RecentProject`` without its timestamp. */
export interface MenuRecentEntry {
  name: string
  path: string
}

/** Everything ``buildMenuTemplate`` needs, injected so the builder holds no app
 *  state and imports no Electron runtime. */
export interface MenuTemplateDeps {
  /** Active interface language — decides every label, nothing else. */
  language: MenuLanguage
  /** ``app.isPackaged``: hides dev-only View items and the raw-log affordance. */
  isPackaged: boolean
  /** Whether the raw (un-redacted) ``backend.log`` reveal is offered — dev only,
   *  see ``rawBackendLogAffordanceEnabled`` in index.ts. */
  rawBackendLogAffordance: boolean
  /** Recent projects, newest first, for the "Open Recent" submenu. */
  recent: readonly MenuRecentEntry[]
  /** One-way main -> renderer fire, e.g. ``send('menu:project-new')``. */
  send: (channel: string, ...args: unknown[]) => void
  /** Open the logs directory (main-side ``shell.openPath``). Dev only. */
  onOpenLogFolder: () => void
  /** Write and offer the redacted diagnostics bundle (main-side). */
  onSaveLogsForSupport: () => void
  /** Show the native About dialog (main-side). */
  onAbout: () => void
}

/**
 * Build the native application-menu template in the given language.
 *
 * Parameters
 * ----------
 * deps : MenuTemplateDeps
 *     Language, packaging flags, the recent list and the click handlers.
 *
 * Returns
 * -------
 * MenuItemConstructorOptions[]
 *     A plain-data template for ``Menu.buildFromTemplate``. No Electron runtime
 *     is touched here — the click closures are invoked later, by Electron.
 */
export function buildMenuTemplate(deps: MenuTemplateDeps): MenuItemConstructorOptions[] {
  const { language, isPackaged, rawBackendLogAffordance, recent, send } = deps

  const recentSubmenu: MenuItemConstructorOptions[] = recent.length
    ? recent.map(r => ({
        label: r.name,
        // Path is the source of truth — the name might have drifted in the DB.
        sublabel: r.path,
        click: () => send('menu:project-open-recent', r.path),
      }))
    : [{ label: menuLabel('noRecentProjects', language), enabled: false }]

  return [
    {
      label: menuLabel('file', language),
      submenu: [
        {
          label: menuLabel('newProject', language),
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:project-new'),
        },
        {
          label: menuLabel('openProject', language),
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:project-open'),
        },
        {
          label: menuLabel('openRecent', language),
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: menuLabel('save', language),
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:project-save'),
        },
        {
          label: menuLabel('saveAs', language),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:project-save-as'),
        },
        {
          label: menuLabel('closeProject', language),
          accelerator: 'CmdOrCtrl+W',
          click: () => send('menu:project-close'),
        },
        { type: 'separator' },
        // One submenu per kind of investigation (owner 2026-10-04), mirroring
        // the Data toolbar's Import menu. The "From DOV" items start the same
        // bbox draw as the toolbar; the renderer routes to the Data stage's map.
        {
          label: menuLabel('importCptMenu', language),
          submenu: [
            {
              label: menuLabel('importCptGef', language),
              accelerator: 'CmdOrCtrl+Shift+C',
              click: () => send('menu:import-cpt'),
            },
            {
              label: menuLabel('importFromDov', language),
              click: () => send('menu:import-cpt-dov'),
            },
            {
              label: menuLabel('importCptPdf', language),
              click: () => send('menu:import-cpt-pdf'),
            },
          ],
        },
        {
          label: menuLabel('importBoreholeMenu', language),
          submenu: [
            {
              label: menuLabel('importFromDov', language),
              click: () => send('menu:import-borehole-dov'),
            },
            {
              label: menuLabel('importBoreholeXml', language),
              accelerator: 'CmdOrCtrl+Shift+B',
              click: () => send('menu:import-borehole'),
            },
            {
              label: menuLabel('importBoreholePdf', language),
              click: () => send('menu:import-borehole-pdf'),
            },
          ],
        },
        {
          label: menuLabel('importDmt', language),
          click: () => send('menu:import-dmt'),
          enabled: false, // Phase 3
        },
        { type: 'separator' },
        {
          label: menuLabel('settings', language),
          // Apple-standard ``Cmd+,`` for Preferences; Ctrl+, on Windows / Linux
          // matches VS Code + JetBrains. Opens the renderer SettingsDialog.
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu:open-settings'),
        },
        { type: 'separator' },
        // Keep the ``quit`` role (its platform behaviour + default accelerator);
        // only the visible label follows the language.
        { role: 'quit', label: menuLabel('quit', language) },
      ],
    },
    {
      label: menuLabel('edit', language),
      submenu: [
        {
          label: menuLabel('undo', language),
          // ``registerAccelerator: false`` shows the shortcut but lets the
          // renderer's document keydown handler own the actual keystroke.
          accelerator: 'CmdOrCtrl+Z',
          registerAccelerator: false,
          click: () => send('menu:edit-undo'),
        },
        {
          label: menuLabel('redo', language),
          accelerator: 'CmdOrCtrl+Shift+Z',
          registerAccelerator: false,
          click: () => send('menu:edit-redo'),
        },
      ],
    },
    {
      label: menuLabel('view', language),
      // Reload / Force Reload / Toggle DevTools exist in development only
      // (debt #200). Registering the roles conditionally also removes their
      // default accelerators (Ctrl+R / F12 / Ctrl+Shift+I). Only Toggle Full
      // Screen ships in a packaged build, so only it carries a translated label;
      // the dev-only roles keep their English role labels.
      submenu: isPackaged
        ? [{ role: 'togglefullscreen', label: menuLabel('toggleFullScreen', language) }]
        : [
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: menuLabel('toggleFullScreen', language) },
          ],
    },
    {
      label: menuLabel('help', language),
      submenu: [
        {
          // Prototype onboarding (#93). One-way fire — the renderer owns the
          // OnboardingOverlay open state and its "seen" flag.
          label: menuLabel('gettingStarted', language),
          click: () => send('menu:open-onboarding'),
        },
        {
          // Guided tutorial (#93). Resumes at the last incomplete step.
          label: menuLabel('tutorial', language),
          click: () => send('menu:tutorial'),
        },
        {
          label: menuLabel('restartTutorial', language),
          click: () => send('menu:tutorial-restart'),
        },
        {
          label: menuLabel('gestureCheatsheet', language),
          accelerator: 'F1',
          click: () => send('menu:open-cheatsheet'),
        },
        { type: 'separator' },
        {
          // Prototype updater (#6). Triggers a manual check.
          label: menuLabel('checkUpdates', language),
          click: () => send('menu:check-updates'),
        },
        // #214d — open the logs directory (raw ``backend.log``). Dev only:
        // that file is un-redacted (asyncpg DSN, raw paths), so a packaged build
        // never offers it — the redacted bundle below is the only log export.
        ...(rawBackendLogAffordance
          ? [
              {
                label: menuLabel('openLogFolder', language),
                click: (): void => deps.onOpenLogFolder(),
              },
            ]
          : []),
        {
          // #16 — the manual half of crash reporting: one redacted zip the user
          // can inspect and send. The label NAMES THE LOG on purpose (owner
          // 2026-08-28) so a user hunting for the word "log" can find it.
          label: menuLabel('saveLogsForSupport', language),
          click: (): void => deps.onSaveLogsForSupport(),
        },
        { type: 'separator' },
        {
          label: menuLabel('about', language),
          click: (): void => deps.onAbout(),
        },
      ],
    },
  ]
}
