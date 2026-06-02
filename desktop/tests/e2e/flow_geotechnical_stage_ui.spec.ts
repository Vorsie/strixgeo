/**
 * Flow — Geotechnical stage placeholder (debt #130).
 *
 * The Geotechnical stage had ZERO e2e coverage. Today it is an intentional
 * ``EmptyState`` placeholder — the NAD packing-class subdivision lands in a
 * later milestone (gated behind the litho stage). This spec is a guard: it
 * proves the stage is reachable from the spine and renders the guided
 * placeholder rather than crashing or showing a blank canvas.
 *
 * When the real Geotech stage ships, this spec is the natural home to grow
 * the toolbar / inspector coverage — replace the placeholder assertion with
 * the real controls.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_geotechnical_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('stage is reachable and renders the guided placeholder', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Geotech')

      // The EmptyState placeholder's title + hint (GeotechnicalCanvas.tsx).
      await expect(page.getByText('Geotechnical subdivision')).toBeVisible()
      await expect(
        page.getByText(/Split geological formations into geotechnical units/),
      ).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
