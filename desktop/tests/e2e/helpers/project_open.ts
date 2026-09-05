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
  | 'Stratigraphy'
  | 'Litho'
  | 'Geotech'
  | 'Parameters'
  | 'Export'

/** Fixed backend port — the Electron main process spawns uvicorn here. */
const API_BASE = 'http://127.0.0.1:8765'

/**
 * Map a ``GET /projects/{id}/bundle`` response into the on-disk ``.strix``
 * shape, mirroring the renderer's ``buildProjectFile``.
 *
 * Two things make this necessary rather than writing the bundle verbatim:
 * 1. ``isProjectFileV3`` requires ``format_version === 3`` and that every
 *    core array (``investigation_reviews``, ``geological_models``, ...) is
 *    present — the bundle response omits/renames some, so a verbatim write is
 *    rejected as "file may be corrupt" and the open fails.
 * 2. Defaulting each optional array to ``[]`` keeps the parser happy across
 *    backend versions.
 *
 * Kept inline (not imported from the renderer's ``projectFile.ts``) so this
 * Node-side helper doesn't drag renderer-only modules into the test runner.
 *
 * Parameters
 * ----------
 * bundle
 *     The parsed JSON from the bundle endpoint.
 *
 * Returns
 * -------
 * str
 *     Pretty-printed ``.strix`` JSON ready to write to disk.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bundleToProjectFile(bundle: any): string {
  return (
    JSON.stringify(
      {
        format_version: 3,
        project: bundle.project,
        cpts: bundle.cpts ?? [],
        boreholes: bundle.boreholes ?? [],
        geological_formations: bundle.geological_formations ?? [],
        geological_models: bundle.geological_models ?? [],
        cross_sections: bundle.cross_sections ?? [],
        investigation_reviews: bundle.investigation_reviews ?? [],
        litho_contact_correlation_edges: bundle.litho_contact_correlation_edges ?? [],
        bodies: bundle.bodies ?? [],
        formation_absences: bundle.formation_absences ?? [],
        body_boundary_shapes: bundle.body_boundary_shapes ?? [],
        body_boundary_nodes: bundle.body_boundary_nodes ?? [],
        stratigraphy_lumping: bundle.stratigraphy_lumping ?? null,
      },
      null,
      2,
    ) + '\n'
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

  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

  // Fetch the REAL project bundle from the app's backend and write it as the
  // .strix file. This is load-bearing: openProjectFile seeds the visibility
  // manifest (manifestSectionIds / manifestCptIds / ...) from the FILE's
  // arrays, not from the API. A minimal/empty bundle leaves the manifest empty
  // so ``visibleSections`` is [] and NO section rows render — even though the
  // DB has them. The bundle GET returns the exact .strix shape, so writing it
  // verbatim seeds the manifest with every section / CPT / borehole id.
  const bundle = await page.evaluate(async ([base, pid]) => {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${base}/projects/${pid}/bundle`)
        if (r.ok) return await r.json()
      } catch {
        /* backend still spinning up — retry */
      }
      await new Promise(res => setTimeout(res, 500))
    }
    return null
  }, [API_BASE, fixtureProjectId] as const)
  if (!bundle) {
    throw new Error(
      `Could not fetch GET ${API_BASE}/projects/${fixtureProjectId}/bundle — is the backend up + fixture seeded?`,
    )
  }
  fs.writeFileSync(tmpPath, bundleToProjectFile(bundle), 'utf-8')

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
