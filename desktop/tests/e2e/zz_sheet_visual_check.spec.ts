/**
 * Visual close-the-loop check for the cross-section PDF sheet — NOT part of the
 * sweep. Runs only with ``SHEET_VISUAL_CHECK=1`` and writes three artefacts for a
 * human (or the session main) to look at side by side:
 *
 *   <out>/section-on-screen.png   the Sections stage as the engineer sees it
 *   <out>/sheet-preview.png       the preview iframe (the same drawing at paper size)
 *   <out>/sheet.pdf               the printed sheet
 *
 * ``SHEET_VISUAL_OUT`` names the output directory (defaults to the OS temp dir).
 * The assertion is only that all three exist; the comparison is by eye — this is
 * the spec's "verify the output against the ask" pass, not a golden.
 */
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const OUT = process.env.SHEET_VISUAL_OUT ?? join(tmpdir(), 'strix-sheet-visual')

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
      // Diagnostic: what the dialog (and any toast) shows when there is no fill.
      await page.screenshot({ path: join(OUT, `nofill-${i}-${axis}.png`), fullPage: false })
      await page.getByTestId('sheet-close').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeHidden({ timeout: 5_000 })
    }
  }
  throw new Error('no section/axis with a drawable fill in the fixture')
}

test.describe('zz_sheet_visual_check (manual, opt-in)', () => {
  test.skip(process.env.SHEET_VISUAL_CHECK !== '1', 'opt-in: set SHEET_VISUAL_CHECK=1')
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set')

  test.setTimeout(240_000)
  test('screen, preview and PDF side by side', async () => {
    mkdirSync(OUT, { recursive: true })
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    const diag: string[] = []
    page.on('console', m => diag.push(`[console:${m.type()}] ${m.location().url.split('/').pop()} ${m.text()}`))
    page.on('pageerror', e => diag.push(`[pageerror] ${e.message}`))
    page.on('frameattached', fr => diag.push(`[frame] attached ${fr.url()}`))
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openFirstSectionWithFill(page)
      await page.waitForTimeout(4000)
      for (const fr of page.frames()) {
        const info = await fr.evaluate(() => ({ url: location.href, ready: document.readyState, root: document.getElementById('sheet-root')?.innerHTML.length ?? -1, hasElectron: typeof (window as unknown as { electron?: unknown }).electron }))
          .catch(e => ({ url: fr.url(), error: String(e) }))
        diag.push(`[frame-state] ${JSON.stringify(info)}`)
      }
      require('fs').writeFileSync(join(OUT, 'diag.txt'), diag.join(String.fromCharCode(10)))
      await page.getByTestId('sheet-close').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeHidden({ timeout: 5_000 })
      // Let the fill settle before the screen capture.
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(OUT, 'section-on-screen.png'), fullPage: false })

      const dropdown = page.getByTestId('sections-toolbar-export-dropdown')
      if (await dropdown.isVisible()) await dropdown.click()
      else {
        await page.getByTestId('toolbar-overflow-more').click()
        const nested = page.getByTestId('sections-toolbar-export-dropdown')
        if (await nested.isVisible()) await nested.click()
      }
      await page.getByTestId('export-section-pdf').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeVisible()
      await expect(page.getByTestId('sheet-paper-size')).toContainText('mm', { timeout: 20_000 })
      // The iframe lays itself out after the payload lands; give the map its tile wait.
      await page.waitForTimeout(5000)
      await page.screenshot({ path: join(OUT, 'sheet-preview-dialog.png'), fullPage: false })
      await page.getByTestId('sheet-preview-frame').screenshot({ path: join(OUT, 'sheet-preview.png') })

      const target = join(OUT, 'sheet.pdf')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
      }, target)
      await page.getByTestId('sheet-export').click()
      await expect(page.getByText(/PDF (exported|geëxporteerd)/)).toBeVisible({ timeout: 60_000 })
      expect(existsSync(target)).toBe(true)
      expect(statSync(target).size).toBeGreaterThan(1000)
    } finally {
      await closeApp(app)
      if (tmpPath) cleanupFixtureFile(tmpPath)
    }
  })
})
