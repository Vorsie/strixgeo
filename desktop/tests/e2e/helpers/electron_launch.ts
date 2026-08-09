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
 * Discard the FIXTURE project's crash-recovery slots before a launch.
 *
 * The suite launches this binary well over a hundred times against ONE shared
 * userData directory — the same one a dev build uses. Any spec whose app is torn
 * down while the project is dirty leaves a recovery snapshot behind, and the very
 * next launch opens on a modal backdrop asking whether to restore it. That modal
 * covers the whole window, so every remaining spec in the run fails on an
 * intercepted click rather than on anything it was testing: one failing drag spec
 * cost 19 unrelated failures before this existed.
 *
 * Scoped to the fixture project id and nothing else. The shared userData means a
 * real project's unsaved work can be sitting in this same directory, and deleting
 * that is not a test's decision to make — the fixture project is rebuilt from
 * scratch every run, so only its own slots are ever safe to drop.
 *
 * Silent when the directory or the app-name convention does not resolve: this is
 * cleanup, and failing to find nothing to clean is not an error.
 *
 * Parameters
 * ----------
 * projectId : string | undefined
 *     The fixture project whose slots to drop. No-op when absent.
 */
function discardFixtureRecoverySlots(projectId: string | undefined): void {
  if (projectId === undefined || projectId === '') return
  // Electron's userData is <APPDATA>/<package name> on Windows, and the platform
  // equivalents elsewhere. Matches main/recoveryStore.ts's <userData>/recovery.
  // BOTH names the app can resolve to, because it resolves to different ones here
  // and in a packaged build. ``app.getName()`` reads the package.json beside the
  // main entry; ``out/main/index.js`` has none, so Electron falls back to its own
  // default and the harness writes to <APPDATA>/Electron — NOT the product name a
  // packaged build uses. Cleaning only one of them silently cleans nothing, which
  // is how a stale slot survived a run that was written specifically to drop it.
  const appNames = ['Electron', 'ground-model-desktop']
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(process.env.HOME ?? '', 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? '', '.config'))
  if (base === undefined || base === '') return
  for (const appName of appNames) {
    const recoveryDir = path.join(base, appName, 'recovery')
    if (!fs.existsSync(recoveryDir)) continue
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
    args: [MAIN_ENTRY],
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
