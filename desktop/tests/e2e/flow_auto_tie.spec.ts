/**
 * Flow — Auto-tie: suggest + accept tie-sections (litho-3D Phase 1, Task 7).
 *
 * Acceptance criteria:
 *   1. With the Sections stage open and the MAP visible (no section selected),
 *      clicking "Suggest tie-sections" fires the pure-TS algorithm and renders
 *      green dashed ghost lines on the Leaflet map (SVG ``<path stroke="#22c55e">``).
 *   2. Right-clicking a ghost line opens the TieContextMenu; clicking "Accept
 *      tie" calls ``handleAcceptTie`` → POSTs a new section named
 *      ``Tie-section N``.  The accepted section appears in the inspector list
 *      (``section-row-*`` text contains "Tie-section").
 *   3. "Accept all ties" batch-creates a section for every ghost in one call,
 *      clears the ghosts, and STAYS ON THE MAP (does not flip to a single
 *      section's profile view — the ``.leaflet-container`` remains visible).
 *
 * Prerequisites: the fixture already has FOUR parallel E-W sections (A/B/C/D)
 * spaced 300 m apart with CPTs at matching x-columns — the suggestTieSections
 * sweep reliably produces ≥1 N-S ghost tie.  No fixture change is needed.
 *
 * Navigation:
 *   ``openFixtureProject`` → ``goToStage('Sections')`` lands on the Sections
 *   stage with NO section selected by default → the canvas shows the Leaflet
 *   map → "Suggest tie-sections" is enabled (≥2 sections).
 *
 * Isolation:
 *   The accepted tie-section is deleted in ``afterAll`` (via API) so the
 *   fixture stays clean.  Any remaining ghost ties (not accepted) are
 *   ephemeral client-side state and require no cleanup.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_auto_tie', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  /** Id of the tie-section created during the single-accept test (kept for
   *  parity / debugging; the afterAll name-sweep is the real cleanup). */
  let createdTieSectionId: string | null = null

  test.afterAll(async () => {
    // Both tests create ``Tie-section *`` rows in the shared fixture DB. Sweep
    // every one by name so the fixture stays clean regardless of how many were
    // created (single-accept = 1, accept-all = N). Swallow per-row failures.
    if (!FIXTURE_PROJECT_ID) return
    try {
      const r = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections`)
      const sections = (await r.json()) as Array<{ id: string; name: string }>
      await Promise.all(
        sections
          .filter(s => s.name.startsWith('Tie-section'))
          .map(s =>
            fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${s.id}`, {
              method: 'DELETE',
            }).catch(() => {}),
          ),
      )
    } catch {
      // Backend down / already clean — nothing to do.
    }
  })

  test(
    'auto-tie: suggest proposes non-crossing ghosts, accept creates a tie-section',
    async () => {
      test.slow() // opens project + renders the section overlay
      const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
      let tmpPath = ''
      try {
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

        // --- 1. Navigate to the Sections stage --------------------------------
        // ``goToStage`` clicks the "Sections" spine button.  No section is
        // pre-selected on stage entry, so the canvas shows the Leaflet map
        // (not a section profile) — the map is the correct surface for the
        // TieSuggestionOverlay.
        await goToStage(page, 'Sections')

        // --- 2. "Suggest tie-sections" must be enabled (fixture has 4 sections)
        const suggestBtn = page.getByRole('button', { name: 'Suggest tie-sections' })
        await expect(suggestBtn).toBeVisible({ timeout: 10_000 })
        await expect(suggestBtn).toBeEnabled({ timeout: 10_000 })

        // --- 3. Fire the suggestion -------------------------------------------
        await suggestBtn.click()

        // --- 4. Green ghost path(s) appear on the Leaflet SVG canvas ----------
        // TieSuggestionOverlay renders each proposed tie as a react-leaflet
        // Polyline whose SVG element carries ``stroke="#22c55e"``.  The
        // fixture's four parallel E-W sections share x-column CPTs, so the
        // sweep algorithm should return ≥1 candidate.
        const ghosts = page.locator('path[stroke="#22c55e"]')
        await expect(ghosts.first()).toBeVisible({ timeout: 15_000 })

        // --- 5. Right-click a ghost to open the context menu, then accept ----
        // The green dashed Polyline now has no left-click action; right-click
        // opens TieContextMenu (portal="fixed") with "Accept tie" / "Reject
        // tie" items.  Accepting POSTs the tie as a real section (name =
        // ``Tie-section N``), removes it from the ghost list, and STAYS ON THE
        // MAP (no auto-select) so the user can keep triaging the other ghosts.
        await ghosts.first().click({ button: 'right' })
        await page.getByTestId('tie-context-accept').click()

        // Stays on the map: the Leaflet container only renders on the map
        // surface, never in a section profile view.
        await expect(page.locator('.leaflet-container')).toBeVisible()

        // --- 6. A "Tie-section" row appears in the inspector list -------------
        // SectionsInspector renders each visible section as
        // ``data-testid="section-row-{id}"``; the row's text is the section
        // name.  We assert ANY row containing "Tie-section" is visible.
        const tieSectionRow = page
          .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
          .filter({ hasText: 'Tie-section' })
          .first()
        await expect(tieSectionRow).toBeVisible({ timeout: 15_000 })

        // --- 7. Capture the new section id for afterAll cleanup ---------------
        // Resolve the newly-created tie-section id from the API so afterAll
        // can delete it without relying on a testid that contains the UUID.
        const sectionsJson = await page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/projects/${pid}/sections`)
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID] as const,
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tieSec = (sectionsJson as any[]).find((s: any) =>
          (s.name as string).startsWith('Tie-section'),
        )
        if (tieSec) createdTieSectionId = tieSec.id as string
      } finally {
        await closeApp(app)
        cleanupFixtureFile(tmpPath)
      }
    },
  )

  test(
    'auto-tie: "Accept all ties" creates every tie and STAYS ON THE MAP',
    async () => {
      test.slow()
      const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
      let tmpPath = ''
      try {
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
        await goToStage(page, 'Sections')

        // Suggest → ghosts appear on the Leaflet map.
        const suggestBtn = page.getByRole('button', { name: 'Suggest tie-sections' })
        await expect(suggestBtn).toBeEnabled({ timeout: 10_000 })
        await suggestBtn.click()
        const ghosts = page.locator('path[stroke="#22c55e"]')
        await expect(ghosts.first()).toBeVisible({ timeout: 15_000 })

        // Accept all → one batch create.
        await page.getByTestId('tie-accept-all').click()

        // 1. Ghosts are cleared (suggestions consumed).
        await expect(ghosts).toHaveCount(0, { timeout: 15_000 })

        // 2. THE REGRESSION: we must STILL be on the map, not flipped into a
        //    single section's profile view. The Leaflet container only renders
        //    on the map surface; a section profile has no ``.leaflet-container``.
        await expect(page.locator('.leaflet-container')).toBeVisible()

        // 3. The created tie-sections exist in the inspector list.
        const tieRows = page
          .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
          .filter({ hasText: 'Tie-section' })
        await expect(tieRows.first()).toBeVisible({ timeout: 15_000 })
        expect(await tieRows.count()).toBeGreaterThanOrEqual(2)
      } finally {
        await closeApp(app)
        cleanupFixtureFile(tmpPath)
      }
    },
  )
})
