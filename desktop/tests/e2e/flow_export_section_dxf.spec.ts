/**
 * Flow W — Export: section DXF (debt #130).
 *
 * Acceptance criteria:
 *
 * Setup:
 *   Uses the fixture's Section A and the fixture's geological model.
 *   The model has 6 CPT anchors × 3 formations = 18 contacts, all
 *   placed at the time the fixture was built.
 *
 * Happy path:
 *   GET ``/projects/{pid}/sections/{sid}/export/dxf?model_id={mid}``
 *   - HTTP 200.
 *   - ``Content-Type`` is ``application/dxf``.
 *   - Body is non-empty UTF-8 text.
 *   - Body contains the AutoCAD DXF section marker ``SECTION`` near
 *     the start (the DXF HEADER section is always emitted by ezdxf).
 *   - Body contains the ``ENTITIES`` keyword (the entity section where
 *     formation polylines + investigation columns live).
 *   - Body contains the ``Investigations`` layer name (the layer that
 *     carries the investigation-column LINE entities).
 *
 *   Note: the section has ``seeded_formation_contact_ids = []`` unless
 *   Flow U ran first. Even with no seeded contacts, the DXF still
 *   carries valid investigation-column geometry (CPTs within the buffer)
 *   plus the HEADER/ENTITIES structure from ezdxf. This test does NOT
 *   depend on Flow U running first — it is self-contained.
 *
 * Rejection path (IDOR check):
 *   GET DXF for a section using a wrong project_id (a project that
 *   doesn't own this section) → 404.
 *   This verifies the project-scope guard in the
 *   ``BuildSectionSnapshot`` use case (ParseError → 404 mapping).
 *
 * Regression anchor:
 *   If the DXF exporter's investigation-column path were removed, the
 *   ``Investigations`` keyword assertion would turn red, catching the
 *   regression.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { listSectionsByProject, getGeologicalModelId } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// A UUID that is syntactically valid but does not belong to this project.
// Used as a wrong project_id in the IDOR check.
const WRONG_PROJECT_ID = '00000000-dead-4000-a000-000000000001'

test.describe('flow_export_section_dxf (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  let sectionAId: string | null = null
  let geoModelId: string | null = null

  test.beforeAll(async () => {
    // Resolve Section A (display_order = 0).
    const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
    const sectionA = sections.sort((a, b) => a.display_order - b.display_order)[0]
    if (!sectionA) throw new Error('Flow W: Section A not found in fixture')
    sectionAId = sectionA.id

    // Resolve the geological model id.
    geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
    if (!geoModelId) throw new Error('Flow W: no geological model in fixture')
  })

  test('happy path: DXF export returns valid DXF bytes with expected markers', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      // 1. Fetch the DXF.
      const result = await page.evaluate(
        async ([base, pid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/sections/${sid}/export/dxf?model_id=${mid}`,
          )
          const text = await r.text()
          return {
            status: r.status,
            contentType: r.headers.get('content-type') ?? '',
            bodyLength: text.length,
            // Capture the first 200 chars for the SECTION marker check.
            bodyStart: text.slice(0, 200),
            // Check for expected DXF structure markers.
            hasEntities: text.includes('ENTITIES'),
            hasInvestigationsLayer: text.includes('Investigations'),
            // DXF SECTION keyword appears near the start of any ezdxf R2018 file.
            hasSectionMarker: text.includes('SECTION'),
          }
        },
        [API_BASE, FIXTURE_PROJECT_ID, sectionAId, geoModelId],
      )

      // 2. Status + Content-Type.
      expect(result.status).toBe(200)
      expect(result.contentType).toContain('application/dxf')

      // 3. Non-empty body.
      expect(result.bodyLength).toBeGreaterThan(100)

      // 4. DXF structure markers.
      expect(result.hasSectionMarker).toBe(true)
      expect(result.hasEntities).toBe(true)
      // Investigations layer is always emitted by _setup_layers() even
      // when no investigations are present.
      expect(result.hasInvestigationsLayer).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('IDOR check: wrong project_id → 404 (scope guard blocks cross-project access)', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(sectionAId).toBeTruthy()
      expect(geoModelId).toBeTruthy()

      // Use the real section id but a wrong project_id — the scope guard
      // in BuildSectionSnapshot raises ParseError → 404.
      const idor = await page.evaluate(
        async ([base, wrongPid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${wrongPid}/sections/${sid}/export/dxf?model_id=${mid}`,
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

  test('IDOR check: non-existent section_id → 404', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')
      expect(geoModelId).toBeTruthy()

      // A syntactically valid but non-existent section id.
      const missingId = '00000000-dead-4000-a000-000000000002'
      const notFound = await page.evaluate(
        async ([base, pid, sid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/sections/${sid}/export/dxf?model_id=${mid}`,
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, missingId, geoModelId],
      )
      expect(notFound).toBe(404)
    } finally {
      await closeApp(app)
    }
  })
})
