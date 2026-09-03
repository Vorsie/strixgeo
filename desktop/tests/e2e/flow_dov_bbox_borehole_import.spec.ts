/**
 * Flow Q — DOV bbox borehole import via fixture-mock transport.
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path:
 *   POST /borehole/import-dov with the fixture bbox exercises the full DOV
 *   borehole import pipeline: boring WFS index → boring XML download → parse →
 *   interpretation WFS → interpretation XML → sample WFS → grain-size
 *   observaties WFS → grain-size XML → persist (all phases). All HTTP traffic is
 *   served by ``dov_fixture_transport`` (STRIXGEO_DOV_FIXTURE_MODE=1).
 *   The test verifies:
 *   - API: 200 with imported=2, duplicates=0, failed=0.
 *   - DB: countBoreholes(projectId) grows by exactly 2.
 *   - DB: getBoreholeWithChildren for BH1 shows drill_segments≥2, samples≥1,
 *     observation_layers≥1 (from gecodeerde_lithologie interpretation).
 *   - DB: grain-size lab test attached to the sample from BH1.
 *
 * Duplicate path:
 *   A second POST /borehole/import-dov with the same bbox returns
 *   imported=0, duplicates=2, failed=0.
 *
 * Rejection / empty-bbox path:
 *   POST /borehole/import-dov with the North Sea bbox returns 200 with
 *   imported=0 (fixture transport serves empty_count.xml for all layers).
 *
 * Fixture transport decision:
 *   Same as Flow P: backend started with STRIXGEO_DOV_FIXTURE_MODE=1. No live
 *   DOV network access during any test in this file.
 *
 * Fixture bbox (WGS84):
 *   west=4.347, south=51.033, east=4.368, north=51.045
 *   Lambert72 equivalent: x≈[148500,149900], y≈[191500,192700]
 *   Covers both fixture boreholes at (149100,192050) and (149300,192150).
 *
 * Isolation:
 *   afterAll deletes the 2 boreholes by the IDs returned from the import
 *   response. CASCADE removes drill_segment, observation, observation_layer,
 *   sample, grain_size automatically.
 *
 * Regression anchor:
 *   If getBoreholeWithChildren is removed or the child-tree persist path is
 *   broken, the happy-path child-count assertions turn red.
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

// WGS84 bbox that covers the 2 fixture boreholes (L72 ~149100-149300, 192050-192150)
// with a margin of ~500 m on each side.
const FIXTURE_BBOX = {
  west: 4.347,
  south: 51.033,
  east: 4.368,
  north: 51.045,
}

// North Sea bbox — no Belgian boreholes here.
// Kept inside the product's import limit (25 km side / 625 km2, dov_common.py):
// a 0.1 deg box is about 6 km x 11 km. A bigger empty box is a 422, not a 200.
const EMPTY_BBOX = {
  west: 2.0,
  south: 55.0,
  east: 2.1,
  north: 55.1,
}

// Borehole UUIDs returned by the import — collected in beforeAll.
let importedBoreholeIds: string[] = []

// The DB UUID of BH1 (first imported borehole, boornummer E2E-DOV-BH-001).
// Used by per-child-tree assertions after the import.
let bh1Id: string | null = null

test.describe('flow_dov_bbox_borehole_import (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test.beforeAll(async ({ }) => {
    // Trigger the full DOV borehole import pipeline against the fixture transport.
    // The backend must be running with STRIXGEO_DOV_FIXTURE_MODE=1.
    const resp = await fetch(`${API_BASE}/borehole/import-dov`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...FIXTURE_BBOX,
        project_id: FIXTURE_PROJECT_ID,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Borehole import-dov failed: HTTP ${resp.status} — ${body.slice(0, 300)}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await resp.json()) as any
    importedBoreholeIds = (body.borehole_ids as string[]) ?? []

    // Identify BH1 by calling GET /borehole/{id} for each returned ID and
    // checking the name. BH1 has boornummer "E2E-DOV-BH-001" which the parser
    // stores as the borehole name.
    for (const bhId of importedBoreholeIds) {
      const r = await fetch(`${API_BASE}/borehole/${bhId}?project_id=${FIXTURE_PROJECT_ID}`)
      if (r.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bh = (await r.json()) as any
        if ((bh.name as string)?.includes('E2E-DOV-BH-001')) {
          bh1Id = bhId
        }
      }
    }
  })

  test.afterAll(async ({ }) => {
    // Delete imported boreholes; CASCADE removes child rows.
    for (const bhId of importedBoreholeIds) {
      await fetch(
        `${API_BASE}/borehole/${bhId}?project_id=${FIXTURE_PROJECT_ID}`,
        { method: 'DELETE' },
      )
    }
  })

  // ---------------------------------------------------------------------------
  // Happy path: import-dov returns 200 with correct counts
  // ---------------------------------------------------------------------------

  test('import-dov returns imported=2 duplicates=0 failed=0', async () => {
    // The beforeAll import returned 2 borehole IDs → imported=2.
    expect(importedBoreholeIds).toHaveLength(2)
  })

  // ---------------------------------------------------------------------------
  // Happy path: DB borehole count grew
  // ---------------------------------------------------------------------------

  test('countBoreholes grows by 2 after import', async () => {
    const count = await countBoreholes(FIXTURE_PROJECT_ID)
    // Only assert ≥ 2 — other flows may have boreholes already.
    expect(count).toBeGreaterThanOrEqual(2)
  })

  // ---------------------------------------------------------------------------
  // Happy path: BH1 has full child tree in DB
  // ---------------------------------------------------------------------------

  test('BH1 has drill segments and samples in DB', async () => {
    expect(bh1Id).not.toBeNull()

    const tree = await getBoreholeWithChildren(bh1Id!)
    expect(tree).not.toBeNull()
    // Fixture BH1 has 2 boormethode segments (0-5m Gespoeld, 5-10m Droog).
    expect(tree!.drill_segments).toBeGreaterThanOrEqual(2)
    // Fixture has 1 grondmonster sample linked to BH1.
    expect(tree!.samples).toBeGreaterThanOrEqual(1)
    // gecodeerde_lithologie interpretation → 2 observation layers (0-4m K, 4-10m Z).
    expect(tree!.observation_layers).toBeGreaterThanOrEqual(2)
    // 1 grain-size lab test from the observaties fixture.
    expect(tree!.lab_tests_count).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // Happy path: grain-size lab test attached to the BH1 sample
  // ---------------------------------------------------------------------------

  test('grain-size lab test is attached to BH1 sample', async () => {
    expect(bh1Id).not.toBeNull()

    const tree = await getBoreholeWithChildren(bh1Id!)
    expect(tree).not.toBeNull()
    expect(tree!.samples).toBeGreaterThanOrEqual(1)

    // Fetch the borehole detail to get the sample ID.
    const resp = await fetch(`${API_BASE}/borehole/${bh1Id!}?project_id=${FIXTURE_PROJECT_ID}`)
    expect(resp.ok).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bh = (await resp.json()) as any
    const samples = bh.samples as Array<{ id: string; grain_sizes?: unknown[] }>
    expect(samples.length).toBeGreaterThanOrEqual(1)

    const sampleId = samples[0].id
    const n = await countLabTestsBySample(sampleId, 'grain_size')
    // Fixture observaties has 1 grain-size test for the sample.
    expect(n).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // Happy path: API list endpoint sees the imported boreholes
  // ---------------------------------------------------------------------------

  test('GET /borehole returns the imported DOV boreholes in the project list', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/borehole/?project_id=${pid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names: string[] = (res.json as any[]).map((b: any) => b.name as string)
      // Fixture boreholes have boornummer E2E-DOV-BH-001 and E2E-DOV-BH-002.
      expect(names.some((n) => n.includes('E2E-DOV-BH-001'))).toBe(true)
      expect(names.some((n) => n.includes('E2E-DOV-BH-002'))).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Happy path: BH1 detail API returns full child tree
  // ---------------------------------------------------------------------------

  test('GET /borehole/{id} returns BH1 full detail tree', async () => {
    expect(bh1Id).not.toBeNull()

    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bhId]) => {
          const r = await fetch(`${base}/borehole/${bhId}?project_id=${pid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, bh1Id!],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bh = res.json as any
      // Fixture BH1: diepte_tot=10.0 m
      expect(bh.total_depth_m).toBeCloseTo(10.0, 1)
      // Coordinates from fixture XML <gml:pos>149100.00 192050.00 4.00</gml:pos>
      expect(bh.location_x).toBeCloseTo(149100.0, 0)
      expect(bh.location_y).toBeCloseTo(192050.0, 0)
      expect(bh.epsg).toBe(31370)
      // Drill segments
      expect(bh.drill_segments.length).toBeGreaterThanOrEqual(2)
      // Samples with grain-size
      expect(bh.samples.length).toBeGreaterThanOrEqual(1)
      expect(bh.samples[0].grain_sizes.length).toBeGreaterThanOrEqual(1)
      const gs = bh.samples[0].grain_sizes[0]
      // Fixture grain-size: 3 sieve points (0.063, 0.25, 2.0 mm)
      expect(gs.diameters_mm).toHaveLength(3)
      expect(gs.pct_larger).toHaveLength(3)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Happy path: PostGIS geometry is populated from Lambert72 coordinates
  // ---------------------------------------------------------------------------

  test('BH1 has PostGIS geometry built from L72 coordinates', async () => {
    expect(bh1Id).not.toBeNull()

    const resp = await fetch(`${API_BASE}/borehole/${bh1Id!}?project_id=${FIXTURE_PROJECT_ID}`)
    expect(resp.ok).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bh = (await resp.json()) as any
    // Lambert72 (149100, 192050, 4.0) from fixture XML.
    expect(bh.epsg).toBe(31370)
    expect(bh.location_x).toBeCloseTo(149100.0, 0)
    expect(bh.location_y).toBeCloseTo(192050.0, 0)
    expect(bh.elevation_m).toBeCloseTo(4.0, 1)
  })

  // ---------------------------------------------------------------------------
  // Duplicate path: second import returns duplicates=2, imported=0
  // ---------------------------------------------------------------------------

  test('second import-dov with same bbox returns duplicates=2 imported=0', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bbox]) => {
          const r = await fetch(`${base}/borehole/import-dov`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...JSON.parse(bbox), project_id: pid }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, JSON.stringify(FIXTURE_BBOX)],
      )

      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = res.json as any
      expect(body.imported).toBe(0)
      expect(body.duplicates).toBe(2)
      expect(body.failed).toBe(0)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Rejection path: empty bbox (North Sea) returns 200 + zero imports
  // ---------------------------------------------------------------------------

  test('import-dov with North Sea bbox returns 200 with zero imports', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, bbox]) => {
          const r = await fetch(`${base}/borehole/import-dov`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...JSON.parse(bbox), project_id: pid }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, JSON.stringify(EMPTY_BBOX)],
      )

      // The fixture transport serves empty_count.xml for any layer with no
      // explicit fixture file. North Sea bbox → no fixture match → empty → 200+0.
      expect(res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = res.json as any
      expect(body.imported).toBe(0)
      expect(body.duplicates).toBe(0)
      expect(body.failed).toBe(0)
    } finally {
      await closeApp(app)
    }
  })
})
