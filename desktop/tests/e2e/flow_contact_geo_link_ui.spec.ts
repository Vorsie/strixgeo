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

      // Find the litho contact at depth 2 m to link. It must be SEEDED on
      // Section B (so its drag-strip actually renders — the explicit-content
      // invariant hides un-seeded contacts) and UNCOUPLED. The body's ZAND-cap
      // contact @2 m on a Section-B CPT satisfies this and is coincident with
      // the geo contact at 2 m on the same column. Scoping to Section B's
      // seeded set keeps the pick deterministic even when a full-suite run has
      // littered the model with other contacts at ~2 m on other sections.
      const contactId = await page.evaluate(
        async ([base, pid]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const models: any[] = await (await fetch(`${base}/projects/${pid}/geology/models`)).json()
          const litho = models.find((m: { kind: string }) => m.kind === 'lithostratigraphic')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sections: any[] = await (await fetch(`${base}/projects/${pid}/sections`)).json()
          const sectionB = sections.find(
            (s: { name?: string }) => typeof s.name === 'string' && s.name.includes('Section B'),
          )
          const seeded = new Set<string>(sectionB?.seeded_formation_contact_ids ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts: any[] = await (
            await fetch(`${base}/projects/${pid}/geology/models/${litho.id}/contacts`)
          ).json()
          const c = contacts.find(
            (x: {
              id: string
              depth_top_m: number
              cpt_id?: string
              parent_geo_contact_id?: string | null
            }) =>
              Math.abs(x.depth_top_m - 2) < 0.01 &&
              !!x.cpt_id &&
              seeded.has(x.id) &&
              x.parent_geo_contact_id == null,
          )
          return (c?.id as string) ?? null
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      expect(
        contactId,
        'a Section-B-seeded uncoupled litho contact at depth 2 m must exist (action seed)',
      ).toBeTruthy()

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

      // Right-click the strip at the TOP EDGE of its bounding box (1 px below
      // y=box.y). The classification-follows-the-test feature (2026-06-08)
      // renders ALL in-corridor contacts per section — a Robertson-segmented
      // strip created by an earlier spec at depth ~2.5 m (closer to the
      // surface in TAW elevation) may overlap bk4's strip. The bk4 strip is
      // the UPPER element (shallower depth → higher on the y-axis); clicking at
      // box.y + 1 px (top edge) hits the non-overlapping zone.  A native mouse
      // event is required because after the link commits and React re-renders
      // the strip, dispatchEvent('contextmenu') no longer reaches the updated
      // React fiber's onContextMenu handler (the replacement DOM node has a
      // fresh fiber that the synthetic-event path misses).
      const rightClickStrip = async (): Promise<void> => {
        const box = await strip.boundingBox()
        if (!box) throw new Error('contact drag-strip has no bounding box')
        await page.mouse.click(box.x + box.width / 2, box.y + 1, { button: 'right' })
      }

      // --- Link: right-click → "Link to geology" (uncoupled → coupled). ---
      await rightClickStrip()
      await expect(page.getByTestId('contact-context-menu')).toBeVisible({ timeout: 5_000 })
      // Use native .click() on the menu item — dispatchEvent('click') is a
      // synthetic event that may not trigger React's event handler in Electron.
      await page.getByTestId('link-geo-menu-item').click()
      await expect(page.getByTestId('contact-context-menu')).toBeHidden({ timeout: 5_000 })

      // --- Unlink: right-click again → "Unlink from geology" now appears. ---
      // The link commits server-side, then refetchLithoContacts updates the
      // strip's coupled state, which the menu reads at open time. Retry
      // re-opening (Esc to clear any stale menu, native right-click) until
      // Unlink shows — covers the async refetch landing.
      await expect(strip).toBeVisible({ timeout: 10_000 })
      await expect(async () => {
        await page.keyboard.press('Escape').catch(() => {})
        await rightClickStrip()
        await expect(page.getByTestId('contact-context-menu')).toBeVisible({ timeout: 2_000 })
        // Coupled now → Unlink is offered (and Link is not).
        await expect(page.getByTestId('unlink-geo-menu-item')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await page.getByTestId('unlink-geo-menu-item').click()
      await expect(page.getByTestId('contact-context-menu')).toBeHidden({ timeout: 5_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
