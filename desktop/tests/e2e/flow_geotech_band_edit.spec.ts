/**
 * Flow — hand-editing packing sub-bands on the geotech axis (#227).
 *
 * The gap this covers
 * -------------------
 * The band-edit verbs shipped with unit + integration coverage, but no spec
 * ever drove the actual GESTURE surface: the boundary-strip DRAG (the owner's
 * 2026-08-07 dogfeed found the pan hand where the drag should be), the
 * consequence sheet, the remove-band menu, and the undo stack. This spec walks:
 *
 *   1. drag a packing boundary a safe distance → consequence sheet → confirm
 *      → BOTH rows share the new boundary and both read source='manual';
 *   2. Ctrl+Z → the boundary returns to where it started;
 *   3. right-click the band → "Remove band (merge into band above)" → confirm
 *      → the column has one band fewer.
 *
 * Actions are UI gestures; side-effect checks go through the API (rows are
 * deterministic, paint is not). The drag synthesis follows the
 * flow_litho_boundary_move_drag recipe: real mousedown on the strip, then
 * document-dispatched mousemove ticks carrying buttons:1 (the release-outside
 * guard cancels on buttons===0), a React flush pause, then the mouseup.
 *
 * Setup is API-driven like the sibling geotech specs: any leftover geotech
 * model is deleted, step 1 (subdivide-cpts) is re-run fresh, the thickest CPT
 * band is split down the middle so the column HAS an internal boundary to drag
 * (the fixture's uniform qc otherwise yields one band per litho body, and a
 * litho contact carries no handle by design), and the project is re-opened so
 * the shell sees the new model.
 *
 * NOTE: this flow MUTATES the fixture (geotech model + a hand edit).
 * Re-seed before a full suite run.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

interface LayerRow {
  id: string
  cpt_id: string | null
  depth_top_m: number
  depth_base_m: number
  source: string
}

test.describe('flow_geotech_band_edit', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('drag a boundary, undo it, then remove a band through the menu', async () => {
    test.slow()

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Fresh geotech model: delete leftovers, run pipeline step 1 via API.
      const setup = await page.evaluate(
        async ([base, pid]) => {
          const models = (await (await fetch(`${base}/projects/${pid}/geology/models`)).json()) as {
            id: string
            kind: string
          }[]
          for (const m of models.filter(x => x.kind === 'geotechnical')) {
            const d = await fetch(`${base}/projects/${pid}/geology/models/${m.id}`, {
              method: 'DELETE',
            })
            if (d.status !== 204) return { error: `delete ${d.status}` }
          }
          const litho = models.find(x => x.kind === 'lithostratigraphic')
          if (!litho) return { error: 'no litho model in fixture' }
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${litho.id}/geotech/subdivide-cpts`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ litho_model_id: litho.id }),
            },
          )
          if (r.status !== 200) return { error: `subdivide ${r.status}: ${await r.text()}` }
          const payload = (await r.json()) as { geotech_model_id: string }
          const gid = payload.geotech_model_id

          // Give the column a boundary to drag. The synthetic fixture's qc is
          // uniform enough that subdivision yields ONE packing band per litho
          // body — and a boundary between two litho bodies is a contact, which
          // correctly carries no drag handle. So the spec makes its own
          // internal boundary by splitting the thickest CPT band down the
          // middle; the two halves share a litho parent, which is exactly the
          // pair the drag verb is for.
          const layers = (await (
            await fetch(`${base}/projects/${pid}/geology/models/${gid}/layers`)
          ).json()) as {
            id: string
            cpt_id: string | null
            depth_top_m: number
            depth_base_m: number
          }[]
          const cptBands = layers.filter(l => l.cpt_id !== null)
          if (cptBands.length === 0) return { error: 'subdivide produced no CPT bands' }
          // Split the thickest band of EVERY CPT, not just the thickest overall:
          // subdivide is model-wide, so the single thickest band may well sit on
          // a CPT this spec never opens, leaving the section it does open with
          // no internal boundary at all.
          const thickestPerCpt = new Map<string, (typeof cptBands)[number]>()
          for (const band of cptBands) {
            const key = band.cpt_id as string
            const best = thickestPerCpt.get(key)
            if (
              best === undefined ||
              band.depth_base_m - band.depth_top_m > best.depth_base_m - best.depth_top_m
            ) {
              thickestPerCpt.set(key, band)
            }
          }
          let splits = 0
          for (const target of thickestPerCpt.values()) {
            const midDepth =
              Math.round(((target.depth_top_m + target.depth_base_m) / 2) * 1000) / 1000
            const sp = await fetch(
              `${base}/projects/${pid}/geology/models/${gid}/geotech/bands/split`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ band_id: target.id, split_depth_m: midDepth }),
              },
            )
            // A band too thin to halve is fine — another CPT will carry the pair.
            if (sp.status === 200) splits += 1
          }
          if (splits === 0) return { error: 'no CPT band could be split to make a pair' }
          return { geotechModelId: gid, splits }
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      expect(setup.error, setup.error ?? '').toBeUndefined()
      const geotechModelId = setup.geotechModelId as string

      // Re-open so the shell picks the fresh model up from a clean slate.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      await goToStage(page, 'Sections')
      const sectionRow = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionRow).toBeVisible({ timeout: 10_000 })
      await sectionRow.click()
      const axisGeotech = page.getByTestId('axis-geotech')
      await expect(axisGeotech).toBeEnabled({ timeout: 10_000 })
      await axisGeotech.click()

      const readLayers = async (): Promise<LayerRow[]> =>
        page.evaluate(
          async ([base, pid, gid]) => {
            const r = await fetch(`${base}/projects/${pid}/geology/models/${gid}/layers`)
            return (await r.json()) as never[]
          },
          [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
        )
      // Take the target from what the overlay actually DREW. A strip exists
      // only where the merge is legal — same litho body — so two bands that
      // merely touch across a litho contact carry no handle, by design. Reading
      // the pair out of the depth table instead picks such a boundary sooner or
      // later and the spec then waits for a strip that correctly does not exist.
      // Two different failures wear the same symptom, so name them apart: no
      // band hit-rects at all means the overlay never mounted (wrong axis, no
      // refinement bundle); rects but no strips means nothing on THIS section
      // has two packing bands inside one litho body.
      const bandRects = page.locator('[data-testid^="geotech-band-hit-"]')
      await expect(
        bandRects.first(),
        'the band-edit overlay must mount on the geotech axis',
      ).toBeVisible({ timeout: 20_000 })
      const strips = page.locator('[data-testid^="geotech-band-boundary-"]')
      await expect(
        strips.first(),
        'this section must show a CPT column with two packing bands in one litho body',
      ).toBeVisible({ timeout: 20_000 })
      const upperIds = (
        await strips.evaluateAll(els =>
          els.map(el =>
            (el.getAttribute('data-testid') ?? '').replace('geotech-band-boundary-', ''),
          ),
        )
      ).filter(Boolean)
      expect(
        upperIds.length,
        'the geotech axis must draw at least one drag handle',
      ).toBeGreaterThan(0)

      const layers = await readLayers()
      const byId = new Map(layers.map(r => [r.id, r]))
      // Of the drawn boundaries, take the one whose LOWER band is thickest, so
      // a 30 % push can never trip the absorb rule.
      let pair: { upper: LayerRow; lower: LayerRow } | null = null
      for (const upperId of upperIds) {
        const upperRow = byId.get(upperId)
        if (upperRow === undefined) continue
        const lowerRow = layers.find(
          r =>
            r.cpt_id !== null &&
            r.cpt_id === upperRow.cpt_id &&
            Math.abs(r.depth_top_m - upperRow.depth_base_m) < 1e-6,
        )
        if (lowerRow === undefined) continue
        const lowerThickness = lowerRow.depth_base_m - lowerRow.depth_top_m
        const best = pair === null ? 0 : pair.lower.depth_base_m - pair.lower.depth_top_m
        if (lowerThickness > best) pair = { upper: upperRow, lower: lowerRow }
      }
      expect(pair, 'a drawn strip must resolve to an adjacent CPT band pair').not.toBeNull()
      const { upper, lower } = pair!
      const boundaryM = upper.depth_base_m
      const lowerThicknessM = lower.depth_base_m - lower.depth_top_m

      const strip = page.getByTestId(`geotech-band-boundary-${upper.id}`)
      await expect(strip).toBeVisible({ timeout: 15_000 })
      const stripBox = (await strip.boundingBox())!
      const upperRect = (await page
        .getByTestId(`geotech-band-hit-${upper.id}`)
        .boundingBox())!
      const pxPerMetre = upperRect.height / (upper.depth_base_m - upper.depth_top_m)

      // Push the boundary 30 % into the lower band — far from both the no-op
      // guard and the absorb threshold (max(0.1 m, 15 %) must REMAIN).
      const shiftM = 0.3 * lowerThicknessM
      const cx = Math.round(stripBox.x + stripBox.width / 2)
      const cy = Math.round(stripBox.y + stripBox.height / 2)
      const targetY = Math.round(cy + shiftM * pxPerMetre)
      expect(targetY - cy, 'the drag must span at least a few px').toBeGreaterThan(3)

      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(200)
      await page.evaluate(
        ({ x, y0, y1, steps }) => {
          for (let i = 1; i <= steps; i += 1) {
            const y = Math.round(y0 + ((y1 - y0) * i) / steps)
            document.dispatchEvent(
              new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, bubbles: true }),
            )
          }
        },
        { x: cx, y0: cy, y1: targetY, steps: 12 },
      )
      // COUNT, not toBeVisible: an SVG <line> is a zero-height box, so
      // Playwright's visibility test calls it hidden however correctly it
      // renders (the quirk already recorded against flow_auto_tie). Its
      // presence is the assertion — it only exists while a drag is live.
      await expect(page.getByTestId('geotech-drag-preview-line')).toHaveCount(1)
      await page.waitForTimeout(150)
      await page.evaluate(
        ({ x, y1 }) => {
          document.dispatchEvent(
            new MouseEvent('mouseup', { clientX: x, clientY: y1, button: 0, buttons: 0, bubbles: true }),
          )
        },
        { x: cx, y1: targetY },
      )
      await page.mouse.up()

      // The consequence sheet (ruling 6) — confirm commits the move.
      const confirm = page.getByTestId('geotech-band-edit-confirm')
      await expect(confirm).toBeVisible({ timeout: 15_000 })
      await confirm.click()

      const readPair = async (): Promise<{ upperBase: number; lowerTop: number; sources: string[] }> => {
        const rows = await readLayers()
        const u = rows.find(r => r.id === upper.id)!
        const l = rows.find(r => r.id === lower.id)!
        return { upperBase: u.depth_base_m, lowerTop: l.depth_top_m, sources: [u.source, l.source] }
      }
      await expect
        .poll(async () => (await readPair()).upperBase, {
          timeout: 30_000,
          message: 'the committed move must land in the database',
        })
        .not.toBeCloseTo(boundaryM, 3)
      const moved = await readPair()
      expect(moved.upperBase).toBeCloseTo(moved.lowerTop, 3) // atomic two-row write
      expect(moved.upperBase).toBeGreaterThan(boundaryM)
      expect(moved.sources).toEqual(['manual', 'manual'])

      // Undo — the boundary drags itself back to where it started.
      await page.keyboard.press('Control+z')
      await expect
        .poll(async () => (await readPair()).upperBase, {
          timeout: 30_000,
          message: 'Ctrl+Z must move the boundary back',
        })
        .toBeCloseTo(boundaryM, 3)

      // Remove band: right-click the LOWER band, absorb it upward.
      const bandCountBefore = (await readLayers()).filter(
        r => r.cpt_id === lower.cpt_id,
      ).length
      await page.getByTestId(`geotech-band-hit-${lower.id}`).click({ button: 'right' })
      const removeUp = page.getByTestId('geotech-band-menu-remove-up')
      await expect(removeUp).toBeVisible({ timeout: 10_000 })
      await removeUp.click()
      const confirmRemove = page.getByTestId('geotech-band-edit-confirm')
      await expect(confirmRemove).toBeVisible({ timeout: 15_000 })
      await confirmRemove.click()
      await expect
        .poll(
          async () => (await readLayers()).filter(r => r.cpt_id === lower.cpt_id).length,
          { timeout: 30_000, message: 'the absorb must remove exactly one row' },
        )
        .toBe(bandCountBefore - 1)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
