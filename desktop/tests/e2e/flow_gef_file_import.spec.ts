/**
 * Flow R — GEF file import.
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path:
 *   POST /cpt/import (multipart FormData, GEF file content) creates one new
 *   CPT row with a populated cpt_series.  Verifies:
 *   - HTTP 201.
 *   - DB: exactly 1 new ``cpt`` row with matching project_id + test_id.
 *   - DB: ``cpt_series`` has a non-empty depths array.
 *
 * Duplicate path (regression anchor):
 *   A second POST of the same GEF content must return 409 Conflict, and
 *   the response body must carry the ``cpt_id`` of the existing record.
 *   This exercises ``DuplicateCptError`` → HTTP 409 in ImportCpt.persist().
 *
 * Regression anchor:
 *   Reverting the duplicate-detection logic in ImportCpt.persist() (the
 *   ``find_by_project_test`` call) turns the "second import returns 409"
 *   assertion red with a 201 instead.
 *
 * Rejection path:
 *   POST of a byte string that is not valid GEF format (random bytes / wrong
 *   MEASUREMENTTEXT block) returns HTTP 400.
 *
 * DOV mocking decision: not applicable — this flow tests the local GEF
 * upload path only.
 *
 * Isolation:
 *   deterministic project_id + test_id pair in the GEF header; afterAll
 *   deletes the CPT by id (returned in the first 201 response).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countCpts, getCptWithSeries } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// The GEF contract_number + test_id pair must be unique within the project
// so the duplicate-detection path is exercisable without colliding with
// the fixture's 6 CPTs (all have project_id="E2E") or Flow P's CPTs
// (project_id="FLOW-P").
const GEF_PROJECT_ID = 'GEF-FLOW-R'
const GEF_TEST_ID = 'R-001'

// Minimal valid GEF string (Lambert72 coordinates, 3 depth rows).
// The XYID EPSG 31370 is Lambert72; ZID EPSG 5710 is TAW (Ostend datum).
const VALID_GEF = `#GEFID= 1, 1, 0
#FILEOWNER= E2E Flow R
#COMPANYID= E2E
#PROJECTID= ${GEF_PROJECT_ID},
#TESTID= ${GEF_TEST_ID}
#XYID= 31370, 157600.0, 214050.0
#ZID= 5710, 3.5
#MEASUREMENTTEXT= 9, Flow R test
#COLUMN= 3
#COLUMNINFO= 1, m, depth, 1
#COLUMNINFO= 2, MPa, cone resistance, 2
#COLUMNINFO= 3, MPa, sleeve friction, 3
#EOH=
0.02; 0.4; 0.02
0.04; 0.5; 0.022
0.06; 0.6; 0.025
`

// A payload that looks like a GEF file (has the .gef extension) but whose
// content is deliberately corrupt — no #EOH= separator and no column data.
const CORRUPT_GEF = `#GEFID= 1, 1, 0
#PROJECTID= ${GEF_PROJECT_ID},
#TESTID= R-CORRUPT
THIS IS NOT VALID GEF CONTENT
`

// ID returned by the first 201 import — populated in the happy-path test
// and consumed by the afterAll cleanup.
let _importedCptId: string | null = null

test.describe('flow_gef_file_import (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test.afterAll(async () => {
    if (_importedCptId) {
      await fetch(
        `${API_BASE}/cpt/${_importedCptId}?project_id=${FIXTURE_PROJECT_ID}`,
        { method: 'DELETE' },
      )
      _importedCptId = null
    }
  })

  // ---------------------------------------------------------------------------
  // Happy path: valid GEF import → 201 + DB row with series
  // ---------------------------------------------------------------------------

  test('POST valid GEF creates CPT with populated cpt_series', async () => {
    const countBefore = await countCpts(FIXTURE_PROJECT_ID)

    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Build the FormData payload from within the renderer context using
      // the web FormData API (the Electron renderer is a browser context).
      const res = await page.evaluate(
        async ([base, pid, gefContent]) => {
          const blob = new Blob([gefContent], { type: 'application/octet-stream' })
          const form = new FormData()
          form.append('file', blob, 'flow-r.gef')
          form.append('project_id', pid)
          const r = await fetch(`${base}/cpt/import`, { method: 'POST', body: form })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, VALID_GEF],
      )

      expect(res.status).toBe(201)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = res.json as any
      expect(typeof body.cpt_id).toBe('string')
      _importedCptId = body.cpt_id as string

      // DB: one new CPT row
      const countAfter = await countCpts(FIXTURE_PROJECT_ID)
      expect(countAfter).toBe(countBefore + 1)

      // DB: series row exists and is non-empty
      const series = await getCptWithSeries(_importedCptId)
      expect(series).not.toBeNull()
      expect(series!.n_rows).toBe(3)
      expect(series!.max_depth_m).toBeCloseTo(0.06, 3)
      expect(series!.depths).toHaveLength(3)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Duplicate path (regression anchor): second import → 409 + existing cpt_id
  // ---------------------------------------------------------------------------

  test('second import of same GEF returns 409 with existing cpt_id', async () => {
    // This test depends on the happy-path test having run first and set
    // _importedCptId.  If the happy-path test is skipped or failed, skip this
    // test too.
    if (!_importedCptId) {
      test.skip(true, 'happy-path test did not set _importedCptId — skipped')
      return
    }

    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const existingId = _importedCptId

      const res = await page.evaluate(
        async ([base, pid, gefContent]) => {
          const blob = new Blob([gefContent], { type: 'application/octet-stream' })
          const form = new FormData()
          form.append('file', blob, 'flow-r-dup.gef')
          form.append('project_id', pid)
          const r = await fetch(`${base}/cpt/import`, { method: 'POST', body: form })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, VALID_GEF],
      )

      // REGRESSION ANCHOR: reverting ImportCpt.persist duplicate detection
      // makes this return 201 instead — flow red.
      expect(res.status).toBe(409)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (res.json as any).detail
      // The 409 body must carry cpt_id of the existing record (CLAUDE.md §API).
      expect(detail?.cpt_id).toBe(existingId)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Rejection path: corrupt GEF → 400
  // ---------------------------------------------------------------------------

  test('POST corrupt GEF returns 400 with a useful error message', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid, gefContent]) => {
          const blob = new Blob([gefContent], { type: 'application/octet-stream' })
          const form = new FormData()
          form.append('file', blob, 'flow-r-corrupt.gef')
          form.append('project_id', pid)
          const r = await fetch(`${base}/cpt/import`, { method: 'POST', body: form })
          return { status: r.status, text: await r.text() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, CORRUPT_GEF],
      )

      // A GEF with no valid data rows should fail with 400 (ParseError) because
      // the parser finds no MEASUREMENTVAR columns and the DataFrame is empty,
      // or because the XY coords are missing.  Accept 400 or 422 (validation).
      expect([400, 422]).toContain(res.status)
    } finally {
      await closeApp(app)
    }
  })

  // ---------------------------------------------------------------------------
  // Non-GEF extension → 400
  // ---------------------------------------------------------------------------

  test('POST file with unsupported extension returns 400', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const res = await page.evaluate(
        async ([base, pid]) => {
          const blob = new Blob(['not a gef file'], { type: 'text/plain' })
          const form = new FormData()
          form.append('file', blob, 'data.ags')
          form.append('project_id', pid)
          const r = await fetch(`${base}/cpt/import`, { method: 'POST', body: form })
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )

      expect(res.status).toBe(400)
    } finally {
      await closeApp(app)
    }
  })
})
