/**
 * Flow — Section scrub-bar bounds track the RENDERED (warp-effective) extent,
 * not the raw projected along (scrub over-scroll fix, dogfeed 2026-06-06).
 *
 * The bug: at low ``column_spacing`` the columns pack left (each column's
 * rendered ``nudgedX`` lands left of ``xToScreen(rawAlong)``), but the scrub
 * bar's outer bounds were computed from the raw ``proj.along`` of the extreme
 * columns. Raw along is spacing-INVARIANT, so the scrub track kept spanning the
 * full ``[leftmost.along, rightmost.along]`` range even when the columns had
 * packed into a fraction of it — letting the handle pan the viewport far past
 * the packed columns into empty space on the right.
 *
 * The fix maps each column's rendered ``nudgedX`` back through
 * ``screenXToAlong`` to its warp-effective along and bounds the track to THOSE
 * extremes (see ``utils/scrubBounds.ts`` + ``computeScrubBounds``).
 *
 * What this asserts end to end, against the seeded fixture's Section A
 * (CPTs 0/1/2 at along ≈ 100 / 250 / 400 m on a 500 m E–W line):
 *   - At ``column_spacing = 1.0`` the columns sit at their true projected
 *     along, so the right-end bound reads ≈ 400 m (the rightmost CPT's along).
 *   - At ``column_spacing = 0.0`` (fully packed) the columns pack left, so the
 *     right-end bound shrinks well below that.
 * Under the OLD raw-along code these two reads were IDENTICAL (the bug); the
 * gap between them is exactly the behaviour the fix introduces — the scrub can
 * no longer pan past the rendered rightmost column.
 *
 * Prerequisites (same as the whole harness): FastAPI on :8765, Postgres on
 * :5433 (``groundmodel_integration``), and ``build_synthetic_fixture.py``
 * already run so ``E2E_FIXTURE_PROJECT_ID`` is set.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import { listSectionsByProject } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_section_scrub_bounds', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  let sectionAId: string | null = null

  test.beforeAll(async () => {
    // Section A is display_order = 0 (southern transect through CPTs 0/1/2).
    const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
    const sectionA = sections.sort((a, b) => a.display_order - b.display_order)[0]
    if (!sectionA) throw new Error('flow_section_scrub_bounds: Section A not found in fixture')
    sectionAId = sectionA.id
  })

  test.afterAll(async () => {
    // Restore Section A's spacing so the shared fixture stays at the default.
    if (sectionAId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionAId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_state: { column_spacing: 1.0 } }),
      }).catch(() => {
        /* fixture cleanup failure is non-fatal */
      })
    }
  })

  /**
   * Set Section A's ``column_spacing`` in the DB, open the project fresh, select
   * Section A, and read the rounded right-end (max) scrub-bound label in metres.
   *
   * A fresh open is used per spacing because the renderer seeds ``columnSpacing``
   * from the section's persisted ``view_state`` on mount — patching the DB after
   * open would not re-render. The PATCH therefore precedes ``openFixtureProject``
   * so the fetched bundle (and the .strix it writes) carries the spacing.
   */
  async function readScrubMaxAtSpacing(spacing: number): Promise<number> {
    // Persist the spacing BEFORE the app opens (shallow-merge PATCH semantics).
    const patchStatus = await fetch(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionAId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_state: { column_spacing: spacing } }),
      },
    ).then(r => r.status)
    expect(patchStatus, `PATCH column_spacing=${spacing} should succeed`).toBe(200)

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')

      const sectionRow = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section A' })
        .first()
      await expect(sectionRow).toBeVisible({ timeout: 10_000 })
      await sectionRow.click()

      // The scrub bar mounts at the bottom of the section canvas once the
      // columns are placed (Section A has three CPTs with series).
      const maxLabel = page.getByTestId('section-scrub-max-label')
      await expect(maxLabel).toBeVisible({ timeout: 20_000 })
      const text = (await maxLabel.textContent()) ?? ''
      const match = text.match(/-?\d+/)
      expect(match, `scrub max-label "${text}" should contain a number`).toBeTruthy()
      return parseInt(match![0], 10)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  }

  test('scrub right-end bound follows the packed (warp-effective) extent, not the raw along', async () => {
    // Baseline: at full spacing the rightmost column sits at its true along
    // (~400 m on the 500 m Section A line), so the bound reads the real extent.
    const fullSpacingMax = await readScrubMaxAtSpacing(1.0)
    expect(
      fullSpacingMax,
      'at column_spacing=1 the right bound should read the real rightmost along (~400 m)',
    ).toBeGreaterThan(300)

    // Fully packed: the columns pack left, so the warp-effective rightmost along
    // — and therefore the scrub bound — shrinks well below the raw extent. Under
    // the old raw-along code this would equal fullSpacingMax (raw along is
    // spacing-invariant); the gap is the fix.
    const packedSpacingMax = await readScrubMaxAtSpacing(0.0)
    expect(
      packedSpacingMax,
      `packed bound (${packedSpacingMax} m) must shrink below the full-spacing bound ` +
        `(${fullSpacingMax} m) — otherwise the scrub still over-scrolls past the packed columns`,
    ).toBeLessThan(fullSpacingMax - 50)
  })
})
