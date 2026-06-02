/**
 * Flow — contact ↔ geology Link / Unlink actions (debt #130 action-coverage).
 *
 * Round-trips the contact-menu coupling gestures on the fixture's seeded body
 * contact that sits at the same depth as a geological contact (the "ZAND top
 * cap" litho contact @2 m on CPT-4 coincides with the Tertiary-Clay geo contact
 * @2 m — within the litho↔geology snap tolerance):
 *   right-click → "Link to geology" (couples) → right-click again →
 *   "Unlink from geology" (uncouples).
 *
 * The Link item shows only for an UNCOUPLED contact, Unlink only for a coupled
 * one, so the round-trip both exercises the actions AND verifies the state
 * flip. Ends uncoupled → order-independent.
 *
 * Self-contained — the coincident contact is seeded by build_synthetic_fixture.py
 * on Section B.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_contact_geo_link_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('Contact → Link to geology, then Unlink — round-trip', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Find the litho contact at depth 2 m (the one coincident with a geo
      // contact) so we can target its specific drag-strip by data-contact-id.
      const contactId = await page.evaluate(
        async ([base, pid]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const models: any[] = await (await fetch(`${base}/projects/${pid}/geology/models`)).json()
          const litho = models.find(m => m.kind === 'lithostratigraphic')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts: any[] = await (
            await fetch(`${base}/projects/${pid}/geology/models/${litho.id}/contacts`)
          ).json()
          const c = contacts.find((x: { depth_top_m: number }) => Math.abs(x.depth_top_m - 2) < 0.01)
          return (c?.id as string) ?? null
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      expect(contactId, 'a litho contact at depth 2 m must exist (action seed)').toBeTruthy()

      await goToStage(page, 'Sections')
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      const strip = page.locator(
        `[data-testid="contact-drag-strip"][data-contact-id="${contactId}"]`,
      )
      await expect(strip).toBeVisible({ timeout: 15_000 })

      // --- Link: right-click → "Link to geology" (uncoupled → coupled). ---
      await strip.dispatchEvent('contextmenu', {
        button: 2,
        clientX: 360,
        clientY: 360,
        bubbles: true,
      })
      await expect(page.getByTestId('contact-context-menu')).toBeVisible({ timeout: 5_000 })
      await page.getByTestId('link-geo-menu-item').dispatchEvent('click')
      await expect(page.getByTestId('contact-context-menu')).toBeHidden({ timeout: 5_000 })

      // --- Unlink: right-click again → "Unlink from geology" now appears. ---
      // The coupling commits server-side then refetches into the strip's
      // isCoupledToGeo, which the menu reads at open time with no signal to
      // await. A fixed delay is racy under full-suite load, so RETRY opening
      // the menu until Unlink shows (the refetch has landed) — re-dispatching
      // contextmenu re-reads the now-coupled state each attempt.
      await expect(strip).toBeVisible({ timeout: 10_000 })
      await expect(async () => {
        await page.keyboard.press('Escape').catch(() => {})
        await strip.dispatchEvent('contextmenu', {
          button: 2,
          clientX: 360,
          clientY: 360,
          bubbles: true,
        })
        await expect(page.getByTestId('contact-context-menu')).toBeVisible({ timeout: 2_000 })
        // Coupled now → Unlink is offered (and Link is not).
        await expect(page.getByTestId('unlink-geo-menu-item')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await page.getByTestId('unlink-geo-menu-item').dispatchEvent('click')
      await expect(page.getByTestId('contact-context-menu')).toBeHidden({ timeout: 5_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
