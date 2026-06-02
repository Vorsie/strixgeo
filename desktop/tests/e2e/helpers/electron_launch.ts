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

  const executablePath = resolveElectronExe()

  const app = await electron.launch({
    executablePath,
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      // Disable GPU acceleration to avoid the 0xC0000005 renderer crash
      // on CI machines and development laptops without a real GPU driver.
      // Same env switch as debt #chore-main devtools commit.
      STRIX_DISABLE_GPU: '1',
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
