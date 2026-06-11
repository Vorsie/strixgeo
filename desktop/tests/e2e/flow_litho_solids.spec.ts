/**
 * Flow — Lithology 3D stage: Build Solids + Solid mode smoke (Task 10,
 * Litho 3D milestone 2).
 *
 * Guards the Build Solids button (``LithologyStage`` toolbar) + Solid-mode
 * render path — proves the complete loop (surface exists → viewer mounts →
 * switch to Solid → click Build → solids appear → no crash) wires up
 * end-to-end.  The grouped-by-lithology body legend lives in
 * ``LithologyInspector``, not on the canvas.
 *
 * WHY setup mirrors flow_litho_fence_diagram:
 *   ``LithologyCanvas`` only renders the viewer branch (Build button +
 *   Solid/Fence toggle) when ``hasLithoSurfaces`` is true.  That flag reads
 *   ``lithoSurfacesByFormationId``, which is fetched ONCE on project-open
 *   (``[project, activeLithoModel]`` effect in ``useGeologicalModel``).
 *   Running the litho surface rebuild BEFORE ``openFixtureProject`` ensures
 *   the first fetch finds real surface rows and ``hasLithoSurfaces`` is true
 *   when ``LithologyCanvas`` mounts.  This is identical to the fence spec's
 *   strategy; see the fence spec for the detailed rationale.
 *
 * WHY the fixture supports this spec without modification:
 *   The e2e fixture seeds a lithostratigraphic model with accepted contacts
 *   and a KLEI body spanning CPT-3/4/5 (Section B) — a bilateral body whose
 *   correlated layers give the ``RebuildLithoSolids`` use case something to
 *   triangulate.  The same contacts are used to seed litho surface rows via
 *   ``POST .../surfaces/rebuild`` (non-degenerate TIN sourced from the
 *   geological model, as in the fence spec).  The Build button therefore has
 *   both surfaces (viewer visible) and bodies (non-empty solid result) to
 *   work with.
 *
 * Acceptance criteria (mount + no-crash only — geometry correctness is
 * covered by the Vitest unit and integration test layers):
 *
 *   1. After setup, the Litho 3D stage shows the viewer (not EmptyState):
 *      ``litho-view-mode-solid`` button is visible.
 *   2. Solid mode is the default — ``aria-pressed="true"`` on solid,
 *      ``aria-pressed="false"`` on fence.
 *   3. Clicking ``litho-build-solids-button`` triggers a build; after the
 *      button exits its "Building…" state (disabled state clears), no error
 *      overlay is shown.
 *   4. The Cesium canvas (``id`` prefix ``cesium-viewport-``) stays visible
 *      after the build: no crash, no unmount to EmptyState.
 *
 * Mirrors: flow_litho_fence_diagram.spec.ts (surface-seed + viewer mount
 * pattern), flow_build_3d_model.spec.ts (API-level rebuild idiom).
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import { getGeologicalModelId } from './helpers/db_helper'
import { Client } from 'pg'

/**
 * Delete all ``formation_surface`` rows for a litho model.
 *
 * Called in the ``finally`` block to restore the no-surfaces state so
 * ``flow_lithology_stage_ui`` (which expects EmptyState) is not broken by
 * this spec's rebuild step.  Direct SQL is used because there is no public
 * surface-delete endpoint.
 *
 * Parameters
 * ----------
 * modelId
 *     UUID of the lithostratigraphic model whose surface rows should be removed.
 */
async function deleteLithoSurfaces(modelId: string): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('DELETE FROM formation_surface WHERE model_id = $1', [modelId])
  } finally {
    await client.end()
  }
}

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_litho_solids', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('Build Solids button produces solids and the Cesium canvas stays mounted', async () => {
    test.slow() // seeds contacts + rebuilds TINs + renders 3D viewer + builds solids

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    let geoModelId: string | null = null
    let lithoModelId: string | null = null
    const seededContactIds: string[] = []

    try {
      // -----------------------------------------------------------------------
      // 1. Resolve model IDs from the DB (Node-side DB helper).
      // -----------------------------------------------------------------------
      geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
      expect(geoModelId, 'Fixture must have a geological model').not.toBeNull()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      geoModelId = geoModelId!

      lithoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'lithostratigraphic')
      expect(lithoModelId, 'Fixture must have a lithostratigraphic model').not.toBeNull()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      lithoModelId = lithoModelId!

      // -----------------------------------------------------------------------
      // 2. Wait for the Welcome screen so the backend is up and serving
      //    before making any API calls from the renderer.
      // -----------------------------------------------------------------------
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // -----------------------------------------------------------------------
      // 3. Seed formation contacts on the litho model + rebuild litho surfaces
      //    BEFORE opening the project.
      //
      //    Same pattern as flow_litho_fence_diagram: copy the geological
      //    model's contacts (14 CPTs across 5 Y-rows → non-degenerate TIN;
      //    Section E adds facies CPTs 11/12/13) onto the litho model so
      //    RebuildModelSurfaces produces real vertices.
      //    ``useGeologicalModel`` fetches lithoSurfacesByFormationId once on
      //    project-open, so surfaces must exist before the project is opened.
      //
      //    Duplicate contacts (409) are tolerated for re-run safety.
      // -----------------------------------------------------------------------
      const seedResult = await page.evaluate(
        async ([base, pid, geoMid, lithoMid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${geoMid}/contacts`)
          if (!r.ok) return { error: `geo contacts fetch: ${r.status}` }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts: any[] = await r.json()
          if (contacts.length === 0) return { error: 'geo model has 0 contacts' }

          const createdIds: string[] = []
          let skipped = 0
          let failed = 0
          for (const c of contacts) {
            const cr = await fetch(
              `${base}/projects/${pid}/geology/models/${lithoMid}/contacts`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  formation_id: c.formation_id,
                  cpt_id: c.cpt_id ?? null,
                  borehole_id: c.borehole_id ?? null,
                  depth_top_m: c.depth_top_m,
                  source: 'manual_pick',
                  confidence: c.confidence ?? 'medium',
                }),
              },
            )
            if (cr.status === 201) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const body: any = await cr.json()
              createdIds.push(body.id as string)
            } else if (cr.status === 409) skipped++
            else failed++
          }
          return { seeded: createdIds.length, skipped, failed, total: contacts.length, createdIds }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, lithoModelId] as const,
      )

      expect((seedResult as { error?: string }).error, 'contact seed should not error').toBeUndefined()
      const sr = seedResult as {
        seeded: number
        skipped: number
        failed: number
        total: number
        createdIds: string[]
      }
      expect(sr.seeded + sr.skipped, 'no contacts reached litho model').toBeGreaterThan(0)
      seededContactIds.push(...(sr.createdIds ?? []))

      // -----------------------------------------------------------------------
      // 4. Rebuild litho surfaces so hasLithoSurfaces is true on project-open.
      // -----------------------------------------------------------------------
      const rebuildRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/surfaces/rebuild`,
            { method: 'POST' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )
      expect(rebuildRes.status, 'Litho surface rebuild should return 200').toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rebuildRes.json as any).formations_rebuilt, 'At least one TIN should build').toBeGreaterThan(0)

      // -----------------------------------------------------------------------
      // 5. Open the fixture project.
      //    useGeologicalModel's surface effect fires here and finds the now-
      //    existing rows → hasLithoSurfaces will be true when LithologyCanvas
      //    mounts.
      // -----------------------------------------------------------------------
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // -----------------------------------------------------------------------
      // 6. Navigate to the Litho stage.
      //    LithologyCanvas renders the viewer branch only when
      //    hasLithoSurfaces is true.
      // -----------------------------------------------------------------------
      await goToStage(page, 'Litho')

      // The Solid button is the viewer-branch mount sentinel.
      // Long timeout: Cesium WebGL context initialisation is slow.
      const solidBtn = page.getByTestId('litho-view-mode-solid')
      await expect(solidBtn).toBeVisible({ timeout: 30_000 })

      // -----------------------------------------------------------------------
      // 7. Solid mode is the default.
      // -----------------------------------------------------------------------
      await expect(solidBtn).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
        'aria-pressed',
        'false',
      )

      // -----------------------------------------------------------------------
      // 8. Click Build Solids.
      //    The button is positioned top-right inside the viewer (top-8 right-2
      //    z-20) — Playwright's auto-wait scrolls to it if needed.
      //    Wait for it to exit the disabled "Building…" state before asserting,
      //    giving the backend enough time to triangulate the solids.
      // -----------------------------------------------------------------------
      const buildBtn = page.getByTestId('litho-build-solids-button')
      await expect(buildBtn).toBeVisible({ timeout: 10_000 })
      await buildBtn.click()

      // Button becomes disabled while building; wait for it to re-enable.
      // Uses toBeEnabled (inverse of disabled) which Playwright auto-waits on.
      await expect(buildBtn).toBeEnabled({ timeout: 30_000 })

      // -----------------------------------------------------------------------
      // 9. No error overlay after the build completes.
      //    The EmptyState fallback (icon Layers3) should NOT be visible — if it
      //    is, the viewer crashed and unmounted to the empty branch.
      //    The viewer element (``id`` prefix ``cesium-viewport-``) must still
      //    be present and visible.
      // -----------------------------------------------------------------------
      await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })

      // The toggle buttons remaining attached proves the hasLithoSurfaces
      // branch did not flip back (no error unmount).
      await expect(solidBtn).toBeAttached()
      await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()

      // Solid legend should now be present (solids were built).
      await expect(page.getByTestId('litho-solid-legend')).toBeVisible({ timeout: 5_000 })
    } finally {
      // -----------------------------------------------------------------------
      // Cleanup: remove the formation contacts seeded on the litho model and
      // the formation_surface rows the rebuild created.
      //
      // This restores the no-surfaces state that flow_lithology_stage_ui and
      // flow_per_instance_body expect (both specs rely on EmptyState or a
      // model with 0 seeded formation contacts).
      // -----------------------------------------------------------------------
      try {
        if (lithoModelId && seededContactIds.length > 0) {
          const mid = lithoModelId
          const ids = [...seededContactIds]
          await page.evaluate(
            async ([base, pid, m, contactIds]) => {
              for (const cid of contactIds as string[]) {
                await fetch(
                  `${base}/projects/${pid}/geology/models/${m}/contacts/${cid}`,
                  { method: 'DELETE' },
                )
              }
            },
            [API_BASE, FIXTURE_PROJECT_ID, mid, ids] as const,
          )
        }
      } catch {
        /* non-fatal — next run's fixture restore resets the DB */
      }

      try {
        if (lithoModelId) {
          await deleteLithoSurfaces(lithoModelId)
        }
      } catch {
        /* non-fatal — next run's truncate cleans up */
      }

      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
