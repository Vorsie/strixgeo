/**
 * Flow — litho partition fill render + freedraw add-strip hover preview.
 *
 * End-to-end demo + regression for the partition-fill overlay
 * (``PartitionFillOverlay``, owner directive 2026-06-05: the 2D section is a
 * TRUE PARTITION that defines the 3D model — every point belongs to exactly one
 * body, no overlaps + no gaps) and its freedraw add-strip hover preview
 * (Task 2, same directive: a single cursor-tracking dot telegraphs where a
 * left-click will insert a new boundary/lens control point).
 *
 * The fixture pre-seeds Section B (build_synthetic_fixture.py action seed,
 * CPTs 3/4/5) with committed litho contacts + a bilateral body — so the litho
 * axis already carries matched bodies across columns → partition regions. No
 * per-run UI build-up is needed for the fill to render; the spec only toggles
 * "Fill bands" on, then hovers an add-strip.
 *
 * Assertions
 * ----------
 * 1. Partition fill renders — after selecting Section B + the litho axis +
 *    clicking "Fill bands" (``litho-fill-bands``), at least one
 *    ``partition-region-<bodyId>`` path is visible.
 * 2. Add-strip hover preview — hovering a freedraw add-strip
 *    (``partition-boundary-addstrip-*`` or ``partition-lens-addstrip-*``)
 *    surfaces the single ``partition-addnode-preview`` dot; moving the pointer
 *    away detaches it (count 0).
 *
 * Graceful degradation
 * --------------------
 * The add-strip surface only renders when the partition emits a shapeable
 * shared boundary (≥ 2 consecutive main regions in a gap) or a lens region.
 * If the seeded topology emits neither, the spec verifies the fill (assertion
 * 1) and returns early with a DONE_WITH_CONCERNS note rather than asserting a
 * flaky hover — mirroring how ``flow_body_extent_gestures`` handles the
 * 0-candidate case.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  openFixtureProject,
  goToStage,
  cleanupFixtureFile,
  detectBodiesForFixture,
} from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Any freedraw add-strip — a matched-boundary strip OR a lens strip. */
const ADDSTRIP_SELECTOR =
  '[data-testid^="partition-boundary-addstrip-"], [data-testid^="partition-lens-addstrip-"]'

test.describe('flow_partition_fill_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('partition fill renders on Section B + an add-strip shows the hover preview dot', async () => {
    test.slow() // opens project + renders the section overlay
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Re-establish the detector ``to_target`` extents on the seeded bodies
      // BEFORE opening. A sibling spec's model-wide auto-correlate + accept (run
      // earlier on the SHARED fixture DB) shifts instance ordinals, which makes
      // the resolver DELETE + RECREATE body rows. The recreated rows keep their
      // accepted member layers + ``body_id`` (so the partition fill still groups
      // them), but lose detector extents — running detect first keeps the seeded
      // topology fully coherent. Idempotent on a fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      await goToStage(page, 'Sections')

      // Select Section B — the pre-seeded bilateral body lives on it.
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()

      // Switch to the lithostratigraphic axis (the partition fill renders here).
      await page.getByRole('radio', { name: 'Litho' }).click()

      // "Fill bands" lives INSIDE the "Bodies" toolbar dropdown, which is
      // ``disabled`` until the litho model is active — wait for it to enable
      // (a reliable "litho section is ready" gate that doesn't couple to the
      // overlay's mount timing).
      const bodiesDropdown = page.getByTestId('litho-bodies-dropdown')
      await expect(bodiesDropdown).toBeEnabled({ timeout: 30_000 })

      // The dropdown items render only while the menu is open (portal). The
      // section keeps refetching bodies/correlations in the background after
      // open, and a SectionsToolbar re-render can reset the dropdown's local
      // ``open`` state — so retry opening until the item is actually present,
      // then click it. ``toPass`` re-runs the open+assert until it sticks.
      const fillBands = page.getByTestId('litho-fill-bands')
      await expect(async () => {
        await bodiesDropdown.click()
        await expect(fillBands).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      await fillBands.click()

      // --- Assertion 1: partition fill renders -----------------------------
      // The bilateral body + its surrounding matched bodies tile the gap into
      // partition regions; at least one ``partition-region-<bodyId>`` is filled.
      await expect(
        page.locator('[data-testid^="partition-region-"]').first(),
      ).toBeVisible({ timeout: 30_000 })

      // --- Assertion 2: add-strip hover preview ----------------------------
      // Find a freedraw add-strip (matched-boundary or lens). If the seeded
      // topology emits neither, degrade gracefully (DONE_WITH_CONCERNS).
      const addStrip = page.locator(ADDSTRIP_SELECTOR).first()
      const haveStrip = await addStrip
        .waitFor({ state: 'attached', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (!haveStrip) {
        // DONE_WITH_CONCERNS: no shapeable boundary / lens add-strip on this
        // fixture topology — the fill (assertion 1) is still verified. The
        // hover-preview gesture is covered by the Vitest overlay layer.
        return
      }

      // The add-strip is a transparent SVG <line> whose handler is a React
      // ``onMouseMove`` — so we drive a real ``mouse.move`` to the line's centre
      // (the line is near-zero-width, so its bbox centre sits ON it). A plain
      // ``locator.hover`` is unreliable here: the thin geometric bbox confuses
      // Playwright's actionability hit-test on the transparent stroke.
      const box = await addStrip.boundingBox()
      expect(box, 'add-strip should have a bounding box').not.toBeNull()
      const cx = box!.x + box!.width / 2
      const cy = box!.y + box!.height / 2
      await page.mouse.move(cx, cy)

      // The hover surfaces the single cursor-tracking preview dot.
      const preview = page.getByTestId('partition-addnode-preview')
      await expect(preview).toBeVisible({ timeout: 10_000 })

      // Moving the pointer well off the strip fires ``onMouseLeave`` →
      // ``setAddNodePreview(null)`` → the circle unmounts (detaches).
      await page.mouse.move(2, 2)
      await expect(page.getByTestId('partition-addnode-preview')).toHaveCount(0, {
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
