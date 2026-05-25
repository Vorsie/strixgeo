/**
 * Flow V — Cross-sections: view-state PATCH and investigation exclusion (debt #130).
 *
 * Acceptance criteria:
 *
 * Happy path A — view_state PATCH:
 *   PATCH ``/projects/{pid}/sections/{sid}`` with a ``view_state`` blob
 *   carrying CPT-channel toggles. The PATCH uses a shallow-merge semantic
 *   (CLAUDE.md "Cross-sections"), so only the provided keys are written.
 *   - GET the section back → view_state persists.
 *
 * Happy path B — exclude a CPT from the section:
 *   PATCH the section's ``excluded_cpt_ids`` to include one fixture CPT id.
 *   - GET the section → CPT id appears in ``excluded_cpt_ids``.
 *   - The CPT is still present in the project at large (``GET /cpt`` lists it).
 *   - Restore: PATCH back to ``excluded_cpt_ids=[]``.
 *
 * Rejection path:
 *   PATCH ``view_state`` with an unknown top-level key → 422 (``extra=forbid``
 *   on the ``SectionViewState`` Pydantic model — debt #24 guard).
 *
 * Isolation:
 *   The spec uses Section B (display_order=1) to avoid interfering with
 *   Flow U's setup on Section A. Any state written to Section B is reverted
 *   in ``afterAll``.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getSectionById, listSectionsByProject } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_section_view_state_and_hide (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  let sectionBId: string | null = null
  let firstCptId: string | null = null

  test.beforeAll(async () => {
    // Resolve Section B (display_order = 1) from DB.
    const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
    const sectionB = sections.sort((a, b) => a.display_order - b.display_order)[1]
    if (!sectionB) throw new Error('Flow V: Section B not found in fixture')
    sectionBId = sectionB.id

    // Resolve one CPT id from the project via the API.
    // CPTs are not project-prefixed — use /cpt/?project_id={pid}.
    const cptsResp = await fetch(`${API_BASE}/cpt/?project_id=${FIXTURE_PROJECT_ID}`)
    if (!cptsResp.ok) throw new Error('Flow V: could not fetch CPTs')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cpts = await cptsResp.json() as any[]
    if (!cpts.length) throw new Error('Flow V: no CPTs in fixture project')
    firstCptId = (cpts[0] as { id: string }).id
  })

  test.afterAll(async () => {
    // Restore Section B to a clean state.
    if (sectionBId) {
      await fetch(`${API_BASE}/projects/${FIXTURE_PROJECT_ID}/sections/${sectionBId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Clear view_state (empty dict = clear bag per the PATCH semantics).
          view_state: {},
          excluded_cpt_ids: [],
        }),
      }).catch(() => {
        // Swallow — fixture cleanup failure is non-fatal.
      })
    }
  })

  test('happy path A: view_state PATCH persists CPT channel toggles', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionBId).toBeTruthy()

      // PATCH with a partial view_state — only set the cpt_channels.qc toggle.
      const patchRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              view_state: {
                cpt_channels: { qc: false },
              },
            }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId],
      )
      expect(patchRes.status).toBe(200)

      // GET the section and verify the view_state was persisted.
      const getRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId],
      )
      expect(getRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const section = getRes.json as any
      expect(section.view_state).toBeDefined()
      expect(section.view_state.cpt_channels).toBeDefined()
      expect(section.view_state.cpt_channels.qc).toBe(false)

      // DB cross-check.
      const dbRow = await getSectionById(sectionBId!)
      expect(dbRow).not.toBeNull()
      // The pg driver returns JSONB as a parsed object — access directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbVs = dbRow!.view_state as any
      expect(dbVs?.cpt_channels?.qc).toBe(false)
    } finally {
      await closeApp(app)
    }
  })

  test('happy path B: exclude CPT id from section, CPT still exists in project', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionBId).toBeTruthy()
      expect(firstCptId).toBeTruthy()

      // PATCH: add the first CPT to excluded_cpt_ids.
      const patchRes = await page.evaluate(
        async ([base, pid, sid, cptId]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excluded_cpt_ids: [cptId] }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId, firstCptId],
      )
      expect(patchRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patchedSection = patchRes.json as any
      expect(patchedSection.excluded_cpt_ids).toContain(firstCptId)

      // GET section confirms the exclusion.
      const getRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((getRes as any).excluded_cpt_ids).toContain(firstCptId)

      // The CPT is still accessible at the project level.
      // GET /cpt/{cpt_id}?project_id={pid} requires the project scope guard.
      const cptGetRes = await page.evaluate(
        async ([base, pid, cptId]) => {
          const r = await fetch(`${base}/cpt/${cptId}?project_id=${pid}`)
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, firstCptId],
      )
      expect(cptGetRes).toBe(200)

      // Restore: clear excluded_cpt_ids.
      const restoreRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excluded_cpt_ids: [] }),
          })
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId],
      )
      expect(restoreRes).toBe(200)
    } finally {
      await closeApp(app)
    }
  })

  test('rejection: unknown view_state key → 422 (extra=forbid on SectionViewState)', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionBId).toBeTruthy()

      // ``snap_to_stratigrahpy`` (typo) is rejected by extra=forbid.
      // ``frobulate`` is an entirely unknown key — also rejected.
      const badPatchRes = await page.evaluate(
        async ([base, pid, sid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              view_state: {
                frobulate: true,  // not a defined SectionViewState field
              },
            }),
          })
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionBId],
      )
      expect(badPatchRes).toBe(422)
    } finally {
      await closeApp(app)
    }
  })
})
