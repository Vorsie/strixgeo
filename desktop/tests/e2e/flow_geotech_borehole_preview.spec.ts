/**
 * Flow — packing preview over undivided boreholes, end to end.
 *
 * The gap this covers (owner dogfeed 2026-08-04): *"correlation bands aren't
 * plotted over boreholes so it is impossible to see how divide-all-boreholes
 * will act — what gets what packing — before you click the button."*
 *
 * ``Subdivide all bodies`` materialises CPT packing bands only and defers every
 * borehole-mediated edge to ``Divide boreholes``, so a borehole column on the
 * geotech axis is blank until that verb runs. The preview endpoint plans the
 * verb without writing, and the geotech axis draws the plan as hatched ghost
 * bands.
 *
 * What this spec pins, that no unit test can
 * ------------------------------------------
 * That the whole chain lines up on real seeded data: the endpoint plans
 * something for a real borehole, the canvas actually draws it on the geotech
 * axis, the legend that names the hatching appears with it, and the ghosts are
 * gone once the real divide has run. The band-for-band equality of preview and
 * commit is a BACKEND gate (integration ``test_db5_preview_equals_commit``) —
 * that one belongs where the rows are, not where the pixels are.
 *
 * Steps
 * -----
 *   1. Open the fixture project + resolve the litho model id.
 *   2. ``subdivide-all-bodies`` (creates the geotech model, CPT bands only).
 *   3. ``divide-boreholes/preview`` — assert it plans ≥ 1 borehole column and
 *      that it wrote nothing (the boreholes still carry no geotech layer).
 *   4. Re-open the project so the shell picks up the geotech model.
 *   5. Sections stage → open Section B → switch to the Geotech axis.
 *   6. Assert the ghost overlay + the "hatched = preview" legend are visible.
 *   7. Press "Divide boreholes"; assert the ghosts disappear (the committed
 *      bands own the column now).
 *
 * Fixture expectations
 * --------------------
 * The synthetic fixture must have at least one BOREHOLE that shares a litho
 * body with a CPT — otherwise there is nothing to plan and step 3 fails. That
 * failure is deliberate rather than a skip: a silently-passing spec here would
 * be indistinguishable from a broken preview.
 *
 * ``build_synthetic_fixture.py`` supplies exactly that on SECTION B: BH-E2E-01
 * sits at the east end of the transect carrying the same seeded KLEI/ZAND units
 * as CPT-3/4/5, correlated to CPT-5 so the resolver puts it in both bodies.
 * Section B is therefore the section this spec opens — the CPTs there are also
 * the only ones with a qc series, so they are the only ones ``Subdivide all
 * bodies`` can give real packing bands to, which in turn is what the planner
 * interpolates onto the borehole. Opening any other section would show an
 * empty geotech axis and no ghosts. (Same reason ``flow_geotech_subdivide_all_
 * bodies`` leans on Section B.)
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

test.describe('flow_geotech_borehole_preview', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('undivided boreholes show ghost packing bands until Divide boreholes runs', async () => {
    // API calls + two project opens + canvas render — slow budget.
    test.slow()

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Step 1: resolve the active lithostratigraphic model id.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID] as const,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel, 'fixture must have a lithostratigraphic model').toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // Step 2: subdivide. This creates the geotech model and CPT bands, and
      // leaves every borehole column empty — the state the preview exists for.
      const subdivide = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/geotech/subdivide-all-bodies`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ litho_model_id: mid }),
            },
          )
          return { status: r.status, body: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )
      expect(
        subdivide.status,
        `subdivide-all-bodies returned HTTP ${subdivide.status}: ${JSON.stringify(subdivide.body)}`,
      ).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geotechModelId: string = (subdivide.body as any).geotech_model_id

      // Step 3: the dry run. It must plan real bands AND write nothing.
      const preview = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/geotech/divide-boreholes/preview`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          return { status: r.status, body: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )
      expect(
        preview.status,
        `preview returned HTTP ${preview.status}: ${JSON.stringify(preview.body)}`,
      ).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previewBody = preview.body as any
      expect(
        previewBody.columns.length,
        'the fixture must have a borehole sharing a litho body with a CPT, ' +
          'or there is nothing to preview',
      ).toBeGreaterThanOrEqual(1)
      expect(previewBody.layer_count).toBeGreaterThanOrEqual(1)

      // A preview writes nothing: every borehole must still be band-less.
      const layersAfterPreview = await page.evaluate(
        async ([base, pid, gid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${gid}/layers`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, geotechModelId] as const,
      )
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (layersAfterPreview as any[]).filter((l: any) => l.borehole_id != null).length,
        'the preview endpoint must not write borehole geotech layers',
      ).toBe(0)

      // Step 4: re-open so the shell picks up the geotech model (React state
      // for activeGeotechModel only refreshes on project open).
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Step 5: open Section B (the only section carrying a borehole) and
      // switch to the geotech axis.
      await goToStage(page, 'Sections')
      const sectionRow = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionRow).toBeVisible({ timeout: 10_000 })
      await sectionRow.click()
      await page.getByRole('radio', { name: 'Geotech' }).click()

      // Step 6: the ghosts and the legend that names them.
      await expect(page.getByTestId('geotech-borehole-preview-ghosts')).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByTestId('geotech-preview-legend')).toBeVisible({ timeout: 10_000 })

      // Step 7: commit. The ghosts must give way to the real bands — a preview
      // that lingered next to the thing it predicted would be worse than none.
      await page.getByTestId('geotech-divide-boreholes').click()
      await expect(page.getByTestId('geotech-borehole-preview-ghosts')).toHaveCount(0, {
        timeout: 30_000,
      })
      await expect(page.getByTestId('geotech-preview-legend')).toHaveCount(0, { timeout: 10_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
