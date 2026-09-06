/**
 * Flow — Guided tutorial, first chapters (spec 2026-09-02, debt #93).
 *
 * Acceptance criteria (spec §Testing):
 * - The tutorial does NOT auto-start; it appears only when Help → Tutorial fires
 *   (the ``menu:tutorial`` IPC, sent here via ``app.evaluate`` like
 *   flow_settings_dialog).
 * - Chapter 1 runs on the welcome screen and is about the New-project button.
 * - Creating a project (projectOpen turns true) auto-advances the tutorial off
 *   the "create" step — nothing is scripted, it reads observable shell state.
 * - Chapter 2 spotlights the Import menu (``import-menu-button``).
 * - "Skip tutorial" hides everything (the overlay unmounts).
 * - Reopening resumes at the last incomplete step (chapter 2), not chapter 1.
 *
 * The tutorial runs on the user's OWN project (assumption A1), so this launches
 * WITHOUT auto-opening the fixture project — the welcome screen shows and the
 * project is created through the UI. The FIXTURE_PROJECT_ID guard only ensures
 * the backend + fixture are seeded (run-e2e does that); the flow itself creates
 * its own project.
 */

import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

/**
 * Fire Help → Tutorial through the main process, the way the native menu does.
 * ``restart`` = Help → Restart tutorial (clears stored progress — the first
 * open of a run, so progress left by an earlier run cannot skew it);
 * ``resume`` = Help → Tutorial (continues at the last incomplete step).
 */
async function startTutorialFromHelp(app: ElectronApplication, mode: 'restart' | 'resume'): Promise<void> {
  await app.evaluate(({ BrowserWindow }, channel) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send(channel)
  }, mode === 'restart' ? 'menu:tutorial-restart' : 'menu:tutorial')
}

test.describe('flow_tutorial_first_chapters', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('starts from Help, spotlights chapter 1, auto-advances on project create, resumes after skip', async () => {
    const { app, page } = await launchApp()
    const projectFile = join(tmpdir(), `strix-e2e-tutorial-${Date.now()}.strix`)

    try {
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // 1. The tutorial has no auto-start — nothing is on screen until Help fires.
      expect(await page.getByTestId('tutorial-overlay').count()).toBe(0)

      await startTutorialFromHelp(app, 'restart')

      // 2. Chapter 1 runs: the coach card appears and the New-project button
      //    (what chapter 1 is about) is on screen.
      const card = page.getByTestId('tutorial-coach-card')
      await expect(card).toBeVisible({ timeout: 5_000 })
      await expect(card).toContainText('Chapter 1')
      await expect(page.getByTestId('welcome-new-project-button')).toBeVisible()

      // 3. Advance from the name step to the "create" step (an explain step
      //    carries Next; the create step then waits for the project to open).
      await page.getByTestId('tutorial-next').click()
      await expect(card).toContainText('Chapter 1')

      // 4. Create a project through the welcome screen — projectOpen turns true.
      await page.getByTestId('welcome-project-name-input').fill(`E2E-Tutorial-${Date.now()}`)
      // The create flow asks where to save the new .strix through the NATIVE
      // save dialog, which blocks under Playwright — answer it from the main
      // process (same recipe as flow_export_section_pdf).
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
      }, projectFile)
      await page.getByTestId('welcome-new-project-button').click()

      // 5. The "create" step auto-completes on the observable state and the walk
      //    lands on chapter 1's coordinate-system step (Step 3 of 4).
      await expect(card).toContainText('Step 3', { timeout: 15_000 })

      // 6. Do-it steps advance by themselves (owner ruling 2026-09-06: "if a user
      //    clicks 'Open de projectgegevens' the tutorial should automatically go to
      //    the next step"). Step 3 completes when the project settings open; the
      //    CRS and datum steps complete when the project carries a horizontal and
      //    a vertical CRS. A fresh project may already carry defaults (then both
      //    complete at once) or not (then each waits: skip it, the walk goes on).
      await page.getByTestId('project-metadata-open').click()
      for (let i = 0; i < 2; i++) {
        if (((await card.textContent()) ?? '').includes('Chapter 2')) break
        const skipStep = page.getByTestId('tutorial-skip-step')
        if (await skipStep.isVisible().catch(() => false)) await skipStep.click()
      }
      await expect(card).toContainText('Chapter 2', { timeout: 10_000 })
      await page.keyboard.press('Escape') // close the settings dialog again
      await expect(page.getByTestId('import-menu-button')).toBeVisible()

      // 7. "Skip tutorial" hides everything — the overlay unmounts.
      await page.getByTestId('tutorial-skip-tutorial').click()
      await expect(page.getByTestId('tutorial-overlay')).toHaveCount(0)

      // 8. Reopening resumes at chapter 2 (the last incomplete step), not chapter 1.
      await startTutorialFromHelp(app, 'resume')
      await expect(card).toBeVisible({ timeout: 5_000 })
      await expect(card).toContainText('Chapter 2')
    } finally {
      await closeApp(app)
      if (existsSync(projectFile)) unlinkSync(projectFile)
    }
  })
})
