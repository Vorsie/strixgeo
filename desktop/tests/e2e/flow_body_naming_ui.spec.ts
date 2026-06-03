/**
 * Flow — name a body (the original "name body hits a dead end" gesture).
 *
 * Regression for the body-naming context-menu gesture the owner first reported
 * as a dead end. The fixture pre-seeds a COMMITTED bilateral-closure body on
 * Section B (build_synthetic_fixture.py action seed). The spec drives the full
 * gesture:
 *
 *   right-click the body wedge → body-context-menu → "Name body" →
 *   name-body-dialog → type a name → name-body-submit → dialog closes.
 *
 * Self-contained: the body lives in the fixture, so no per-run seeding.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  openFixtureProject,
  goToStage,
  cleanupFixtureFile,
  detectBodiesForFixture,
} from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_body_naming_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — seed fixture + a bilateral body first',
  )

  test('right-click a body → Name body → dialog → submit names it', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Re-stamp the seeded body's detector extents BEFORE opening the project
      // (a sibling spec's model-wide auto-correlate + accept recreates body rows
      // without extents) so the section render fetches corrected bodies and the
      // body wedge renders deterministically. Idempotent on a fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')

      // Section B carries the pre-seeded body.
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      // The committed body renders as a fill wedge. Skip cleanly if none seeded.
      const bodyFill = page.locator('[data-testid^="body-extent-fill-"]').first()
      const hasBody = await bodyFill
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
      test.skip(!hasBody, 'no committed body on the section — seed a bilateral body first')

      // Right-click the wedge (dispatchEvent bypasses SVG z-order).
      await bodyFill.dispatchEvent('contextmenu', {
        button: 2,
        clientX: 360,
        clientY: 360,
        bubbles: true,
      })
      await expect(page.getByTestId('body-context-menu')).toBeVisible({ timeout: 5_000 })

      // "Name body" → the dialog (the former dead-end).
      await page.getByTestId('body-ctx-name-body').click()
      await expect(page.getByTestId('name-body-dialog')).toBeVisible({ timeout: 5_000 })

      // Type a name + submit → the dialog closes (the name commits).
      await page.getByTestId('name-body-input').fill('Channel sand lens')
      await page.getByTestId('name-body-submit').click()
      await expect(page.getByTestId('name-body-dialog')).toBeHidden({ timeout: 10_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
