/**
 * Flow — Lithology 3D stage: Multi-lithology solid render smoke (facies scenario).
 *
 * Guards the multi-lithology path of the VOXEL builder: when a section carries
 * more than one lithology (ZAND and VEEN above a shared KLEI), the voxel build
 * labels 3-D space from the validated 2-D ``computeSectionFill`` partition and
 * extracts one watertight body per distinct lithology body — including a body
 * present on a single column (the single-CPT VEEN).
 *
 * WHAT DRIVES THE BUILD — the VOXEL path, exactly what ships:
 *   The in-app "Build model" toolbar button (``litho-build-model-button``) is the
 *   source-of-truth build.  It assembles the validated ``computeSectionFill``
 *   partitions from the model's accepted litho layers + visible sections and POSTs
 *   them to ``buildVoxelLithoModel`` → ``POST .../litho-solids/build-voxel`` (see
 *   useLithoSolids.ts + LithologyStage.tsx).  This spec clicks that button to
 *   materialise the solids, then asserts the multi-lithology bodies + the
 *   single-CPT VEEN body via the litho-solids API.
 *
 *   The RETIRED implicit strat-field builder (the old ``POST
 *   .../litho-solids/rebuild`` — DELETED with #237) is not exercised here.
 *   On the synthetic fixture that builder timed out (3 min) and overflowed
 *   asyncpg's bind-message buffer; the voxel path is fast (chunked persist) and
 *   never poisons the connection pool.
 *
 * WHY no pre-open ``/rebuild`` seed any more:
 *   The viewer (Solid/Fence buttons) mounts on ``hasLithoSolids``.  The old spec
 *   pre-seeded solids via ``/rebuild`` BEFORE opening, and copied the geological
 *   model's contacts onto the litho model (carefully SKIPPING the facies CPTs so
 *   the ZAND/VEEN-over-KLEI stack stayed pristine for the retired
 *   ``assemble_facies_competitors`` path).  None of that is needed now:
 *     - We build via the toolbar button AFTER opening; the ``litho-build-model-
 *       button`` lives in the stage TOOLBAR (gated only on litho-contact
 *       presence, not ``hasLithoSolids``) so it is reachable from the EmptyState.
 *     - The fixture already seeds the clean facies stack (Section E: CPT-11/12
 *       ZAND@1/KLEI@4, CPT-13 VEEN@1/KLEI@4) directly on the litho model, and the
 *       FC→LL mirror trigger gives every seeded contact an ``accepted`` litho_layer
 *       row.  The voxel build labels the partition from those layers — no
 *       contact copying, no facies-CPT skip logic.
 *
 * Acceptance criteria (mount + no-crash + competitor lithologies present —
 * geometry correctness is covered by the Vitest / Python unit layers):
 *
 *   1. After clicking Build model, the Litho 3D stage shows the viewer (not
 *      EmptyState): ``litho-view-mode-solid`` button is visible.
 *   2. Solid mode is the default — ``aria-pressed="true"`` on solid,
 *      ``aria-pressed="false"`` on fence.
 *   3. The build completed (button exited its "Building…" state) with no error
 *      overlay.
 *   4. The Cesium canvas (``id`` prefix ``cesium-viewport-``) stays visible
 *      after the build: no crash, no unmount to EmptyState.
 *   5. The solid legend shows at least two distinct lithology group headers —
 *      confirming the build produced multiple distinct lithology bodies.
 *   6. The decisive single-column check: the single-CPT VEEN body builds as a
 *      real solid volume (``is_flagged=false`` AND ``triangles.length > 0`` via
 *      the ``litho-solids`` API).  The voxel builder gives EVERY body a watertight
 *      greedy-meshed boundary, including single-column bodies — there are no
 *      flagged disk-markers.  A "PEAT" group-header DOM cross-check rides alongside.
 *
 * Mirrors: flow_litho_fence_diagram.spec.ts (in-app voxel-build harness).
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
 * this spec's voxel build.  The Litho 3D pane mounts when built solids exist
 * (``hasLithoSolids``), so leftover solid rows would keep the viewer mounted
 * for downstream specs.  Direct SQL is used because there is no public
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

  // The voxel builder gives EVERY body a watertight greedy-meshed boundary by
  // construction — including a body present on a single column (where other
  // builders emitted flagged disk markers).  The old per-body-TIN / facies-prism
  // / disk-marker builder was retired; the voxel build never emits flagged
  // bodies.  Criterion 6 asserts that directly (is_flagged === false AND
  // triangles.length > 0) for the single-CPT VEEN body.
  test(
    'Build model with facies competition produces ≥2 lithology groups and no crash',
    async () => {
      // A voxel build on the fixture takes ~50 s as a background job (label ~41 s +
      // extract ~8 s, measured 2026-09-03); the default 60 s test timeout killed the
      // app mid-labelling and the old 30 s wait for the solid toggle was too short.
      test.setTimeout(300_000)
      test.slow() // opens the shell + builds voxel solids + renders the 3D viewer

      const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
      let tmpPath = ''
      let lithoModelId: string | null = null

      try {
        // -----------------------------------------------------------------------
        // 1. Resolve the litho model id (for the VEEN API check + cleanup).
        // -----------------------------------------------------------------------
        lithoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'lithostratigraphic')
        expect(lithoModelId, 'Fixture must have a lithostratigraphic model').not.toBeNull()
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        lithoModelId = lithoModelId!

        // -----------------------------------------------------------------------
        // 2. Open the fixture project + navigate to the Litho stage.
        //    No solids exist yet → the canvas shows the guided EmptyState, but
        //    the "Build model" button is in the stage toolbar regardless.
        //    The fixture already carries the facies stack (Section E) on the
        //    litho model with accepted layers, so the build has real content.
        // -----------------------------------------------------------------------
        tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
        await goToStage(page, 'Litho')

        // -----------------------------------------------------------------------
        // 3. Click "Build model" (the VOXEL path).  Wait for the button to exit
        //    its "Building…" state (disabled clears).  The multi-lithology
        //    scenario (ZAND, VEEN above a shared KLEI) is in the litho model from
        //    the fixture seed; the voxel build labels the partition and extracts
        //    one watertight body per lithology body.
        // -----------------------------------------------------------------------
        const buildBtn = page.getByTestId('litho-build-model-button')
        await expect(buildBtn).toBeVisible({ timeout: 20_000 })
        await expect(buildBtn).toBeEnabled({ timeout: 10_000 })
        await buildBtn.click()

        // Button is disabled while building; wait for it to re-enable.  The voxel
        // build on the synthetic fixture is fast (chunked persist), but the
        // renderer must then mount Cesium + render every body mesh — allow a
        // generous window under e2e load (Electron + WebGL).
        await expect(buildBtn).toBeEnabled({ timeout: 90_000 })

        // -----------------------------------------------------------------------
        // 4. The viewer mounted: the Solid button is the viewer-branch sentinel.
        //    Long timeout: Cesium WebGL context initialisation is slow.
        // -----------------------------------------------------------------------
        const solidBtn = page.getByTestId('litho-view-mode-solid')
        await expect(solidBtn).toBeVisible({ timeout: 150_000 })

        // -----------------------------------------------------------------------
        // 5. Solid mode is the default.
        // -----------------------------------------------------------------------
        await expect(solidBtn).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
          'aria-pressed',
          'false',
        )

        // -----------------------------------------------------------------------
        // 6. No error overlay after the build completes.
        //    The Cesium canvas must still be present — if the viewer crashed
        //    and unmounted to EmptyState this assertion fails.
        // -----------------------------------------------------------------------
        await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })

        // The toggle buttons remaining attached proves the hasLithoSolids
        // branch did not flip back (no error unmount).
        await expect(solidBtn).toBeAttached()
        await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()

        // -----------------------------------------------------------------------
        // 7. The solid legend is present (build produced ≥1 solid).
        // -----------------------------------------------------------------------
        const legend = page.getByTestId('litho-solid-legend')
        await expect(legend).toBeVisible({ timeout: 5_000 })

        // -----------------------------------------------------------------------
        // 8. ≥2 lithology group headers visible in the legend.
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
        // 9. The single-CPT VEEN body builds as a real watertight VOLUME, not
        //     a flagged stub.
        //
        //     This is the assertion that actually validates the builder produced
        //     a volume for every body.  The ≥2-group check above is too weak: it
        //     passes even if a competitor fell back to a degenerate / flagged
        //     body (the legend would still show its group header).
        //
        //     KEY DISTINCTION: VEEN sits on a SINGLE CPT (CPT-13). Under the voxel
        //     builder every body is a watertight greedy-meshed boundary over the
        //     labelled grid, so single-column bodies get a real volume rather than
        //     a flagged marker.  The retired per-body-TIN / disk-marker paths never
        //     run; the voxel build never emits is_flagged=true bodies.  Asserting
        //     ``is_flagged=false`` AND ``triangles.length > 0`` proves VEEN has a
        //     genuine volume.
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
              // volume: a non-flagged VEEN solid carrying triangles.  The voxel
              // build never emits is_flagged=true bodies — every body is a
              // watertight greedy-meshed boundary, even single-column ones.
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
          'Single-CPT VEEN must build as a real watertight VOLUME (is_flagged=false AND triangles.length>0) — the voxel build gives every body a greedy-meshed boundary, so no disk-markers exist',
        ).toBe(true)

        // DOM cross-check: the VEEN body renders under a "PEAT" group header
        // (formatLithoDisplayName maps VEEN → "Peat" → upper-cased "PEAT").
        // Belt-and-braces alongside the API assertion above.
        await expect(
          legend.locator('[data-testid^="solid-group-header-"]').filter({ hasText: 'PEAT' }),
        ).toHaveCount(1)
      } finally {
        // -----------------------------------------------------------------------
        // Cleanup: remove the litho_body_solid rows the in-app Build created so
        // flow_lithology_stage_ui (which expects EmptyState) is not broken.
        //
        // No contact cleanup is needed any more: this spec no longer seeds
        // contacts onto the litho model — it builds from the fixture's own
        // seeded contacts, which downstream specs expect to remain.
        // -----------------------------------------------------------------------
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
