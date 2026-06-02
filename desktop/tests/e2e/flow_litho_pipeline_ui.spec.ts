/**
 * Flow — Litho Suggest → Accept pipeline on a cross-section (debt #130).
 *
 * The first DYNAMIC e2e flow: it builds real lithostratigraphic contacts by
 * driving the section toolbar end to end, rather than asserting a static
 * surface. The chain is entirely button/text-driven (no pixel-based SVG
 * interaction), so it is deterministic under Playwright's auto-waiting:
 *
 *   1. Sections stage → select a section → switch to the Litho axis.
 *   2. Suggest split → caret → "Suggest all in this section" → the bulk
 *      confirmation modal ("Suggest lithos for all tests?").
 *   3. Confirm → the segmenter runs on every in-corridor investigation →
 *      the bulk "Accept all (bulk)" button appears.
 *   4. Accept-all-bulk → suggestions commit as litho contacts, which render
 *      on the section as ``contact-drag-strip`` elements.
 *
 * Beyond its own value (it exercises the segmenter + bulk-accept use cases
 * through the UI), this flow is the DATA SETUP the context-menu specs need:
 * the 4 section context menus (contact / body / litho-band / empty-space) all
 * require committed contacts to right-click, which this flow produces.
 *
 * Generous timeouts: the segmenter runs on the fixture's 6 CPTs and the
 * bulk-accept commits in one batch — both are real backend round-trips.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set). NOTE: this flow MUTATES the
 * fixture litho model (commits contacts). ``build_synthetic_fixture.py`` is
 * idempotent + cleans litho state on re-run, so re-seed between full suites.
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Click the first non-delete section row to select it. */
async function selectFirstSection(page: Page): Promise<void> {
  const row = page.locator('[data-testid^="section-row-"]:not([data-testid*="delete"])').first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
}

test.describe('flow_litho_pipeline_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('suggest-all → confirm → accept-all-bulk commits litho contacts', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')
      await selectFirstSection(page)

      // Switch to the lithostratigraphic axis.
      await page.getByRole('radio', { name: 'Litho' }).click()

      // Suggest split → caret → "Suggest all in this section".
      await page.getByTestId('litho-suggest-caret').click()
      await page.getByTestId('litho-suggest-all').click()

      // Bulk confirmation modal → confirm.
      await expect(page.getByText('Suggest lithos for all tests?')).toBeVisible({ timeout: 5_000 })
      await page.getByRole('button', { name: /^Suggest all \(\d+\)$/ }).click()

      // Segmenter runs on every in-section investigation → bulk-accept appears.
      const acceptBulk = page.getByTestId('litho-accept-all-bulk')
      await expect(acceptBulk).toBeVisible({ timeout: 45_000 })
      await acceptBulk.click()

      // Suggestions commit → litho contacts render as drag strips on the section.
      await expect(
        page.locator('[data-testid="contact-drag-strip"]').first(),
      ).toBeVisible({ timeout: 45_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
