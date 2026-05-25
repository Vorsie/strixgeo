/**
 * Flow T — Cross-sections: create, list, and delete (debt #130).
 *
 * Acceptance criteria:
 *
 * Happy path:
 *   POST a new cross-section with two distinct in-project endpoints.
 *   - DB: a ``cross_section`` row exists with correct endpoints,
 *     ``seeded_formation_contact_ids = []`` (explicit-content invariant),
 *     and ``app_project_id`` matching the fixture project.
 *   - API: ``GET /projects/{pid}/sections`` lists the section.
 *   DELETE the section.
 *   - DB + API: row is gone.
 *
 * Rejection path:
 *   POST with identical start + end endpoints → 422 (Pydantic model
 *   validator ``_endpoints_distinct`` fires before any DB write).
 *
 * Regression anchor:
 *   If the repository's ``create`` no longer writes
 *   ``seeded_formation_contact_ids=[]`` (instead inheriting a non-empty
 *   default), the DB assertion `seededIds.length === 0` turns red —
 *   catching any accidental modification to the explicit-content invariant.
 *
 * Isolation:
 *   The section is created in the test body and explicitly deleted in
 *   ``afterAll`` (via the section id captured in the test). The fixture
 *   project's two pre-existing sections (Section A / B) are not touched.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countSections, getSectionById } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// Lambert72 coordinates within the fixture site (Antwerp area).
// Distinct from the fixture's Section A / B endpoints so this section
// doesn't collide with pre-existing data.
const SECTION_BODY = {
  name: 'E2E-Flow-T-Section',
  start_x: 157_500.0,
  start_y: 213_800.0,
  end_x: 157_800.0,
  end_y: 213_800.0,
  epsg: 31370,
  projection_buffer_m: 100.0,
}

test.describe('flow_section_create_delete (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  let createdSectionId: string | null = null

  test.afterAll(async () => {
    // Clean up: delete the section if the test left it behind.
    if (createdSectionId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${createdSectionId}`, {
        method: 'DELETE',
      }).catch(() => {
        // Swallow — either it was already deleted by the test or the
        // backend is down; either way the fixture stays clean enough.
      })
    }
  })

  test('happy path: create section, list it, verify DB, then delete', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Count existing sections before creation so the assertion is
      //    relative (the fixture already has 2 sections).
      const countBefore = await countSections(FIXTURE_PROJECT_ID)

      // 2. Create the section via API.
      const createRes = await page.evaluate(
        async ([base, pid, body]) => {
          const r = await fetch(`${base}/projects/${pid}/sections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, SECTION_BODY] as const,
      )
      expect(createRes.status).toBe(201)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = createRes.json as any
      createdSectionId = created.id as string
      expect(createdSectionId).toBeTruthy()

      // 3. DB check — row exists with correct shape.
      const row = await getSectionById(createdSectionId)
      expect(row).not.toBeNull()
      expect(row!.app_project_id).toBe(FIXTURE_PROJECT_ID)
      expect(row!.name).toBe(SECTION_BODY.name)
      // Explicit-content invariant: seeded_formation_contact_ids must be empty on create.
      expect(row!.seeded_formation_contact_ids).toHaveLength(0)

      // 4. List endpoint includes the new section.
      const listRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(listRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listed = listRes.json as any[]
      const ids = listed.map((s: any) => s.id as string)
      expect(ids).toContain(createdSectionId)
      expect(listed.length).toBe(countBefore + 1)

      // 5. Count via DB helper to cross-check the list.
      const countAfter = await countSections(FIXTURE_PROJECT_ID)
      expect(countAfter).toBe(countBefore + 1)

      // 6. Delete the section.
      const deleteRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`, {
            method: 'DELETE',
          })
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, createdSectionId],
      )
      expect(deleteRes).toBe(204)

      // 7. DB check — row is gone.
      const rowAfterDelete = await getSectionById(createdSectionId)
      expect(rowAfterDelete).toBeNull()
      createdSectionId = null // prevent afterAll double-delete

      // 8. List endpoint no longer includes the id.
      const listAfterDelete = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idsAfter = (listAfterDelete as any[]).map((s: any) => s.id as string)
      expect(idsAfter).not.toContain(createdSectionId)
    } finally {
      await closeApp(app)
    }
  })

  test('rejection: identical endpoints → 422, no DB write', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const countBefore = await countSections(FIXTURE_PROJECT_ID)

      // Degenerate section: start === end.
      const degenRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'E2E-Degen',
              start_x: 157_500.0,
              start_y: 214_000.0,
              end_x: 157_500.0,  // identical to start_x
              end_y: 214_000.0,  // identical to start_y
              epsg: 31370,
              projection_buffer_m: 50.0,
            }),
          })
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(degenRes.status).toBe(422)

      // No DB write.
      const countAfter = await countSections(FIXTURE_PROJECT_ID)
      expect(countAfter).toBe(countBefore)
    } finally {
      await closeApp(app)
    }
  })
})
