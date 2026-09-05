/**
 * Flow — Lithology stage UI surface (debt #130).
 *
 * Covers the Lithology stage in its baseline (empty-model) state: the
 * always-present ``ModelKindPicker`` (model select/create lifecycle) in the
 * inspector, and the guided canvas placeholder shown until solids exist.
 *
 * The contact-dependent inspector controls (wipe / resolve-instances /
 * committed pill) are gated behind a populated model — they are covered by a
 * future Suggest→Accept flow that builds litho contacts first (the fixture
 * ships an *empty* active litho model by design, per
 * build_synthetic_fixture.py). This spec guards the entry surface so a
 * regression in the picker or the empty-state guidance is caught immediately.
 *
 * Follows the ``flow_sections_toolbar_ui`` template.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_lithology_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('model-kind picker + canvas placeholder are reachable', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Litho')

      // The model lifecycle picker is always present at the inspector top.
      await expect(page.getByTestId('model-kind-picker')).toBeVisible()

      // The canvas shows the guided placeholder until built solids exist
      // (litho-3D plan: the 3D pane mounts on solids, not retired TIN surfaces).
      await expect(page.getByText('Lithological model')).toBeVisible()
      await expect(
        page.getByText(/click Build model on the Lithology toolbar/),
      ).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
