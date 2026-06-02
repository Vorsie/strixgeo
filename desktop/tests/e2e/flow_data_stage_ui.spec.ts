/**
 * Flow — Data stage UI surface (debt #130).
 *
 * Covers the Data stage's primary control: the Import dropdown. Asserts the
 * trigger is reachable and that opening it exposes every import action — the
 * three live verbs (CPT .gef, CPT from DOV, Borehole from DOV) and the three
 * Phase-4-deferred verbs (DMT / Lab Test / Monitoring) that render as dimmed
 * "Phase 4" items.
 *
 * Import actions are NOT clicked — they open a native file dialog or arm a
 * bbox-draw on the map; reachability is the contract here. The Map/Chart
 * view-tab switcher only appears once an investigation is selected and is
 * left for a follow-up selection flow.
 *
 * The Data toolbar uses a local DropdownMenu (text-labelled, no testids), so
 * selectors here are role/text. Follows the ``flow_sections_toolbar_ui``
 * template.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_data_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('Import dropdown exposes every import verb', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Data')

      // The Import dropdown trigger (label "Import" when idle).
      const importBtn = page.getByRole('button', { name: 'Import' })
      await expect(importBtn).toBeVisible()
      await importBtn.click()

      // Live import verbs.
      await expect(page.getByText('Import CPT (.gef)')).toBeVisible()
      await expect(page.getByText('Import CPT from DOV (draw bbox)')).toBeVisible()
      await expect(page.getByText('Import Borehole from DOV (draw bbox)')).toBeVisible()

      // Phase-4-deferred verbs render (dimmed) so the roadmap is visible.
      await expect(page.getByText('Import DMT')).toBeVisible()
      await expect(page.getByText('Import Lab Test')).toBeVisible()
      await expect(page.getByText('Import Monitoring')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
