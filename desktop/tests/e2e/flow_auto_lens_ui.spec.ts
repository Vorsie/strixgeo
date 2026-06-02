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

      // The crossing lives on two DEDICATED series-less CPTs (the fixture's
      // _CROSSING_CPT_INDICES). Because suggest-litho returns nothing for a
      // series-less CPT, every all-CPT litho seeder skips them — so no spec
      // can bury the pre-seeded inversion under segmenter contacts, and this
      // spec works identically solo and in a full suite run.
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

      // If an earlier spec already produced auto edges on the shared model, the
      // toolbar opens the "Auto-correlate found existing edges" dialog (after an
      // async pre-check) instead of firing. Race the dialog against the markers:
      // solo run -> markers appear directly; in-suite -> the dialog wins, so
      // Re-correlate (delete the old auto edges + rerun) to run the detection.
      const reCorrelate = page.getByTestId('re-correlate-rerun')
      const markers = page.getByTestId('crossing-pinch-out-markers')
      await Promise.race([
        reCorrelate.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        markers.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      ])
      if (await reCorrelate.isVisible().catch(() => false)) {
        await reCorrelate.click()
      }

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
