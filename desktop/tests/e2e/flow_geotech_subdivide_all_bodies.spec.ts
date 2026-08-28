/**
 * Flow — Geotechnical "Subdivide all bodies" end-to-end.
 *
 * Exercises the full geotech subdivision flow on the seeded synthetic fixture.
 *
 * Architecture note — why the API is called directly
 * ---------------------------------------------------
 * This spec predates the clean-slate axis fix (2026-08-05, ``03a3d86a9``):
 * back then the Geotech axis radio was disabled until a geotech model
 * existed, so the toolbar path could not be clicked on a first run and the
 * endpoint was called directly via ``page.evaluate`` (the
 * ``flow_auto_correlate`` pattern), followed by a project re-open to pick up
 * the new model. The toolbar path is now walked end-to-end by
 * ``flow_geotech_pipeline_clean_slate.spec.ts``; THIS spec deliberately keeps
 * the API route — its subject is the subdivision RESULT reaching the Geotech
 * spine-stage inspector, not the toolbar entry.
 *
 * Endpoint
 * --------
 * ``POST /projects/{projectId}/geology/models/{lithoModelId}/geotech/subdivide-all-bodies``
 * body: ``{ litho_model_id }`` — the operation is model-wide (every in-model
 * investigation is classified in one atomic pass); the body's
 * ``litho_model_id`` MUST equal the URL ``model_id`` (the handler rejects a
 * mismatch with 422). It is NOT section-scoped.
 *
 * Steps
 * -----
 *   1. Open the fixture project + resolve litho model id.
 *   2. Call the subdivision endpoint.
 *   3. Assert the response: HTTP 200, body_count ≥ 1.
 *   4. Re-open the project so the shell picks up the newly created geotech
 *      model and NAD formations (React state only refreshes on project open).
 *   5. Navigate to the Geotech spine stage.
 *   6. Assert ≥1 NAD unit row (``geotech-unit-row-*``) in the
 *      ``GeotechnicalInspector`` — and NO "CPT est." badge on it.
 *
 * Fixture reuse
 * -------------
 * No fixture changes — the existing Section B scenario (CPTs 3/4/5 with qc
 * series + accepted KLEI/ZAND contacts + bilateral body) supplies everything
 * the subdivider needs.  The fixture is NOT extended.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 *
 * NOTE: this flow MUTATES the fixture by creating a geotechnical model + NAD
 * formation rows.  ``build_synthetic_fixture.py``'s ``_cleanup_litho_state``
 * removes non-fixture models (including geotech) on re-run, so re-seed
 * before running the full suite from scratch.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_geotech_subdivide_all_bodies', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test(
    'subdivide all bodies creates NAD units, unbadged',
    async () => {
      // API call + project re-open + inspector render — slow budget.
      test.slow()

      const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
      let tmpPath = ''
      try {
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

        // Step 1: Resolve the active lithostratigraphic model id.
        // Mirrors flow_auto_correlate: fetch via page.evaluate so we hit the
        // same backend instance the app uses.
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

        // Step 2: Call the subdivision endpoint.
        // Same HTTP call the frontend handleSubdivideAllBodies fires. The
        // operation is model-wide (not section-scoped): the request body
        // carries litho_model_id, which the handler asserts equals the URL
        // model_id. The fixture's Section B (CPTs 3/4/5 with qc series +
        // accepted KLEI/ZAND contacts + a bilateral body) is what the
        // subdivider classifies, but no section_id is passed.
        const subdivideResult = await page.evaluate(
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

        // Step 3: Verify the endpoint succeeded.
        expect(
          subdivideResult.status,
          `subdivide-all-bodies returned HTTP ${subdivideResult.status}: ${JSON.stringify(subdivideResult.body)}`,
        ).toBe(200)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respBody = subdivideResult.body as any
        expect(
          typeof respBody.body_count,
          'response must include body_count',
        ).toBe('number')
        expect(
          respBody.body_count,
          'at least one body must be classified (fixture Section B has KLEI + ZAND bodies)',
        ).toBeGreaterThanOrEqual(1)

        // Step 4: Re-open the project so the shell picks up the newly created
        // geotech model + NAD formations.  The React state for
        // geotechFormations/activeGeotechModel only refreshes when the project
        // is opened (useGeologicalModel's [project] useEffect), so a plain
        // navigate-to-stage would show the stale pre-subdivision state.
        // Re-opening re-fetches the bundle (GET /bundle) which now includes the
        // geotech model row, so useGeologicalModel initialises correctly.
        //
        // openFixtureProject expects the welcome screen to be visible on entry,
        // but after the subdivision API call the shell is still mounted.
        // A plain page.reload() resets renderer state to the welcome screen
        // (no persisted project state across reloads) so the second open works.
        await page.reload()
        await page.waitForLoadState('domcontentloaded')
        await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

        // Step 5: Navigate to the Geotech spine stage.
        await goToStage(page, 'Geotech')

        // Step 6: At least one NAD unit row must be visible in the inspector.
        // The subdivider created NAD formations (geotechFormations filters on
        // isGeotechUnit); the geotechLayers useEffect loads them via listLayers.
        await expect(
          page.locator('[data-testid^="geotech-unit-row-"]').first(),
        ).toBeVisible({ timeout: 30_000 })

        // ...and it carries NO "CPT est." badge. Owner ruling 2026-08-27,
        // verbatim: *"CPT. est. die flag mag eruit, bijna alle
        // packingsklassen zijn altijd uit sonderingen afgeleid"* — being
        // cone-derived is the NORM, so it is unbadged; only the exceptions
        // ("No CPT" / "No CPT (partial)") badge. CPTs 3/4/5 carry real qc
        // series, so every unit here is cone-derived and must be plain.
        // The unit suite pins the same absence
        // (GeotechnicalInspector.test.tsx asserts queryByTestId(...) is null);
        // this spec had kept asserting the retired badge.
        await expect(page.locator('[data-testid^="cpt-est-badge-"]')).toHaveCount(0)
      } finally {
        await closeApp(app)
        cleanupFixtureFile(tmpPath)
      }
    },
  )
})
