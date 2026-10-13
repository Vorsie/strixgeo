/**
 * Shared Electron launch helper for the Strix smoke harness.
 *
 * Every spec file calls ``launchApp`` once per test. The helper:
 *
 * 1. Resolves the Electron executable from the local ``electron`` package.
 * 2. Launches the app with ``_electron.launch`` pointing at the built
 *    ``out/main/index.js`` entry point (the Vite-compiled main process).
 * 3. Waits for the first ``BrowserWindow`` to become visible.
 * 4. Returns the ``ElectronApplication`` + the first ``Page`` so specs
 *    can immediately interact with the renderer.
 *
 * Prerequisites (the harness does NOT start these — they must be running):
 * - FastAPI backend on port 8765.
 * - PostgreSQL 16 on port 5433 with the integration DB
 *   (``groundmodel_integration`` — ``DATABASE_URL`` env var must end in
 *   ``_integration`` or ``_test``).
 *
 * The backend is assumed to already have the synthetic fixture loaded by
 * ``fixtures/build_synthetic_fixture.py``.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawnSync } from 'child_process'

import {
  UNSAVED_DIALOG_TESTID,
  UNSAVED_DISCARD_TESTID,
  formatWindowReport,
  pickDialogWindow,
  type WindowProbe,
} from './closeAppProbe'

// The electron package ships its own path.txt pointing at the local
// electron.exe (Windows) / electron (Linux/macOS). We resolve it the
// same way the package's index.js does, avoiding a hard-coded path.
function resolveElectronExe(): string {
  const electronPkg = require.resolve('electron/index.js')
  const electronDir = path.dirname(electronPkg)
  const pathTxt = path.join(electronDir, 'path.txt')
  const relExe = fs.readFileSync(pathTxt, 'utf-8').trim()
  return path.join(electronDir, 'dist', relExe)
}

// The compiled main process entry point. The harness requires a fresh
// ``electron-vite build`` to exist (``npm run build`` in desktop/).
// The project root is two levels up from this file:
//   desktop/tests/e2e/helpers/  →  desktop/
const DESKTOP_ROOT = path.resolve(__dirname, '..', '..', '..')
const MAIN_ENTRY = path.join(DESKTOP_ROOT, 'out', 'main', 'index.js')

/**
 * The suite's OWN userData directory, passed explicitly on every launch.
 *
 * The harness was already isolated from a dev build, but only by accident:
 * ``app.getName()`` reads the package.json beside the main entry, and
 * ``out/main/index.js`` has none, so Electron fell back to its own default and
 * wrote to ``<APPDATA>/Electron`` while dev and packaged builds both use
 * ``ground-model-desktop`` (``productName`` lives inside the electron-builder
 * ``build`` block, where ``getName()`` never sees it). That isolation is worth
 * KEEPING — a suite that stores over a hundred launches' worth of recent-project
 * entries, localStorage chrome and crash-recovery snapshots has no business
 * writing them into the store a real session uses — but it should be declared
 * rather than inherited from where a file happens to sit. A refactor that moved
 * the entry point, or a package.json appearing in ``out/``, would silently point
 * the whole suite at a real user's data.
 *
 * Stable rather than per-run: specs may rely on chrome persisting between the
 * launches WITHIN a run, and one of them says so explicitly
 * (``flow_parameters_cpt_profile`` re-expands a panel a previous run collapsed).
 */
// The naive-engineer walker (run-e2e.ps1 sets E2E_USER_DATA_SUFFIX=-walker) gets
// its own store: its chaos toggled the inspector rail closed and that persisted
// localStorage chrome broke four deterministic specs afterwards (2026-09-07).
const E2E_USER_DATA_DIR = path.join(
  os.tmpdir(),
  `strix-e2e-userdata${process.env.E2E_USER_DATA_SUFFIX ?? ''}`,
)

/**
 * The userData directory every launch of this run uses (suffix included).
 *
 * Exported so the walker clears ITS recovery slots in the directory the app
 * really writes: it used to rebuild the path without the ``-walker`` suffix
 * and so cleared a directory its own launches never touch.
 *
 * Returns
 * -------
 * string
 *     The absolute userData directory.
 */
export function e2eUserDataDir(): string {
  return E2E_USER_DATA_DIR
}

/**
 * Discard the FIXTURE project's crash-recovery slots before a launch.
 *
 * Any spec whose app is torn down while the project is dirty leaves a recovery
 * snapshot behind, and the very next launch opens on a modal backdrop asking
 * whether to restore it. That modal covers the whole window, so every remaining
 * spec in the run fails on an intercepted click rather than on anything it was
 * testing: one failing drag spec cost 19 unrelated failures before this existed.
 *
 * Reads the suite's OWN userData directory, so there is no app-name convention to
 * guess. Guessing it is exactly how the first version of this function deleted
 * nothing while appearing to work — the stale slot survived a whole run written to
 * drop it, and the tell was the dialog citing the same snapshot timestamp twice.
 *
 * Still scoped to the fixture project id even inside a directory the suite owns:
 * narrow deletion costs nothing here and keeps this honest if the path is ever
 * pointed somewhere shared again.
 *
 * Silent when there is nothing to clean — failing to find nothing is not an error.
 *
 * Parameters
 * ----------
 * projectId : string | undefined
 *     The fixture project whose slots to drop. No-op when absent.
 */
function discardFixtureRecoverySlots(projectId: string | undefined): void {
  if (projectId === undefined || projectId === '') return
  // Matches main/recoveryStore.ts's <userData>/recovery.
  const recoveryDir = path.join(E2E_USER_DATA_DIR, 'recovery')
  if (!fs.existsSync(recoveryDir)) return
  for (const name of fs.readdirSync(recoveryDir)) {
    // Every slot variant the store writes for one project starts with its id:
    // the primary, the declined marker, and the quarantined-corrupt copy.
    if (!name.startsWith(projectId)) continue
    try {
      fs.rmSync(path.join(recoveryDir, name))
    } catch {
      /* another launch may have taken it first — nothing to do either way */
    }
  }
}

export interface LaunchResult {
  app: ElectronApplication
  page: Page
}

/**
 * Launch the Strix Electron app and wait for the first renderer window.
 *
 * Parameters
 * ----------
 * env : Record<string, string>, optional
 *   Additional environment variables injected into the spawned process.
 *   Merges with ``process.env``. Use to pass ``E2E_FIXTURE_PROJECT_ID``
 *   and similar test-scoped vars.
 *
 * Returns
 * -------
 * LaunchResult
 *   ``app`` is the Playwright ElectronApplication handle; ``page`` is the
 *   first BrowserWindow page (the renderer).
 *
 * Raises
 * ------
 * Error
 *   If ``out/main/index.js`` does not exist (app not built yet) or the
 *   Electron executable cannot be resolved.
 */
export async function launchApp(env: Record<string, string> = {}): Promise<LaunchResult> {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Electron main entry not found at ${MAIN_ENTRY}.\n` +
        'Run `npm run build` inside desktop/ before running e2e tests.',
    )
  }

  // Before the window exists, so no spec ever opens onto a previous spec's
  // recovery prompt. Reads the id from the caller's env first — specs pass it
  // there — falling back to the runner's own.
  discardFixtureRecoverySlots(env.E2E_FIXTURE_PROJECT_ID ?? process.env.E2E_FIXTURE_PROJECT_ID)

  const executablePath = resolveElectronExe()

  const app = await electron.launch({
    executablePath,
    // The userData directory is DECLARED, not inherited from where the main entry
    // happens to sit — see E2E_USER_DATA_DIR. Without it the suite's store location
    // is a side effect of Electron's app-name fallback, and a refactor that moved
    // the entry point would silently redirect a hundred-plus launches' worth of
    // recent-project entries, chrome and crash snapshots into a real session's store.
    // ``--lang`` pins Chromium's application locale, and with it
    // ``navigator.language``, to English. The app defaults to the SYSTEM
    // language (languageSelect.ts, installer #5 2026-09-03), so on a Dutch
    // machine every copy assertion in the suite would otherwise see Dutch.
    // ``--force-device-scale-factor=1`` pins Chromium's device pixel ratio, so
    // a pixel golden (litho 3-D scene, fence cutout) has the same size on every
    // machine and monitor. Without it the goldens follow the Windows display
    // scale: blessed at 125 % they came back 1.2x larger at 150 % (2026-09-15,
    // the #41 chain) with the scene itself unchanged. Layout is in DIPs, so
    // the toolbar and width-sensitive specs see the same picture as before.
    args: [
      MAIN_ENTRY,
      `--user-data-dir=${E2E_USER_DATA_DIR}`,
      '--lang=en-US',
      '--force-device-scale-factor=1',
    ],
    env: {
      ...process.env,
      // Disable GPU acceleration to avoid the 0xC0000005 renderer crash
      // on CI machines and development laptops without a real GPU driver.
      // Same env switch as debt #chore-main devtools commit.
      STRIXGEO_DISABLE_GPU: '1',
      // Opt out of the single-instance lock (main/index.ts). The suite
      // launches this binary ~166 times against ONE shared userData
      // directory: any process that lingers past its spec's teardown owns the
      // lock, and the next launch would quit before creating a window — the
      // spec then fails on a missing first window instead of on whatever
      // actually broke. Packaged builds ignore this variable and always lock.
      STRIX_DISABLE_SINGLE_INSTANCE: '1',
      // Suppress the launch-prototype boot UI in the harness: the shared
      // userData dir persists across the run and nothing seeds the onboarding
      // "seen" flag, so without this ~130 specs would open under the onboarding
      // modal. The main process reads STRIX_E2E and exposes it as
      // window.electron.launchFlags.e2e; the renderer's onboarding auto-open and
      // the packaged activation gate both no-op when it is set. A spec that WANTS
      // the first-launch overlay (flow_onboarding_first_launch) clears it via the
      // env override below, which is spread last.
      STRIX_E2E: '1',
      // Forward the integration DATABASE_URL so the backend (already
      // running) serves the fixture data, not the dev DB.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration',
      ...env,
    },
  })

  // The first window becomes available immediately after the main process
  // calls ``app.whenReady().then(() => createWindow())``.
  const page = await app.firstWindow()
  // Renderer console + uncaught page errors go to a per-run log next to the
  // backend logs. A stuck UI with a green backend (the 2026-09-03 Build specs)
  // is undiagnosable without the renderer's own log lines.
  const consoleLog = path.join(os.tmpdir(), 'strix-e2e-renderer-console.log')
  const stamp = (): string => new Date().toISOString().slice(11, 23)
  page.on('console', msg => {
    try {
      fs.appendFileSync(consoleLog, `${stamp()} [${msg.type()}] ${msg.text()}
`)
    } catch {
      /* logging must never fail a spec */
    }
  })
  page.on('pageerror', err => {
    try {
      fs.appendFileSync(consoleLog, `${stamp()} [pageerror] ${err.message}
${err.stack ?? ''}
`)
    } catch {
      /* logging must never fail a spec */
    }
  })

  // Wait for the window to be fully visible before handing off to the spec.
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}

/** How long ``closeApp`` looks for the unsaved-changes prompt before giving up on it. */
const DIRTY_PROMPT_WAIT_MS = 25_000
/** How long a quit may take after the discard click (the discard replace-restores the bundle). */
const QUIT_AFTER_DISCARD_MS = 30_000
/** How long a quit may take when no prompt was clicked. */
const QUIT_WITHOUT_DISCARD_MS = 5_000
/** How long one window may take to answer a DOM probe before it counts as unreachable. */
const WINDOW_PROBE_MS = 3_000

/** Resolve ``work``, or ``fallback`` when it has not settled within ``ms``. */
async function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([work.catch(() => fallback), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Probe every window of the app for the unsaved-changes prompt.
 *
 * Every window, not ``windows()[0]``: a walk can leave the hidden PDF print
 * window (``sheet.html``) or a reloaded document in the list, and the order is
 * Playwright's insertion order, not "the main window first". Each probe is a
 * bounded ``evaluate`` so a hung renderer is reported as UNREACHABLE rather
 * than stalling the teardown.
 *
 * Parameters
 * ----------
 * app : ElectronApplication
 *     The application handle returned by ``launchApp``.
 * withBody : boolean
 *     Also read ``document.body.innerText`` (for the hang report only).
 *
 * Returns
 * -------
 * { pages: Page[]; probes: WindowProbe[] }
 *     The pages and one probe row per page, index-aligned.
 */
async function probeWindows(
  app: ElectronApplication,
  withBody: boolean,
): Promise<{ pages: Page[]; probes: WindowProbe[] }> {
  const pages = app.windows()
  const probes = await Promise.all(
    pages.map(async (page, index): Promise<WindowProbe> => {
      const base: WindowProbe = {
        index,
        url: page.url(),
        closed: page.isClosed(),
        reachable: false,
        title: null,
        dialog: false,
        discard: 'absent',
        bodyText: null,
      }
      if (base.closed) return base
      const seen = await within(
        page.evaluate(
          ({ dialogId, discardId, body }) => {
            const dialog = document.querySelector(`[data-testid="${dialogId}"]`)
            const button = dialog?.querySelector<HTMLButtonElement>(`[data-testid="${discardId}"]`)
            const discard: 'absent' | 'enabled' | 'disabled' = button
              ? button.disabled
                ? 'disabled'
                : 'enabled'
              : 'absent'
            return {
              title: document.title,
              dialog: dialog !== null,
              discard,
              bodyText: body ? (document.body?.innerText ?? '') : null,
            }
          },
          { dialogId: UNSAVED_DIALOG_TESTID, discardId: UNSAVED_DISCARD_TESTID, body: withBody },
        ),
        WINDOW_PROBE_MS,
        null,
      )
      return seen === null ? base : { ...base, reachable: true, ...seen }
    }),
  )
  return { pages, probes }
}

/**
 * Click the prompt's discard button in ``page``; true when a click landed.
 *
 * A real pointer click first (the path an engineer takes). Playwright's click
 * waits for the button to be visible, STABLE (two animation frames with the
 * same box) and the topmost element at its centre; a renderer busy with a 3-D
 * scene or an overlay can fail that while the button is perfectly clickable.
 * The fallback is a DOM ``element.click()`` inside the page, which React
 * handles the same way (pinned in ``UnsavedChangesDialog.test.tsx``).
 *
 * Parameters
 * ----------
 * page : Page
 *     The window whose probe saw the prompt with an enabled discard button.
 *
 * Returns
 * -------
 * boolean
 *     True when either click landed on an enabled discard button.
 */
async function clickDiscard(page: Page): Promise<boolean> {
  const viaPointer = await page
    .getByTestId(UNSAVED_DIALOG_TESTID)
    .getByTestId(UNSAVED_DISCARD_TESTID)
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (viaPointer) {
    console.warn('[e2e] closeApp: discarded the unsaved-changes prompt (pointer click)')
    return true
  }
  const viaDom = await within(
    page.evaluate(
      ({ dialogId, discardId }) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="${dialogId}"] [data-testid="${discardId}"]`,
        )
        if (!button || button.disabled) return false
        button.click()
        return true
      },
      { dialogId: UNSAVED_DIALOG_TESTID, discardId: UNSAVED_DISCARD_TESTID },
    ),
    WINDOW_PROBE_MS,
    false,
  )
  console.warn(
    `[e2e] closeApp: pointer click on the discard button failed; DOM click ${viaDom ? 'landed' : 'did NOT land'}`,
  )
  return viaDom
}

/**
 * Gracefully close the Electron application after a test.
 *
 * Calls ``app.close()`` (Playwright: stop tracing, screenshot every page, then
 * ``app.quit()`` in the main process). On a DIRTY project the renderer answers
 * that quit with the unsaved-changes prompt and the quit BLOCKS until a button
 * is clicked, so this helper looks for the prompt in every window and
 * discards it; a clean project quits on its own and the search ends when the
 * close resolves. Discarding (rather than killing) lets the app quit through
 * its own shutdown, so the spawned engine is stopped instead of orphaned.
 *
 * Every wait is bounded. When the app is still alive at the end, the helper
 * logs what each window was showing (URL, title, prompt state, the first 300
 * characters of its body text) and then kills this launch's process tree.
 * Errors during close are suppressed — a crashed renderer should not fail the
 * teardown and mask the real assertion failure.
 *
 * Parameters
 * ----------
 * app : ElectronApplication
 *   The application handle returned by ``launchApp``.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const mainPid = app.process().pid ?? -1
  let closed = false
  const closing = app
    .close()
    .catch(() => {
      // Swallow — a crashed renderer is an already-caught test failure.
    })
    .then(() => {
      closed = true
    })
  // Why a poll over all windows and not one 10 s click on ``windows()[0]``
  // (walker 2026-10-13, twice: "dialog opened (mode=quit-app)", then silence):
  // ``app.close()`` screenshots every page (5 s cap each — the ``screenshot:
  // only-on-failure`` artefact capture runs on EVERY close) BEFORE it sends the
  // quit, so on a heavy 3-D window the prompt appears late and a click clock
  // started at the same moment as the close could run out first. The search
  // starts its clock with the close, looks in every window, and re-reads the
  // window list each round. By test id, never by label: the app may run in
  // Dutch.
  let discarded = false
  const deadline = Date.now() + DIRTY_PROMPT_WAIT_MS
  while (!closed && Date.now() < deadline) {
    const { pages, probes } = await probeWindows(app, false)
    if (closed) break
    const hit = pickDialogWindow(probes)
    if (hit !== null) {
      discarded = await clickDiscard(pages[hit])
      if (discarded) break
    }
    await within(closing, 500, undefined)
  }
  // Never wait on the quit forever. A discard replace-restores the project, so
  // it gets the longer bound; anything else falls through to the kill below.
  await within(closing, discarded ? QUIT_AFTER_DISCARD_MS : QUIT_WITHOUT_DISCARD_MS, undefined)
  if (!closed) {
    // The next hang must be diagnosable from the log alone: what did each
    // window show when the teardown gave up on it?
    const { probes } = await probeWindows(app, true)
    console.warn(
      `[e2e] closeApp: the app did not quit (prompt discarded=${discarded}); windows:\n  ` +
        formatWindowReport(probes).join('\n  '),
    )
  }
  // A spec that failed mid-flow, or a renderer that never answered the quit,
  // can leave the Electron tree alive after app.close() resolves (2026-09-07:
  // one survived for an hour holding the suite's localStorage lock). Give it
  // five seconds, then kill the tree; only this launch's pid is touched.
  if (mainPid > 0 && process.platform === 'win32') {
    const alive = (): boolean => {
      try {
        process.kill(mainPid, 0)
        return true
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 5_000
    while (alive() && Date.now() < deadline) await new Promise(r => setTimeout(r, 250))
    if (alive()) {
      console.warn(`[e2e] electron ${mainPid} survived close(); killing its tree`)
      spawnSync('taskkill', ['/PID', String(mainPid), '/T', '/F'], { stdio: 'ignore' })
    }
  }
}

/**
 * The pinned window size a layout-sensitive spec renders at.
 *
 * Electron sizes the window from the screen it opens on, so the same spec
 * renders at different widths on different machines. Two kinds of spec care:
 * a PIXEL GOLDEN (the element size follows the window), and a TOOLBAR spec
 * (the overflow planner moves low-priority items into the "More" menu when
 * space is tight, so which items are directly visible is width-dependent).
 * Pinning makes both deterministic.
 */
export const PINNED_WINDOW = { width: 1600, height: 900 } as const

/**
 * Pin the app window to ``PINNED_WINDOW`` — call right after launch, before
 * any stage that mounts Cesium, so every canvas is created at the pinned
 * size.
 *
 * Parameters
 * ----------
 * app
 *     The Playwright Electron application handle.
 */
export async function pinWindowSize(
  app: import('@playwright/test').ElectronApplication,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('pinWindowSize: no BrowserWindow yet')
    if (win.isMaximized()) win.unmaximize()
    win.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
  }, PINNED_WINDOW)
}
