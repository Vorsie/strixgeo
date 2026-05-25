/**
 * Flow U — Cross-sections: seed from stratigraphy (explicit-content invariant).
 *
 * This is a regression anchor for the most fragile invariant in the section
 * system: the ``updated_section`` field in ``AutoPopulateFromStratigraphyResponse``.
 * It has regressed 3× (memory file ``project_section_seed_must_apply_updated_section.md``).
 *
 * Acceptance criteria:
 *
 * Setup:
 *   A borehole with a formal_stratigraphy observation is seeded in
 *   ``beforeAll`` via the bundle restore endpoint (idempotent). The
 *   three observation layers are named after the fixture's three
 *   geological formations ("Quaternary", "Tertiary Clay", "Tertiary Sand").
 *
 * Happy path:
 *   1. Confirm Section A starts with ``seeded_formation_contact_ids = []``.
 *   2. POST ``/geology/models/{mid}/contacts/auto-populate`` with
 *      ``section_id``, ``create_missing_formations=false``, and the
 *      borehole id. This is the "Seed from stratigraphy" path.
 *   3. Response contains ``updated_section`` — non-null with a non-empty
 *      ``seeded_formation_contact_ids``.  This assertion is the
 *      **regression anchor**.
 *   4. DB: ``cross_section.seeded_formation_contact_ids`` for Section A
 *      is now non-empty.
 *   5. Re-run the same seed call: idempotent — ``created_contact_ids``
 *      grows to 0 (already found), and ``seeded_formation_contact_ids``
 *      is unchanged (union pattern adds nothing).
 *
 * Rejection path:
 *   POST auto-populate with ``borehole_ids = []`` → 422 (Pydantic
 *   ``min_length=1`` validator on ``borehole_ids``).
 *
 * Regression demo:
 *   Removing ``updated_section`` from ``AutoPopulateFromStratigraphyResponse``
 *   causes assertion step 3 ("response.updated_section is not null") to fail
 *   in this flow, catching the exact regression that triggered 3 real bug
 *   reports. See ``project_section_seed_must_apply_updated_section.md``.
 *
 * Cleanup:
 *   Reset Section A's ``seeded_formation_contact_ids`` to ``[]`` in
 *   ``afterAll`` so subsequent flows start from a clean explicit-content
 *   invariant. Contacts created in the geological model are NOT deleted
 *   (they are part of the fixture's geo model).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getSectionById, listSectionsByProject, countFormationContactsByModel } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// Deterministic IDs for the seed borehole (same namespace as flow_fill_from_boreholes
// but different seed strings to avoid id collisions with that flow).
const SEED_BH_ID = 'e2e00010-0001-4000-a000-000000000001'
const SEED_OBS_ID = 'e2e00011-0001-4000-a000-000000000001'
const SEED_LQ_ID = 'e2e00012-0001-4000-a000-000000000001'
const SEED_LTC_ID = 'e2e00013-0001-4000-a000-000000000001'
const SEED_LTS_ID = 'e2e00014-0001-4000-a000-000000000001'

// Formation names must match the fixture exactly (case-sensitive).
const FORMATION_NAMES = ['Quaternary', 'Tertiary Clay', 'Tertiary Sand']

test.describe('flow_section_seed_from_stratigraphy (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  // Resolve section A's id before the tests run. Section A is the first
  // fixture section (display_order = 0).
  let sectionAId: string | null = null
  let geoModelId: string | null = null

  test.beforeAll(async () => {
    // Seed the borehole with stratigraphy via the bundle restore endpoint.
    // The borehole is placed within Section A's corridor (projection_buffer_m=200 m,
    // section y = 214_000) so it is eligible for the seed operation.
    const bundle = {
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
          // Place inside Section A's corridor (y=214_000, buffer=200m → y∈[213800,214200])
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
              id: SEED_OBS_ID,
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
                  id: SEED_LQ_ID,
                  observation_id: SEED_OBS_ID,
                  top_m: 0.0,
                  base_m: 2.0,
                  color: null,
                  main_soil_codes: [],
                  description: 'Quaternary',
                  layer_index: 0,
                  admixtures: [],
                },
                {
                  id: SEED_LTC_ID,
                  observation_id: SEED_OBS_ID,
                  top_m: 2.0,
                  base_m: 5.0,
                  color: null,
                  main_soil_codes: [],
                  description: 'Tertiary Clay',
                  layer_index: 1,
                  admixtures: [],
                },
                {
                  id: SEED_LTS_ID,
                  observation_id: SEED_OBS_ID,
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
    }

    const resp = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Borehole seed failed: HTTP ${resp.status} — ${body.slice(0, 300)}`)
    }

    // Resolve Section A id from the DB.
    const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
    // Section A has display_order=0; sort by display_order ascending and pick first.
    const sectionA = sections.sort((a, b) => a.display_order - b.display_order)[0]
    if (!sectionA) throw new Error('Flow U: no sections found for fixture project')
    sectionAId = sectionA.id

    // Reset Section A's seeded set unconditionally so this flow is truly
    // self-contained regardless of what other flows ran before it.
    // (Flow X's beforeAll may have seeded Section A; this undoes it.)
    await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionAId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seeded_formation_contact_ids: [] }),
    })

    // Resolve geological model id from the API (same method used by other flows).
    const modelsResp = await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models`)
    if (!modelsResp.ok) throw new Error('Flow U: could not fetch geology models')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const models = await modelsResp.json() as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoModel = models.find((m: any) => m.kind === 'geological')
    if (!geoModel) throw new Error('Flow U: no geological model in fixture')
    geoModelId = geoModel.id as string
  })

  test.afterAll(async () => {
    // Reset Section A's seeded set so later flows see the invariant
    // (``seeded_formation_contact_ids = []``).
    if (sectionAId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionAId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeded_formation_contact_ids: [] }),
      }).catch(() => {
        // Swallow — if the backend is down the fixture cleanup isn't critical.
      })
    }
  })

  test('happy path: seed populates seeded_formation_contact_ids + response.updated_section is non-null', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      // 1. Section must start with an empty seeded set (explicit-content invariant).
      const sectionBefore = await getSectionById(sectionAId!)
      expect(sectionBefore).not.toBeNull()
      expect(sectionBefore!.seeded_formation_contact_ids).toHaveLength(0)

      // 2. Call auto-populate (the "Seed from stratigraphy" path).
      //    create_missing_formations=false: never creates new formations (CLAUDE.md invariant).
      const seedRes = await page.evaluate(
        async ([base, pid, mid, bhId, secId]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/auto-populate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                borehole_ids: [bhId],
                section_id: secId,
                create_missing_formations: false,
              }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, SEED_BH_ID, sectionAId] as const,
      )
      expect(seedRes.status).toBe(200)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = seedRes.json as any

      // 3. REGRESSION ANCHOR: updated_section must be non-null and have a
      //    non-empty seeded_formation_contact_ids.
      //    Removing ``updated_section`` from ``AutoPopulateFromStratigraphyResponse``
      //    causes this assertion to fail — reproducing the bug in memory file
      //    ``project_section_seed_must_apply_updated_section.md``.
      expect(body.updated_section).not.toBeNull()
      expect(body.updated_section.seeded_formation_contact_ids).toBeDefined()
      expect(body.updated_section.seeded_formation_contact_ids.length).toBeGreaterThan(0)

      // 4. DB: section row reflects the seeded set.
      const sectionAfter = await getSectionById(sectionAId!)
      expect(sectionAfter).not.toBeNull()
      expect(sectionAfter!.seeded_formation_contact_ids.length).toBeGreaterThan(0)

      // Ids in response and DB must match.
      const responseIds = new Set(body.updated_section.seeded_formation_contact_ids as string[])
      const dbIds = new Set(sectionAfter!.seeded_formation_contact_ids)
      for (const id of dbIds) {
        expect(responseIds).toContain(id)
      }

      // 5. Idempotency: re-running the seed produces no new contact_ids.
      const seed2Res = await page.evaluate(
        async ([base, pid, mid, bhId, secId]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/auto-populate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                borehole_ids: [bhId],
                section_id: secId,
                create_missing_formations: false,
              }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, SEED_BH_ID, sectionAId] as const,
      )
      expect(seed2Res.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body2 = seed2Res.json as any
      // All contacts already exist → created_contact_ids is empty.
      expect(body2.created_contact_ids).toHaveLength(0)
      // seeded set is unchanged (union of identical sets = same set).
      const sectionAfter2 = await getSectionById(sectionAId!)
      expect(sectionAfter2!.seeded_formation_contact_ids.length).toBe(
        sectionAfter!.seeded_formation_contact_ids.length,
      )
    } finally {
      await closeApp(app)
    }
  })

  test('rejection: empty borehole_ids → 422, no DB write', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      const sectionBefore = await getSectionById(sectionAId!)
      const seedCountBefore = sectionBefore?.seeded_formation_contact_ids.length ?? 0
      const contactCountBefore = await countFormationContactsByModel(geoModelId!)

      // Empty borehole_ids violates the min_length=1 constraint.
      const emptyRes = await page.evaluate(
        async ([base, pid, mid, secId]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/auto-populate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                borehole_ids: [],
                section_id: secId,
                create_missing_formations: false,
              }),
            },
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, sectionAId] as const,
      )
      expect(emptyRes).toBe(422)

      // No DB writes.
      const sectionAfter = await getSectionById(sectionAId!)
      expect(sectionAfter?.seeded_formation_contact_ids.length ?? 0).toBe(seedCountBefore)
      const contactCountAfter = await countFormationContactsByModel(geoModelId!)
      expect(contactCountAfter).toBe(contactCountBefore)
    } finally {
      await closeApp(app)
    }
  })
})
