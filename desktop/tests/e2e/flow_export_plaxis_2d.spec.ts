/**
 * Flow X — Export: Plaxis 2D per-section script (debt #130).
 *
 * Acceptance criteria:
 *
 * Setup:
 *   Uses the fixture's Section A + geological model. The fixture has 6
 *   CPTs with ``elevation_m`` recorded — all within Section A's buffer
 *   (200 m around y=214_000).
 *
 *   ``beforeAll`` seeds Section A via the "Seed from stratigraphy" endpoint
 *   (borehole BH-E2E-SEED-U, which shares the fixture with Flow U). This
 *   populates ``seeded_formation_contact_ids`` so the snapshot carries
 *   formations → the script body is non-trivial. ``afterAll`` clears the
 *   seeded set.
 *
 * Happy path:
 *   GET ``/projects/{pid}/sections/{sid}/export/plaxis2d?model_id={mid}``
 *   - HTTP 200.
 *   - ``Content-Type: text/x-python``.
 *   - Body contains ``g_i.soilmat(`` calls (one per formation — at least 1).
 *   - Body contains ``g_i.soillayer(`` calls (global layer stack).
 *   - Body contains ``g_i.borehole(`` calls (one per exported column with Z).
 *   - Body contains ``g_i.setsoillayerlevel(`` calls (per borehole × layer).
 *
 * No-investigation path:
 *   A scratch section pointing at empty space (far from all fixture CPTs)
 *   produces HTTP 200 with a no-op script body (exporter emits
 *   "nothing to export" comment when ``not exportable``).
 *
 * IDOR check:
 *   GET Plaxis 2D with wrong project_id → 404.
 *
 * Regression anchor:
 *   Commenting out the ``g_i.setsoillayerlevel`` loop in
 *   ``PlaxisSectionExporter._emit_boreholes`` would cause the
 *   ``hasSetSoilLayerLevel`` assertion to fail, catching the regression.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { listSectionsByProject, getGeologicalModelId } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'
const WRONG_PROJECT_ID = '00000000-dead-4000-a000-000000000003'

// Borehole seeded by Flow U beforeAll (same deterministic id).
const SEED_BH_ID = 'e2e00010-0001-4000-a000-000000000001'

test.describe('flow_export_plaxis_2d (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  let sectionAId: string | null = null
  let geoModelId: string | null = null
  let scratchSectionId: string | null = null

  test.beforeAll(async () => {
    // Resolve Section A and the geological model.
    const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
    const sectionA = sections.sort((a, b) => a.display_order - b.display_order)[0]
    if (!sectionA) throw new Error('Flow X: Section A not found')
    sectionAId = sectionA.id

    geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
    if (!geoModelId) throw new Error('Flow X: no geological model in fixture')

    // Seed the borehole for Flow U if it doesn't exist yet (idempotent restore).
    await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format_version: 3,
        project: {
          id: FIXTURE_PROJECT_ID,
          name: 'E2E Smoke Project',
          project_number: 'SMOKE-2026-001',
          client: 'E2E Test Client',
          site_label: 'Smoke Site',
          description: 'Synthetic fixture for Playwright smoke harness',
          tags: ['e2e', 'smoke'],
          default_horizontal_epsg: 31370,
          default_vertical_epsg: 5710,
          phase: 'investigation',
          status: 'active',
          view_state: {},
        },
        cpts: [],
        boreholes: [
          {
            id: SEED_BH_ID,
            name: 'BH-E2E-SEED-U',
            location_x: 157_600.0,
            location_y: 214_050.0,
            elevation_m: 4.2,
            epsg: 31370,
            z_epsg: 5710,
            elevation_source: 'surveyed',
            original_elevation_m: null,
            original_z_epsg: null,
            original_elevation_source: null,
            total_depth_m: 10.0,
            pre_drill_m: null,
            water_depth_m: null,
            drill_method: null,
            dov_permkey: null,
            drill_segments: [],
            field_log_intervals: [],
            observations: [
              {
                id: 'e2e00011-0001-4000-a000-000000000001',
                borehole_id: SEED_BH_ID,
                dov_permkey: null,
                observation_type: 'formal_stratigraphy',
                author: 'E2E fixture',
                observation_date: '2026-01-01',
                reliability: null,
                score_category: null,
                drill_method_score: null,
                layers: [
                  {
                    id: 'e2e00012-0001-4000-a000-000000000001',
                    observation_id: 'e2e00011-0001-4000-a000-000000000001',
                    top_m: 0.0,
                    base_m: 2.0,
                    color: null,
                    main_soil_codes: [],
                    description: 'Quaternary',
                    layer_index: 0,
                    admixtures: [],
                  },
                  {
                    id: 'e2e00013-0001-4000-a000-000000000001',
                    observation_id: 'e2e00011-0001-4000-a000-000000000001',
                    top_m: 2.0,
                    base_m: 5.0,
                    color: null,
                    main_soil_codes: [],
                    description: 'Tertiary Clay',
                    layer_index: 1,
                    admixtures: [],
                  },
                  {
                    id: 'e2e00014-0001-4000-a000-000000000001',
                    observation_id: 'e2e00011-0001-4000-a000-000000000001',
                    top_m: 5.0,
                    base_m: 10.0,
                    color: null,
                    main_soil_codes: [],
                    description: 'Tertiary Sand',
                    layer_index: 2,
                    admixtures: [],
                  },
                ],
              },
            ],
            samples: [],
          },
        ],
        geological_formations: [],
        geotechnical_units: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
        litho_correlation_edges: [],
        litho_lenses: [],
        formation_absences: [],
      }),
    })

    // Seed Section A so it has formation contacts (needed for non-trivial script).
    await fetch(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models/${geoModelId}/contacts/auto-populate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borehole_ids: [SEED_BH_ID],
          section_id: sectionAId,
          create_missing_formations: false,
        }),
      },
    )

    // Create a scratch section far from all fixture investigations (no-investigation path).
    const createResp = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E-Flow-X-NoInv',
        start_x: 100_000.0,
        start_y: 100_000.0,
        end_x: 100_500.0,
        end_y: 100_000.0,
        epsg: 31370,
        projection_buffer_m: 10.0,
      }),
    })
    if (!createResp.ok) throw new Error('Flow X: could not create scratch section')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await createResp.json() as any
    scratchSectionId = created.id as string
  })

  test.afterAll(async () => {
    // Reset Section A's seeded set.
    if (sectionAId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionAId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeded_formation_contact_ids: [] }),
      }).catch(() => {})
    }
    // Delete the scratch section.
    if (scratchSectionId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${scratchSectionId}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
  })

  test('happy path: Plaxis 2D script contains all expected keywords', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      const result = await page.evaluate(
        async ([base, pid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/sections/${sid}/export/plaxis2d?model_id=${mid}`,
          )
          const text = await r.text()
          return {
            status: r.status,
            contentType: r.headers.get('content-type') ?? '',
            bodyLength: text.length,
            hasSoilMat: text.includes('g_i.soilmat('),
            hasSoilLayer: text.includes('g_i.soillayer('),
            hasBorehole: text.includes('g_i.borehole('),
            hasSetSoilLayerLevel: text.includes('g_i.setsoillayerlevel('),
            hasPlxScripting: text.includes('from plxscripting'),
          }
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionAId, geoModelId],
      )

      // Status and content type.
      expect(result.status).toBe(200)
      expect(result.contentType).toContain('text/x-python')

      // Non-empty script.
      expect(result.bodyLength).toBeGreaterThan(200)

      // Script structure keywords.
      expect(result.hasPlxScripting).toBe(true)
      expect(result.hasSoilMat).toBe(true)
      expect(result.hasSoilLayer).toBe(true)
      // Fixture CPTs have elevation_m → at least one borehole call.
      expect(result.hasBorehole).toBe(true)
      // REGRESSION ANCHOR: setsoillayerlevel calls must always be present
      // when there are exportable columns.
      expect(result.hasSetSoilLayerLevel).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('no-investigation path: section with empty corridor emits no-op script (200)', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(scratchSectionId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      // The scratch section is far from all fixture CPTs → 0 exportable columns.
      const result = await page.evaluate(
        async ([base, pid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/sections/${sid}/export/plaxis2d?model_id=${mid}`,
          )
          const text = await r.text()
          return {
            status: r.status,
            hasNothingToExport: text.includes('nothing to export'),
          }
        },
        [API_BASE, FIXTURE_PROJECT_ID, scratchSectionId, geoModelId],
      )

      // 200 even for empty section — exporter handles gracefully.
      expect(result.status).toBe(200)
      expect(result.hasNothingToExport).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('IDOR check: wrong project_id → 404', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      const idor = await page.evaluate(
        async ([base, wrongPid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${wrongPid}/sections/${sid}/export/plaxis2d?model_id=${mid}`,
          )
          return r.status
        },
        [API_BASE, WRONG_PROJECT_ID, sectionAId, geoModelId],
      )
      expect(idor).toBe(404)
    } finally {
      await closeApp(app)
    }
  })
})
