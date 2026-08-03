/**
 * Flow — Parameters stage: click a CPT row, get its profile in the inspector.
 *
 * Owner rulings (dogfeed 2026-08-03) that this spec pins end-to-end:
 *   * the inline per-test chart is GONE — a depth series reads TALL, in the
 *     stage's right inspector pane, not squished under the table;
 *   * BOTH classifiers are drawn: the normalised Robertson-2015 zone strip and
 *     the non-normalised I_SBT strip, side by side;
 *   * the water table the profile was normalised under is stated on screen,
 *     with its provenance (recorded / set by engineer / assumed).
 *
 * Assertions
 * ----------
 * A. The Parameters stage is reachable and the per-test table lists the
 *    fixture's CPTs.
 * B. Clicking a CPT row populates the inspector: title, water-table line, and
 *    BOTH depth strips. This is the cold-cache path — the fixture project is
 *    opened fresh, so nothing has fetched the plot or the profile before the
 *    click.
 * C. The water-table line reports "assumed" for the fixture CPTs (the synthetic
 *    fixture records no water table), and the value is clickable — the edit
 *    affordance the ruling asked for.
 * D. The killed surfaces stay dead: no "SBT (dominant)" column, no inline
 *    ic/sbt panel under the table.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_parameters_cpt_profile', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('clicking a CPT row plots its depth series + both SBT strips', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // A — Parameters stage, per-test tab (the default tab).
      await goToStage(page, 'Parameters')
      await expect(page.getByTestId('parameters-panel-per-test')).toBeVisible({ timeout: 15_000 })

      // The inspector is open by default, but its open/closed flag is
      // persisted localStorage chrome — expand it if a previous run collapsed
      // it, so this spec asserts the panel and not the user's last preference.
      const expand = page.getByRole('button', { name: 'Expand inspector' })
      if (await expand.isVisible().catch(() => false)) {
        await expand.click()
      }

      // Before any click: the empty state, not a stale profile.
      await expect(page.getByText('No test selected')).toBeVisible({ timeout: 10_000 })

      // B — Click the first CPT row. Nothing has fetched this CPT's plot or
      // profile yet: this is the cold-cache path.
      const cptRow = page
        .locator('[data-testid^="parameters-row-"]')
        .filter({ hasText: 'CPT-E2E-01' })
        .first()
      await expect(cptRow).toBeVisible({ timeout: 10_000 })
      await cptRow.click()

      await expect(page.getByTestId('parameters-inspector')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('parameters-inspector-title')).toHaveText('CPT-E2E-01')

      // Both classifiers, on one shared depth axis.
      await expect(page.getByTestId('cpt-sbt-depth-panels')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('cpt-strip-normalised')).toBeVisible()
      await expect(page.getByTestId('cpt-strip-non-normalised')).toBeVisible()
      await expect(page.getByTestId('cpt-panel-qc')).toBeVisible()
      await expect(page.getByTestId('cpt-panel-fs-rf')).toBeVisible()
      await expect(page.getByTestId('cpt-panel-ic')).toBeVisible()

      // A depth series reads TALL — the panel is taller than the 420 px
      // inspector is wide. This is the ruling that killed the old chart.
      const panelBox = await page.getByTestId('cpt-panel-qc').boundingBox()
      expect(panelBox).not.toBeNull()
      expect(panelBox!.height).toBeGreaterThan(panelBox!.width)

      // C — The water table is stated, with its provenance, and is editable.
      await expect(page.getByTestId('parameters-water-table-line')).toBeVisible()
      await expect(page.getByTestId('parameters-water-table-source')).toContainText('assumed')
      const value = page.getByTestId('parameters-water-table-value')
      await expect(value).toBeVisible()
      await value.click()
      await expect(page.getByTestId('parameters-water-table-input')).toBeVisible()
      // Esc leaves the stored value alone — committing is a separate gesture.
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('parameters-water-table-input')).toHaveCount(0)

      // D — The killed surfaces stay dead.
      await expect(page.getByText('SBT (dominant)')).toHaveCount(0)
      await expect(page.getByTestId('parameters-ic-sbt-panel')).toHaveCount(0)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
