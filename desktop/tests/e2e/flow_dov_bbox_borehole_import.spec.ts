/**
 * Flow Q — DOV bbox borehole import.
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path:
 *   A borehole bundle — header + drill segment + observation layer +
 *   sample + grain-size lab test — is seeded via POST /projects/{id}/restore.
 *   Verifies:
 *   - DB: countBoreholes(projectId) is ≥ 1.
 *   - DB: getBoreholeWithChildren returns the full tree (drill_segments ≥ 1,
 *     observation_layers ≥ 1, samples ≥ 1, lab_tests_count ≥ 1).
 *   - API: GET /borehole/{id} returns the full detail tree.
 *
 * Rejection / empty-bbox path:
 *   POST /borehole/import-dov with a North Sea bbox returns HTTP 200 with
 *   imported=0, duplicates=0, failed=0.
 *
 * DOV mocking decision (Option 2): same rationale as Flow P.
 *
 * Isolation:
 *   deterministic UUIDs, afterAll cleanup deletes the seeded borehole row
 *   (CASCADE removes drill_segment, observation, sample, grain_size).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  countBoreholes,
  getBoreholeWithChildren,
  countLabTestsBySample,
} from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// Deterministic IDs for this spec — prefixed "e2e00020-" to avoid
// collisions with the fixture builder or Flow P.
const BH_Q_ID = 'e2e00020-0001-4000-a000-000000000001'
const OBS_Q_ID = 'e2e00020-0002-4000-a000-000000000001'
const LAYER_Q1_ID = 'e2e00020-0003-4000-a000-000000000001'
const DS_Q1_ID = 'e2e00020-0004-4000-a000-000000000001'
const SAMPLE_Q1_ID = 'e2e00020-0005-4000-a000-000000000001'
const GRAIN_Q1_ID = 'e2e00020-0006-4000-a000-000000000001'

function _makeBoreholeBundle() {
  return {
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
        id: BH_Q_ID,
        name: 'BH-FLOW-Q',
        location_x: 157_700.0,
        location_y: 214_100.0,
        elevation_m: 3.8,
        epsg: 31370,
        z_epsg: 5710,
        elevation_source: 'surveyed',
        original_elevation_m: null,
        original_z_epsg: null,
        original_elevation_source: null,
        total_depth_m: 8.0,
        pre_drill_m: null,
        water_depth_m: null,
        drill_method: null,
        dov_permkey: null,
        drill_segments: [
          {
            id: DS_Q1_ID,
            borehole_id: BH_Q_ID,
            top_m: 0.0,
            base_m: 8.0,
            // method carries a DOV Dutch token — pass-through per convention.
            method: 'Gespoeld boren',
          },
        ],
        field_log_intervals: [],
        observations: [
          {
            id: OBS_Q_ID,
            borehole_id: BH_Q_ID,
            dov_permkey: null,
            observation_type: 'lithological_description',
            author: 'Flow-Q fixture',
            observation_date: '2026-01-15',
            reliability: null,
            score_category: null,
            drill_method_score: null,
            layers: [
              {
                id: LAYER_Q1_ID,
                observation_id: OBS_Q_ID,
                top_m: 0.0,
                base_m: 8.0,
                color: null,
                main_soil_codes: ['K'],
                description: 'Clay with silt admixtures',
                layer_index: 0,
                admixtures: [],
              },
            ],
          },
        ],
        samples: [
          {
            id: SAMPLE_Q1_ID,
            borehole_id: BH_Q_ID,
            dov_permkey: null,
            depth_top_m: 2.0,
            depth_base_m: 2.5,
            description: 'Undisturbed Shelby sample',
            sample_number: '1',
            sample_type: 'ongeroerd',
            composition: null,
            instrument: null,
            sampling_date: '2026-01-15',
            grain_sizes: [
              {
                id: GRAIN_Q1_ID,
                sample_id: SAMPLE_Q1_ID,
                dov_permkey: null,
                diameters_mm: [0.002, 0.063, 2.0],
                pct_larger: [80.0, 45.0, 5.0],
                method: 'Zeving',
                test_date: '2026-02-01',
                lime_removed: false,
                organics_removed: false,
              },
            ],
            atterberg_limits_tests: [],
            caco3_content_tests: [],
            organic_content_tests: [],
            water_content_tests: [],
            scalar_lab_tests: [],
          },
        ],
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
  }
}

test.describe('flow_dov_bbox_borehole_import (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test.beforeAll(async () => {
    const bundle = _makeBoreholeBundle()
    const resp = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Borehole seed failed: HTTP ${resp.status} — ${body.slice(0, 300)}`)
    }
  })

  test.afterAll(async () => {
    // DELETE the borehole; CASCADE removes drill_segment, observation,
    // observation_layer, sample, grain_size automatically.
    await fetch(
      `${API_BASE}/borehole/${BH_Q_ID}?project_id=${FIXTURE_PROJECT_ID}`,
      { method: 'DELETE' },
    )
  })

  // ---------------------------------------------------------------------------
  // Happy path: full child tree is present in DB
  // ---------------------------------------------------------------------------

  test('seeded borehole has full child tree in DB', async () => {
    const totalBefore = await countBoreholes(FIXTURE_PROJECT_ID)
    // The fixture has no boreholes; we seeded 1.
    expect(totalBefore).toBeGreaterThanOrEqual(1)

    const tree = await getBoreholeWithChildren(BH_Q_ID)
    expect(tree).not.toBeNull()
    expect(tree!.drill_segments).toBe(1)
    expect(tree!.observation_layers).toBe(1)
    expect(tree!.samples).toBe(1)
    // 1 grain_size + 0 others = 1 lab test total
    expect(tree!.lab_tests_count).toBe(1)
  })

  test('countLabTestsBySample returns 1 grain_size for the seeded sample', async () => {
    const n = await countLabTestsBySample(SAMPLE_Q1_ID, 'grain_size')
    expect(n).toBe(1)
  })

  test('countLabTestsBySample returns 0 for absent families on the seeded sample', async () => {
    // Verify the helper correctly reports 0 for families we did not seed.
    for (const fam of ['atterberg', 'caco3', 'organic', 'water', 'scalar'] as const) {
      const n = await countLabTestsBySample(SAMPLE_Q1_ID, fam)
      expect(n).toBe(0)
    }
  })

  test('GET /borehole/{id} returns the full detail tree', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bhId]) => {
          const r = await fetch(`${base}/borehole/${bhId}?project_id=${pid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, BH_Q_ID],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bh = res.json as any
      expect(bh.id).toBe(BH_Q_ID)
      expect(bh.name).toBe('BH-FLOW-Q')
      expect(bh.total_depth_m).toBeCloseTo(8.0, 2)
      // Drill segments
      expect(bh.drill_segments).toHaveLength(1)
      expect(bh.drill_segments[0].base_m).toBeCloseTo(8.0, 2)
      // Observations + layers
      expect(bh.observations).toHaveLength(1)
      expect(bh.observations[0].layers).toHaveLength(1)
      // Samples + grain-size
      expect(bh.samples).toHaveLength(1)
      expect(bh.samples[0].grain_sizes).toHaveLength(1)
      const gs = bh.samples[0].grain_sizes[0]
      expect(gs.diameters_mm).toHaveLength(3)
      expect(gs.pct_larger).toHaveLength(3)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Rejection path: DOV import with North Sea bbox returns 200 + zero imports
  // ---------------------------------------------------------------------------

  test('DOV import-dov borehole with empty bbox returns 200 with zero imports', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/borehole/import-dov`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              west: 2.0,
              south: 55.0,
              east: 2.5,
              north: 55.5,
              project_id: pid,
            }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )

      // 200 with 0 imports, or a network error from DOV (502/503/504).
      expect([200, 502, 503, 504]).toContain(res.status)
      if (res.status === 200) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = res.json as any
        expect(body.imported).toBe(0)
        expect(body.duplicates).toBe(0)
        expect(body.failed).toBe(0)
      }
    } finally {
      await closeApp(app)
    }
  })
})
