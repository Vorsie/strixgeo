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
const E2E_USER_DATA_DIR = path.join(os.tmpdir(), 'strix-e2e-userdata')

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
    args: [MAIN_ENTRY, `--user-data-dir=${E2E_USER_DATA_DIR}`],
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

  // Wait for the window to be fully visible before handing off to the spec.
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}

/**
 * Gracefully close the Electron application after a test.
 *
 * Calls ``app.close()`` which sends the standard OS quit signal. Errors
 * during close are suppressed — a crashed renderer should not fail the
 * teardown and mask the real assertion failure.
 *
 * Parameters
 * ----------
 * app : ElectronApplication
 *   The application handle returned by ``launchApp``.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  // ``app.close()`` requests an app quit. On a DIRTY project (a test that
  // committed contacts / left unsaved session-imports) the renderer intercepts
  // the quit with the unsaved-changes prompt and BLOCKS until a button is
  // clicked — hanging teardown indefinitely. Race the close against discarding
  // that prompt: on a clean project the close resolves first and the discard
  // click no-ops; on a dirty one, clicking Discard lets the app quit
  // gracefully so the spawned uvicorn is killed via ``stopApi`` rather than
  // orphaned on :8765 (which a hard process kill would do).
  const win = app.windows()[0] ?? null
  const closing = app.close().catch(() => {
    // Swallow — a crashed renderer is an already-caught test failure.
  })
  if (win) {
    await Promise.race([
      closing,
      win
        .getByTestId('unsaved-changes-dialog')
        .getByRole('button', { name: 'Discard' })
        .click({ timeout: 10_000 })
        .catch(() => {
          // No unsaved prompt appeared (clean project) — close proceeds alone.
        }),
    ])
  }
  await closing
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
