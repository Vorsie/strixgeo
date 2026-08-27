/**
 * Flow — Lithology 3D stage: REAL voxel build + Cesium pixel golden (E3).
 *
 * WHY: the 3-D stage viewers render only under real WebGL — jsdom has none —
 * so no automated test had ever LOOKED at a built litho model.  The build
 * itself is feasible in e2e (proven by flow_litho_fence_diagram: the in-app
 * "Build model" button voxel-builds the synthetic fixture inside a 90 s
 * window), so this is a FULL build golden, not an empty-state layout
 * fallback.
 *
 * What it pins: after clicking the real ``litho-build-model-button`` (the
 * exact path the owner presses — partition assembly → POST build-voxel →
 * viewer mount), the Cesium viewport region must match the stored golden:
 * solid bodies in formation colours over the (offline, untextured) basemap
 * lid, plus the viewer's own DOM chrome (Layers legend, basemap panel) —
 * all deterministic on the re-seeded fixture.
 *
 * Determinism levers (shared rationale in ``helpers/visual_golden``):
 *   - ``reseedFixture`` — the scene is the seeded baseline regardless of
 *     which specs ran before (earlier specs legitimately mutate litho state,
 *     which would reshape the build).
 *   - ``blockExternalNetwork`` — the basemap lid's Geopunt WMS fetch is
 *     aborted, so online and offline machines render the same pixels.
 *   - ``WEBGL_MAX_DIFF_PIXEL_RATIO`` — SwiftShader anti-aliasing budget.
 *
 * First run: Playwright writes the missing golden and FAILS — that is the
 * red run; inspect the image, re-run green.  Re-bless procedure:
 * docs/e2e-fixtures.md.
 *
 * Cleanup mirrors flow_litho_fence_diagram: the built ``litho_body_solid``
 * rows are deleted afterwards so flow_lithology_stage_ui (which expects the
 * guided EmptyState) still holds.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set), ``uv`` on PATH (re-seed).
 */

import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import { getGeologicalModelId } from './helpers/db_helper'
import {
  WEBGL_MAX_DIFF_PIXEL_RATIO,
  blockExternalNetwork,
  reseedFixture,
} from './helpers/visual_golden'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/**
 * Settle window between the viewer mounting and the screenshot.
 *
 * Longer than the fence cutout's: the same 1.5 s camera flight, but the full
 * model's meshes (every voxel body across five sections) upload and rasterise
 * under SwiftShader before the first stable frame.
 */
const LITHO_3D_SETTLE_MS = 6_000

/**
 * Delete all built solids for a litho model (same rationale + SQL as
 * flow_litho_fence_diagram: no public solid-delete endpoint exists, and
 * downstream specs expect the no-solids EmptyState).
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

test.describe('flow_litho_3d_golden', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('in-app voxel build renders the litho 3D scene matching the golden', async () => {
    // Re-seed + shell open + full voxel build + Cesium mount — generous.
    test.setTimeout(300_000)

    // Deterministic baseline, whatever ran before this spec.
    reseedFixture(FIXTURE_PROJECT_ID)

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    let lithoModelId: string | null = null
    try {
      lithoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'lithostratigraphic')
      expect(lithoModelId, 'fixture must have a lithostratigraphic model').not.toBeNull()

      await blockExternalNetwork(page)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Litho')

      // The REAL build: partition assembly + POST build-voxel, exactly what
      // the owner's press does. The button disables while building.
      const buildBtn = page.getByTestId('litho-build-model-button')
      await expect(buildBtn).toBeVisible({ timeout: 20_000 })
      await expect(buildBtn).toBeEnabled({ timeout: 10_000 })
      await buildBtn.click()
      await expect(buildBtn).toBeEnabled({ timeout: 90_000 })

      // Viewer mounted (hasLithoSolids branch) in default Solid mode.
      await expect(page.getByTestId('litho-view-mode-solid')).toBeVisible({ timeout: 30_000 })
      const viewport = page.locator('[id^="cesium-viewport-"]')
      await expect(viewport).toBeVisible({ timeout: 10_000 })

      // Camera flight + SwiftShader mesh upload before pinning pixels.
      await page.waitForTimeout(LITHO_3D_SETTLE_MS)

      await expect(viewport).toHaveScreenshot('litho-3d-solid.png', {
        maxDiffPixelRatio: WEBGL_MAX_DIFF_PIXEL_RATIO,
      })
    } finally {
      // Restore the no-solids state downstream specs expect.
      try {
        if (lithoModelId) {
          await deleteLithoSolids(lithoModelId)
        }
      } catch {
        /* non-fatal — the next run's TRUNCATE cleans up */
      }
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
