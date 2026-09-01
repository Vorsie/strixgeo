/**
 * Flow — the "Separate" verb + its Rejoin (debt #278 R5, owner ruling 2026-08-31).
 *
 * Drives the whole gesture on Section B's two seeded bodies (a KLEI unit over a
 * ZAND unit, each correlated across CPT-3/4/5 → two distinct resolver bodies):
 *
 *   right-click body A → "Separate from…" (ARMS) → the hint chip appears →
 *   left-click body B's region → success toast → re-open body A's menu →
 *   "Rejoin with …" is now offered → click it → the separation is lifted.
 *
 * WHY assert on the toast + the Rejoin item rather than on geometry: KLEI and
 * ZAND are different lithologies, so the resolver would never merge them anyway;
 * the durable, fixture-independent proof that the separation was recorded is
 * that the body menu now offers to Rejoin it, and that the item is gone after
 * the Rejoin. A future fixture with two masses the resolver WOULD merge can
 * tighten this to a geometry re-merge assertion.
 *
 * Dead ends this spec deliberately avoids (memory + flow_body_actions_ui):
 *   * ``body-context-menu`` is DUPLICATED by the chip menu — select via the
 *     ITEM testids (``body-ctx-*``) only, never the container.
 *   * waiting on ``cursor: context-menu`` no longer proves the body list landed
 *     (the stats jump gives that cursor too) — so RETRY the right-click until a
 *     body-menu ITEM (``body-ctx-separate-body``) is visible.
 *   * the SVG-portalled menu fails Playwright's actionability check — DISPATCH
 *     the click/contextmenu events rather than ``.click()``.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page, type Locator } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Open the project, go to Section B (the seeded bodies), switch to the litho axis. */
async function openBodySection(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const sectionB = page
    .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
    .filter({ hasText: 'Section B' })
    .first()
  await expect(sectionB).toBeVisible({ timeout: 10_000 })
  await sectionB.click()
  await page.getByRole('radio', { name: 'Litho' }).click()
}

/** Ensure "Fill bands" is ON so PartitionFillOverlay renders ``partition-region-*``. */
async function enableFillBands(page: Page): Promise<void> {
  const bodiesDropdown = page.getByTestId('litho-bodies-dropdown')
  await expect(bodiesDropdown).toBeEnabled({ timeout: 30_000 })
  const fillBands = page.getByTestId('litho-fill-bands')
  await expect(async () => {
    await bodiesDropdown.click()
    await expect(fillBands).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const currentLabel = await fillBands.textContent().catch(() => '')
  if (currentLabel?.includes('Fill bands')) {
    await fillBands.click()
  } else {
    // Already ON — close by toggling the trigger, never Escape (SectionPanel's
    // document Escape handler would deselect the section).
    await bodiesDropdown.click()
  }
}

/**
 * The two distinct body regions on the section, as locators.
 *
 * Reads every ``partition-region-<bodyId>`` testid, drops the fallback
 * ``-nobody`` paint, and returns the first two DIFFERENT body ids' regions —
 * Section B's KLEI and ZAND bodies. Retried via ``toPass`` because the roster
 * (and thus the region body ids) only settles once the body list has landed.
 */
async function twoDistinctBodyRegions(page: Page): Promise<{ a: Locator; b: Locator }> {
  let idA = ''
  let idB = ''
  await expect(async () => {
    const testids = await page
      .locator('[data-testid^="partition-region-"]')
      .evaluateAll(els =>
        els
          .map(el => el.getAttribute('data-testid') ?? '')
          .filter(t => t.startsWith('partition-region-') && !t.endsWith('-nobody')),
      )
    const distinct = Array.from(new Set(testids))
    expect(distinct.length).toBeGreaterThanOrEqual(2)
    idA = distinct[0]
    idB = distinct[1]
  }).toPass({ timeout: 30_000 })
  return {
    a: page.locator(`[data-testid="${idA}"]`).first(),
    b: page.locator(`[data-testid="${idB}"]`).first(),
  }
}

/**
 * Right-click ``region`` and wait until the BODY menu's "Separate from…" item
 * is visible — the only signal that the body list has landed (the stats menu
 * offers no such item).
 */
async function openBodyMenuOn(page: Page, region: Locator): Promise<void> {
  await expect(region).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await region.dispatchEvent('contextmenu', {
      button: 2,
      clientX: 360,
      clientY: 360,
      bubbles: true,
    })
    await expect(page.getByTestId('body-ctx-separate-body')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

test.describe('flow_separate_body_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('Separate two bodies, then Rejoin them', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)
      await enableFillBands(page)

      const { a: bodyA, b: bodyB } = await twoDistinctBodyRegions(page)

      // ARM: right-click body A → "Separate from…" (dispatch — SVG-portalled menu).
      await openBodyMenuOn(page, bodyA)
      await page.getByTestId('body-ctx-separate-body').dispatchEvent('click')

      // The hint chip confirms the arm is live and the regions are now clickable.
      await expect(page.getByTestId('separate-arm-hint')).toBeVisible({ timeout: 5_000 })

      // COMMIT: left-click body B's region → the pick resolves a distinct body.
      await bodyB.dispatchEvent('click', { bubbles: true })

      // Success toast fires, and the arm chip clears (commit disarms).
      await expect(page.getByText('Bodies separated', { exact: false })).toBeVisible({
        timeout: 5_000,
      })
      await expect(page.getByTestId('separate-arm-hint')).toBeHidden({ timeout: 10_000 })

      // The separation is now durable: re-opening body A's menu offers to Rejoin.
      await openBodyMenuOn(page, bodyA)
      const rejoinItem = page.locator('[data-testid^="body-ctx-rejoin-body-"]').first()
      await expect(rejoinItem).toBeVisible({ timeout: 10_000 })

      // REJOIN: lift the separation.
      await rejoinItem.dispatchEvent('click')
      await expect(page.getByText('Separation lifted', { exact: false })).toBeVisible({
        timeout: 5_000,
      })

      // And the Rejoin option is gone once the roster refetches — the bodies may
      // rejoin again. Re-open the menu and assert no Rejoin item remains.
      await openBodyMenuOn(page, bodyA)
      await expect(page.locator('[data-testid^="body-ctx-rejoin-body-"]')).toHaveCount(0, {
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
