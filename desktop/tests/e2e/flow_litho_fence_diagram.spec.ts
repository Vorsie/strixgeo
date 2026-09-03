/**
 * Flow — Lithology 3D stage: Fence-mode toggle smoke (Litho 3D fence diagram).
 *
 * Guards the Fence/Solid toggle wiring in ``LithologyCanvas`` — the toggle only
 * renders when built body solids exist (``hasLithoSolids``; litho-3D plan: the
 * pane mounts on solids, not retired TIN surfaces).
 *
 * WHAT DRIVES THE BUILD — the VOXEL path, exactly what ships:
 *   The in-app "Build model" toolbar button (``litho-build-model-button``) is
 *   the source-of-truth build.  It assembles the validated ``computeSectionFill``
 *   partitions from the model's accepted litho layers + visible sections and
 *   POSTs them to ``buildVoxelLithoModel`` → ``POST .../litho-solids/build-voxel``
 *   (see useLithoSolids.ts + LithologyStage.tsx).  This spec clicks that button
 *   to materialise the solids, then asserts the viewer mounts.
 *
 *   The RETIRED implicit strat-field builder (the old ``POST
 *   .../litho-solids/rebuild`` — DELETED with #237) is not exercised here.
 *   On the synthetic fixture that builder is slow (3-min test timeout) and emits a
 *   JSONB mesh that overflows asyncpg's bind-message buffer, closing a pooled
 *   connection mid-suite — which used to cascade into ``flow_litho_merge_boundary``
 *   500s.  Driving the voxel path (fast + chunked-persist) removes both problems.
 *
 * WHY no pre-open ``/rebuild`` seed any more:
 *   The viewer (Solid/Fence buttons) mounts on ``hasLithoSolids``.  The old spec
 *   pre-seeded solids via ``/rebuild`` BEFORE opening so the first solid fetch
 *   found rows.  We now open with NO solids (the canvas shows the guided
 *   EmptyState), but the ``litho-build-model-button`` lives in the stage TOOLBAR
 *   (gated only on litho-contact presence, not on ``hasLithoSolids``), so it is
 *   reachable from the EmptyState.  Clicking it builds the voxel solids; the
 *   canvas then flips to the viewer branch and the Solid/Fence toggle appears.
 *
 *   The fixture's litho model already carries accepted litho contacts (the FC→LL
 *   mirror trigger gives every seeded contact an ``accepted`` litho_layer row) on
 *   Sections B / C / D / E, so the partition has real content to build from — no
 *   extra contact seeding is needed.
 *
 * Acceptance criteria (no-crash + state correctness only — no WebGL pixel
 * assertions; geometry correctness is covered by the Vitest + Python layers):
 *
 *   1. After clicking Build model, the Litho 3D stage shows the viewer (not
 *      EmptyState): ``litho-view-mode-solid`` is visible.
 *   2. Solid mode is the default — ``aria-pressed="true"`` on solid,
 *      ``aria-pressed="false"`` on fence.
 *   3. Clicking ``litho-view-mode-fence`` flips the toggle — fence button
 *      gets ``aria-pressed="true"``, solid gets ``aria-pressed="false"``.
 *   4. The Cesium canvas (``id`` prefix ``cesium-viewport-``) stays visible
 *      after the toggle: no crash, no unmount to EmptyState.
 *
 * Mirrors: flow_litho_facies.spec.ts (in-app voxel-build harness) and
 * flow_lithology_stage_ui.spec.ts (harness / project-open / stage navigation).
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import { getGeologicalModelId } from './helpers/db_helper'
import { Client } from 'pg'

/**
 * Delete all ``litho_body_solid`` rows for a litho model.
 *
 * Called in the ``finally`` block to restore the no-solids state so
 * ``flow_lithology_stage_ui`` (which expects EmptyState) is not broken
 * by this spec's voxel build.  The Litho 3D pane mounts when built solids
 * exist (``hasLithoSolids``), so leftover solid rows would keep the viewer
 * mounted for downstream specs.  Direct SQL is used because there is no public
 * solid-delete endpoint.
 */
async function deleteLithoSolids(modelId: string): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('DELETE FROM litho_body_solid WHERE model_id = $1', [modelId])
  } finally {
    await client.end()
  }
}

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_litho_fence_diagram', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('Fence-mode toggle renders the fence diagram without crashing', async () => {
    // A voxel build on the fixture takes ~50 s as a background job (label ~41 s +
    // extract ~8 s, measured 2026-09-03); the default 60 s test timeout killed the
    // app mid-labelling and the old 30 s wait for the solid toggle was too short.
    test.setTimeout(300_000)
    test.slow() // opens the shell + builds voxel solids + renders the 3D viewer

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    let lithoModelId: string | null = null

    try {
      // -----------------------------------------------------------------------
      // 1. Resolve the litho model id (for the cleanup DELETE only).
      // -----------------------------------------------------------------------
      lithoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'lithostratigraphic')
      expect(lithoModelId, 'Fixture must have a lithostratigraphic model').not.toBeNull()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      lithoModelId = lithoModelId!

      // -----------------------------------------------------------------------
      // 2. Open the fixture project + navigate to the Litho stage.
      //    No solids exist yet → the canvas shows the guided EmptyState, but
      //    the "Build model" button is in the stage toolbar regardless.
      // -----------------------------------------------------------------------
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Litho')

      // -----------------------------------------------------------------------
      // 3. Click "Build model" (the VOXEL path).  The toolbar button assembles
      //    the per-section partition payload from the model's accepted litho
      //    layers and POSTs it to build-voxel; on success the canvas flips from
      //    EmptyState to the 3D viewer (hasLithoSolids becomes true).
      // -----------------------------------------------------------------------
      const buildBtn = page.getByTestId('litho-build-model-button')
      await expect(buildBtn).toBeVisible({ timeout: 20_000 })
      await expect(buildBtn).toBeEnabled({ timeout: 10_000 })
      await buildBtn.click()

      // The button is disabled while building; wait for it to re-enable.  The
      // voxel build on the synthetic fixture is fast (the persist is chunked),
      // but the renderer must then mount Cesium + render every body mesh, so
      // allow a generous window under e2e load (Electron + WebGL).
      await expect(buildBtn).toBeEnabled({ timeout: 90_000 })

      // -----------------------------------------------------------------------
      // 4. The viewer mounted: the Solid button is the mount sentinel — only
      //    present inside the hasLithoSolids viewer branch.  Long timeout:
      //    Cesium WebGL context initialisation is slow.
      // -----------------------------------------------------------------------
      const solidBtn = page.getByTestId('litho-view-mode-solid')
      await expect(solidBtn).toBeVisible({ timeout: 150_000 })

      // -----------------------------------------------------------------------
      // 5. Solid mode is the default.
      // -----------------------------------------------------------------------
      await expect(solidBtn).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
        'aria-pressed',
        'false',
      )

      // -----------------------------------------------------------------------
      // 6. Switch to Fence mode.
      //
      //    The toggle is positioned ``bottom-2 left-2 z-20`` (LithologyCanvas
      //    fix 2026-06-10) so it sits CLEAR of both the Layers legend
      //    (``top-2 left-2 z-10``) and the BasemapPanel (``top-2 right-2``)
      //    that Geology3DViewer renders.  A normal Playwright ``.click()`` is
      //    sufficient — no programmatic workaround needed.
      // -----------------------------------------------------------------------
      await page.getByTestId('litho-view-mode-fence').click()

      // -----------------------------------------------------------------------
      // 7. Fence is now active; Solid is inactive.
      // -----------------------------------------------------------------------
      await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(solidBtn).toHaveAttribute('aria-pressed', 'false')

      // -----------------------------------------------------------------------
      // 8. Cesium canvas stays mounted — no crash, no unmount to EmptyState.
      //     Geology3DViewer renders ``<div id="cesium-viewport-{key}">``; it
      //     only unmounts on a hard error.  The toggle buttons remaining
      //     attached proves the ``hasLithoSolids`` branch did not flip back.
      // -----------------------------------------------------------------------
      await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('litho-view-mode-solid')).toBeAttached()
      await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()
    } finally {
      // -----------------------------------------------------------------------
      // Cleanup: remove the litho_body_solid rows the in-app Build created.
      // Without this, flow_lithology_stage_ui (which expects EmptyState) would
      // see the 3D viewer instead, because the solid rows persist and the pane
      // mounts on hasLithoSolids.
      //
      // No contact cleanup is needed any more: this spec no longer seeds
      // contacts onto the litho model — it builds from the fixture's own
      // seeded contacts, which downstream specs expect to remain.
      // -----------------------------------------------------------------------
      try {
        if (lithoModelId) {
          await deleteLithoSolids(lithoModelId)
        }
      } catch {
        /* non-fatal — next run's truncate cleans up */
      }

      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
