/**
 * Open-a-seeded-project helper — the harness "unblocker" (debt #130).
 *
 * Until now every e2e spec exercised the IPC + welcome surface only, because
 * there was no way to drive a project *into the shell* (past the Welcome
 * screen) from Playwright: ``window.electron.readProjectFile`` enforces
 * path-authorisation, so a spec cannot simply hand the renderer an arbitrary
 * file path. ``openFixtureProject`` removes that block:
 *
 * 1. Writes a *minimal valid* ``.strix`` bundle (format_version 3) whose
 *    ``project.id`` is the already-seeded fixture project id. The bundle is
 *    only a pointer — on open the renderer calls ``GET /projects/{id}`` and
 *    adopts the live DB metadata + data, so the on-disk arrays can be empty.
 * 2. Calls ``addRecentProject(path, name)`` which (a) registers the entry in
 *    the recent list AND (b) re-authorises the path so the subsequent
 *    ``readProjectFile`` succeeds — this is the key that unlocks the open.
 * 3. Reloads the Welcome screen so the recent entry renders, then clicks it.
 * 4. Waits for the shell to mount (Welcome unmounts, the workflow spine
 *    appears).
 *
 * Prerequisites are identical to the rest of the harness (see
 * ``electron_launch.ts``): FastAPI on :8765, Postgres on :5433 with the
 * ``groundmodel_integration`` DB, and ``build_synthetic_fixture.py`` already
 * run so ``E2E_FIXTURE_PROJECT_ID`` points at a real project row.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/** Stable visible spine labels (``StageDescriptor.spineLabel``). */
export type SpineLabel =
  | 'Data'
  | 'Sections'
  | 'Geology'
  | 'Litho'
  | 'Geotech'
  | 'Parameters'
  | 'Export'

/**
 * Build a minimal, parser-valid ``.strix`` bundle for a known project id.
 *
 * The arrays are intentionally empty: opening the file triggers a live
 * ``GET /projects/{id}`` that hydrates CPTs / boreholes / models / sections
 * from the DB. The bundle's only load-bearing field is ``project.id``.
 *
 * Parameters
 * ----------
 * projectId
 *     The seeded fixture project's UUID (``E2E_FIXTURE_PROJECT_ID``).
 *
 * Returns
 * -------
 * str
 *     Pretty-printed JSON ready to write to disk.
 */
function minimalBundle(projectId: string): string {
  return JSON.stringify(
    {
      format_version: 3,
      project: {
        id: projectId,
        name: 'E2E Fixture',
        project_number: null,
        client: null,
        site_label: null,
        description: null,
        tags: [],
        default_horizontal_epsg: 31370,
        default_vertical_epsg: 5710,
        phase: null,
        status: 'active',
        view_state: {},
      },
      cpts: [],
      boreholes: [],
      geological_formations: [],
      geotechnical_units: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
    },
    null,
    2,
  )
}

/**
 * Open the seeded fixture project into the shell.
 *
 * Parameters
 * ----------
 * app
 *     The launched ``ElectronApplication`` (unused today, accepted so callers
 *     pass the full ``{ app, page }`` pair and so a future implementation can
 *     reach the main process via ``app.evaluate`` if needed).
 * page
 *     The renderer ``Page``.
 * fixtureProjectId
 *     The seeded project's UUID.
 *
 * Returns
 * -------
 * Promise<string>
 *     The temp ``.strix`` path that was created — pass it to
 *     ``cleanupFixtureFile`` in the test's ``finally`` block.
 */
export async function openFixtureProject(
  app: ElectronApplication,
  page: Page,
  fixtureProjectId: string,
): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `strix-e2e-open-${process.pid}-${Math.round(performance.now())}.strix`)
  fs.writeFileSync(tmpPath, minimalBundle(fixtureProjectId), 'utf-8')

  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

  // Register + authorise the path so readProjectFile can read it after reload.
  await page.evaluate(
    async ([filePath, name]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.addRecentProject(filePath, name)
    },
    [tmpPath, 'E2E Fixture'] as const,
  )

  // Fresh mount so WelcomeScreen re-reads the recent list and renders the entry.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

  const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()

  // Shell mounts: Welcome unmounts, the workflow spine appears.
  await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible({ timeout: 20_000 })

  return tmpPath
}

/**
 * Navigate to a workflow stage by clicking its spine button.
 *
 * The spine button carries a *dynamic* ``aria-label`` (a per-stage summary
 * that includes a live badge), so we target the *stable* visible
 * ``spineLabel`` text instead.
 *
 * Parameters
 * ----------
 * page
 *     The renderer ``Page`` (already inside the shell).
 * label
 *     The stage's ``spineLabel`` (e.g. ``'Sections'``).
 */
export async function goToStage(page: Page, label: SpineLabel): Promise<void> {
  const spine = page.getByRole('navigation', { name: 'Workflow stages' })
  await spine.getByRole('button').filter({ hasText: label }).first().click()
}

/**
 * Remove the temp ``.strix`` file created by ``openFixtureProject``.
 *
 * Safe to call with a path that no longer exists.
 *
 * Parameters
 * ----------
 * tmpPath
 *     The path returned by ``openFixtureProject``.
 */
export function cleanupFixtureFile(tmpPath: string): void {
  try {
    fs.unlinkSync(tmpPath)
  } catch {
    /* already gone — ignore */
  }
}
