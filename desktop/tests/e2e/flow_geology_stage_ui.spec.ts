/**
 * Flow — Geology stage UI surface + Create-formation dialog (debt #130).
 *
 * Covers the Geology stage's toolbar + inspector controls and exercises the
 * FormationDialog (open → assert fields → cancel), which is one of the ~16
 * dialogs the #130 backfill targets. The dialog open/cancel round-trip is the
 * reversible action this spec uses to prove the control is wired (the earlier
 * "name body hits a dead end" class of bug is exactly what a dialog open/close
 * assertion catches).
 *
 * Selectors are the real testids in ``GeologyToolbar`` / ``GeologyInspector``
 * / ``FormationDialog``. Follows the ``flow_sections_toolbar_ui`` template.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_geology_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('toolbar + inspector controls are reachable', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Stratigraphy')

      // Toolbar verbs (GeologyToolbar).
      await expect(page.getByTestId('geology-fill-from-boreholes-button')).toBeVisible()
      await expect(page.getByTestId('geology-build-model-button')).toBeVisible()

      // Inspector entry action.
      await expect(page.getByTestId('geology-create-formation-button')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('Create-formation dialog opens, exposes its fields, and cancels', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Stratigraphy')

      await page.getByTestId('geology-create-formation-button').click()

      // Dialog + its key fields are reachable (name + formal-stratigraphy link).
      const dialog = page.getByTestId('create-formation-dialog')
      await expect(dialog).toBeVisible()
      await expect(page.getByTestId('create-formation-name-input')).toBeVisible()
      await expect(page.getByTestId('formation-formal-input')).toBeVisible()
      await expect(page.getByTestId('create-formation-submit')).toBeVisible()

      // Cancel closes it cleanly (no commit).
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
