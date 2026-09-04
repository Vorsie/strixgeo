// Owner 2026-09-04 (installer #12): "Still can't click a cross section on the
// map to open it." Root cause: the map draws markers on a canvas (a6696974b)
// whose pane sat ABOVE the section pane, and a canvas takes every pointer
// event over its area — so the section's hit-band never saw the click. The
// section vectors now draw with the SVG renderer in a pane above the markers
// (components/mapPanes.ts). This spec clicks the hit-band's real geometry on
// the DATA-stage map and expects the Sections stage to open on that section.
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_map_section_click', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set')
  test.setTimeout(180_000)
  test('a click on a section line on the Data map opens the section', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Data')
      await page.waitForTimeout(3000)
      // Leaflet panes are 0x0 positioned divs: never "visible" to Playwright,
      // so count the section paths inside instead of asserting the pane.
      const pane = page.locator('.leaflet-section-overlays-pane')
      await page.waitForTimeout(2000)
      // With the SVG renderer the 14 px hit-band is a real path again: click its geometry.
      const bands = page.locator('svg path[stroke="#ffffff"]')
      const nb = await bands.count()
      expect(nb, 'the section hit-bands must be SVG paths (canvas swallowed the click)').toBeGreaterThan(0)
      const box = await bands.first().boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.waitForTimeout(2500)
      const inSections = await page.getByTestId('section-view-reset').isVisible().catch(() => false)
      expect(inSections).toBe(true)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
