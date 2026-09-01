/**
 * Flow — the "Separate" verb + its Rejoin (debt #278 R5, owner ruling 2026-08-31).
 *
 * Drives the whole gesture on Section B's CROSS-SOIL bodies (a KLEI unit over a
 * ZAND unit): right-click body A → "Separate from…" (ARMS) → the hint chip
 * appears → left-click body B's region → success toast → re-open the menu →
 * "Rejoin with …" is now offered → click it → the separation is lifted.
 *
 * WHY CROSS-SOIL, not "the first two distinct bodies": tonight's identity work
 * (class-keyed + framed evidence) MERGES touching SAME-soil bodies on the
 * debounced recompute — two same-soil regions welded into one, so a click on the
 * "other" one correctly took the same-body advisory path and never POSTed. Two
 * DIFFERENT-soil regions (different fill colours) never weld, so the Separate
 * between them stays a legal, distinct pick across every recompute.
 *
 * WHY the gesture is wrapped in ``toPass``: the project-open identity recompute
 * is debounced and can land mid-gesture (it did, in the first run). The retry
 * re-resolves fresh regions and re-drives each attempt, so whenever the
 * recompute fires the next attempt runs against stable ids. Separate is
 * idempotent server-side (a duplicate pair answers 200), so a retry is safe.
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

/** The body-region hit paths, as ``{ testid, fill }`` — filters strokes + fallback paint. */
async function bodyRegions(page: Page): Promise<{ testid: string; fill: string }[]> {
  return page.locator('[data-testid^="partition-region-"]').evaluateAll(els =>
    els
      .map(el => ({
        testid: el.getAttribute('data-testid') ?? '',
        fill: el.getAttribute('fill') ?? '',
      }))
      .filter(
        r =>
          r.testid.startsWith('partition-region-') &&
          !r.testid.includes('-stroke-') &&
          !r.testid.endsWith('-nobody'),
      ),
  )
}

/**
 * Two body regions of DIFFERENT fill colour — i.e. different soils, which never
 * weld. Retried until at least two colours are on screen (the roster settling).
 * Returns them as locators keyed by their live testid.
 */
async function twoCrossSoilRegions(page: Page): Promise<{ a: Locator; b: Locator }> {
  let idA = ''
  let idB = ''
  await expect(async () => {
    const regions = await bodyRegions(page)
    // First region of each of the first two DISTINCT fill colours.
    const byColour = new Map<string, string>()
    for (const r of regions) if (!byColour.has(r.fill)) byColour.set(r.fill, r.testid)
    const colours = [...byColour.values()]
    expect(colours.length, 'need two different-soil regions on the section').toBeGreaterThanOrEqual(2)
    idA = colours[0]
    idB = colours[1]
  }).toPass({ timeout: 30_000 })
  return {
    a: page.locator(`[data-testid="${idA}"]`).first(),
    b: page.locator(`[data-testid="${idB}"]`).first(),
  }
}

/**
 * Right-click ``region`` and wait until the BODY menu's "Separate from…" item is
 * visible — the only signal that the body list has landed (the stats menu offers
 * no such item, and ``bodiesLoaded`` withholds the body menu across a recompute).
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

  test('Separate two cross-soil bodies, then Rejoin them', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)
      await enableFillBands(page)

      // ARM + COMMIT, retried so a debounced recompute landing mid-gesture is
      // absorbed: each attempt re-resolves fresh cross-soil regions (ids can
      // shift on a merge), arms body A, and clicks body B. Cross-soil means the
      // pick is never the same body; the retry only covers the timing.
      await expect(async () => {
        const { a: bodyA, b: bodyB } = await twoCrossSoilRegions(page)
        await openBodyMenuOn(page, bodyA)
        await page.getByTestId('body-ctx-separate-body').dispatchEvent('click')
        await expect(page.getByTestId('separate-arm-hint')).toBeVisible({ timeout: 3_000 })
        await bodyB.dispatchEvent('click', { bubbles: true })
        await expect(page.getByText('Bodies separated', { exact: false })).toBeVisible({
          timeout: 3_000,
        })
      }).toPass({ timeout: 90_000 })

      // The arm clears on commit.
      await expect(page.getByTestId('separate-arm-hint')).toBeHidden({ timeout: 10_000 })

      // The separation is durable: a body's menu now offers to Rejoin. Retried
      // because the post-commit recompute re-shuffles the region ids.
      await expect(async () => {
        const { a: bodyA } = await twoCrossSoilRegions(page)
        await openBodyMenuOn(page, bodyA)
        await expect(page.locator('[data-testid^="body-ctx-rejoin-body-"]').first()).toBeVisible({
          timeout: 1_500,
        })
      }).toPass({ timeout: 60_000 })

      // REJOIN: lift the separation, then confirm the Rejoin option is gone.
      await page.locator('[data-testid^="body-ctx-rejoin-body-"]').first().dispatchEvent('click')
      await expect(page.getByText('Separation lifted', { exact: false })).toBeVisible({
        timeout: 5_000,
      })
      await expect(async () => {
        const { a: bodyA } = await twoCrossSoilRegions(page)
        await openBodyMenuOn(page, bodyA)
        await expect(page.locator('[data-testid^="body-ctx-rejoin-body-"]')).toHaveCount(0, {
          timeout: 1_500,
        })
      }).toPass({ timeout: 60_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
