/**
 * flow_section_shots — VISUAL close-the-loop for the owner's engine rulings (walk22d, 2026-09-07).
 *
 * The owner ruled four section-fill behaviours (R2..R5) against HIS worked-example project. The unit
 * pins (``partitionFillV2/ownerRulings.test.ts``) check the geometry numerically; this spec captures
 * the actual RENDER of each named section on the litho axis so the change can be diffed by EYE against
 * the owner's screenshots (10:00..10:13): TS3 the sand pocket, TS4 the clay under the shallow TD, CS2
 * the sand/silt seam.
 *
 * It opens the bundled worked example through the app's own open-from-recents path (mirroring
 * ``walker.spec.ts`` → ``openWorkedExample``), goes to the Sections stage, and for each name in
 * ``SECTION_SHOTS`` (env, comma-separated; default the three ruling sections) selects the section row,
 * switches to the LITHO axis, waits for the fill, and saves the full section canvas to
 * ``tests/e2e/_results/section_shots/<name>.png``.
 *
 * Run offline via ``.\scripts\run-e2e.ps1 flow_section_shots`` (the worked example is bundled at
 * ``resources/sample/worked-example.strix``; the open triggers a /restore into the integration DB).
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { launchApp, closeApp } from './helpers/electron_launch'
import { goToStage } from './helpers/project_open'

const SECTION_SHOTS = (process.env.SECTION_SHOTS ?? 'Tie-section 3,Tie-section 4,Cross-section 2')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const RESULTS_DIR = path.resolve(__dirname, '_results', 'section_shots')
// ``SECTION_SHOTS_FILE`` (env) points the capture at another .strix -- the owner's live worked
// example carries sections the bundled sample does not (Tie-section 3 / 4, 2026-09-07).
const SAMPLE = process.env.SECTION_SHOTS_FILE
  ? path.resolve(process.env.SECTION_SHOTS_FILE)
  : path.resolve(__dirname, '..', '..', 'resources', 'sample', 'worked-example.strix')

/**
 * Open the bundled worked example through the welcome screen's recents path (a copy to a temp file, so
 * the open triggers a /restore). Byte-for-byte the flow ``walker.spec.ts`` uses.
 */
async function openWorkedExample(page: Page, tmpPath: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(
    async ([filePath, name]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.addRecentProject(filePath, name)
    },
    [tmpPath, 'StrixGeo worked example'] as const,
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 90_000 })
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible({ timeout: 90_000 })
}

test.describe('section shots — owner ruling render capture', () => {
  test.skip(process.platform !== 'win32', 'the worked-example open path is exercised on Windows CI')
  test.setTimeout(5 * 60_000)

  test('capture each named section on the litho axis', async () => {
    expect(fs.existsSync(SAMPLE), `worked example missing at ${SAMPLE} — build resources/sample first`).toBe(true)
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    const tmpPath = path.join(os.tmpdir(), `strix-shots-${process.pid}-${Date.now()}.strix`)
    fs.copyFileSync(SAMPLE, tmpPath)

    const { app, page } = await launchApp({})
    try {
      await openWorkedExample(page, tmpPath)
      await goToStage(page, 'Sections')

      for (const name of SECTION_SHOTS) {
        // The section list row's text is the section name (``section-row-<id>``; the delete affordance
        // carries a separate testid we exclude).
        const row = page
          .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
          .filter({ hasText: name })
          .first()
        await expect(row, `section "${name}" is in the list`).toBeVisible({ timeout: 20_000 })
        await row.click()
        // The litho axis is the surface the owner's rulings are about.
        await page.getByRole('radio', { name: 'Litho' }).click()
        // The open section's SVG carries no testid of its own; find it through the marquee
        // background it always renders, and fall back to the whole window.
        const panelSvg = page.locator('svg', { has: page.getByTestId('section-marquee-bg') }).first()
        await panelSvg.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
        // Reset the view so the whole section length is in the shot.
        await page.getByTestId('section-view-reset').click({ timeout: 5_000 }).catch(() => {})
        // "Fill bands" is an in-memory toggle, default OFF (bandFillStore): press the bare L
        // hotkey once when no fill region is on screen, so every shot shows the litho fill.
        await page.waitForTimeout(1_500)
        if ((await page.locator('[data-testid^="partition-fill-group-"]').count()) === 0) {
          await page.keyboard.press('l')
        }
        // Let the on-click litho fill settle (the partition + overlay render).
        await page.waitForTimeout(3_000)
        const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_')
        const shotPath = path.join(RESULTS_DIR, `${safe}.png`)
        if (await panelSvg.isVisible().catch(() => false)) await panelSvg.screenshot({ path: shotPath })
        else await page.screenshot({ path: shotPath })
      }
    } finally {
      await closeApp(app)
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // best-effort temp cleanup
      }
    }
  })
})
