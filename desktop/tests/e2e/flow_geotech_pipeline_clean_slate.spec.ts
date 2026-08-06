/**
 * Flow — the four-step packing pipeline from a TRUE clean slate, UI-driven.
 *
 * The gap this covers
 * -------------------
 * Every other geotech spec creates the geotech model by calling the API
 * directly (``flow_geotech_subdivide_all_bodies``, ``flow_geotech_borehole_
 * preview``), so no spec ever walked the owner's actual flow: *no geotech
 * model exists*, and the engineer reaches "Packing pipeline → 1 · Subdivide
 * CPTs" through the toolbar. That entry point deadlocked until 2026-08-05
 * (``03a3d86a9``): the geotech axis radio was gated on the geotech model
 * existing, but step 1 — the only thing that CREATES the model — lives on
 * that axis. This spec is the regression pin for the deadlock AND the
 * end-to-end proof of the pipeline redesign:
 *
 *   1 · Subdivide CPTs   — creates the model, CPT bands only, NO confirm
 *                          dialog on a first run;
 *   2 · Auto-correlate   — refinement of ruling A (owner 2026-08-06): ties
 *                          that RESTATE an approved litho tie are born
 *                          accepted; the machine's NEW packing-density pairs
 *                          and bridged jump pairs arrive as pending ghosts;
 *   3 · Accept           — pressed only when step 2 actually left something
 *                          pending (the fixture decides — both branches are
 *                          honest);
 *   4 · Divide boreholes — unlocked once nothing is pending, commits real
 *                          borehole bands.
 *
 * Actions are UI clicks; completion/side-effect checks go through the API
 * (the flow's writes are rows, and polling rows is deterministic where
 * polling paint is not).
 *
 * Clean slate is ENFORCED, not assumed: any geotech model left behind by an
 * earlier spec in the same suite run is deleted through the public DELETE
 * endpoint before the project is (re)opened, so this spec is order-proof.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 *
 * NOTE: this flow MUTATES the fixture (geotech model + NAD formations +
 * borehole geotech layers). Re-seed before a full suite run.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_geotech_pipeline_clean_slate', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('the four-step pipeline runs end-to-end from no geotech model, through the toolbar', async () => {
    // Two project opens + three pipeline verbs + API polling — slow budget.
    test.slow()

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Enforce the clean slate: delete every geotech model that an earlier
      // spec may have created. Geotech models have no dependents, so the
      // DELETE cannot 409.
      const deleted = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          const models = (await r.json()) as { id: string; kind: string }[]
          const geotech = models.filter(m => m.kind === 'geotechnical')
          const statuses: number[] = []
          for (const m of geotech) {
            const d = await fetch(`${base}/projects/${pid}/geology/models/${m.id}`, {
              method: 'DELETE',
            })
            statuses.push(d.status)
          }
          return statuses
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      for (const st of deleted) expect(st, 'geotech model cleanup must succeed').toBe(204)

      // Re-open so the shell truly has activeGeotechModel === null.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Open Section B (the only section whose CPTs carry a qc series and
      // whose borehole shares a body with them — see the sibling specs).
      await goToStage(page, 'Sections')
      const sectionRow = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionRow).toBeVisible({ timeout: 10_000 })
      await sectionRow.click()

      // THE DEADLOCK PIN: the geotech axis must be clickable with no geotech
      // model — a litho model (the pipeline's source) is the prerequisite.
      const axisGeotech = page.getByTestId('axis-geotech')
      await expect(axisGeotech).toBeEnabled({ timeout: 10_000 })
      await axisGeotech.click()

      // Step 1 through the toolbar. A FIRST run must not raise the
      // re-subdivide confirm dialog (there is nothing to wipe yet).
      await page.getByTestId('geotech-pipeline').click()
      await page.getByTestId('geotech-subdivide-cpts').click()
      await expect(page.getByTestId('re-subdivide-confirm-dialog')).toHaveCount(0)

      // Completion = the model row exists. Poll the API, not the paint.
      const findGeotechModelId = async (): Promise<string | null> =>
        page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/projects/${pid}/geology/models`)
            const models = (await r.json()) as { id: string; kind: string }[]
            return models.find(m => m.kind === 'geotechnical')?.id ?? null
          },
          [API_BASE, FIXTURE_PROJECT_ID] as const,
        )
      await expect.poll(findGeotechModelId, { timeout: 60_000 }).not.toBeNull()
      const geotechModelId = (await findGeotechModelId())!

      // Step 1 materialises CPT bands and derives NO edges.
      const edgesAfterStep1 = await page.evaluate(
        async ([base, pid, gid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${gid}/contact-correlations`)
          return (await r.json()) as { user_approved: boolean }[]
        },
        [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
      )
      expect(edgesAfterStep1.length, 'step 1 correlates nothing — that is step 2').toBe(0)

      // Step 2 through the toolbar. The item enables once the shell's
      // refreshModels lands (handleSubdivideAllBodies awaits it, but the
      // React commit is async from here).
      await page.getByTestId('geotech-pipeline').click()
      const autoCorrelate = page.getByTestId('geotech-auto-correlate')
      await expect(autoCorrelate).toBeEnabled({ timeout: 15_000 })
      await autoCorrelate.click()

      // Ruling A (2026-08-05): the fixture's derived ties sit inside approved
      // litho correlations, so every edge is BORN accepted. Wait for the
      // verb to land (edges appear), then judge the pending count.
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ([base, pid, gid]) => {
                const r = await fetch(
                  `${base}/projects/${pid}/geology/models/${gid}/contact-correlations`,
                )
                return ((await r.json()) as unknown[]).length
              },
              [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
            ),
          {
            timeout: 60_000,
            message:
              'the fixture has approved litho correlations on Section B — ' +
              'step 2 must derive ties from them',
          },
        )
        .toBeGreaterThanOrEqual(1)
      const tieState = await page.evaluate(
        async ([base, pid, gid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${gid}/contact-correlations`)
          const edges = (await r.json()) as { user_approved: boolean }[]
          return { count: edges.length, pending: edges.filter(e => !e.user_approved).length }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
      )
      expect(tieState.count).toBeGreaterThanOrEqual(1)

      if (tieState.pending > 0) {
        // The machine proposed new packing-density or jump ties — the chip
        // must say so and step 4 must be gated until they are judged.
        await expect(page.getByTestId('geotech-pending-tie-chip')).toBeVisible({
          timeout: 15_000,
        })
        await page.getByTestId('geotech-pipeline').click()
        await expect(page.getByTestId('geotech-divide-boreholes')).toBeDisabled()
        const accept = page.getByTestId('geotech-accept-correlations')
        await expect(accept).toBeEnabled()
        await accept.click()
        await expect(page.getByTestId('geotech-pending-tie-chip')).toHaveCount(0, {
          timeout: 30_000,
        })
      } else {
        // Every derived tie was a restatement — nothing to review.
        await expect(page.getByTestId('geotech-pending-tie-chip')).toHaveCount(0)
      }

      // Step 4 through the toolbar — unlocked because nothing is pending.
      await page.getByTestId('geotech-pipeline').click()
      const divide = page.getByTestId('geotech-divide-boreholes')
      await expect(divide).toBeEnabled({ timeout: 30_000 })
      await divide.click()

      // Completion = the borehole carries committed geotech bands.
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ([base, pid, gid]) => {
                const r = await fetch(`${base}/projects/${pid}/geology/models/${gid}/layers`)
                const layers = (await r.json()) as { borehole_id: string | null }[]
                return layers.filter(l => l.borehole_id != null).length
              },
              [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
            ),
          { timeout: 60_000 },
        )
        .toBeGreaterThanOrEqual(1)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
