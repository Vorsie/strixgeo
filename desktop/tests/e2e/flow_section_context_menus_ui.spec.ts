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
 *   2. Litho band → "Delete unit" (``litho-band-remove``). Uses
 *      Section B (pre-seeded bilateral body contacts from the fixture) so
 *      ``per-column-litho-band-{key}`` renders immediately without a build step.
 *   3. Contact strip → contact menu (``contact-context-menu`` with
 *      "Delete contact" + the open-end items). Also uses Section B for the
 *      same reason — ``contact-drag-strip`` renders from fixture contacts.
 *   4. Body wedge → body menu (``body-context-menu``). This is the
 *      "name body hits a dead end" surface the owner reported. Needs a
 *      detected body: uses the pre-seeded bilateral body on Section B with
 *      Fill bands ON, then right-clicks ``partition-region-{bodyId}``
 *      (PartitionFillOverlay, retargeted 2026-06-05 from ``body-extent-fill-*``
 *      which was disabled in the partition-fill rewrite).
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
import {
  openFixtureProject,
  goToStage,
  cleanupFixtureFile,
} from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Select the first section and switch to the litho axis. */
async function enterLithoAxis(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const row = page.locator('[data-testid^="section-row-"]:not([data-testid*="delete"])').first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByRole('radio', { name: 'Litho' }).click()
}

/**
 * Build committed litho contacts via Suggest-new-tests → bulk-confirm → Accept-all-bulk.
 *
 * Uses ``litho-suggest-new-tests`` (section-scoped: only CPTs with NO existing
 * litho contacts) rather than ``litho-suggest-all`` (model-wide: all CPTs).
 * The model-wide path hits the ``litho_layer_accepted_no_overlap`` constraint
 * when the shared fixture DB has pre-seeded accepted layers on CPTs 3/4/5
 * (body + per-instance scenarios), causing the batch accept to 409 and leaving
 * section A without committed bands. The new-tests path is safe: section A's
 * CPTs (0/1/2) have no pre-seeded contacts, so the batch accept always succeeds.
 */
async function buildLithoContacts(page: Page): Promise<void> {
  // The tests in this file share the fixture DB, so contacts committed by an
  // earlier test persist. If committed bands are already on the section, skip
  // the (slow) rebuild — the right-click targets only need contacts to EXIST.
  // Bands render from contacts that are seeded in the section. When a prior test
  // already accepted contacts for this section, they appear once the litho-layer
  // fetch resolves — wait up to 30 s. 30 s accounts for the full async load
  // (bundle fetch + section fetch + litho layer fetch) after a fresh app open.
  const existing = await page
    .locator('[data-testid^="per-column-litho-band-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  if (existing) return

  // No bands yet — run suggest-new-tests to create contacts for clean CPTs.
  // Wait for the "Suggest all (N)" label with N > 0 first — this proves
  // ``bulkAnchors`` (the section's visible CPTs) has loaded; without this wait
  // ``newTestAnchors`` may be empty (visibleCpts not yet fetched) and the
  // suggest-new-tests click silently does nothing.
  await expect(
    page.getByRole('button', { name: /^Suggest all \(\d+\)$/ }).first(),
  ).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('litho-suggest-caret').click()
  // Wait for the menu item to be visible (portal may take a moment to mount).
  await expect(page.getByTestId('litho-suggest-new-tests')).toBeVisible({ timeout: 3_000 })
  await page.getByTestId('litho-suggest-new-tests').click()

  const acceptBulkAppeared = await page
    .getByTestId('litho-accept-all-bulk')
    .waitFor({ state: 'visible', timeout: 45_000 })
    .then(() => true)
    .catch(() => false)

  if (!acceptBulkAppeared) {
    // Suggest-new-tests produced no ghosts (all CPTs occupied or suggest
    // failed). Bands from DB contacts should be loading — wait one more pass.
    await page
      .locator('[data-testid^="per-column-litho-band-"]')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
    return
  }

  const acceptBulk = page.getByTestId('litho-accept-all-bulk')
  await acceptBulk.click()

  // Dismiss the bulk-ghost overlay FIRST — committed bands are subtracted under
  // the still-present ghosts until "Clear bulk", and clearing also makes the
  // committed contacts/strips the clean top layer for the right-click targets.
  const clearBulk = page.getByRole('button', { name: 'Clear bulk' })
  await expect(clearBulk).toBeVisible({ timeout: 30_000 })
  await clearBulk.click()

  // Committed contacts now render as per-column lithology bands.
  await expect(
    page.locator('[data-testid^="per-column-litho-band-"]').first(),
  ).toBeVisible({ timeout: 30_000 })
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

      // The per-column capture rect renders on the litho axis. Right-click
      // near its BOTTOM edge — below any committed litho bands — so the empty-
      // space "add" menu fires regardless of whether an earlier spec already
      // committed contacts on this shared fixture model (order-independent).
      const capture = page.locator('[data-testid^="per-column-rclick-capture-"]').first()
      await expect(capture).toBeVisible({ timeout: 10_000 })
      const box = await capture.boundingBox()
      if (!box) throw new Error('capture rect has no bounding box')
      await capture.click({
        button: 'right',
        force: true,
        position: { x: box.width / 2, y: box.height - 6 },
      })

      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible()
      await expect(page.getByTestId('litho-band-add')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('litho band right-click → Remove-litho-unit menu', async () => {
    // Retargeted 2026-06-05 to Section B (pre-seeded bilateral body contacts
    // from the fixture) instead of Section A + buildLithoContacts. Section B's
    // fixture contacts are seeded into seeded_formation_contact_ids on load, so
    // per-column-litho-band-* elements render immediately — no suggest flow needed.
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      const band = page.locator('[data-testid^="per-column-litho-band-"]').first()
      await expect(band).toBeVisible({ timeout: 20_000 })
      // dispatchEvent bypasses SVG z-order: a transparent overlay covers the
      // band's centre, so a real right-click lands on the wrong element. The
      // band's onContextMenu reads clientX/clientY to position the menu.
      await band.dispatchEvent('contextmenu', {
        button: 2,
        clientX: 320,
        clientY: 320,
        bubbles: true,
      })

      await expect(page.getByTestId('litho-band-context-menu')).toBeVisible()
      await expect(page.getByTestId('litho-band-remove')).toBeVisible()
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('contact strip right-click → contact menu (delete + open-end)', async () => {
    // Retargeted 2026-06-05 to Section B (pre-seeded bilateral body contacts
    // from the fixture) instead of Section A + buildLithoContacts. Section B's
    // contacts are seeded into seeded_formation_contact_ids, so contact-drag-strip
    // elements render immediately — no suggest flow needed.
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      await page
        .locator('[data-testid="contact-drag-strip"]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
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
    // Retargeted 2026-06-05: BodyExtentOverlay (``body-extent-fill-*``) was
    // disabled behind SHOW_LEGACY_BODY_EXTENT=false in the partition-fill
    // rewrite.  The body context menu is now reached via PartitionFillOverlay's
    // ``partition-region-*`` paths, which only render when "Fill bands" is ON.
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // The fixture seeds a GUARANTEED bilateral body on Section B, so target
      // that section directly rather than building one via auto-correlate on
      // the first section (debt #130: the synthetic geometry there may not
      // close a body — which is why the old build-a-body path skipped). The
      // build→correlate→body pipeline is covered by auto-correlate-and-lenses.
      await goToStage(page, 'Sections')
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      // Enable "Fill bands" so PartitionFillOverlay renders partition-region-*
      // paths. The Bodies dropdown is disabled until the litho model is active;
      // wait for it, then retry opening until the item sticks.
      const bodiesDropdown = page.getByTestId('litho-bodies-dropdown')
      await expect(bodiesDropdown).toBeEnabled({ timeout: 30_000 })
      const fillBands = page.getByTestId('litho-fill-bands')
      await expect(async () => {
        await bodiesDropdown.click()
        await expect(fillBands).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      await fillBands.click()

      // The pre-seeded body renders as a filled partition region —
      // right-click opens its body context menu. RETRY the right-click until a
      // body-menu ITEM is visible (flow_body_actions_ui pattern): the #279
      // arming gate deliberately serves the stats menu until the body roster
      // lands (and re-withholds it while a debounced recompute is in flight),
      // so a single click can legitimately meet the interim menu. Assert on an
      // ITEM testid, never the `body-context-menu` container (duplicated by
      // the chip menu).
      const partitionRegion = page.locator('[data-testid^="partition-region-"]').first()
      await expect(partitionRegion).toBeVisible({ timeout: 20_000 })
      await expect(async () => {
        // dispatchEvent bypasses SVG z-order (overlays cover the region centre).
        await partitionRegion.dispatchEvent('contextmenu', {
          button: 2,
          clientX: 340,
          clientY: 340,
          bubbles: true,
        })
        await expect(page.getByTestId('body-ctx-name-body')).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
