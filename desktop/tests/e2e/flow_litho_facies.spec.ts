/**
 * Flow — Lithology 3D stage: Multi-lithology solid render smoke
 * (originally Task 9 facies spec; updated for the implicit strat-field builder).
 *
 * Guards the multi-lithology path of ``build_strat_model``: when a section
 * carries more than one lithology (ZAND and VEEN above a shared KLEI), the
 * implicit strat-field builder produces one watertight solid per distinct body
 * resolved by the correlation graph — including a body present on a single
 * column (the single-CPT VEEN).
 *
 * WHY this spec exists separately from flow_litho_solids:
 *   ``flow_litho_solids`` exercises the common multi-column case (one KLEI
 *   body spanning three aligned CPTs).  This spec exercises the multi-lithology
 *   scenario with a single-column minority body:
 *
 *     Section E — CPTs 11 / 12 / 13 (y + 1200 m)
 *       CPT-11: ZAND@1 m / KLEI@4 m
 *       CPT-12: ZAND@1 m / KLEI@4 m
 *       CPT-13: VEEN@1 m / KLEI@4 m
 *
 *   KLEI is correlated across all three CPTs (one KLEI body).
 *   ZAND is correlated CPT-11 ↔ CPT-12 (one ZAND body).
 *   VEEN sits only on CPT-13 (one single-column VEEN body).
 *
 * WHY setup mirrors flow_litho_solids:
 *   ``LithologyCanvas`` only renders the viewer branch (Solid / Fence toggle)
 *   when ``hasLithoSolids`` is true (litho-3D plan: the pane mounts on built
 *   solids, not retired TIN surfaces).  We seed formation contacts on the litho
 *   model and trigger a SOLID rebuild BEFORE ``openFixtureProject`` so the first
 *   solid fetch finds real rows.  Identical to the fence + solids spec strategy.
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
 *   3. Clicking ``litho-build-model-button`` triggers a build; after the
 *      button exits its "Building…" state (disabled state clears), no error
 *      overlay is shown.
 *   4. The Cesium canvas (``id`` prefix ``cesium-viewport-``) stays visible
 *      after the build: no crash, no unmount to EmptyState.
 *   5. The solid legend shows at least two distinct lithology group headers —
 *      confirming the build produced multiple distinct lithology bodies.
 *   6. The decisive single-column check: the single-CPT VEEN body builds as a
 *      real solid volume (``is_flagged=false`` AND ``triangles.length > 0`` via
 *      the ``litho-solids`` API).  The implicit strat-field builder gives EVERY
 *      body a real watertight prism, including single-column bodies — there are
 *      no flagged disk-markers (the old M2/M3 per-body-TIN/disk-marker path was
 *      retired with the loft builder in Task 8–9).  A "PEAT" group-header DOM
 *      cross-check rides alongside.
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
 * Delete all ``litho_body_solid`` rows for a litho model.
 *
 * Called in the ``finally`` block to restore the no-solids state so
 * ``flow_lithology_stage_ui`` (which expects EmptyState) is not broken by
 * this spec's solid-rebuild step.  The Litho 3D pane mounts when built solids
 * exist (``hasLithoSolids``), so leftover solid rows would keep the viewer
 * mounted for downstream specs.  Direct SQL is used because there is no public
 * solid-delete endpoint.
 *
 * Parameters
 * ----------
 * modelId
 *     UUID of the lithostratigraphic model whose solid rows should be removed.
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

test.describe('flow_litho_facies', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  // The implicit strat-field builder (build_strat_model, Task 6–9) gives EVERY
  // body a watertight height-field prism by construction — including a body
  // present on a single column (where other builders emitted flagged disk
  // markers).  The old per-body-TIN / facies-prism / disk-marker builder was
  // retired in Task 8–9; there are no flagged bodies from build_strat_model.
  // Criterion 12 asserts that directly (is_flagged === false AND
  // triangles.length > 0) for the single-CPT VEEN body.
  test(
    'Build Solids with facies competition produces ≥2 lithology groups and no crash',
    async () => {
      test.slow() // seeds contacts + rebuilds TINs + renders 3D viewer + builds solids with strat-field builder

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

            // CRITICAL: do NOT copy geological contacts onto the facies CPTs.
            // The facies scenario (Section E, CPTs 11/12/13) is pre-seeded
            // directly on the litho model with a CLEAN ZAND/VEEN-directly-over-
            // KLEI stack — that direct adjacency is exactly what
            // ``assemble_facies_competitors`` keys on.  When this spec runs
            // after other specs that have populated the *geological* model's
            // contacts (e.g. flow_build_3d_model seeds the fixture's geo model
            // with Q@0/TC@2/TS@5 on every CPT, including 11/12/13), copying
            // them across inserts a Tertiary-Clay contact at 2 m BETWEEN the
            // VEEN@1 m and KLEI@4 m facies units.  VEEN is then no longer a
            // direct upper neighbour of the shared KLEI body, the facies path
            // never fires for it, and the single-CPT VEEN body collapses to an
            // M2 disk marker (``is_flagged=true``) — breaking criterion 12.
            // The facies CPTs are identified as those that already carry a
            // litho contact for a "%facies%" formation (the fixture's
            // pre-seeded scenario).
            const fr0 = await fetch(`${base}/projects/${pid}/geology/formations`)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allForms: any[] = fr0.ok ? await fr0.json() : []
            const faciesFormIds = new Set(
              allForms
                .filter(f => typeof f.name === 'string' && f.name.includes('facies'))
                .map(f => f.id as string),
            )
            const lr0 = await fetch(`${base}/projects/${pid}/geology/models/${lithoMid}/contacts`)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lithoContacts0: any[] = lr0.ok ? await lr0.json() : []
            const faciesCptIds = new Set(
              lithoContacts0
                .filter(c => faciesFormIds.has(c.formation_id as string) && c.cpt_id)
                .map(c => c.cpt_id as string),
            )

            const createdIds: string[] = []
            let skipped = 0
            let failed = 0
            let skippedFacies = 0
            for (const c of contacts) {
              // Skip any geological contact on a facies CPT — keep that column's
              // pre-seeded ZAND/VEEN-over-KLEI stack pristine.
              if (c.cpt_id && faciesCptIds.has(c.cpt_id as string)) {
                skippedFacies++
                continue
              }
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
            return {
              seeded: createdIds.length,
              skipped,
              failed,
              skippedFacies,
              total: contacts.length,
              createdIds,
            }
          },
          [API_BASE, FIXTURE_PROJECT_ID, geoModelId, lithoModelId] as const,
        )

        expect((seedResult as { error?: string }).error, 'contact seed should not error').toBeUndefined()
        const sr = seedResult as {
          seeded: number
          skipped: number
          failed: number
          skippedFacies: number
          total: number
          createdIds: string[]
        }
        expect(sr.seeded + sr.skipped, 'no contacts reached litho model').toBeGreaterThan(0)
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
        // 5. Open the fixture project.
        //    useLithoSolids fetches the now-existing solid rows on open →
        //    hasLithoSolids will be true when LithologyCanvas mounts.
        // -----------------------------------------------------------------------
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

        // -----------------------------------------------------------------------
        // 6. Navigate to the Litho stage.
        //    LithologyCanvas renders the viewer branch only when
        //    hasLithoSolids is true.
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
        //    The multi-lithology scenario (ZAND, VEEN above a shared KLEI) is
        //    present in the litho model from the fixture seed.  The build runs
        //    build_strat_model (the implicit strat-field builder), which fits the
        //    cubic-RBF potential field then assembles watertight prisms per band.
        //    Wait for the button to re-enable (exits "Building…" state).
        // -----------------------------------------------------------------------
        const buildBtn = page.getByTestId('litho-build-model-button')
        await expect(buildBtn).toBeVisible({ timeout: 10_000 })
        await buildBtn.click()

        // Button becomes disabled while building; wait for it to re-enable.
        // The strat builder fits the RBF + assembles watertight height-field
        // prisms; the renderer then refetches + re-renders every body mesh in
        // Cesium.  Under e2e load (Electron + WebGL) the round-trip can approach
        // a minute.
        // TODO(task-11): tighten the build-wait once the real test.strix strat
        // build time is measured; 90 s is deliberately generous until then.
        await expect(buildBtn).toBeEnabled({ timeout: 90_000 })

        // -----------------------------------------------------------------------
        // 9. No error overlay after the build completes.
        //    The Cesium canvas must still be present — if the viewer crashed
        //    and unmounted to EmptyState this assertion fails.
        // -----------------------------------------------------------------------
        await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })

        // The toggle buttons remaining attached proves the hasLithoSolids
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
        //     The multi-lithology scenario seeds at least three distinct lithologies
        //     (KLEI, ZAND, VEEN) each resolved into a separate body by the
        //     resolver.  The legend groups by formation, so we expect ≥2 group
        //     header buttons.  A single-group legend would mean the builder
        //     collapsed all bodies into one — a real build failure.
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
        expect(groupCount, 'Multi-lithology build must produce ≥2 lithology groups in the legend').toBeGreaterThanOrEqual(2)

        // -----------------------------------------------------------------------
        // 12. The single-CPT VEEN body builds as a real watertight VOLUME, not
        //     a flagged stub.
        //
        //     This is the assertion that actually validates the builder produced
        //     a volume for every body.  The ≥2-group check above is too weak: it
        //     passes even if a competitor fell back to a degenerate / flagged
        //     body (the legend would still show its group header).
        //
        //     KEY DISTINCTION: VEEN sits on a SINGLE CPT (CPT-13). Under the
        //     implicit strat-field builder (build_strat_model, Tasks 6–9) every
        //     body is a watertight height-field prism over the shared grid, so
        //     single-column bodies get a real volume rather than a flagged marker.
        //     The old M2/M3 per-body-TIN / disk-marker paths were retired in
        //     Tasks 8–9 and build_strat_model never emits is_flagged=true bodies.
        //     Asserting ``is_flagged=false`` AND ``triangles.length > 0`` proves
        //     VEEN has a genuine volume.
        //
        //     We go to the API rather than the DOM because the API exposes the
        //     per-body ``is_flagged`` flag + ``triangles`` directly.  We map the
        //     VEEN formation by ``litho_main_soil_code === 'VEEN'`` (the fixture
        //     seeds ``form("VEEN facies …", "VEEN", …)``), then find the solid
        //     whose ``formation_id`` matches and assert it is a real volume.
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
              // True if the single-CPT VEEN body builds as a real watertight
              // volume: a non-flagged VEEN solid carrying triangles.
              // build_strat_model (Tasks 6–9) never emits is_flagged=true bodies —
              // every band is a watertight prism, even single-column ones.
              // We assert SOME (not EVERY) VEEN solid is a real volume: the
              // geology-bounding pass can split a VEEN unit into several bodies
              // across geological bands, and a band-confined or off-section copy
              // may legitimately be a zero-volume row — that is not a build
              // failure.  What proves the builder gave the single-CPT VEEN a
              // genuine volume is that AT LEAST one VEEN body has real triangles.
              veenHasVolume:
                veenSolids.some(
                  s =>
                    s.is_flagged === false &&
                    Array.isArray(s.triangles) &&
                    s.triangles.length > 0,
                ),
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
          veenHasVolume: boolean
        }
        expect(vc.veenFormationCount, 'Fixture must define a VEEN formation').toBeGreaterThan(0)
        expect(
          vc.veenSolidCount,
          'The single-CPT VEEN body must build a body solid (not be dropped)',
        ).toBeGreaterThan(0)
        expect(
          vc.veenHasVolume,
          'Single-CPT VEEN must build as a real watertight VOLUME (is_flagged=false AND triangles.length>0) — build_strat_model gives every body a height-field prism, so no disk-markers exist',
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
        // the litho_body_solid rows the rebuild + in-app Build created.
        //
        // This restores the no-solids state that flow_lithology_stage_ui and
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
            await deleteLithoSolids(lithoModelId)
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
