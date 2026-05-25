/**
 * Flow S — Lab data display.
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path:
 *   A borehole with samples carrying all six lab-test families is seeded
 *   via POST /projects/{id}/restore.  Verifies:
 *   - DB: each family's table has exactly the rows we seeded.
 *   - API: GET /borehole/{id} returns all six families in the response
 *     with the correct value fields populated.
 *
 * This is the typed-vs-catch-all rendering split regression:
 *   If the ``scalar_lab_tests`` relationship is broken (e.g. the ORM
 *   relationship is dropped or the selectinload is removed), the scalar
 *   family array would come back empty and the assertion fails.
 *   Similarly for the five typed families (Atterberg, CaCO3, etc.).
 *
 * Rejection / empty path:
 *   A borehole with a sample that has NO lab tests yields an empty list for
 *   every family in the GET /borehole/{id} response.
 *
 * Testid coverage:
 *   The ``LabTestPanel`` component carries ``data-testid="sample-inspector-{id}"``
 *   on its outer ``<aside>`` element (added in the same commit as this flow).
 *   This flow verifies the API path only; the UI testid is an anchor for
 *   future UI-navigation assertions.
 *
 * Isolation:
 *   deterministic UUIDs; afterAll cleanup deletes the seeded borehole
 *   (CASCADE removes all child rows).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countLabTestsBySample, getBoreholeWithChildren } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// Deterministic IDs for this spec — prefixed "e2e00030-".
const BH_S_ID = 'e2e00030-0001-4000-a000-000000000001'
const SAMPLE_S_FULL = 'e2e00030-0010-4000-a000-000000000001'
const SAMPLE_S_EMPTY = 'e2e00030-0011-4000-a000-000000000001'

const GRAIN_S_ID = 'e2e00030-0020-4000-a000-000000000001'
const ATT_S_ID = 'e2e00030-0021-4000-a000-000000000001'
const CACO3_S_ID = 'e2e00030-0022-4000-a000-000000000001'
const ORGANIC_S_ID = 'e2e00030-0023-4000-a000-000000000001'
const WATER_S_ID = 'e2e00030-0024-4000-a000-000000000001'
const SCALAR_S_ID = 'e2e00030-0025-4000-a000-000000000001'

function _makeLabBundle() {
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
        id: BH_S_ID,
        name: 'BH-FLOW-S',
        location_x: 157_800.0,
        location_y: 214_200.0,
        elevation_m: 4.2,
        epsg: 31370,
        z_epsg: 5710,
        elevation_source: 'surveyed',
        original_elevation_m: null,
        original_z_epsg: null,
        original_elevation_source: null,
        total_depth_m: 6.0,
        pre_drill_m: null,
        water_depth_m: null,
        drill_method: null,
        dov_permkey: null,
        drill_segments: [],
        field_log_intervals: [],
        observations: [],
        samples: [
          // Sample with all six lab-test families populated.
          {
            id: SAMPLE_S_FULL,
            borehole_id: BH_S_ID,
            dov_permkey: null,
            depth_top_m: 1.5,
            depth_base_m: 2.0,
            description: 'Full-lab-test fixture sample',
            sample_number: 'S1-FULL',
            sample_type: 'ongeroerd',
            composition: null,
            instrument: null,
            sampling_date: '2026-02-01',
            grain_sizes: [
              {
                id: GRAIN_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                // 5-point sieve curve: clay / silt / sand fractions
                diameters_mm: [0.002, 0.020, 0.063, 0.500, 2.0],
                pct_larger: [95.0, 78.0, 45.0, 15.0, 2.0],
                method: 'Zeving',
                test_date: '2026-02-10',
                lime_removed: true,
                organics_removed: false,
              },
            ],
            atterberg_limits_tests: [
              {
                id: ATT_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                liquid_limit_pct: 48.0,
                plastic_limit_pct: 22.0,
                non_plastic: false,
                method: 'Casagrande',
                test_date: '2026-02-11',
              },
            ],
            caco3_content_tests: [
              {
                id: CACO3_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                content_pct: 12.5,
                method: 'Calcimetrie',
                test_date: '2026-02-12',
              },
            ],
            organic_content_tests: [
              {
                id: ORGANIC_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                carbon_pct: 2.3,
                matter_pct: null,
                method: 'LOI',
                test_date: '2026-02-13',
              },
            ],
            water_content_tests: [
              {
                id: WATER_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                content_pct: 38.0,
                method: null,
                test_date: null,
              },
            ],
            scalar_lab_tests: [
              {
                id: SCALAR_S_ID,
                sample_id: SAMPLE_S_FULL,
                dov_permkey: null,
                // Grain density — a typical ScalarLabTest from DOV
                parameter_group: 'Korrelgrootteverdeling',
                parameter: 'Korreldichtheid (Korreldichtheid)',
                value_numeric: 2.68,
                value_text: null,
                unit: 'g/cm³',
                method: null,
                test_date: null,
                detection_condition: null,
              },
            ],
          },
          // Sample with NO lab tests — verifies the empty-state path.
          {
            id: SAMPLE_S_EMPTY,
            borehole_id: BH_S_ID,
            dov_permkey: null,
            depth_top_m: 3.0,
            depth_base_m: 3.0,
            description: 'Spot sample — no lab tests',
            sample_number: 'S2-EMPTY',
            sample_type: null,
            composition: null,
            instrument: null,
            sampling_date: null,
            grain_sizes: [],
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

test.describe('flow_lab_data_display (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test.beforeAll(async () => {
    const bundle = _makeLabBundle()
    const resp = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Lab-test borehole seed failed: HTTP ${resp.status} — ${body.slice(0, 300)}`)
    }
  })

  test.afterAll(async () => {
    await fetch(
      `${API_BASE}/borehole/${BH_S_ID}?project_id=${FIXTURE_PROJECT_ID}`,
      { method: 'DELETE' },
    )
  })

  // ---------------------------------------------------------------------------
  // DB assertions — each family in its own table
  // ---------------------------------------------------------------------------

  test('DB: all six lab-test family rows are present for the full sample', async () => {
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'grain_size')).toBe(1)
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'atterberg')).toBe(1)
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'caco3')).toBe(1)
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'organic')).toBe(1)
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'water')).toBe(1)
    expect(await countLabTestsBySample(SAMPLE_S_FULL, 'scalar')).toBe(1)
  })

  test('DB: empty sample has zero lab tests in every family', async () => {
    for (const fam of ['grain_size', 'atterberg', 'caco3', 'organic', 'water', 'scalar'] as const) {
      expect(await countLabTestsBySample(SAMPLE_S_EMPTY, fam)).toBe(0)
    }
  })

  test('DB: borehole child tree summary shows 2 samples and 6 lab tests', async () => {
    const tree = await getBoreholeWithChildren(BH_S_ID)
    expect(tree).not.toBeNull()
    expect(tree!.samples).toBe(2)
    expect(tree!.lab_tests_count).toBe(6)
  })

  // ---------------------------------------------------------------------------
  // API assertions — GET /borehole/{id} returns all six families
  // ---------------------------------------------------------------------------

  test('GET /borehole/{id} returns all six lab-test families with correct values', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bhId]) => {
          const r = await fetch(`${base}/borehole/${bhId}?project_id=${pid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, BH_S_ID],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bh = res.json as any
      expect(bh.samples).toHaveLength(2)

      // Identify the full-test sample by its sample_number.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const full = bh.samples.find((s: any) => s.sample_number === 'S1-FULL')
      expect(full).toBeTruthy()

      // Grain-size family: 5-point curve.
      expect(full.grain_sizes).toHaveLength(1)
      const gs = full.grain_sizes[0]
      expect(gs.diameters_mm).toHaveLength(5)
      expect(gs.pct_larger).toHaveLength(5)

      // Atterberg family: LL=48, PL=22.
      // REGRESSION ANCHOR: if the Atterberg selectinload is dropped from the
      // repository, this family comes back empty and the assertion fails.
      expect(full.atterberg_limits_tests).toHaveLength(1)
      expect(full.atterberg_limits_tests[0].liquid_limit_pct).toBeCloseTo(48.0, 1)
      expect(full.atterberg_limits_tests[0].plastic_limit_pct).toBeCloseTo(22.0, 1)

      // CaCO3 family.
      expect(full.caco3_content_tests).toHaveLength(1)
      expect(full.caco3_content_tests[0].content_pct).toBeCloseTo(12.5, 1)

      // Organic content family.
      expect(full.organic_content_tests).toHaveLength(1)
      expect(full.organic_content_tests[0].carbon_pct).toBeCloseTo(2.3, 1)

      // Water content family.
      expect(full.water_content_tests).toHaveLength(1)
      expect(full.water_content_tests[0].content_pct).toBeCloseTo(38.0, 1)

      // Scalar catch-all family.
      // REGRESSION ANCHOR: if scalar_lab_tests is removed from the ORM
      // relationship or its selectinload is dropped, this comes back empty.
      expect(full.scalar_lab_tests).toHaveLength(1)
      expect(full.scalar_lab_tests[0].value_numeric).toBeCloseTo(2.68, 2)
      expect(full.scalar_lab_tests[0].unit).toBe('g/cm³')
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Rejection / empty path: sample with no lab tests → all families empty
  // ---------------------------------------------------------------------------

  test('GET /borehole/{id} empty sample has all lab-test families as empty arrays', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bhId]) => {
          const r = await fetch(`${base}/borehole/${bhId}?project_id=${pid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, BH_S_ID],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bh = res.json as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const empty = bh.samples.find((s: any) => s.sample_number === 'S2-EMPTY')
      expect(empty).toBeTruthy()

      // Every family must be an empty array, not undefined or null.
      expect(empty.grain_sizes).toHaveLength(0)
      expect(empty.atterberg_limits_tests).toHaveLength(0)
      expect(empty.caco3_content_tests).toHaveLength(0)
      expect(empty.organic_content_tests).toHaveLength(0)
      expect(empty.water_content_tests).toHaveLength(0)
      expect(empty.scalar_lab_tests).toHaveLength(0)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // GET /borehole/{id} wrong project_id → 404 scope guard
  // ---------------------------------------------------------------------------

  test('GET /borehole/{id} with wrong project_id returns 404', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Use a random valid UUID that doesn't match any project.
      const res = await page.evaluate(
        async ([base, bhId]) => {
          const r = await fetch(
            `${base}/borehole/${bhId}?project_id=00000000-0000-4000-a000-000000000000`,
          )
          return { status: r.status }
        },
        [API_BASE, BH_S_ID],
      )

      expect(res.status).toBe(404)
    } finally {
      await closeApp(app)
    }
  })
})
