/**
 * Flow — body context-menu ACTIONS (debt #130 action-coverage convention).
 *
 * Drives the body menu's Dissolve action on the fixture's pre-seeded body
 * (Section B): DESTRUCTIVE — drive to the native confirm and CANCEL, so the
 * gesture + confirm are exercised without mutating the shared fixture.
 *
 * This is the template for ACTION specs (debt #130): exercise the gesture all
 * the way to its effect; for irreversible actions, assert the confirmation
 * fires and Cancel rather than committing, so the spec is order-independent and
 * never corrupts the shared seeded fixture. The commit path of destructive
 * actions is covered by integration tests at the API/use-case layer.
 *
 * The body is seeded by build_synthetic_fixture.py on Section B — a KLEI unit
 * correlated SAME-lithology across CPT-3/4/5, which ``ResolveLithoInstances``
 * resolves to one body and PartitionFillOverlay renders as ``partition-region-*``.
 * (Body extent claim/clear was retired 2026-06-06 — the partition fill owns
 * body shape; those menu items + their specs are gone.)
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Open the project, go to Section B (the seeded body), switch to the litho axis. */
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

/**
 * Ensure the "Fill bands" toggle is ON so PartitionFillOverlay renders
 * ``partition-region-*`` elements.
 *
 * Idempotent: checks the current label ("Fill bands" = OFF → click; "Hide bands"
 * = already ON → skip). Uses ``toPass`` to retry opening the dropdown until the
 * item is visible.
 */
async function enableFillBands(page: Page): Promise<void> {
  const bodiesDropdown = page.getByTestId('litho-bodies-dropdown')
  await expect(bodiesDropdown).toBeEnabled({ timeout: 30_000 })
  const fillBands = page.getByTestId('litho-fill-bands')

  // Open dropdown to read the current label.
  await expect(async () => {
    await bodiesDropdown.click()
    await expect(fillBands).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  // Only click if currently OFF ("Fill bands"); if already ON ("Hide bands"), skip.
  const currentLabel = await fillBands.textContent().catch(() => '')
  if (currentLabel?.includes('Fill bands')) {
    // Was OFF → click turns it ON (and closes the dropdown).
    await fillBands.click()
  } else {
    // Already ON — close the dropdown by TOGGLING THE TRIGGER, never Escape
    // (SectionPanel's document Escape handler would deselect the section).
    await bodiesDropdown.click()
  }
}

/** Enable fill bands, right-click the first partition region, and wait for its context menu. */
async function openBodyMenu(page: Page): Promise<void> {
  // PartitionFillOverlay renders ``partition-region-*`` paths when showBands is
  // ON; each fires onBodyContextMenu on right-click when the body has a bodyId.
  await enableFillBands(page)
  // The context menu is wired only once the model's BODY LIST has loaded
  // (``interactive = onBodyContextMenu && bodyById.get(region.bodyId)``, and
  // the list arrives as ``bodies={lenses}``). Dispatching before it lands means
  // the event hits a region the overlay has not armed, and the menu can never
  // open — the historic "body-detection" flake was THIS race.
  //
  // WAITING ON ``cursor: context-menu`` NO LONGER PROVES THE LIST ARRIVED.
  // Since the unit-statistics jump landed (R2/S7b, 2026-08-27),
  // ``PartitionFillOverlay`` gives that cursor to statistics regions too —
  // ``interactive || statsInteractive`` — while wiring the BODY menu only for
  // the first. So the old guard passed on an un-armed region, the statistics
  // menu answered instead, and the spec waited out its timeout for a body menu
  // that was never coming.
  //
  // There is no DOM signal that separates the two, so ask the only question
  // that actually matters: retry the right-click until the BODY menu opens.
  // ``toPass`` bounds it, and the body list landing is what makes it succeed.
  const partitionRegion = page
    .locator('[data-testid^="partition-region-"][style*="context-menu"]')
    .first()
  await expect(partitionRegion).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await partitionRegion.dispatchEvent('contextmenu', {
      button: 2,
      clientX: 360,
      clientY: 360,
      bubbles: true,
    })
    await expect(page.getByTestId('body-context-menu')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

test.describe('flow_body_actions_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('Dissolve body — confirmation fires, Cancel keeps the body', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)

      // Cancel the native confirm so the body is NOT removed (order-independent).
      let confirmFired = false
      page.on('dialog', dialog => {
        confirmFired = true
        void dialog.dismiss()
      })

      await openBodyMenu(page)
      // DISPATCHED, not ``.click()``. The menu is portalled into the SVG, and a
      // real click fails Playwright's actionability check — the item is visible
      // (the failure screenshot shows the whole menu) but something above it
      // owns the hit test. Dispatching matches how this spec already delivers
      // the right-click that opens the menu, and keeps the assertion about the
      // ACTION rather than about hit-testing.
      const dissolve = page.getByTestId('body-ctx-dissolve-body')
      await expect(dissolve).toBeVisible({ timeout: 5_000 })
      await dissolve.dispatchEvent('click')

      // The confirm dialog fired (gesture reached it) and — dismissed — the
      // body survives (partition region still present).
      await expect.poll(() => confirmFired, { timeout: 5_000 }).toBe(true)
      await expect(page.locator('[data-testid^="partition-region-"]').first()).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
