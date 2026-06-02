/**
 * Flow — Sections toolbar UI surface (template spec, debt #130).
 *
 * This is the *template* for the exhaustive per-stage UI coverage the owner
 * asked for ("every option and every pane and every button tested"). It is
 * the first spec that actually drives a project *into the shell* and exercises
 * a live toolbar — made possible by ``helpers/project_open.ts``.
 *
 * What it covers, end to end against the seeded fixture:
 * - Opening the fixture project into the shell (Welcome → spine).
 * - Navigating to the Sections stage via the workflow spine.
 * - The section model-axis toggle (Geology ⇄ Litho), incl. the enabled
 *   state of the Litho segment (the fixture ships an *active* litho model).
 * - The geological-axis toolbar: New cross-section, Undo, and the Export
 *   ToolbarDropdown's three items (DXF / Plaxis 3D / PDF).
 * - The lithostratigraphic-axis toolbar: the Suggest SplitToolbarButton +
 *   its caret items, the Correlate SplitToolbarButton + its caret items, the
 *   Bodies ToolbarDropdown's four items, and the Admixtures ToolbarDropdown's
 *   four items.
 *
 * The pattern to copy for the other stages:
 *   1. ``launchApp`` → ``openFixtureProject`` → ``goToStage``.
 *   2. Open every dropdown / caret and assert each item testid is reachable.
 *   3. Exercise at least one reversible action to prove the control is wired.
 *
 * Prerequisites (same as the whole harness): FastAPI on :8765, Postgres on
 * :5433 (``groundmodel_integration``), and ``build_synthetic_fixture.py``
 * already run so ``E2E_FIXTURE_PROJECT_ID`` is set.
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Click the first non-delete section row so section-scoped actions enable. */
async function selectFirstSection(page: Page): Promise<void> {
  // ``section-row-{id}`` selects; ``section-row-delete-{id}`` / -confirm- are
  // the row's delete affordances — exclude them with a :not() guard.
  const row = page.locator('[data-testid^="section-row-"]:not([data-testid*="delete"])').first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
}

/** Open a ToolbarDropdown by its trigger testid and wait for the portalled menu. */
async function openDropdown(page: Page, triggerTestId: string): Promise<void> {
  await page.getByTestId(triggerTestId).click()
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 })
}

/** Open a SplitToolbarButton's caret menu (``{testid}-caret``). */
async function openCaret(page: Page, testid: string): Promise<void> {
  await page.getByTestId(`${testid}-caret`).click()
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 })
}

/** Dismiss any open floating menu. */
async function dismissMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden({ timeout: 5_000 })
}

test.describe('flow_sections_toolbar_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('geological-axis toolbar surface is fully reachable', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')

      // --- Axis toggle: Geology is the default-selected segment. -------------
      const geologyTab = page.getByRole('radio', { name: 'Geology' })
      const lithoTab = page.getByRole('radio', { name: 'Litho' })
      await expect(geologyTab).toBeVisible()
      await expect(geologyTab).toHaveAttribute('aria-checked', 'true')
      // The fixture ships an *active* lithostratigraphic model, so the Litho
      // segment must be enabled (it greys out only when no litho model exists).
      await expect(lithoTab).toBeEnabled()

      // --- Primary action + undo are present. -------------------------------
      await expect(page.getByRole('button', { name: /New cross-section/ })).toBeVisible()
      await expect(page.getByTestId('sections-undo')).toBeVisible()

      // --- Export ToolbarDropdown: three export targets. --------------------
      await selectFirstSection(page)
      await openDropdown(page, 'sections-toolbar-export-dropdown')
      await expect(page.getByTestId('export-section-dxf')).toBeVisible()
      await expect(page.getByTestId('export-plaxis-3d')).toBeVisible()
      await expect(page.getByTestId('export-section-pdf')).toBeVisible()
      await dismissMenu(page)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })

  test('litho-axis toolbar surface is fully reachable', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Sections')
      await selectFirstSection(page)

      // --- Switch to the lithostratigraphic axis. ---------------------------
      const lithoTab = page.getByRole('radio', { name: 'Litho' })
      await lithoTab.click()
      await expect(lithoTab).toHaveAttribute('aria-checked', 'true')

      // --- Suggest SplitToolbarButton + caret items. ------------------------
      await expect(page.getByTestId('litho-suggest')).toBeVisible()
      await openCaret(page, 'litho-suggest')
      await expect(page.getByTestId('litho-suggest-all')).toBeVisible()
      await expect(page.getByTestId('litho-suggest-new-tests')).toBeVisible()
      await dismissMenu(page)

      // --- Correlate SplitToolbarButton + caret items (debt #141 triad). ----
      await expect(page.getByTestId('correlate-mode')).toBeVisible()
      await openCaret(page, 'correlate-mode')
      await expect(page.getByTestId('litho-auto-correlate')).toBeVisible()
      await expect(page.getByTestId('litho-accept-correlations')).toBeVisible()
      await expect(page.getByTestId('litho-clear-suggestions')).toBeVisible()
      await dismissMenu(page)

      // --- Bodies ToolbarDropdown: four body verbs. -------------------------
      await openDropdown(page, 'litho-bodies-dropdown')
      await expect(page.getByTestId('litho-detect-lenses')).toBeVisible()
      await expect(page.getByTestId('body-suggest-pinch-outs')).toBeVisible()
      await expect(page.getByTestId('litho-materialise-lens-companions')).toBeVisible()
      await expect(page.getByTestId('litho-delete-detected-bodies')).toBeVisible()
      await dismissMenu(page)

      // --- Admixtures ToolbarDropdown: strip / reseed verbs. ----------------
      await openDropdown(page, 'litho-admixtures-dropdown')
      await expect(page.getByTestId('litho-strip-cpt')).toBeVisible()
      await expect(page.getByTestId('litho-strip-borehole')).toBeVisible()
      await expect(page.getByTestId('litho-strip-all')).toBeVisible()
      await expect(page.getByTestId('litho-reseed-borehole')).toBeVisible()
      await dismissMenu(page)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
