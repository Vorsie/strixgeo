/**
 * Flow — right-click a BOREHOLE packing band on the geotech axis opens the
 * BAND menu, even where a lab-sample capsule covers it (owner installer #37
 * dogfeed, GEO-99/201-B1).
 *
 * The bug (his words): "it doesn't say band hier splitsen" — right-clicking one
 * of a projected borehole's packing bands opened the COLUMN menu (Focus /
 * Details / Onderverdeling wissen / Uit dit profiel verwijderen), never the
 * band menu. The band menu was unit-tested only; no spec drove a real
 * right-click on a real borehole band.
 *
 * ROOT CAUSE (found on the owner's own .strix via the harness): the lab-sample
 * hit rect (``SampleGeotechOverlay``) is painted ON TOP of the band-edit
 * overlay's borehole band rect and had no ``onContextMenu``, so a right-click on
 * a sample capsule bubbled to the section's ``<svg onContextMenu>`` catch-all,
 * which opens the COLUMN menu. The synthetic fixture's BH-E2E-01 carries no lab
 * sample, which is exactly why the overlay's own unit tests (and a naive
 * borehole spec) never saw it — so this spec SEEDS a sample over a real
 * committed packing band and drives the real right-click.
 *
 * NOTE: this flow MUTATES the fixture (geotech model + a borehole geotech
 * subdivision + one lab sample). Re-seed before a full suite run.
 */

import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://groundmodel:groundmodel@127.0.0.1:5433/groundmodel_integration'

/** Insert one lab sample directly on a borehole (transient, re-seeded each run). */
async function insertSample(
  boreholeId: string,
  topM: number,
  baseM: number,
): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'INSERT INTO sample (id, borehole_id, depth_top_m, depth_base_m, description) ' +
        'VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), boreholeId, topM, baseM, 'e2e band-menu sample'],
    )
  } finally {
    await client.end()
  }
}

test.describe('flow_geotech_borehole_band_menu', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('right-click a borehole band on the geotech axis opens the band menu with band hier splitsen', async () => {
    test.slow()

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Seed a real geotech subdivision, accept ties model-wide, divide the
      // boreholes so BH-E2E-01 carries committed packing bands.
      const setup = await page.evaluate(
        async ([base, pid]) => {
          const models = (await (
            await fetch(`${base}/projects/${pid}/geology/models`)
          ).json()) as { id: string; kind: string }[]
          for (const m of models.filter(x => x.kind === 'geotechnical')) {
            const d = await fetch(`${base}/projects/${pid}/geology/models/${m.id}`, {
              method: 'DELETE',
            })
            if (d.status !== 204) return { error: `delete ${d.status}` }
          }
          const litho = models.find(x => x.kind === 'lithostratigraphic')
          if (!litho) return { error: 'no litho model in fixture' }
          const sab = await fetch(
            `${base}/projects/${pid}/geology/models/${litho.id}/geotech/subdivide-all-bodies`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ litho_model_id: litho.id }),
            },
          )
          if (sab.status !== 200) return { error: `subdivide ${sab.status}: ${await sab.text()}` }
          const gid = ((await sab.json()) as { geotech_model_id: string }).geotech_model_id
          const acc = await fetch(
            `${base}/projects/${pid}/geology/models/${gid}/contact-correlations/accept`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          if (acc.status !== 200) return { error: `accept ${acc.status}: ${await acc.text()}` }
          const div = await fetch(
            `${base}/projects/${pid}/geology/models/${litho.id}/geotech/divide-boreholes`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ignore_pending_ties: true }),
            },
          )
          if (div.status !== 200) return { error: `divide ${div.status}: ${await div.text()}` }
          const bhs = (await (
            await fetch(`${base}/borehole/?project_id=${pid}`)
          ).json()) as { id: string; name: string }[]
          const bh = bhs.find(b => b.name === 'BH-E2E-01')
          if (!bh) return { error: 'BH-E2E-01 not found' }
          const layers = (await (
            await fetch(`${base}/projects/${pid}/geology/models/${gid}/layers`)
          ).json()) as {
            id: string
            borehole_id: string | null
            depth_top_m: number
            depth_base_m: number
          }[]
          const bhBands = layers.filter(l => l.borehole_id === bh.id)
          if (bhBands.length === 0) return { error: 'BH-E2E-01 has no geotech bands' }
          // The THICKEST band — its hit rect is tallest, so the seeded sample
          // capsule is guaranteed to sit over a real, clickable band rect.
          const band = bhBands.reduce((a, b) =>
            b.depth_base_m - b.depth_top_m > a.depth_base_m - a.depth_top_m ? b : a,
          )
          return {
            boreholeId: bh.id,
            bandTop: band.depth_top_m,
            bandBase: band.depth_base_m,
          }
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      expect(setup.error, setup.error ?? '').toBeUndefined()
      const boreholeId = setup.boreholeId as string
      const bandTop = setup.bandTop as number
      const bandBase = setup.bandBase as number

      // Seed a lab sample covering the middle of that band, so a sample capsule
      // is painted over it — the exact real-world condition the bug needs.
      const mid = (bandTop + bandBase) / 2
      const half = Math.min(0.25, (bandBase - bandTop) / 4)
      await insertSample(boreholeId, mid - half, mid + half)

      // Re-open so the shell picks up the geotech model + the borehole detail
      // (which now carries the sample), then open Section B on the geotech axis.
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
      await page.getByRole('radio', { name: 'Geotech' }).click()

      // The overlay must mount, and the seeded sample capsule must be drawn over
      // the borehole band (else the bug's precondition is not reproduced).
      await expect(page.getByTestId('geotech-band-edit-overlay')).toBeVisible({ timeout: 20_000 })
      const sampleHit = page.locator('[data-testid^="sample-hit-"]').first()
      await expect(
        sampleHit,
        'a lab-sample capsule must cover the borehole band (the bug precondition)',
      ).toBeVisible({ timeout: 20_000 })

      // Capture the borehole's band rects NOW, before any menu interaction, so
      // the "outside the bands" check below does not depend on post-dismiss
      // state (dismissing the menu must not need Escape, which exits the
      // section and unmounts the overlay).
      const rectBoxes = await page
        .locator('[data-testid^="geotech-borehole-band-"]')
        .evaluateAll(els =>
          els.map(el => {
            const r = el.getBoundingClientRect()
            return { cx: r.x + r.width / 2, top: r.y, bottom: r.y + r.height }
          }),
        )
      expect(rectBoxes.length, 'the borehole must have band rects').toBeGreaterThan(0)

      // Right-click the sample capsule (which sits ON the packing band). His rule:
      // this opens the BAND menu with "Band hier splitsen", never the column menu.
      const hitBox = (await sampleHit.boundingBox())!
      await page.mouse.click(
        Math.round(hitBox.x + hitBox.width / 2),
        Math.round(hitBox.y + hitBox.height / 2),
        { button: 'right' },
      )

      await expect(
        page.getByTestId('geotech-band-edit-menu'),
        'the band menu must open on a borehole band under a sample capsule',
      ).toBeVisible({ timeout: 5_000 })
      await expect(
        page.getByTestId('geotech-band-menu-split-here'),
        'the band menu must offer Band hier splitsen',
      ).toBeVisible()
      // Owner bug (b): the unit-statistics jump must be on the band menu.
      await expect(
        page.getByTestId('geotech-band-menu-unit-statistics'),
        'statistieken van deze eenheid must be on the band menu',
      ).toBeVisible()
      await expect(
        page.getByTestId('column-menu-clear-subdivision'),
        'the column menu must NOT open on a band',
      ).toHaveCount(0)
      // Dismiss the band menu with a LEFT-click on its full-screen backdrop
      // (never Escape, which exits the section and unmounts the overlay).
      await page.mouse.click(4, 4)
      await expect(page.getByTestId('geotech-band-edit-menu')).toHaveCount(0)

      // Owner rule 2: right-click on the column OUTSIDE its bands opens the
      // column menu. The borehole reaches the plot floor, so aim ABOVE the
      // shallowest band — the collar gap over the first litho unit, which carries
      // no band, no sample capsule and no fill, only the column glyph.
      const shallowest = rectBoxes.reduce((a, b) => (b.top < a.top ? b : a))
      await page.mouse.click(Math.round(shallowest.cx), Math.round(shallowest.top - 18), {
        button: 'right',
      })
      await expect(
        page.getByTestId('column-menu-clear-subdivision'),
        'the column menu still opens outside the bands',
      ).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('geotech-band-edit-menu')).toHaveCount(0)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
