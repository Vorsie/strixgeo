/**
 * Flow — Lithology 3D stage: Fence-mode toggle smoke (Task 7, Litho 3D fence diagram).
 *
 * Guards the Fence/Solid toggle wiring in ``LithologyCanvas`` — the toggle only
 * renders when built body solids exist (``hasLithoSolids``; litho-3D plan: the
 * pane now mounts on solids, not retired TIN surfaces), so this spec seeds
 * formation contacts on the litho model and triggers a SOLID rebuild BEFORE
 * opening the project (so the solid fetch on project-open sees them).
 *
 * WHY setup must happen before ``openFixtureProject``:
 *   ``useLithoSolids`` fetches the solid list on project load.  Running the
 *   rebuild before ``openFixtureProject`` ensures the first solid fetch finds
 *   real rows so ``hasLithoSolids`` is true when ``LithologyCanvas`` mounts.
 *
 * WHY the spec seeds contacts:
 *   ``RebuildLithoSolids`` triangulates bodies from correlated litho layers.
 *   The fixture ships a KLEI body correlated across CPT-3/4/5 (Section B) — a
 *   triangulable (non-flagged) body — so the rebuild produces at least one
 *   solid with triangles.  We additionally copy the geological model's contacts
 *   (14 CPTs across 5 Y-rows) onto the litho model to give the build more
 *   content, mirroring the solids + facies specs.
 *
 * Acceptance criteria (no-crash + state correctness only — no WebGL pixel
 * assertions; geometry correctness is covered by the Vitest layer):
 *
 *   1. After setup, the Litho 3D stage shows the viewer (not EmptyState):
 *      ``litho-view-mode-solid`` is visible.
 *   2. Solid mode is the default — ``aria-pressed="true"`` on solid,
 *      ``aria-pressed="false"`` on fence.
 *   3. Clicking ``litho-view-mode-fence`` flips the toggle — fence button
 *      gets ``aria-pressed="true"``, solid gets ``aria-pressed="false"``.
 *   4. The Cesium canvas (``id`` prefix ``cesium-viewport-``) stays visible
 *      after the toggle: no crash, no unmount to EmptyState.
 *
 * Mirrors: flow_build_3d_model.spec.ts (API-level rebuild pattern) and
 * flow_lithology_stage_ui.spec.ts (harness / project-open / stage navigation).
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
 * Delete all ``litho_body_solid`` rows for a litho model.
 *
 * Called in the ``finally`` block to restore the no-solids state so
 * ``flow_lithology_stage_ui`` (which expects EmptyState) is not broken
 * by this spec's solid-rebuild step.  The Litho 3D pane mounts when built
 * solids exist (``hasLithoSolids``), so leftover solid rows would keep the
 * viewer mounted for downstream specs.  Direct SQL is used because there is
 * no public solid-delete endpoint.
 */
async function deleteLithoSolids(modelId: string): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('DELETE FROM litho_body_solid WHERE model_id = $1', [modelId])
  } finally {
    await client.end()
  }
}

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_litho_fence_diagram', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('Fence-mode toggle renders the fence diagram without crashing', async () => {
    test.slow() // seeds contacts + rebuilds TINs + renders 3D viewer

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    // Declared outside try so the finally cleanup block can reference them.
    let geoModelId: string | null = null
    let lithoModelId: string | null = null
    // IDs of contacts we added to the litho model — only these are removed in cleanup.
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
      // 3. Seed formation contacts on the litho model + rebuild surfaces
      //    BEFORE opening the project.
      //
      //    Critical: ``useGeologicalModel`` fetches lithoSurfacesByFormationId
      //    ONCE on project-open (effect keyed on [project, activeLithoModel]).
      //    Running rebuild AFTER the project opens leaves the map cached as
      //    empty.  Rebuilding here ensures the first fetch (on open) finds
      //    real surface rows.
      //
      //    Strategy: copy the geological model's contacts (14 CPTs across 5
      //    Y-rows → non-degenerate TIN; Section E adds facies CPTs 11/12/13)
      //    onto the litho model, then rebuild.
      //    Duplicate contacts (model+anchor+formation uniqueness constraint)
      //    return 409 — tolerated for re-run safety.
      //
      //    Why page.evaluate: port 8765 is only reachable inside the renderer
      //    (main-process CSP blocks cross-origin Node-side fetch).
      // -----------------------------------------------------------------------
      const seedResult = await page.evaluate(
        async ([base, pid, geoMid, lithoMid]) => {
          // Fetch geological model contacts (14 CPTs × 3 formations = 42 rows; Section E adds 3 series-less CPTs).
          const r = await fetch(`${base}/projects/${pid}/geology/models/${geoMid}/contacts`)
          if (!r.ok) return { error: `geo contacts fetch: ${r.status}` }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts: any[] = await r.json()
          if (contacts.length === 0) return { error: 'geo model has 0 contacts' }

          // POST each contact onto the litho model.  Track created IDs so
          // cleanup removes only what we added, not the fixture's own contacts.
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
            } else if (cr.status === 409) skipped++ // duplicate — ok
            else failed++
          }
          return { seeded: createdIds.length, skipped, failed, total: contacts.length, createdIds }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, lithoModelId] as const,
      )

      // Hard error check (fetch failure, empty model).
      expect((seedResult as { error?: string }).error, 'contact seed should not error').toBeUndefined()
      const sr = seedResult as { seeded: number; skipped: number; failed: number; total: number; createdIds: string[] }
      // At least some contacts reached the litho model (seeded or already existed).
      expect(sr.seeded + sr.skipped, 'no contacts reached litho model').toBeGreaterThan(0)
      // Track what we created so cleanup only removes those rows.
      seededContactIds.push(...(sr.createdIds ?? []))

      // -----------------------------------------------------------------------
      // 4. Rebuild litho SOLIDS so hasLithoSolids is true on project-open.
      // -----------------------------------------------------------------------
      const rebuildRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/litho-solids/rebuild`,
            { method: 'POST' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )
      expect(rebuildRes.status, 'Litho solids rebuild should return 200').toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rebuildRes.json as any).bodies_built, 'At least one body solid should build').toBeGreaterThan(0)

      // -----------------------------------------------------------------------
      // 5. Open the fixture project.  At this point ``useLithoSolids`` fetches
      //    the now-existing solid rows → ``hasLithoSolids`` will be true when
      //    LithologyCanvas mounts.
      // -----------------------------------------------------------------------
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // -----------------------------------------------------------------------
      // 6. Navigate to the Litho stage.
      //    LithologyCanvas renders the viewer (Solid / Fence buttons) when
      //    ``hasLithoSolids`` is true.
      // -----------------------------------------------------------------------
      await goToStage(page, 'Litho')

      // The Solid button is the mount sentinel — only present inside the viewer
      // branch.  Long timeout: Cesium WebGL context initialisation is slow.
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
      // 8. Switch to Fence mode.
      //
      //    The toggle is positioned ``bottom-2 left-2 z-20`` (LithologyCanvas
      //    fix 2026-06-10) so it sits CLEAR of both the Layers legend
      //    (``top-2 left-2 z-10``) and the BasemapPanel (``top-2 right-2``)
      //    that Geology3DViewer renders.  A normal Playwright ``.click()`` is
      //    sufficient — no programmatic workaround needed.
      // -----------------------------------------------------------------------
      await page.getByTestId('litho-view-mode-fence').click()

      // -----------------------------------------------------------------------
      // 9. Fence is now active; Solid is inactive.
      // -----------------------------------------------------------------------
      await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(solidBtn).toHaveAttribute('aria-pressed', 'false')

      // -----------------------------------------------------------------------
      // 10. Cesium canvas stays mounted — no crash, no unmount to EmptyState.
      //     Geology3DViewer renders ``<div id="cesium-viewport-{key}">``; it
      //     only unmounts on a hard error.  The toggle buttons remaining
      //     attached proves the ``hasLithoSolids`` branch did not flip back.
      // -----------------------------------------------------------------------
      await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('litho-view-mode-solid')).toBeAttached()
      await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()
    } finally {
      // -----------------------------------------------------------------------
      // Cleanup: remove the formation contacts we added to the litho model so
      // subsequent specs (flow_per_instance_body, flow_lithology_stage_ui, etc.)
      // that expect the litho model to have 0 formation contacts / no surfaces
      // are not broken.  Best-effort: if the app is still alive we use its page
      // context to call the delete endpoint; if it already died we skip.
      // -----------------------------------------------------------------------
      try {
        if (lithoModelId && seededContactIds.length > 0) {
          const mid = lithoModelId
          const ids = [...seededContactIds]
          await page.evaluate(
            async ([base, pid, m, contactIds]) => {
              // Delete only the contacts we added — not the fixture's own
              // action-scenario contacts (those belong to bk3/bk4/bk5 etc.).
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
        // Cleanup failure is non-fatal — the next run's fixture restore will
        // truncate the DB and re-seed, restoring the baseline state.
      }

      // Also remove the litho_body_solid rows the rebuild created.  Without
      // this, flow_lithology_stage_ui (which expects EmptyState) would see the
      // 3D viewer instead, because the solid rows persist past contact cleanup
      // and the pane mounts on hasLithoSolids.
      try {
        if (lithoModelId) {
          await deleteLithoSolids(lithoModelId)
        }
      } catch {
        /* non-fatal — next run's truncate cleans up */
      }

      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
