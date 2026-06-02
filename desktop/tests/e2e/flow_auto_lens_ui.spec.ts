/**
 * Flow — auto-lens: a correlation crossing surfaces as a lens-candidate diamond.
 *
 * End-to-end demo + regression for the auto-lens feature (increments 1–3d,
 * owner dogfeed 2026-06-02). The fixture pre-seeds an interfingered ZAND/KLEI
 * crossing on Section C (build_synthetic_fixture.py action seed). When the user
 * runs Auto-correlate, the two crossing edges are NOT drawn (a crossing is not
 * a flat correlation); instead the pinching layer is surfaced as an amber
 * lens-candidate diamond (``crossing-pinch-out-markers``).
 *
 * Self-contained: the crossing lives in the fixture, so no per-run API seeding.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_auto_lens_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py + seed the crossing first',
  )

  test('auto-correlate surfaces a crossing as an amber lens-candidate diamond', async () => {
    test.slow() // opens project + auto-correlate round-trip
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')

      // Select Section C — the pre-seeded crossing lives on it.
      const sectionC = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section C' })
        .first()
      await expect(sectionC).toBeVisible({ timeout: 10_000 })
      await sectionC.click()

      // Switch to the lithostratigraphic axis (the crossing contacts render here).
      await page.getByRole('radio', { name: 'Litho' }).click()

      // Auto-correlate (Correlate split → caret → Auto-correlate).
      await page.getByTestId('correlate-mode-caret').click()
      await page.getByTestId('litho-auto-correlate').click()

      // The crossing is surfaced as an amber lens-candidate diamond — the two
      // crossing edges were dropped, not drawn.
      await expect(page.getByTestId('crossing-pinch-out-markers')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.locator('[data-testid^="crossing-pinch-out-"]').first(),
      ).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
