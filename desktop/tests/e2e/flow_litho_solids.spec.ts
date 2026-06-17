/**
 * Flow — Lithology 3D stage: deterministic VOXEL build regression gate.
 *
 * Guards the VOXEL litho-3D builder end-to-end — the path the in-app "Build
 * model" button now drives (``LithologyStage`` → ``buildVoxelLithoModel`` →
 * ``POST .../litho-solids/build-voxel``).  The retired implicit strat-field
 * ``POST .../litho-solids/rebuild`` endpoint is NO LONGER what Build calls; this
 * spec was repurposed accordingly (was: strat-field rebuild + a 90 s wait).
 *
 * WHY this builds against a self-contained THROWAWAY model rather than the
 * fixture's own litho model:
 *   The voxel build bounds the labelling by the PARENT geological model's built
 *   surfaces when they are usable (non-stale).  The fixture's litho model has a
 *   parent geo model, and earlier specs in the suite (e.g. flow_crossing_validator
 *   / flow_build_3d_model) rebuild those geo surfaces — so whether geo-bounding is
 *   active by the time this spec runs is SUITE-ORDER-DEPENDENT.  Building a
 *   hand-authored coarse payload at synthetic coordinates against bounded
 *   surfaces that don't cover that footprint is a flake.  To make the voxel-path
 *   gate deterministic regardless of order, we create a throwaway empty geological
 *   model (no built surfaces → the build runs UN-BOUNDED, exactly like the
 *   integration test BV-1's empty parent) + a litho model parented to it, build
 *   the voxel payload against THAT, assert, and delete it in ``finally``.  This
 *   isolates "does the voxel build produce watertight voxel solids" from the
 *   shared fixture's mutable geo-surface state.
 *
 * Payload: mirrors integration test BV-1 (tests/integration/api/test_build_voxel.py)
 *   — two cross-sections forming an L over three non-collinear columns carrying a
 *   ZAND / KLEI / ZAND interbedded stack plus a SILT lens pinching inside the KLEI
 *   on section 0.  Tiny ~20×20 m footprint, ``grid_spacing_m: 2.0`` +
 *   ``vertical_spacing_m: 1.0`` (NEVER the 0.5 m production vertical — that
 *   explodes the voxel count and makes the build slow).  The voxel build is
 *   labelling-from-partition, so it produces solids from the supplied payload
 *   alone — no DB picks / correlation edges needed (per BV-1).
 *
 * The viewer-mount UI smoke (Cesium canvas / Solid mode) is intentionally NOT
 * here — it is suite-order-fragile (needs solids on the ACTIVE fixture litho
 * model) and is already covered by flow_litho_fence_diagram.spec.ts.  This spec's
 * job is the deterministic voxel-BUILD regression gate; the button→build wiring
 * is covered by LithologyStage.toolbar.test.tsx + geology.buildVoxel.test.ts.
 *
 * Acceptance criteria:
 *   1. ``POST .../litho-solids/build-voxel`` returns 200 with ``bodies_built > 0``
 *      and ``bodies_flagged === 0``.
 *   2. Every returned solid is ``method === 'voxel'`` with ``is_flagged === false``
 *      and non-empty vertices + triangles, and ``solids.length === bodies_built``.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { launchApp, closeApp } from './helpers/electron_launch'

/** Integration DB connection string (the e2e runner points DATABASE_URL here). */
function dbUrl(): string {
  return (
    process.env.DATABASE_URL ??
    'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'
  )
}

/**
 * Create a self-contained throwaway model pair for a deterministic, un-bounded
 * voxel build: an empty geological model (no built surfaces → no geo-band
 * bounding) plus a lithostratigraphic model parented to it (a litho model
 * requires a parent — a null parent violates the model-kind constraint).  Also
 * returns three real ``geological_formation`` ids (``litho_body_solid.formation_id``
 * is an FK; ``body_id`` is not, so payload body ids can be arbitrary UUIDs).
 *
 * Parameters
 * ----------
 * projectId
 *     The fixture project to attach the throwaway models + reuse formations from.
 *
 * Returns
 * -------
 * geoId, lithoId, formationIds
 *     The throwaway model ids (to build against + clean up) and ≥3 real
 *     formation ids for the payload regions.
 */
async function createThrowawayModels(
  projectId: string,
): Promise<{ geoId: string; lithoId: string; formationIds: string[] }> {
  const client = new Client({ connectionString: dbUrl() })
  await client.connect()
  try {
    const geoId = randomUUID()
    const lithoId = randomUUID()
    await client.query(
      `INSERT INTO geological_model (id, app_project_id, name, kind)
       VALUES ($1, $2, '__e2e_voxel_geo', 'geological')`,
      [geoId, projectId],
    )
    await client.query(
      `INSERT INTO geological_model (id, app_project_id, name, kind, parent_geological_model_id)
       VALUES ($1, $2, '__e2e_voxel_litho', 'lithostratigraphic', $3)`,
      [lithoId, projectId, geoId],
    )
    const fr = await client.query(
      `SELECT id FROM geological_formation WHERE app_project_id = $1 ORDER BY display_order LIMIT 3`,
      [projectId],
    )
    return { geoId, lithoId, formationIds: fr.rows.map((r) => r.id as string) }
  } finally {
    await client.end()
  }
}

/** Delete the throwaway models + any voxel solids they built (restores clean state). */
async function deleteThrowawayModels(geoId: string, lithoId: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl() })
  await client.connect()
  try {
    await client.query('DELETE FROM litho_body_solid WHERE model_id = $1', [lithoId])
    await client.query('DELETE FROM geological_model WHERE id = ANY($1::uuid[])', [[lithoId, geoId]])
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

  test('Voxel build produces watertight voxel solids (method=voxel, 0 flagged)', async () => {
    test.slow() // launches Electron for the renderer-side API call

    // The build POST must originate from the renderer (port 8765 is reachable
    // from the renderer context; a Node-side cross-origin fetch is blocked).
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let throwaway: { geoId: string; lithoId: string; formationIds: string[] } | null = null

    try {
      // Backend up + renderer ready before any API call.
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // Self-contained, un-bounded target (order-independent — see file header).
      throwaway = await createThrowawayModels(FIXTURE_PROJECT_ID)
      expect(
        throwaway.formationIds.length,
        'fixture must expose ≥3 formations for the payload',
      ).toBeGreaterThanOrEqual(3)

      // --- API-level VOXEL build (the deterministic regression gate) ----------
      // Coarse BV-1 payload: two sections (L) over three non-collinear columns;
      // a ZAND / KLEI / ZAND stack with a SILT lens pinching inside the KLEI on
      // section 0.  Field names mirror VoxelBuildRequest EXACTLY.  Coarse spacing
      // (2.0 m horizontal, 1.0 m vertical — NEVER 0.5 m) keeps the build fast.
      const buildResult = await page.evaluate(
        async ([base, pid, mid, fIds]) => {
          const [fZand, fKlei, fSilt] = fIds
          const uuid = (): string =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (crypto as any).randomUUID() as string
          const bZandTop = uuid()
          const bKlei = uuid()
          const bZandBot = uuid()
          const bSiltLens = uuid()
          const colA = { investigation_id: uuid(), along_m: 0.0, world_x: 0.0, world_y: 0.0 }
          const colB = { investigation_id: uuid(), along_m: 20.0, world_x: 20.0, world_y: 0.0 }
          const colC = { investigation_id: uuid(), along_m: 22.4, world_x: 10.0, world_y: 20.0 }
          const band = (formationId: string, bodyId: string, top: number, base: number) => ({
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
          const lens = (formationId: string, bodyId: string, top: number, base: number) => ({
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
          // Status-safe: a 5xx returns a non-JSON body ("Internal Server Error")
          // — read it as text so the assertion surfaces the real error instead of
          // a JSON-parse SyntaxError.
          if (!r.ok) return { status: r.status, body: await r.text() }
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, throwaway.lithoId, throwaway.formationIds] as const,
      )

      expect(
        buildResult.status,
        `build-voxel should return 200; body: ${(buildResult as { body?: string }).body ?? ''}`,
      ).toBe(200)
      const json = (buildResult as { json: Record<string, unknown> }).json
      expect(json.bodies_built as number, 'voxel build must produce ≥1 body').toBeGreaterThan(0)
      expect(json.bodies_flagged as number, 'voxel build must flag no body').toBe(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const solids = json.solids as any[]
      expect(solids.length, 'response solids must match bodies_built').toBe(json.bodies_built)
      for (const solid of solids) {
        expect(solid.method, 'every solid must be a voxel solid').toBe('voxel')
        expect(solid.is_flagged, 'no solid may be flagged').toBe(false)
        expect(solid.vertices.length, 'voxel solid must have vertices').toBeGreaterThan(0)
        expect(solid.triangles.length, 'voxel solid must have triangles').toBeGreaterThan(0)
      }
    } finally {
      try {
        if (throwaway) {
          await deleteThrowawayModels(throwaway.geoId, throwaway.lithoId)
        }
      } catch {
        /* non-fatal — the next run's TRUNCATE clears the integration DB */
      }
      await closeApp(app)
    }
  })
})
