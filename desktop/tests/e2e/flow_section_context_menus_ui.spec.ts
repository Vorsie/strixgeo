/**
 * Flow — the 4 section context menus (debt #130).
 *
 * Covers every right-click menu on the cross-section's litho axis. Each
 * trigger element carries a stable testid, so we right-click the LOCATOR
 * directly (Playwright dispatches the contextmenu at the element's box —
 * no pixel hunting) with ``force`` to skip the transparent-fill actionability
 * check. The four menus:
 *
 *   1. Empty-space → "Add new suggestion here" (``litho-band-add``). Tested on
 *      the EMPTY litho model: the per-column capture rect
 *      (``per-column-rclick-capture-{id}``) renders on the litho axis
 *      regardless of contacts, and with no bands its centre is empty space.
 *   2. Litho band → "Remove this litho unit" (``litho-band-remove``). Needs
 *      committed contacts (built via the Suggest→Accept pipeline) so a
 *      ``per-column-litho-band-{key}`` exists to right-click.
 *   3. Contact strip → contact menu (``contact-context-menu`` with
 *      "Delete contact" + the open-end items). Needs committed contacts.
 *   4. Body wedge → body menu (``body-context-menu``). This is the
 *      "name body hits a dead end" surface the owner reported. Needs a
 *      detected body: build contacts → auto-correlate → accept-correlations
 *      → detect-lenses, then right-click ``body-extent-fill-{key}``.
 *
 * RISK NOTES (these are the parts a green run validates):
 * - Menus 2–4 depend on the segmenter producing litho contacts on the
 *   fixture's 6 CPTs (it does — the synthetic qc varies per CPT).
 * - Menu 4 additionally depends on auto-correlate closing at least one body
 *   on the synthetic geometry. If no body forms, the fixture needs a
 *   guaranteed pinch-out (a fixture tweak, not a spec redesign) — flagged in
 *   debt #130.
 * - Right-clicks use ``force``; if a full-plot overlay ever steals the
 *   empty-space click, menu 1 needs a ``position`` near the column bottom.
 *
 * Tests MUTATE the fixture litho model — re-run build_synthetic_fixture.py
 * (idempotent + self-cleaning) between full suites.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Select the first section and switch to the litho axis. */
async function enterLithoAxis(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const row = page.locator('[data-testid^="section-row-"]:not([data-testid*="delete"])').first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByRole('radio', { name: 'Litho' }).click()
}

/** Build committed litho contacts via Suggest-all → bulk-confirm → Accept-all-bulk. */
async function buildLithoContacts(page: Page): Promise<void> {
  await page.getByTestId('litho-suggest-caret').click()
  await page.getByTestId('litho-suggest-all').click()
  await expect(page.getByText('Suggest lithos for all tests?')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^Suggest all \(\d+\)$/ }).click()
  const acceptBulk = page.getByTestId('litho-accept-all-bulk')
  await expect(acceptBulk).toBeVisible({ timeout: 45_000 })
  await acceptBulk.click()
  await expect(
    page.locator('[data-testid="contact-drag-strip"]').first(),
  ).toBeVisible({ timeout: 45_000 })
}

test.describe('flow_section_context_menus_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('empty-space right-click → Add-new-suggestion menu', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await enterLithoAxis(page)

      // The per-column capture rect renders on the litho axis (empty model).
      const capture = page.locator('[data-testid^="per-column-rclick-capture-"]').first()
      await expect(capture).toBeAttached({ timeout: 10_000 })
      await capture.click({ button: 'right', force: true })

      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible()
      await expect(page.getByTestId('litho-band-add')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('litho band right-click → Remove-litho-unit menu', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await enterLithoAxis(page)
      await buildLithoContacts(page)

      const band = page.locator('[data-testid^="per-column-litho-band-"]').first()
      await expect(band).toBeVisible({ timeout: 10_000 })
      await band.click({ button: 'right', force: true })

      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible()
      await expect(page.getByTestId('litho-band-remove')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('contact strip right-click → contact menu (delete + open-end)', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await enterLithoAxis(page)
      await buildLithoContacts(page)

      await page
        .locator('[data-testid="contact-drag-strip"]')
        .first()
        .click({ button: 'right', force: true })

      await expect(page.getByTestId('contact-context-menu')).toBeVisible()
      // "Delete contact" is present for any deletable litho contact.
      await expect(page.getByText('Delete contact')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('body wedge right-click → body menu (the name-body surface)', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await enterLithoAxis(page)
      await buildLithoContacts(page)

      // Build a body: auto-correlate → accept correlations → detect lenses.
      await page.getByTestId('correlate-mode-caret').click()
      await page.getByTestId('litho-auto-correlate').click()
      // Let the auto-correlate round-trip settle before accepting.
      await page.getByTestId('correlate-mode-caret').click()
      await page.getByTestId('litho-accept-correlations').click()
      await page.getByTestId('litho-bodies-dropdown').click()
      await page.getByTestId('litho-detect-lenses').click()

      // A detected body renders as a fill wedge — right-click opens its menu.
      const bodyFill = page.locator('[data-testid^="body-extent-fill-"]').first()
      await expect(bodyFill).toBeVisible({ timeout: 30_000 })
      await bodyFill.click({ button: 'right', force: true })

      await expect(page.getByTestId('body-context-menu')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
