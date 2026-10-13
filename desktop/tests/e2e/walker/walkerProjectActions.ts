/**
 * The walker's project-level gestures (Playwright side), owner 2026-10-13.
 *
 * "Walk again, add more steps. I test it once and find a bug, walker is thus
 * not doing its job." The bug: opening a SECOND project left the first
 * project's models active. The walker only ever reopened the same project
 * through a page reload, which throws the whole renderer state away and so can
 * never show state leaking from one project into the next. These gestures go
 * through the app's OWN paths instead, in one renderer session:
 *
 * * ``switchProject`` closes through File > Close Project (the menu IPC a
 *   Ctrl+W sends), answers the unsaved-changes prompt (discard or save), and
 *   opens the other project from the welcome screen's recent list.
 * * ``saveProject`` / ``openSettings`` send the same menu IPC the native menu
 *   sends: Playwright's keyboard goes through CDP and never reaches a native
 *   menu accelerator, so a pressed Ctrl+S would do nothing.
 * * ``undoRedoBurst`` presses Ctrl+Z / Ctrl+Y, which the renderer owns
 *   (App.tsx keydown listener; the menu accelerators are display-only).
 * * ``openImportDialog`` walks the Data toolbar's Import menu to one verb and
 *   cancels whatever it opened.
 *
 * Every gesture is best-effort and swallows ordinary failures; only a fatal
 * page error (a crash) escapes, so the orchestrator can record it.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test'

import { UNSAVED_DIALOG_TESTID, UNSAVED_DISCARD_TESTID } from '../helpers/closeAppProbe'
import { IMPORT_ROUTES } from './walkerPolicy'
import type { CloseChoice } from './walkerTypes'

/** The unsaved-changes prompt's save button (UnsavedChangesDialog.tsx). */
const UNSAVED_SAVE_TESTID = 'unsaved-save-and-close'
/** The force-revert prompt that follows a refused discard (AppDialogs.tsx). */
const FORCE_REVERT_DIALOG_TESTID = 'force-revert-dialog'
const FORCE_REVERT_CONFIRM_TESTID = 'force-revert-confirm'

/** How long a close may take: a discard replace-restores the whole bundle. */
const CLOSE_BUDGET_MS = 60_000
/** How long an open may take: the worked example's first restore is slow. */
const OPEN_BUDGET_MS = 90_000

/** One project the walk can be in: its recent-list path and its id. */
export interface ProjectSlot {
  /** Short label for the trail (``worked`` / ``fixture``). */
  readonly label: string
  /** The temp ``.strix`` path; ``welcome-recent-entry-<path>`` opens it. */
  readonly path: string
}

/** True for a Playwright error that means the page / app is gone. */
function isFatal(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err)
  return /Target (page|closed)|crashed|has been closed|Browser has been closed/i.test(m)
}

/** Re-throw a fatal (crash) error; swallow every ordinary failure. */
function rethrowIfFatal(err: unknown): void {
  if (isFatal(err)) throw err
}

/**
 * Send a menu IPC to the main window, exactly as the native menu item does
 * (menuTemplate.ts ``send(channel)``).
 *
 * @param app - The Electron application.
 * @param channel - The menu channel, e.g. ``menu:project-close``.
 */
export async function sendMenu(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, ch) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(ch)
  }, channel)
}

/** Whether a test id is visible right now (never throws). */
async function visible(page: Page, testid: string): Promise<boolean> {
  return page
    .getByTestId(testid)
    .first()
    .isVisible()
    .catch(() => false)
}

/**
 * Close the open project through File > Close Project and answer any prompt.
 *
 * @param app - The Electron application.
 * @param page - The renderer page.
 * @param choice - Discard or save when the unsaved-changes prompt appears.
 * @returns ``true`` when the welcome screen is up afterwards.
 */
export async function closeProjectViaMenu(
  app: ElectronApplication,
  page: Page,
  choice: CloseChoice,
): Promise<boolean> {
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  await sendMenu(app, 'menu:project-close').catch(rethrowIfFatal)
  const deadline = Date.now() + CLOSE_BUDGET_MS
  let answered = false
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('Target page has been closed during the project close')
    if (await visible(page, 'welcome-screen')) return true
    if (await visible(page, FORCE_REVERT_DIALOG_TESTID)) {
      await page.getByTestId(FORCE_REVERT_CONFIRM_TESTID).click({ timeout: 5_000 }).catch(rethrowIfFatal)
    } else if (!answered && (await visible(page, UNSAVED_DIALOG_TESTID))) {
      const button = choice === 'save' ? UNSAVED_SAVE_TESTID : UNSAVED_DISCARD_TESTID
      await page.getByTestId(UNSAVED_DIALOG_TESTID).getByTestId(button).click({ timeout: 5_000 }).catch(rethrowIfFatal)
      answered = true
    }
    await page.waitForTimeout(250)
  }
  // The close did not finish (a failed save keeps its prompt open for the
  // retry): back out so the walk goes on inside the project it is in.
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  return visible(page, 'welcome-screen')
}

/**
 * Open a project from the welcome screen's recent list (no page reload, so the
 * renderer keeps every bit of state the previous project left behind).
 *
 * @param page - The renderer page, on the welcome screen.
 * @param slot - The project to open.
 * @param onOpening - Called right before the click, so the orchestrator can
 *   judge every request from the first one the opening project sends.
 * @returns ``true`` when the workflow spine is up afterwards.
 */
export async function openFromRecents(
  page: Page,
  slot: ProjectSlot,
  onOpening: (slot: ProjectSlot) => void = () => {},
): Promise<boolean> {
  onOpening(slot)
  await page
    .getByTestId(`welcome-recent-entry-${slot.path}`)
    .click({ timeout: 10_000 })
    .catch(rethrowIfFatal)
  return page
    .getByRole('navigation', { name: 'Workflow stages' })
    .waitFor({ state: 'visible', timeout: OPEN_BUDGET_MS })
    .then(() => true)
    .catch(err => {
      rethrowIfFatal(err)
      return false
    })
}

/** Outcome of a project switch, for the trail and the orchestrator's state. */
export type SwitchOutcome =
  /** Closed ``from`` and opened ``to``. */
  | 'switched'
  /** The close did not happen; still in ``from``. */
  | 'stayed'
  /** Closed ``from`` but ``to`` did not open; reopened ``from``. */
  | 'reopened-previous'
  /** Closed ``from`` and neither project opened: on the welcome screen. */
  | 'welcome'

/**
 * Close the open project and open the other one, in one renderer session.
 *
 * @param app - The Electron application.
 * @param page - The renderer page.
 * @param choice - How to answer an unsaved-changes prompt.
 * @param from - The open project.
 * @param to - The project to open.
 * @param onOpening - Called right before a recent entry is clicked (see
 *   :func:`openFromRecents`).
 * @returns Where the walk ended up.
 */
export async function switchProject(
  app: ElectronApplication,
  page: Page,
  choice: CloseChoice,
  from: ProjectSlot,
  to: ProjectSlot,
  onOpening: (slot: ProjectSlot) => void = () => {},
): Promise<SwitchOutcome> {
  if (!(await closeProjectViaMenu(app, page, choice))) return 'stayed'
  if (await openFromRecents(page, to, onOpening)) return 'switched'
  // Back on welcome without the target: try the project we came from.
  if (await visible(page, 'welcome-screen')) {
    if (await openFromRecents(page, from, onOpening)) return 'reopened-previous'
  }
  return 'welcome'
}

/**
 * Ctrl+Z ``n`` times, then Ctrl+Y ``n`` times, on the current stage.
 *
 * The focus is dropped first: the renderer's undo listener ignores a key
 * pressed inside a text field (``isTypingTarget``), and a novice's earlier
 * junk typing usually leaves one focused.
 *
 * @param page - The renderer page.
 * @param n - Presses of each key (1..5).
 */
export async function undoRedoBurst(page: Page, n: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.()).catch(rethrowIfFatal)
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(150)
  }
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(150)
  }
}

/**
 * Open Settings, flip one switch twice, close it (save or cancel).
 *
 * @param app - The Electron application.
 * @param page - The renderer page.
 * @param pick - The plan's draw in [0, 1): picks the section, the switch, and
 *   whether to leave with Save or with Escape, so the run replays.
 */
export async function openSettings(app: ElectronApplication, page: Page, pick: number): Promise<void> {
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  await sendMenu(app, 'menu:open-settings')
  const dialog = page.getByTestId('settings-dialog')
  const opened = await dialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(err => {
      rethrowIfFatal(err)
      return false
    })
  if (!opened) return
  const sections = dialog.locator('[data-testid^="settings-section-"]')
  const nSections = await sections.count()
  if (nSections > 0) {
    await sections
      .nth(Math.min(nSections - 1, Math.floor(pick * nSections)))
      .click({ timeout: 3_000 })
      .catch(rethrowIfFatal)
  }
  const switches = dialog.locator('input[type="checkbox"]:visible:enabled')
  const nSwitches = await switches.count()
  if (nSwitches > 0) {
    // A second, independent-looking index from the same draw.
    const idx = Math.min(nSwitches - 1, Math.floor(((pick * 7919) % 1) * nSwitches))
    await switches.nth(idx).click({ timeout: 3_000 }).catch(rethrowIfFatal)
    await switches.nth(idx).click({ timeout: 3_000 }).catch(rethrowIfFatal)
  }
  if (pick < 0.5) {
    await page.getByTestId('settings-save-button').click({ timeout: 3_000 }).catch(rethrowIfFatal)
  } else {
    await page.keyboard.press('Escape')
  }
  const closed = await dialog
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .then(() => true)
    .catch(err => {
      rethrowIfFatal(err)
      return false
    })
  if (!closed) await page.keyboard.press('Escape')
}

/**
 * Open one import route of the Data toolbar's Import menu, then cancel it.
 *
 * Goes to the Data stage first (the toolbar lives there). A link the build
 * does not show (a flag-gated pdf route) ends the route early; the walk goes on.
 *
 * @param page - The renderer page.
 * @param routeId - An ``IMPORT_ROUTES`` id.
 * @returns ``opened`` or ``missing <testid>`` for the trail.
 */
export async function openImportDialog(page: Page, routeId: string): Promise<string> {
  const route = IMPORT_ROUTES.find(r => r.id === routeId)
  if (!route) return `unknown route ${routeId}`
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  await page.getByTestId('stage-tab-data').click({ timeout: 5_000 }).catch(rethrowIfFatal)
  await page.waitForTimeout(300)
  for (const testid of route.chain) {
    const link = page.getByTestId(testid).first()
    const shown = await link
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(err => {
        rethrowIfFatal(err)
        return false
      })
    if (!shown) {
      await page.keyboard.press('Escape').catch(rethrowIfFatal)
      return `missing ${testid}`
    }
    await link.click({ timeout: 3_000 }).catch(rethrowIfFatal)
    await page.waitForTimeout(200)
  }
  // Let the route open its dialog (or the stubbed native dialog cancel), then
  // cancel whatever is up: an in-app dialog, a DOV map draw.
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  await page.keyboard.press('Escape').catch(rethrowIfFatal)
  return 'opened'
}

/**
 * Open the copied worked example through the app's own open-from-recents path.
 * Mirrors ``project_open.openFixtureProject`` but points at the sample temp file
 * (whose project the DB does not yet have, so the open triggers a /restore).
 * Registers the recent entry, reloads to the welcome screen (which also
 * renders any other entry registered before, e.g. the walk's second project)
 * and clicks it.
 *
 * @param page - The renderer page, on the welcome screen.
 * @param tmpPath - The copied worked example's path.
 */
export async function openWorkedExample(page: Page, tmpPath: string): Promise<void> {
  await page.evaluate(
    async ([filePath, name]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.addRecentProject(filePath, name)
    },
    [tmpPath, 'StrixGeo worked example'] as const,
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  // Restoring a full worked example (formations, litho, geotech, bodies,
  // solids) plus the body reconcile can take a while -- be generous.
  await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 90_000 })
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible({ timeout: 90_000 })
}
