/**
 * Flow — Lithology 3D stage: Facies competition solid render smoke
 * (Task 9, Litho 3D milestone 3 — watertight).
 *
 * Guards the ``assemble_facies_competitors`` path in ``build_body_solids``:
 * when a shared body has ≥2 distinct neighbours directly above (or below) it,
 * the builder routes each competitor through a clipped-prism partition instead
 * of the single-patch shared-surface path.
 *
 * WHY this spec exists separately from flow_litho_solids:
 *   ``flow_litho_solids`` exercises the common single-patch case (one KLEI
 *   body spanning three aligned CPTs — no facies).  This spec exercises the
 *   multi-patch facies case:
 *
 *     Section E — CPTs 11 / 12 / 13 (y + 1200 m)
 *       CPT-11: ZAND@1 m / KLEI@4 m
 *       CPT-12: ZAND@1 m / KLEI@4 m
 *       CPT-13: VEEN@1 m / KLEI@4 m
 *
 *   KLEI is correlated across all three CPTs (one KLEI body).
 *   ZAND is correlated CPT-11 ↔ CPT-12 (one ZAND body).
 *   VEEN sits only on CPT-13 (one single-column VEEN body).
 *   Both ZAND and VEEN sit directly above the same KLEI → the KLEI body has
 *   two distinct upper neighbours → ``len(ups) >= 2`` → facies path fires.
 *
 * WHY setup mirrors flow_litho_solids:
 *   ``LithologyCanvas`` only renders the viewer branch (Solid / Fence toggle)
 *   when ``hasLithoSurfaces`` is true.  That flag reads
 *   ``lithoSurfacesByFormationId``, fetched once on project-open.  We seed
 *   formation contacts on the litho model and trigger a surface rebuild
 *   BEFORE ``openFixtureProject`` so the first fetch finds real surface rows.
 *   Identical to the fence + solids spec strategy.
 *
 * WHY the fixture extension is minimal:
 *   Three new CPTs (indices 11 / 12 / 13) at y + 1200 m carry no qc series
 *   (``_FACIES_CPT_INDICES``), so ``suggest-litho`` skips them — other specs
 *   that run suggest/accept on all CPTs cannot contaminate this scenario.
 *   ``_seed_action_scenarios_async`` inserts the six contacts + three edges
 *   and stamps them onto Section E's ``seeded_formation_contact_ids``.
 *
 * Acceptance criteria (mount + no-crash + competitor lithologies present —
 * geometry correctness is covered by the Vitest / Python unit layers):
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
 *   5. The solid legend shows at least two distinct lithology group headers —
 *      the facies competitors (ZAND + VEEN) plus the shared KLEI.  We assert
 *      ≥2 group headers are visible, confirming the build produced multiple
 *      bodies.
 *   6. The decisive facies check: the single-CPT VEEN body builds as a real
 *      prism (``is_flagged=false`` via the ``litho-solids`` API), NOT an M2
 *      disk marker (``is_flagged=true``).  Criterion 5 alone is too weak — it
 *      passes even if the facies path failed and both competitors fell back to
 *      M2.  A single-column body is un-triangulable under M2 → flagged disk
 *      markers; under the facies path it is a clipped prism → not flagged.  A
 *      "PEAT" group-header DOM cross-check rides alongside.
 *
 * Mirrors: flow_litho_solids.spec.ts (harness + setup pattern).
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set) with Section E contacts.
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

test.describe('flow_litho_facies', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test(
    'Build Solids with facies competition produces ≥2 lithology groups and no crash',
    async () => {
      test.slow() // seeds contacts + rebuilds TINs + renders 3D viewer + builds solids with facies path

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
        //    Same pattern as flow_litho_fence_diagram + flow_litho_solids:
        //    copy the geological model's contacts (14 CPTs across 5 Y-rows →
        //    non-degenerate TIN; Section E adds facies CPTs 11/12/13) onto the
        //    litho model so RebuildModelSurfaces
        //    produces real vertices.  ``useGeologicalModel`` fetches
        //    lithoSurfacesByFormationId once on project-open, so surfaces must
        //    exist before the project is opened.
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
        //    The facies-competition bodies (ZAND, VEEN above shared KLEI) are
        //    present in the litho model from the fixture seed.  The build
        //    triggers ``build_body_solids`` which routes them through
        //    ``assemble_facies_competitors`` (multi-patch path).
        //    Wait for the button to re-enable (exits "Building…" state).
        // -----------------------------------------------------------------------
        const buildBtn = page.getByTestId('litho-build-solids-button')
        await expect(buildBtn).toBeVisible({ timeout: 10_000 })
        await buildBtn.click()

        // Button becomes disabled while building; wait for it to re-enable.
        await expect(buildBtn).toBeEnabled({ timeout: 30_000 })

        // -----------------------------------------------------------------------
        // 9. No error overlay after the build completes.
        //    The Cesium canvas must still be present — if the viewer crashed
        //    and unmounted to EmptyState this assertion fails.
        // -----------------------------------------------------------------------
        await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })

        // The toggle buttons remaining attached proves the hasLithoSurfaces
        // branch did not flip back (no error unmount).
        await expect(solidBtn).toBeAttached()
        await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()

        // -----------------------------------------------------------------------
        // 10. The solid legend is present (build produced ≥1 solid).
        // -----------------------------------------------------------------------
        const legend = page.getByTestId('litho-solid-legend')
        await expect(legend).toBeVisible({ timeout: 5_000 })

        // -----------------------------------------------------------------------
        // 11. ≥2 lithology group headers visible in the legend.
        //
        //     The facies scenario seeds at least three distinct lithologies
        //     (KLEI, ZAND, VEEN) each resolved into a separate body by the
        //     resolver.  The legend groups by formation, so we expect ≥2 group
        //     header buttons.  A single-group legend would mean the facies path
        //     collapsed all competitors into one body — a real build failure.
        //
        //     We use ``[data-testid^="solid-group-header-"]`` rather than a
        //     fixed count so the assertion survives future fixture additions
        //     that might add more bodies in other sections.
        // -----------------------------------------------------------------------
        const groupHeaders = legend.locator('[data-testid^="solid-group-header-"]')
        // Wait for at least one group header to appear (auto-wait), then read
        // the actual count.  Playwright's ``locator.count()`` does not auto-wait,
        // so we first assert ≥1 with a short timeout to let React commit the
        // legend rows, then snapshot the raw number.
        await expect(groupHeaders.first()).toBeVisible({ timeout: 5_000 })
        const groupCount = await groupHeaders.count()
        expect(groupCount, 'Facies build must produce ≥2 lithology groups in the legend').toBeGreaterThanOrEqual(2)

        // -----------------------------------------------------------------------
        // 12. The single-CPT VEEN competitor is a real PRISM, not a disk marker.
        //
        //     This is the assertion that actually validates the facies path ran.
        //     The ≥2-group check above is too weak: it passes even if the facies
        //     path FAILED and both competitors fell back to the M2 single-patch /
        //     disk-marker path (the legend would still show ≥2 lithology groups —
        //     KLEI + ZAND alone clears the bar, and a VEEN that built as a disk
        //     marker still renders its own group header).
        //
        //     KEY DISTINCTION: VEEN sits on a SINGLE CPT (CPT-13). Under the OLD
        //     M2 builder a single-column body is un-triangulable → it emits
        //     vertical disk markers with ``is_flagged=true``. Under the NEW facies
        //     path VEEN builds as a real clipped prism → ``is_flagged=false``.
        //     So asserting the VEEN body solid has ``is_flagged=false`` proves the
        //     facies-competition prism path actually fired for the single-CPT body.
        //
        //     We go to the API rather than the DOM because the legend's per-body
        //     marker note ("(N markers)") is only visible when a group is expanded
        //     AND only distinguishes flagged bodies — the API exposes the per-body
        //     ``is_flagged`` flag directly and unambiguously. We map the VEEN
        //     formation by ``litho_main_soil_code === 'VEEN'`` (the fixture seeds
        //     ``form("VEEN facies …", "VEEN", …)``), then find the solid whose
        //     ``formation_id`` matches and assert it is a non-flagged prism.
        // -----------------------------------------------------------------------
        const veenCheck = await page.evaluate(
          async ([base, pid, mid]) => {
            const fr = await fetch(`${base}/projects/${pid}/geology/formations`)
            if (!fr.ok) return { error: `formations fetch: ${fr.status}` }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const formations: any[] = await fr.json()
            const veenIds = new Set(
              formations
                .filter(f => f.litho_main_soil_code === 'VEEN')
                .map(f => f.id as string),
            )

            const sr = await fetch(`${base}/projects/${pid}/geology/models/${mid}/litho-solids`)
            if (!sr.ok) return { error: `litho-solids fetch: ${sr.status}` }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const solids: any[] = await sr.json()
            const veenSolids = solids.filter(s => veenIds.has(s.formation_id as string))
            return {
              veenFormationCount: veenIds.size,
              veenSolidCount: veenSolids.length,
              // True only if EVERY VEEN body is a real prism (facies path).
              // Under M2 the single-CPT VEEN body would be a flagged disk marker.
              allVeenPrisms:
                veenSolids.length > 0 && veenSolids.every(s => s.is_flagged === false),
            }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
        )

        expect(
          (veenCheck as { error?: string }).error,
          'VEEN solid check should not error',
        ).toBeUndefined()
        const vc = veenCheck as {
          veenFormationCount: number
          veenSolidCount: number
          allVeenPrisms: boolean
        }
        expect(vc.veenFormationCount, 'Fixture must define a VEEN formation').toBeGreaterThan(0)
        expect(
          vc.veenSolidCount,
          'The single-CPT VEEN competitor must build a body solid (not be dropped)',
        ).toBeGreaterThan(0)
        expect(
          vc.allVeenPrisms,
          'Single-CPT VEEN must build as a facies PRISM (is_flagged=false), not an M2 disk marker (is_flagged=true) — confirms the facies path ran',
        ).toBe(true)

        // DOM cross-check: the VEEN body renders under a "PEAT" group header
        // (formatLithoDisplayName maps VEEN → "Peat" → upper-cased "PEAT").
        // Belt-and-braces alongside the API assertion above.
        await expect(
          legend.locator('[data-testid^="solid-group-header-"]').filter({ hasText: 'PEAT' }),
        ).toHaveCount(1)
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
    },
  )
})
