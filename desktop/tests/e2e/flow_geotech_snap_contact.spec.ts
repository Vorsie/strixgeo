/**
 * Flow — dragging a lithostratigraphic contact onto a packing boundary from the
 * geotech axis (owner ruling 2026-08-08).
 *
 * The gap this covers
 * -------------------
 * The geotech axis is view-only for contacts with ONE consented exception: the
 * boundary between two packing bands that sit in DIFFERENT litho bodies restates
 * a lithostratigraphic contact, and dragging it moves that LITHO row — snapped
 * onto the CPT's own packing boundaries, never skipping one. On the owner's real
 * data a single column carries 17 internal boundaries of which only 3 are packing
 * boundaries; the other 14 are the contacts he actually wants to move, because
 * the cone resistance resolved them 3-4x finer than the driller's 0.5 m log grid.
 *
 * Every rule shipped unit-tested in isolation (``geotechSnapTargets``,
 * ``geotechContactDrag``, the SectionsCanvas seam). This spec is the only thing
 * that proves the CHAIN — rendered hit strip → plan → litho PATCH — in the real
 * app. It walks:
 *
 *   1. press the contact's hit strip on the geotech axis and drag PAST two
 *      packing boundaries;
 *   2. the LITHO contact moves to the FIRST boundary crossed (one drag consumes
 *      one boundary — "can't skip a boundary right, drag merge first, then drag
 *      merge second");
 *   3. not one packing band is created or deleted — the drag moved a litho row,
 *      it never re-derives the subdivision.
 *
 * The action is a real UI gesture; every side-effect check goes through the API,
 * because the rows are deterministic and the paint is not. The drag synthesis is
 * the sibling ``flow_geotech_band_edit`` recipe: real mousedown on the strip, then
 * document-dispatched mousemove ticks carrying buttons:1 (handleMove cancels on
 * buttons===0), a React flush pause, then the mouseup.
 *
 * Setup is API-driven like every geotech spec and lives in
 * ``helpers/geotech_snap_setup``: leftover geotech models are deleted,
 * ``subdivide-cpts`` is re-run fresh, and the band BELOW each restated contact is
 * cut into thirds so the column offers TWO boundaries under it — which is what
 * makes "landed on the first, not the second" assertable at all. The contact
 * itself is NOT contrived: Section B's CPTs carry a seeded KLEI body over a ZAND
 * body, so the boundary between their packing bands is a genuine restated
 * lithostratigraphic contact.
 *
 * NOTE: this flow MUTATES the fixture (the geotech model is rebuilt). The litho
 * contact it drags is put back at the end, so the litho model other specs read is
 * left as found; re-seed before a full suite run all the same.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import {
  COINCIDENT_TOLERANCE_M,
  prepareGeotechSnapFixture,
  readModelLayers,
  type SnapTarget,
} from './helpers/geotech_snap_setup'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_geotech_snap_contact', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('a contact dragged past two packing boundaries lands on the first', async () => {
    test.slow()

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      const setup = await prepareGeotechSnapFixture(page, API_BASE, FIXTURE_PROJECT_ID)
      expect(setup.error, setup.error ?? '').toBeUndefined()
      const geotechModelId = setup.geotechModelId as string
      const lithoModelId = setup.lithoModelId as string
      const targets = setup.targets as SnapTarget[]
      const bandIdsBefore = setup.geotechLayerIds as string[]

      // Re-open so the shell picks the rebuilt geotech model up from a clean slate.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      await goToStage(page, 'Sections')
      // Section B is the transect whose CPTs carry a qc series — the only one that
      // subdivides into packing bands at all.
      const sectionRow = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionRow).toBeVisible({ timeout: 10_000 })
      await sectionRow.click()
      const axisGeotech = page.getByTestId('axis-geotech')
      await expect(axisGeotech).toBeEnabled({ timeout: 10_000 })
      await axisGeotech.click()

      // Take the target from what the overlay actually DREW, the way the sibling
      // band-edit spec takes its drag pair from the strips. The padlock marker is
      // rendered on exactly the boundaries the overlay classified as litho contacts
      // — the same predicate the drag plan runs — so a prepared column that carries
      // no marker here is one this section correctly does not offer the gesture on.
      // Name the two failures apart: no band hit rects at all means the overlay
      // never mounted (wrong axis, no refinement bundle); rects but no marker means
      // nothing on THIS section restates a litho contact.
      const bandRects = page.locator('[data-testid^="geotech-band-hit-"]')
      await expect(
        bandRects.first(),
        'the band-edit overlay must mount on the geotech axis',
      ).toBeVisible({ timeout: 20_000 })
      const markers = page.locator('[data-testid^="geotech-contact-marker-"]')
      await markers.first().waitFor({ state: 'attached', timeout: 20_000 })
      const markedUpperIds = (
        await markers.evaluateAll(els =>
          els.map(el =>
            (el.getAttribute('data-testid') ?? '').replace('geotech-contact-marker-', ''),
          ),
        )
      ).filter(Boolean)
      expect(
        markedUpperIds.length,
        'this section must draw at least one restated litho contact',
      ).toBeGreaterThan(0)

      const target = targets.find(t => markedUpperIds.includes(t.upperBandId))
      expect(
        target,
        `a drawn contact marker must resolve to a prepared column — drawn=[${markedUpperIds.join(', ')}]`,
      ).toBeDefined()
      const {
        lowerBandId,
        contactDepthM,
        lithoLayerId,
        lithoUpperLayerId,
        firstBandId,
        firstBoundaryM,
        secondBandId,
        secondBoundaryM,
      } = target as SnapTarget

      // Vertical scale straight off the two prepared bands: the gap between their
      // drawn tops over the gap between their real depths. Both sit deep inside the
      // plot, so neither rect is clipped against the plot edge.
      const firstRect = (await page.getByTestId(`geotech-band-hit-${firstBandId}`).boundingBox())!
      const secondRect = (await page.getByTestId(`geotech-band-hit-${secondBandId}`).boundingBox())!
      const pxPerMetre = (secondRect.y - firstRect.y) / (secondBoundaryM - firstBoundaryM)
      expect(
        pxPerMetre,
        'the two prepared bands must give a positive vertical scale',
      ).toBeGreaterThan(0)

      const strip = page.locator(
        `[data-testid="contact-drag-strip"][data-contact-id="${lowerBandId}"]`,
      )
      await expect(
        strip,
        'the restated contact must carry ContactsLayer’s drag hit strip',
      ).toHaveCount(1)
      const stripBox = (await strip.boundingBox())!
      const cx = Math.round(stripBox.x + stripBox.width / 2)
      const cy = Math.round(stripBox.y + stripBox.height / 2)

      // Release WELL past the second boundary — 40 % into the run below it. The
      // overshoot is the point: the clamp must still hand back the first boundary
      // crossed, because moving a contact two boundaries takes two drags, each with
      // its own consequence and its own entry on the undo stack.
      const releaseDepthM = secondBoundaryM + 0.4 * (secondBoundaryM - firstBoundaryM)
      const targetY = Math.round(firstRect.y + (releaseDepthM - firstBoundaryM) * pxPerMetre)
      expect(targetY - cy, 'the drag must span at least a few px').toBeGreaterThan(3)

      // What is actually under the press point, recorded BEFORE the mousedown. The
      // geotech axis stacks several transparent hit surfaces over this pixel, so a
      // failure should name the element that swallowed the press rather than leave
      // "the contact did not move" to be re-diagnosed by hand.
      const pressTarget = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y)
          if (el === null) return 'nothing'
          const testid = el.getAttribute('data-testid') ?? '—'
          return `<${el.tagName}> testid=${testid} contact=${el.getAttribute('data-contact-id') ?? '—'}`
        },
        { x: cx, y: cy },
      )

      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(200)
      // COUNT, not toBeVisible — the readout is an SVG <g>, and Playwright calls a
      // zero-area box hidden however correctly it renders (the quirk already
      // recorded against flow_auto_tie). Its presence is the assertion: it exists
      // only while ContactsLayer holds a live drag, so this tells "the press never
      // reached the strip" apart from "the commit did nothing".
      await expect(
        page.getByTestId('contact-drag-readout'),
        `the press must arm ContactsLayer’s drag; the element under the cursor was ${pressTarget}`,
      ).toHaveCount(1)

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
      await page.waitForTimeout(150) // let React flush the moved drag state
      await page.evaluate(
        ({ x, y1 }) => {
          document.dispatchEvent(
            new MouseEvent('mouseup', {
              clientX: x,
              clientY: y1,
              button: 0,
              buttons: 0,
              bubbles: true,
            }),
          )
        },
        { x: cx, y1: targetY },
      )
      await page.mouse.up()

      // Polled as a WORD, not a depth: a missing row would make a numeric
      // ``not.toBeCloseTo`` pass on NaN, i.e. a deleted contact would read as a
      // successful move. Three named outcomes cannot do that.
      const lithoRowState = async (): Promise<'missing' | 'moved' | 'unmoved'> => {
        const rows = await readModelLayers(page, API_BASE, FIXTURE_PROJECT_ID, lithoModelId)
        const row = rows.find(r => r.id === lithoLayerId)
        if (row === undefined) return 'missing'
        return Math.abs(row.depth_top_m - contactDepthM) > 0.001 ? 'moved' : 'unmoved'
      }
      await expect
        .poll(lithoRowState, {
          timeout: 30_000,
          message:
            `the litho contact at ${contactDepthM.toFixed(3)}m must move; ` +
            `press landed on ${pressTarget}`,
        })
        .toBe('moved')

      // The litho↔geo coupling prompt can open on top once the PATCH lands (a third
      // of litho rows restate a geological contact). It is inert — the depth is
      // already written — but dismiss it so nothing is left modal.
      const snapCancel = page.getByTestId('snap-cancel')
      if (await snapCancel.isVisible().catch(() => false)) await snapCancel.click()

      const lithoAfter = await readModelLayers(page, API_BASE, FIXTURE_PROJECT_ID, lithoModelId)
      const movedRow = lithoAfter.find(r => r.id === lithoLayerId)!
      const partnerRow = lithoAfter.find(r => r.id === lithoUpperLayerId)!
      // Within a millimetre, not bit-identical: the band materialiser rounds depths
      // to 3 decimals while litho contacts keep full float precision, so the same
      // boundary is recorded at two precisions (COINCIDENT_DEPTH_TOLERANCE_M).
      expect(
        Math.abs(movedRow.depth_top_m - firstBoundaryM),
        `the contact must land ON the first packing boundary (${firstBoundaryM}m); ` +
          `it sits at ${movedRow.depth_top_m}m`,
      ).toBeLessThanOrEqual(COINCIDENT_TOLERANCE_M)
      // One drag consumes ONE boundary however far the cursor travelled. Released
      // 40 % past the second, it must not have landed there.
      expect(
        Math.abs(movedRow.depth_top_m - secondBoundaryM),
        'the drag must stop at the first boundary crossed, never skip to the second',
      ).toBeGreaterThan(COINCIDENT_TOLERANCE_M)
      // Atomic two-row resize — the partner above closed onto the same depth, so the
      // litho column stays gap-free.
      expect(partnerRow.depth_base_m).toBeCloseTo(movedRow.depth_top_m, 3)

      // The subdivision is untouched: the drag moved a litho row, it never
      // re-derives, splits or merges a packing band.
      const bandsAfter = await readModelLayers(page, API_BASE, FIXTURE_PROJECT_ID, geotechModelId)
      expect(
        bandsAfter.map(b => b.id).sort(),
        'no packing band may be created or deleted by a contact drag',
      ).toEqual(bandIdsBefore)

      // Put the litho contact back where the fixture had it — other specs read this
      // model, and the geotech model is the only thing this flow means to rebuild.
      await page.evaluate(
        async ([base, pid, mid, upperId, lowerId, depth]) => {
          await fetch(`${base}/projects/${pid}/geology/models/${mid}/layers/boundary-move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              upper_layer_id: upperId,
              lower_layer_id: lowerId,
              new_depth_m: Number(depth),
            }),
          })
        },
        [
          API_BASE,
          FIXTURE_PROJECT_ID,
          lithoModelId,
          lithoUpperLayerId,
          lithoLayerId,
          String(contactDepthM),
        ] as const,
      )
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
