/**
 * Flow — Export stage UI surface (debt #130).
 *
 * The Export stage had ZERO e2e coverage. It is the spine's terminal stage:
 * the export hub, one card per export target grouped by model level (installer
 * #35). This spec proves the section-scoped exports are reachable and enable
 * once a section is chosen. Since installer #42 D-Stability and Plaxis 2D are
 * geotechnical-only, so the sole Plaxis 2D card is the geotech one.
 *
 * The fixture ships active geological + litho + geotech models + 2
 * cross-sections, so the cards render their actions (not their "define a model
 * first" guidance). Export buttons are NOT clicked — firing a real export
 * writes a file / opens a save dialog; reachability + enabled-state is the
 * contract here.
 *
 * Selectors are the cards' stable testids + the ``#export-section-select`` id.
 * Follows the ``flow_sections_toolbar_ui`` template.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_export_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('the hub renders and section selection enables DXF + geotech Plaxis 2D', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Export')

      // Stage heading + a group heading + the Plaxis 3D card title.
      await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible()
      await expect(page.getByText('Cross-section', { exact: true })).toBeVisible()
      await expect(page.getByText('Stratigraphic model → Plaxis 3D')).toBeVisible()

      // Model-wide Plaxis 3D export is always actionable (active model present).
      await expect(page.getByRole('button', { name: 'Export Plaxis 3D' })).toBeEnabled()

      // The section-scoped cards (DXF + the sole, geotechnical, Plaxis 2D) show
      // a guidance line ("Pick a cross-section above to export it.") until a
      // section is picked; their export buttons, which carry the testids, only
      // render after the pick. So: pick first, then both buttons are there and
      // enabled.
      await page.locator('#export-section-select').selectOption({ index: 0 })
      const dxf = page.getByTestId('export-canvas-dxf')
      const plaxis2d = page.getByTestId('export-canvas-geotech-plaxis2d')
      await expect(dxf).toBeVisible()
      await expect(plaxis2d).toBeVisible()
      await expect(dxf).toBeEnabled()
      await expect(plaxis2d).toBeEnabled()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
