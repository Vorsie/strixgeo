/**
 * Flow Y — Export: Plaxis 3D model-wide script (debt #130).
 *
 * Acceptance criteria:
 *
 * Setup:
 *   Uses the fixture's geological model. The model has 6 CPT anchors
 *   with ``elevation_m`` recorded, so all 6 will be exported as
 *   Plaxis boreholes. The model has 3 formations × 6 anchors = 18 contacts.
 *
 * Happy path:
 *   GET ``/projects/{pid}/geology/models/{mid}/export/plaxis3d``
 *   - HTTP 200.
 *   - ``Content-Type: text/x-python``.
 *   - Body is non-empty UTF-8 text.
 *   - Body contains ``g_i.soilmat(`` calls (one per formation × 3).
 *   - Body contains ``g_i.soillayer(`` calls (global layer stack × 3).
 *   - Body contains ``g_i.borehole(`` calls (one per investigation × 6).
 *   - Body contains ``g_i.setsoillayerlevel(`` calls (per borehole × layer).
 *   - Body contains ``g_i.new()`` (the project-reset call).
 *   The 3D exporter is model-wide; no seeded-contact filter applies
 *   (unlike the section-scoped DXF/Plaxis-2D exporters).
 *
 * IDOR check:
 *   GET Plaxis 3D with wrong project_id → 404 (scope guard in the
 *   ``get_in_project_or_404`` helper + ``BuildGroundModelSnapshot``).
 *
 * Regression demo:
 *   Commenting out the ``g_i.setsoillayerlevel`` loop in
 *   ``PlaxisExporter._emit_boreholes`` would cause the
 *   ``hasSetSoilLayerLevel`` assertion to fail here, catching the
 *   regression. This is the documented regression demo for this slice
 *   (chosen over Flow U as the second regression anchor because the
 *   Plaxis path has fewer tests overall — both anchors are retained).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getGeologicalModelId } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'
const WRONG_PROJECT_ID = '00000000-dead-4000-a000-000000000004'

test.describe('flow_export_plaxis_3d (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  let geoModelId: string | null = null

  test.beforeAll(async () => {
    geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
    if (!geoModelId) throw new Error('Flow Y: no geological model in fixture')
  })

  test('happy path: Plaxis 3D script contains all expected structural keywords', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(geoModelId).toBeTruthy()

      const result = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/export/plaxis3d`,
          )
          const text = await r.text()
          return {
            status: r.status,
            contentType: r.headers.get('content-type') ?? '',
            bodyLength: text.length,
            // Script connection bootstrap.
            hasPlxScripting: text.includes('from plxscripting'),
            hasNewServer: text.includes('new_server('),
            hasGiNew: text.includes('g_i.new()'),
            // Per-formation material definitions.
            hasSoilMat: text.includes('g_i.soilmat()'),
            // Global soil layer stack.
            hasSoilLayer: text.includes('g_i.soillayer('),
            // Per-investigation borehole placement.
            hasBorehole: text.includes('g_i.borehole('),
            // Per-(borehole, layer) level assignments.
            // REGRESSION ANCHOR: this assertion catches a removed
            // setsoillayerlevel loop in _emit_boreholes.
            hasSetSoilLayerLevel: text.includes('g_i.setsoillayerlevel('),
          }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )

      // Status and content type.
      expect(result.status).toBe(200)
      expect(result.contentType).toContain('text/x-python')

      // Non-trivial payload.
      expect(result.bodyLength).toBeGreaterThan(500)

      // Script structure — all five structural keywords must be present.
      expect(result.hasPlxScripting).toBe(true)
      expect(result.hasNewServer).toBe(true)
      expect(result.hasGiNew).toBe(true)
      expect(result.hasSoilMat).toBe(true)
      expect(result.hasSoilLayer).toBe(true)
      expect(result.hasBorehole).toBe(true)
      // REGRESSION ANCHOR: setsoillayerlevel must appear.
      expect(result.hasSetSoilLayerLevel).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('IDOR check: wrong project_id → 404 (scope guard)', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(geoModelId).toBeTruthy()

      // Real model id, but wrapped in a request carrying a non-owner project_id.
      const idor = await page.evaluate(
        async ([base, wrongPid, mid]) => {
          const r = await fetch(
            `${base}/projects/${wrongPid}/geology/models/${mid}/export/plaxis3d`,
          )
          return r.status
        },
        [API_BASE, WRONG_PROJECT_ID, geoModelId],
      )
      expect(idor).toBe(404)
    } finally {
      await closeApp(app)
    }
  })

  test('non-existent model id → 404', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const missingModelId = '00000000-dead-4000-a000-000000000005'
      const notFound = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/export/plaxis3d`,
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, missingModelId],
      )
      expect(notFound).toBe(404)
    } finally {
      await closeApp(app)
    }
  })
})
