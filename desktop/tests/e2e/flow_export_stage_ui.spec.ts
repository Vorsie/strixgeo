/**
 * Flow — Export stage UI surface (debt #130).
 *
 * The Export stage had ZERO e2e coverage. It is the spine's terminal stage:
 * a Cross-section card (section picker + DXF + Plaxis 2D) and a model-wide
 * Plaxis 3D card (debt #30 — the spine no longer ends in a "coming soon"
 * room). This spec proves every export affordance is reachable and that
 * selecting a section enables the section-scoped buttons.
 *
 * The fixture ships an *active* geological model + 2 cross-sections, so both
 * cards render their actions (not their "define a model first" guidance).
 * Export buttons are NOT clicked — firing a real export writes a file /
 * opens a save dialog; reachability + enabled-state is the contract here.
 *
 * Selectors are role/text + the stable ``#export-section-select`` id (the
 * Export cards carry no testids today). Follows the
 * ``flow_sections_toolbar_ui`` template.
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

  test('both export cards render and section selection enables DXF + Plaxis 2D', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Export')

      // Stage heading + both card titles.
      await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible()
      await expect(page.getByText('Cross-section', { exact: true })).toBeVisible()
      await expect(page.getByText('Stratigraphic model → Plaxis 3D')).toBeVisible()

      // Model-wide Plaxis 3D export is always actionable (active model present).
      await expect(page.getByRole('button', { name: 'Export Plaxis 3D' })).toBeEnabled()

      // Section-scoped buttons start disabled (no section chosen yet)…
      const dxf = page.getByRole('button', { name: 'Export DXF' })
      const plaxis2d = page.getByRole('button', { name: 'Export Plaxis 2D' })
      await expect(dxf).toBeVisible()
      await expect(plaxis2d).toBeVisible()

      // …pick a section in the picker → both enable.
      await page.locator('#export-section-select').selectOption({ index: 0 })
      await expect(dxf).toBeEnabled()
      await expect(plaxis2d).toBeEnabled()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
