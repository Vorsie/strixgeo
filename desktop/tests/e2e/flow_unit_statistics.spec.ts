/**
 * Flow — Parameters per-unit statistics + the FIRST Cesium pixel golden.
 *
 * WHY (owner ruling 2026-08-27: "if it can be automated, automate it"):
 * the unit suite runs under jsdom, which has no WebGL — the fence cutout and
 * every Cesium surface had NEVER rendered in any automated test; the owner's
 * eyes were the only gate.  This spec drives the real Electron renderer
 * (SwiftShader renders WebGL headless) end-to-end:
 *
 *   1. Re-seed the fixture (visual_golden.reseedFixture) so the scene is the
 *      deterministic seeded baseline regardless of which specs ran before —
 *      a pixel golden cannot tolerate the fixture mutations earlier specs
 *      legitimately leave behind.
 *   2. Resolve the target NAD unit over the API (ids are uuid7-minted per
 *      seed — never hard-coded).
 *   3. Parameters stage → Per-unit tab → the unit roster renders rows.
 *   4. The body-level contract: a unit lumping ≥2 resolver bodies carries an
 *      expander (expand it, body rows appear, a body row click scopes the
 *      canvas); a single-body unit carries NO expander (the GT3 precedent).
 *      The fixture decides which branch is real — both are asserted honestly.
 *   5. Unit row click → the statistics canvas: population line
 *      (``unit-stats-population``) + at least one distribution panel.
 *   6. The fence cutout mounts its Cesium scene (walls exist because the
 *      fixture seeds approved geotech edges), the camera flight settles, and
 *      the cutout region is compared against a stored golden
 *      (``toHaveScreenshot`` — tolerance rationale in
 *      ``helpers/visual_golden.WEBGL_MAX_DIFF_PIXEL_RATIO``).
 *
 * External network is BLOCKED for the whole session (the basemap lid
 * textures itself from the Geopunt WMS when online — see
 * ``blockExternalNetwork``), so the golden renders the offline scene in
 * every environment.
 *
 * First run: Playwright writes the missing golden and FAILS the test — that
 * failure is the red run; inspect the written image, then re-run green.
 * Re-blessing after an intentional visual change: see docs/e2e-fixtures.md.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set), ``uv`` on PATH (re-seed).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import {
  CESIUM_SETTLE_MS,
  WEBGL_MAX_DIFF_PIXEL_RATIO,
  blockExternalNetwork,
  reseedFixture,
  resolveFenceTargetUnit,
} from './helpers/visual_golden'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_unit_statistics', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('unit roster → statistics canvas → fence cutout golden', async () => {
    // Re-seed (~backend round-trips) + shell open + Cesium mount + camera
    // flight — well past the 60 s default.
    test.setTimeout(300_000)

    // 1. Deterministic baseline, whatever ran before this spec.
    reseedFixture(FIXTURE_PROJECT_ID)

    // 2. Which NAD unit the golden pins (ids are re-minted per seed).
    const target = await resolveFenceTargetUnit(FIXTURE_PROJECT_ID)

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Before any stage that mounts Cesium, so the WMS lid fetch can never
      // reach the network.
      await blockExternalNetwork(page)

      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Parameters')
      await page.getByTestId('parameters-tab-per-unit').click()
      await expect(page.getByTestId('parameters-panel-per-unit')).toBeVisible()

      // 3. The roster (inspector half) renders rows — geotech units, because
      //    the seeded model has accepted bands.
      const list = page.getByTestId('parameters-unit-list')
      await expect(list).toBeVisible()
      const options = list.getByRole('option')
      expect(await options.count(), 'unit roster must render at least one row').toBeGreaterThan(0)

      const unitRow = page.getByTestId(`parameters-unit-${target.unitId}`)
      await expect(unitRow).toBeVisible()

      // 4. Body-level contract — the fixture decides which branch is real.
      const expander = page.getByTestId(`parameters-unit-expander-${target.unitId}`)
      if (target.bodyCount > 1) {
        // Multi-body unit: expander present; expanding reveals one row per
        // resolver body; clicking one scopes the canvas to that body.
        await expect(expander).toBeVisible()
        await expander.click()
        const bodyRows = list.locator('[data-testid^="parameters-unit-body-"]')
        await expect(bodyRows.first()).toBeVisible()
        expect(await bodyRows.count(), 'one body row per resolver body').toBe(target.bodyCount)
        await bodyRows.first().click()
        await expect(page.getByTestId('parameters-unit-canvas')).toBeVisible()
      } else {
        // Single-body unit: no expander — the unit row IS the pooled view
        // (shipped contract, GT3 precedent).
        await expect(expander).toHaveCount(0)
      }

      // 5. The POOLED unit scope drives the statistics canvas (also the
      //    deterministic scope the golden pins — a body scope would tie the
      //    golden to whichever body sorted first).
      await unitRow.click()
      await expect(page.getByTestId('parameters-unit-canvas')).toBeVisible()
      await expect(page.getByTestId('unit-stats-population')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('unit-stats-empty')).toHaveCount(0)
      expect(
        await page.locator('[data-testid^="unit-stats-row-"]').count(),
        'at least one distribution panel must render',
      ).toBeGreaterThan(0)

      // 6. The fence cutout — the Cesium branch, never the empty hint (the
      //    fixture guarantees approved edges → walls for this unit).
      const cutout = page.getByTestId('unit-fence-cutout')
      await cutout.scrollIntoViewIfNeeded()
      await expect(cutout).toBeVisible()
      await expect(page.getByTestId('unit-fence-empty')).toHaveCount(0)
      // Cesium needs real frames: the canvas appears once the viewer boots
      // (lazy chunk + fence assembly + WebGL context — generous window).
      await expect(cutout.locator('canvas')).toBeVisible({ timeout: 60_000 })
      await expect(page.getByTestId('unit-fence-reset-camera')).toBeVisible()

      // Camera flight (1.5 s) + SwiftShader settle before pinning pixels.
      await page.waitForTimeout(CESIUM_SETTLE_MS)

      await expect(cutout).toHaveScreenshot('unit-fence-cutout.png', {
        maxDiffPixelRatio: WEBGL_MAX_DIFF_PIXEL_RATIO,
      })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
