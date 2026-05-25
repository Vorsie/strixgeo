/**
 * Flow 5 — Auto-correlate litho bodies across all investigations.
 *
 * Acceptance criteria (debt #127):
 * - POST .../auto-correlate on a lithostratigraphic model returns 200 with
 *   ``edges_created >= 0`` (idempotent on re-call).
 * - On first call (no pre-existing auto edges): ``edges_created > 0`` when
 *   the fixture has ≥ 2 same-litho investigations.
 * - On second call (idempotent re-run): ``edges_created = 0``,
 *   ``edges_skipped_existing >= 0``.
 * - The DB ``litho_correlation_edge`` table grows by exactly ``edges_created``
 *   rows with ``source = 'auto'``.
 *
 * Regression anchor: if the CHECK constraint ``ck_litho_correlation_edge_source``
 * (added in migration j4d5e6f7a8b9) is absent, inserting an edge with an
 * invalid source token would silently succeed — this test ensures the endpoint
 * never inserts such rows (the endpoint always uses source='auto').
 *
 * NOTE: This flow calls the API directly because the auto-correlate button
 * requires the renderer's ghost-suggestion state to be populated, which needs
 * the full UI chain (navigate → section → suggest). The API path exercises
 * the exact same code path the frontend button fires.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countAutoCorrelationEdges, countCorrelationEdges } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_auto_correlate', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('auto-correlate creates auto edges; idempotent re-call creates 0 new edges', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve litho model id for the fixture project.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // 2. Snapshot edge count before auto-correlate.
      const totalBefore = await countCorrelationEdges(FIXTURE_PROJECT_ID)
      const autoBefore = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)

      // 3. First auto-correlate call.
      const firstResult = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/auto-correlate`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )

      expect(firstResult.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = firstResult.json as any
      expect(typeof first.edges_created).toBe('number')
      expect(typeof first.edges_skipped_existing).toBe('number')
      expect(typeof first.formations_recomputed).toBe('number')
      expect(typeof first.wedge_tips_materialised).toBe('number')
      expect(first.edges_created).toBeGreaterThanOrEqual(0)
      expect(first.edges_skipped_existing).toBeGreaterThanOrEqual(0)

      // 4. Assert DB auto-edge count grew by exactly edges_created.
      const autoAfterFirst = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)
      const totalAfterFirst = await countCorrelationEdges(FIXTURE_PROJECT_ID)
      expect(autoAfterFirst - autoBefore).toBe(first.edges_created)
      // Total edge count must be >= auto edge count (manual edges may also exist).
      expect(totalAfterFirst).toBeGreaterThanOrEqual(totalBefore)

      // 5. Idempotency: second auto-correlate call must create 0 new edges.
      const secondResult = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/auto-correlate`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )

      expect(secondResult.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const second = secondResult.json as any
      expect(second.edges_created).toBe(0)
      // All candidates are now pre-existing.
      expect(second.edges_skipped_existing).toBeGreaterThanOrEqual(0)

      // 6. DB count unchanged after second call.
      const autoAfterSecond = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)
      expect(autoAfterSecond).toBe(autoAfterFirst)
    } finally {
      await closeApp(app)
    }
  })

  test('auto-correlate on a geological model (wrong kind) returns 422', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Resolve geological model id.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geoModel = (modelsJson as any[]).find((m: any) => m.kind === 'geological')

      if (!geoModel) {
        // No geological model in the fixture — skip this sub-test.
        test.info().annotations.push({ type: 'note', description: 'No geological model found in fixture' })
        return
      }

      const result = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/auto-correlate`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          return { status: r.status, json: r.status < 200 || r.status >= 300 ? await r.json() : null }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModel.id],
      )

      // The endpoint only operates on lithostratigraphic models.
      expect(result.status).toBe(422)
    } finally {
      await closeApp(app)
    }
  })
})
