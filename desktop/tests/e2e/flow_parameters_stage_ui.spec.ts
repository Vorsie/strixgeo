/**
 * Flow — Parameters stage UI surface (debt #130).
 *
 * The Parameters stage had ZERO e2e coverage. It is a three-tab scaffold
 * (per-test / per-unit / methods) that lifted the Ic/SBT panel out of the
 * old CptChart (debt #22). This spec drives the tab bar end to end:
 * navigates to the stage, asserts all three tab buttons render, and that
 * switching tabs swaps the visible panel (only the active panel is mounted).
 *
 * Selectors are the real testids in ``ParametersCanvas`` (verified against
 * ``ParametersCanvas.test.tsx``). Follows the ``flow_sections_toolbar_ui``
 * template: launchApp → openFixtureProject → goToStage → assert surface.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_parameters_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('three tabs render and switching swaps the active panel', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Parameters')

      // All three tab buttons render.
      await expect(page.getByTestId('parameters-tab-per-test')).toBeVisible()
      await expect(page.getByTestId('parameters-tab-per-unit')).toBeVisible()
      await expect(page.getByTestId('parameters-tab-methods')).toBeVisible()

      // Default: per-test panel mounted, the other two are NOT.
      await expect(page.getByTestId('parameters-panel-per-test')).toBeVisible()
      await expect(page.getByTestId('parameters-panel-per-unit')).toHaveCount(0)
      await expect(page.getByTestId('parameters-panel-methods')).toHaveCount(0)

      // Switch to per-unit → only that panel mounts.
      await page.getByTestId('parameters-tab-per-unit').click()
      await expect(page.getByTestId('parameters-panel-per-unit')).toBeVisible()
      await expect(page.getByTestId('parameters-panel-per-test')).toHaveCount(0)

      // Switch to methods → only that panel mounts.
      await page.getByTestId('parameters-tab-methods').click()
      await expect(page.getByTestId('parameters-panel-methods')).toBeVisible()
      await expect(page.getByTestId('parameters-panel-per-unit')).toHaveCount(0)

      // Back to per-test → panel returns.
      await page.getByTestId('parameters-tab-per-test').click()
      await expect(page.getByTestId('parameters-panel-per-test')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
