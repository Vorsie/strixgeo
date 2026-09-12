/**
 * Flow — contact-menu + litho-band ACTIONS (debt #130 action-coverage).
 *
 * Drives the remaining section right-click ACTIONS against the fixture's
 * pre-seeded committed contacts on Section B (the body's source/target
 * contacts render as ``contact-drag-strip`` boundaries + ``per-column-litho-band``
 * bands):
 *   1. Contact → Delete contact — DESTRUCTIVE: drive to the confirm dialog and
 *      Cancel (order-independent; the body's contacts survive).
 *   2. Litho band → Delete unit — DESTRUCTIVE: confirm dialog + Cancel.
 *
 * (The body-extent "Open-end layer" gesture was retired in debt #207 — the
 * dead route 404'd silently — so its action test was removed with it.)
 *
 * Follows the action-coverage convention (debt #130): exercise the gesture to
 * its effect; for irreversible actions assert the confirmation fires and Cancel
 * so the shared fixture is never corrupted. Self-contained — Section B is seeded
 * by build_synthetic_fixture.py.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Open the project, go to Section B (seeded committed contacts), litho axis. */
async function openContactSection(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const sectionB = page
    .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
    .filter({ hasText: 'Section B' })
    .first()
  await expect(sectionB).toBeVisible({ timeout: 10_000 })
  await sectionB.click()
  await page.getByRole('radio', { name: 'Litho' }).click()
}

/** Right-click an element (dispatchEvent bypasses SVG z-order). */
async function rightClick(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 15_000 })
  await locator.dispatchEvent('contextmenu', {
    button: 2,
    clientX: 360,
    clientY: 360,
    bubbles: true,
  })
}

test.describe('flow_contact_band_actions_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('Contact → Delete contact — confirm fires, Cancel keeps the contact', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openContactSection(page)

      const strip = page.locator('[data-testid="contact-drag-strip"]').first()
      await rightClick(page, strip)
      const menu = page.getByTestId('contact-context-menu')
      await expect(menu).toBeVisible({ timeout: 5_000 })

      // "Delete contact" → confirm dialog → Cancel (no mutation). dispatchEvent
      // click bypasses the viewport check — the portalled menu can render with
      // its last item below the fold.
      await menu.getByText('Delete contact').dispatchEvent('click')
      const dialog = page.getByTestId('delete-contact-confirm-dialog')
      await expect(dialog).toBeVisible({ timeout: 5_000 })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden({ timeout: 5_000 })
      // The contact survives.
      await expect(page.locator('[data-testid="contact-drag-strip"]').first()).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('Litho band → Delete unit — confirm fires, Cancel keeps the band', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openContactSection(page)

      const band = page.locator('[data-testid^="per-column-litho-band-"]').first()
      await rightClick(page, band)
      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible({ timeout: 5_000 })

      // Remove → confirm dialog → Cancel (no mutation).
      await page.getByTestId('litho-band-remove').dispatchEvent('click')
      const dialog = page.getByTestId('delete-contact-confirm-dialog')
      await expect(dialog).toBeVisible({ timeout: 5_000 })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden({ timeout: 5_000 })
      await expect(page.locator('[data-testid^="per-column-litho-band-"]').first()).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('Empty-space → Add new suggestion — opens the composition picker, Cancel', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openContactSection(page)

      // Right-click the per-column capture rect near its BOTTOM (below the
      // bands) → the empty-space "Add new suggestion here" menu.
      const capture = page.locator('[data-testid^="per-column-rclick-capture-"]').first()
      await expect(capture).toBeVisible({ timeout: 10_000 })
      const box = await capture.boundingBox()
      if (!box) throw new Error('capture rect has no bounding box')
      await capture.click({
        button: 'right',
        force: true,
        position: { x: box.width / 2, y: box.height - 6 },
      })
      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible({ timeout: 5_000 })
      await page.getByTestId('litho-band-add').dispatchEvent('click')

      // The composition picker opens (titled "Top of which litho unit?"); Cancel
      // leaves the model untouched.
      const picker = page.getByText('Top of which litho unit?')
      await expect(picker).toBeVisible({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Cancel' }).first().click()
      await expect(picker).toBeHidden({ timeout: 5_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
