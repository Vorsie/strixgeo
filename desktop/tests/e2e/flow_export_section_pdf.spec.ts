/**
 * The cross-section PDF sheet: open the preview, move a slider, export, and
 * prove the file is a PDF whose page box equals the size the preview showed.
 * Offline by construction — the basemap falls back to the offline caption.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set). Run via
 * ``.\scripts\run-e2e.ps1 flow_export_section_pdf`` (session main only — the
 * dev app holds :8765).
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/** Open the Sections stage, select the first seeded section, switch to litho. */
async function openFirstSectionWithFill(page: Page): Promise<void> {
  // The seeded fixture draws a partition only on some sections/axes (Section A on
  // the litho axis has column strips but no bands), so walk the rows and axes
  // until the sheet dialog reports a paper size, which it does only with a fill.
  // Returns with the preview dialog OPEN on that section/axis.
  await goToStage(page, 'Sections')
  const rows = page.locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })
  const n = await rows.count()
  for (let i = 0; i < n; i += 1) {
    await rows.nth(i).click()
    for (const axis of ['Litho', 'Geotech'] as const) {
      const radio = page.getByRole('radio', { name: axis })
      if (!(await radio.isVisible())) continue
      await radio.click()
      // The geotech toolbar folds the export verbs under the overflow "More" menu.
      const dropdown = page.getByTestId('sections-toolbar-export-dropdown')
      if (await dropdown.isVisible()) await dropdown.click()
      else {
        await page.getByTestId('toolbar-overflow-more').click()
        const nested = page.getByTestId('sections-toolbar-export-dropdown')
        if (await nested.isVisible()) await nested.click()
      }
      await page.getByTestId('export-section-pdf').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeVisible()
      const size = page.getByTestId('sheet-paper-size')
      // Wait for THIS section's build to settle (the label carries data-busy while it runs).
      await expect(size).toHaveAttribute('data-busy', 'false', { timeout: 30_000 })
      if (((await size.textContent()) ?? '').includes('mm')) return
      await page.getByTestId('sheet-close').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeHidden({ timeout: 5_000 })
    }
  }
  throw new Error('no section/axis with a drawable fill in the fixture')
}

test.describe('flow_export_section_pdf', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test.setTimeout(240_000)
  test('preview → slider → export → a PDF whose page matches the preview', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      // Opens the preview on the first section/axis that has a fill.
      await openFirstSectionWithFill(page)

      const size = page.getByTestId('sheet-paper-size')
      await expect(size).toContainText('mm', { timeout: 20_000 })
      const before = (await size.textContent()) ?? ''

      // Moving the exaggeration slider re-lays the sheet (no fetch) → the size
      // label changes.
      const vex = page.getByTestId('sheet-vex')
      await vex.focus()
      for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft')
      await expect(size).not.toHaveText(before, { timeout: 10_000 })
      const after = (await size.textContent()) ?? ''
      const m = after.match(/(\d+) × (\d+) mm/)
      expect(m).not.toBeNull()
      const wMm = Number(m![1])
      const hMm = Number(m![2])

      // Stub the save dialog in the main process so the flow never blocks on a
      // native dialog. ``authorisePath`` in ``export:save-dialog`` runs on the
      // returned path, so the temp path is authorised like a real pick.
      const dir = mkdtempSync(join(tmpdir(), 'strix-sheet-'))
      const target = join(dir, 'sheet.pdf')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
      }, target)

      await page.getByTestId('sheet-export').click()
      await expect(page.getByText(/PDF (exported|geëxporteerd)/)).toBeVisible({ timeout: 60_000 })

      // The written file is a PDF whose /MediaBox equals the size the label
      // showed (Chromium writes page dictionaries uncompressed, so /MediaBox is
      // greppable; if that ever changes, keep the %PDF- + size-label checks).
      const bytes = readFileSync(target)
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      const text = bytes.toString('latin1')
      const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)
      expect(box).not.toBeNull()
      // Chromium quantises the requested page size (inches at 1/100 pt), so
      // allow 2 pt or 0.1 %, whichever is larger — well below one millimetre.
      const ptPerMm = 72 / 25.4
      const near = (got: number, want: number): void =>
        expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.max(2, want * 0.001))
      near(Number(box![1]), wMm * ptPerMm)
      near(Number(box![2]), hMm * ptPerMm)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
