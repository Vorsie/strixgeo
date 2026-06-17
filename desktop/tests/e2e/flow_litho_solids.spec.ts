/**
 * Flow — Lithology 3D stage: VOXEL build + Solid-mode mount smoke.
 *
 * Guards the VOXEL litho-3D builder end-to-end — the path the in-app "Build
 * model" button now drives (``LithologyStage`` → ``buildVoxelLithoModel`` →
 * ``POST .../litho-solids/build-voxel``).  The retired implicit strat-field
 * ``POST .../litho-solids/rebuild`` endpoint is NO LONGER what Build calls; this
 * spec was repurposed accordingly (was: strat-field rebuild + 90 s wait).
 *
 * Two-part shape:
 *
 *   1. API-level voxel build (the robust, deterministic regression gate).
 *      POSTs a COARSE-spacing ``VoxelBuildRequest`` (mirrors integration test
 *      BV-1 in ``tests/integration/api/test_build_voxel.py``: a two-section L
 *      over three non-collinear columns carrying a ZAND / KLEI / ZAND
 *      interbedded stack plus a SILT lens that pinches inside the KLEI).  Tiny
 *      ~20×20 m footprint, ``grid_spacing_m: 2.0`` + ``vertical_spacing_m: 1.0``
 *      (NEVER the 0.5 m production vertical — that explodes the voxel count and
 *      makes the build slow).  Asserts: ``bodies_built > 0``; every returned
 *      solid is ``method === 'voxel'`` with non-empty vertices + triangles and
 *      ``is_flagged === false``; ``bodies_flagged === 0``.  The voxel build is
 *      labelling-from-partition, so it produces solids from the supplied payload
 *      alone — it does NOT require DB picks / correlation edges (per BV-1).
 *
 *   2. UI smoke (mount + no-crash only — geometry correctness lives in the
 *      Vitest + integration layers).  Opens the project (the API build above
 *      already wrote ``method='voxel'`` rows, so ``hasLithoSolids`` is true on
 *      open → ``LithologyCanvas`` mounts the viewer), navigates to Litho, and
 *      asserts the Cesium canvas mounts + stays mounted and the solid legend is
 *      visible.
 *
 * WHY this spec asserts against API-built solids instead of clicking
 * ``litho-build-model-button``:
 *   The in-app Build button POSTs ``lithoVoxelRequestCallback.current`` — a
 *   payload the *canvas* assembles from an OPEN litho-axis cross-section (the
 *   live ``computeSectionFill`` partition).  Without an open section the ref is
 *   undefined and the click is a guarded no-op.  Driving that reliably in the
 *   harness means scripting a full section-open + Suggest + Accept flow, which
 *   is orthogonal to "does the voxel build path produce watertight solids".  So
 *   the deterministic voxel-path gate is the API build (part 1), and the button
 *   wiring itself is covered by the Vitest toolbar test
 *   (``LithologyStage.toolbar.test.tsx``) + the client-shape test
 *   (``geology.buildVoxel.test.ts``).  The UI smoke here proves the built voxel
 *   solids mount the 3-D pane without crashing.
 *
 * Acceptance criteria:
 *   1. The API voxel build returns ``bodies_built > 0``, ``bodies_flagged === 0``,
 *      and every solid is ``method === 'voxel'`` with non-empty geometry.
 *   2. After opening the project, the Litho stage shows the viewer (not
 *      EmptyState): ``litho-view-mode-solid`` is visible + default-pressed.
 *   3. The Cesium canvas (``id`` prefix ``cesium-viewport-``) mounts + stays
 *      visible; ``litho-solid-legend`` is visible (solids exist).
 *
 * Mirrors: flow_litho_fence_diagram.spec.ts (surface-seed + viewer-mount
 * pattern), test_build_voxel.py BV-1 (the known-good coarse payload).
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
 * ``flow_lithology_stage_ui`` (which expects EmptyState) is not broken by this
 * spec's voxel build.  The Litho 3D pane mounts when built solids exist
 * (``hasLithoSolids``), so leftover ``method='voxel'`` rows would keep the
 * viewer mounted for downstream specs.  Direct SQL is used because there is no
 * public solid-delete endpoint.
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

test.describe('flow_litho_solids', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('Voxel build produces watertight voxel solids and the Cesium canvas mounts', async () => {
    test.slow() // API voxel build + 3D viewer mount under Electron + WebGL

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    let lithoModelId: string | null = null

    try {
      // -----------------------------------------------------------------------
      // 1. Resolve the lithostratigraphic model id from the DB (Node helper).
      // -----------------------------------------------------------------------
      lithoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'lithostratigraphic')
      expect(lithoModelId, 'Fixture must have a lithostratigraphic model').not.toBeNull()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      lithoModelId = lithoModelId!

      // -----------------------------------------------------------------------
      // 2. Wait for the Welcome screen so the backend is up and serving before
      //    any API call from the renderer (port 8765 is only reachable inside
      //    the renderer — the main-process CSP blocks cross-origin Node fetch).
      // -----------------------------------------------------------------------
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // -----------------------------------------------------------------------
      // 3. API-level VOXEL build (the deterministic regression gate).
      //
      //    Build a COARSE, hand-authored VoxelBuildRequest mirroring BV-1: two
      //    sections forming an L over three non-collinear columns (so the domain
      //    hull builds), each gap carrying a ZAND / KLEI / ZAND interbedded stack
      //    with a SILT lens pinching inside the KLEI on section 0.
      //
      //    Real formation_ids are required (litho_body_solid.formation_id is an
      //    FK) — we derive them from the project's formations (the fixture's
      //    geological + litho models share the project formation vocabulary).
      //    body_id is NOT an FK so any UUID works.
      //
      //    Field names mirror VoxelBuildRequest EXACTLY:
      //      sections[] { start_x, start_y, end_x, end_y, columns[], regions[] }
      //      columns[]  { investigation_id, along_m, world_x, world_y }
      //      regions[]  { formation_id, body_id, polygon: [[fraction, elev]], gap_index }
      //      top-level  grid_spacing_m, vertical_spacing_m
      //    Coarse spacing: grid_spacing_m 2.0 m, vertical_spacing_m 1.0 m
      //    (NEVER 0.5 m — that is the production vertical and explodes the build).
      // -----------------------------------------------------------------------
      const buildResult = await page.evaluate(
        async ([base, pid, mid]) => {
          // Need >=3 distinct real formation ids (ZAND / KLEI / SILT analogues).
          const fr = await fetch(`${base}/projects/${pid}/geology/formations`)
          if (!fr.ok) return { error: `formations fetch: ${fr.status}` }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const formations: any[] = await fr.json()
          if (formations.length < 3) {
            return { error: `need >=3 formations for the payload; got ${formations.length}` }
          }
          const fZand = formations[0].id as string
          const fKlei = formations[1].id as string
          const fSilt = formations[2].id as string

          // Stable-enough body ids (any UUID — body_id is not an FK).  Generated
          // inline so re-runs get fresh ids (the build upserts by body_id, and a
          // prior run's rows are cleaned up in finally, but fresh ids are safest).
          const uuid = (): string =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (crypto as any).randomUUID() as string
          const bZandTop = uuid()
          const bKlei = uuid()
          const bZandBot = uuid()
          const bSiltLens = uuid()

          // Three non-collinear columns A=(0,0) B=(20,0) C=(10,20).
          const colA = { investigation_id: uuid(), along_m: 0.0, world_x: 0.0, world_y: 0.0 }
          const colB = { investigation_id: uuid(), along_m: 20.0, world_x: 20.0, world_y: 0.0 }
          const colC = { investigation_id: uuid(), along_m: 22.4, world_x: 10.0, world_y: 20.0 }

          // Full-width band [(0,top),(1,top),(1,base),(0,base)].
          const band = (
            formationId: string,
            bodyId: string,
            top: number,
            base: number,
          ): {
            formation_id: string
            body_id: string
            polygon: number[][]
            gap_index: number
          } => ({
            formation_id: formationId,
            body_id: bodyId,
            polygon: [
              [0.0, top],
              [1.0, top],
              [1.0, base],
              [0.0, base],
            ],
            gap_index: 0,
          })

          // Lens: full thickness at the left column, pinches to a point at fraction 1.
          const lens = (
            formationId: string,
            bodyId: string,
            top: number,
            base: number,
          ): {
            formation_id: string
            body_id: string
            polygon: number[][]
            gap_index: number
          } => ({
            formation_id: formationId,
            body_id: bodyId,
            polygon: [
              [0.0, top],
              [1.0, (top + base) / 2.0],
              [0.0, base],
            ],
            gap_index: 0,
          })

          const payload = {
            sections: [
              {
                start_x: 0.0,
                start_y: 0.0,
                end_x: 20.0,
                end_y: 0.0,
                columns: [colA, colB],
                regions: [
                  band(fZand, bZandTop, 0.0, -3.0),
                  band(fKlei, bKlei, -3.0, -7.0),
                  lens(fSilt, bSiltLens, -4.0, -6.0),
                  band(fZand, bZandBot, -7.0, -10.0),
                ],
              },
              {
                start_x: 20.0,
                start_y: 0.0,
                end_x: 10.0,
                end_y: 20.0,
                columns: [colB, colC],
                regions: [
                  band(fZand, bZandTop, 0.0, -3.0),
                  band(fKlei, bKlei, -3.0, -7.0),
                  band(fZand, bZandBot, -7.0, -10.0),
                ],
              },
            ],
            // Coarse cubic X/Y + a 1 m vertical (never 0.5 m) → fast, watertight.
            grid_spacing_m: 2.0,
            vertical_spacing_m: 1.0,
          }

          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/litho-solids/build-voxel?force=true`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          )
          const json = await r.json()
          return { status: r.status, json }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )

      expect((buildResult as { error?: string }).error, 'voxel build setup should not error').toBeUndefined()
      const br = buildResult as {
        status: number
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json: any
      }
      expect(br.status, 'build-voxel should return 200').toBe(200)

      // The voxel-path assertions (mirror BV-1).
      expect(br.json.bodies_built, 'voxel build must produce at least one body').toBeGreaterThan(0)
      expect(br.json.bodies_flagged, 'voxel build must not flag any body').toBe(0)
      expect(
        br.json.solids.length,
        'response solids must match bodies_built',
      ).toBe(br.json.bodies_built)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const solid of br.json.solids as any[]) {
        expect(solid.method, 'every solid must be a voxel solid').toBe('voxel')
        expect(solid.is_flagged, 'no solid may be flagged').toBe(false)
        expect(solid.vertices.length, 'voxel solid must have vertices').toBeGreaterThan(0)
        expect(solid.triangles.length, 'voxel solid must have triangles').toBeGreaterThan(0)
      }

      // -----------------------------------------------------------------------
      // 4. Open the fixture project.  useLithoSolids fetches the now-existing
      //    method='voxel' rows on open → hasLithoSolids is true when
      //    LithologyCanvas mounts.
      // -----------------------------------------------------------------------
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // -----------------------------------------------------------------------
      // 5. Navigate to the Litho stage.  LithologyCanvas renders the viewer
      //    branch only when hasLithoSolids is true.
      // -----------------------------------------------------------------------
      await goToStage(page, 'Litho')

      // The Solid button is the viewer-branch mount sentinel.
      // Sane 30 s timeout: Cesium WebGL context initialisation is slow under
      // Electron, but the voxel solids already exist (built in step 3) so there
      // is no build wait here — only the WebGL mount.  (Was a stale 90 s wait
      // that referenced the retired implicit strat-field builder's build time.)
      const solidBtn = page.getByTestId('litho-view-mode-solid')
      await expect(solidBtn).toBeVisible({ timeout: 30_000 })

      // -----------------------------------------------------------------------
      // 6. Solid mode is the default.
      // -----------------------------------------------------------------------
      await expect(solidBtn).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('litho-view-mode-fence')).toHaveAttribute(
        'aria-pressed',
        'false',
      )

      // -----------------------------------------------------------------------
      // 7. Cesium canvas mounts + stays visible (no crash, no unmount to
      //    EmptyState).  The toggle buttons remaining attached proves the
      //    hasLithoSolids branch did not flip back.
      // -----------------------------------------------------------------------
      await expect(page.locator('[id^="cesium-viewport-"]')).toBeVisible({ timeout: 10_000 })
      await expect(solidBtn).toBeAttached()
      await expect(page.getByTestId('litho-view-mode-fence')).toBeAttached()

      // Solid legend should be present (the voxel solids built in step 3 exist).
      await expect(page.getByTestId('litho-solid-legend')).toBeVisible({ timeout: 5_000 })
    } finally {
      // -----------------------------------------------------------------------
      // Cleanup: remove the litho_body_solid rows the voxel build created so the
      // no-solids state that flow_lithology_stage_ui + flow_per_instance_body
      // expect (EmptyState / no built solids) is restored.  No formation
      // contacts were seeded here (the voxel build needs none), so only the
      // solid rows need removing.
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
  })
})
