/**
 * Flow — body context-menu ACTIONS (debt #130 action-coverage convention).
 *
 * Drives the body menu's actions on the fixture's pre-seeded body (Section B):
 *   1. Dissolve body — DESTRUCTIVE: drive to the native confirm and CANCEL, so
 *      the gesture+confirm are exercised without mutating the shared fixture.
 *   2. Claim a body extent — set the right side to "open" via the side submenu.
 *
 * This is the template for ACTION specs (debt #130): exercise the gesture all
 * the way to its effect; for irreversible actions, assert the confirmation
 * fires and Cancel rather than committing, so the spec is order-independent and
 * never corrupts the shared seeded fixture. The commit path of destructive
 * actions is covered by integration tests at the API/use-case layer.
 *
 * Self-contained — the body is seeded by build_synthetic_fixture.py on Section B.
 *
 * Retargeted 2026-06-05 from ``body-extent-fill-*`` (BodyExtentOverlay) to
 * ``partition-region-*`` (PartitionFillOverlay) — BodyExtentOverlay was disabled
 * behind SHOW_LEGACY_BODY_EXTENT=false in the partition-fill rewrite.  The
 * partition fill only renders regions when "Fill bands" is ON, so each test now
 * enables the fill first before right-clicking the region.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  openFixtureProject,
  goToStage,
  cleanupFixtureFile,
  detectBodiesForFixture,
} from './helpers/project_open'

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
 * item is visible. The idempotent check prevents the toggle-OFF bug when a prior
 * test in the same spec already enabled it.
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
    // Already ON — close the dropdown by TOGGLING THE TRIGGER, never Escape.
    // SectionPanel's document-level Escape handler peels the section view and,
    // with no menu/focus open, hits its final branch — DESELECT the section,
    // which unmounts the profile and every ``partition-region-*`` element.
    // That was the root cause of the test-3 flake: it is the only test that
    // re-enters openBodyMenu with bands already ON, so the only one that
    // reached this branch; the stray Escape closed the whole section.
    await bodiesDropdown.click()
  }
}

/** Enable fill bands, right-click the first partition region, and wait for its context menu. */
async function openBodyMenu(page: Page): Promise<void> {
  // The partition fill (PartitionFillOverlay) renders ``partition-region-*``
  // paths when showBands is ON; each path fires onBodyContextMenu on right-click
  // when the body has a known bodyId.
  await enableFillBands(page)
  const partitionRegion = page.locator('[data-testid^="partition-region-"]').first()
  // Use a longer timeout: after a ClaimBodyExtent API call the frontend
  // refetches bodies/layers which can briefly remove regions from the DOM.
  await expect(partitionRegion).toBeVisible({ timeout: 30_000 })
  await partitionRegion.dispatchEvent('contextmenu', {
    button: 2,
    clientX: 360,
    clientY: 360,
    bubbles: true,
  })
  await expect(page.getByTestId('body-context-menu')).toBeVisible({ timeout: 5_000 })
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
      // Re-stamp the seeded body's detector extents BEFORE opening the project —
      // a sibling spec's model-wide auto-correlate + accept on the shared fixture
      // DB recreates body rows without extents (ordinal shift), so the body wedge
      // would not render. Running detect before the open means the section render
      // fetches the already-corrected bodies. Idempotent on a fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)

      // Cancel the native confirm so the body is NOT removed (order-independent).
      let confirmFired = false
      page.on('dialog', dialog => {
        confirmFired = true
        void dialog.dismiss()
      })

      await openBodyMenu(page)
      await page.getByTestId('body-ctx-dissolve-body').click()

      // The confirm dialog fired (gesture reached it) and — dismissed — the
      // body survives (partition region still present).
      await expect.poll(() => confirmFired, { timeout: 5_000 }).toBe(true)
      await expect(page.locator('[data-testid^="partition-region-"]').first()).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('Claim a body extent — set the right side to "open" via the submenu', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Re-stamp the seeded body's detector extents BEFORE opening the project —
      // a sibling spec's model-wide auto-correlate + accept on the shared fixture
      // DB recreates body rows without extents (ordinal shift), so the body wedge
      // would not render. Running detect before the open means the section render
      // fetches the already-corrected bodies. Idempotent on a fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)
      await openBodyMenu(page)

      // Reveal the right-extent submenu and claim the "open" kind. dispatchEvent
      // (no pointer movement) avoids the hover-open / click-toggle race: a real
      // click hovers first (onMouseEnter opens) then toggles (onClick closes),
      // and the panel sits outside the parent's box so hovering to it closes it.
      await page.getByTestId('body-ctx-side-right').dispatchEvent('click')
      await page.getByTestId('body-ctx-claim-right-open').dispatchEvent('click')

      // The claim commits without error; the partition region still renders.
      await expect(page.locator('[data-testid^="partition-region-"]').first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('Clear a claimed body extent — claim then Clear extent', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Re-stamp the seeded body's detector extents BEFORE opening the project —
      // a sibling spec's model-wide auto-correlate + accept on the shared fixture
      // DB recreates body rows without extents (ordinal shift), so the body wedge
      // would not render. Running detect before the open means the section render
      // fetches the already-corrected bodies. Idempotent on a fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openBodySection(page)

      // Claim the right side first (the detector-set extent has no Clear row;
      // Clear only appears once the side is USER-claimed).
      await openBodyMenu(page)
      await page.getByTestId('body-ctx-side-right').dispatchEvent('click')
      await page.getByTestId('body-ctx-claim-right-open').dispatchEvent('click')

      // Re-open the menu → the right submenu now offers "Clear extent".
      await openBodyMenu(page)
      await page.getByTestId('body-ctx-side-right').dispatchEvent('click')
      await page.getByTestId('body-ctx-clear-right').dispatchEvent('click')

      // The body survives the clear (partition region still present).
      await expect(page.locator('[data-testid^="partition-region-"]').first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
