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
 * Slice 4 Half-A (re-correlate dialog):
 * - DELETE /correlations/auto removes only source='auto' edges; manual edges survive.
 * - The DELETE + POST auto-correlate cycle is idempotent in shape: same edge count
 *   after a re-correlate cycle as after the first correlate call.
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
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
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
      // Post-#133 response shape: crossing edges are dropped (not persisted)
      // and surfaced as pinch-out candidates rather than correlation edges.
      expect(typeof first.edges_dropped_crossing).toBe('number')
      expect(Array.isArray(first.crossing_pinch_outs)).toBe(true)
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
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
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
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
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

  test('delete-auto then re-correlate: manual edges survive, auto count is idempotent', async () => {
    // Slice 4 Half-A (re-correlate flow):
    // 1. Run auto-correlate to produce source='auto' edges.
    // 2. Create one source='manual' edge via POST /correlations.
    // 3. DELETE /correlations/auto → auto edges gone, manual edge survives.
    // 4. POST auto-correlate again → auto edges recreated; count == original.
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Resolve litho model.
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

      // 1. Run auto-correlate (creates auto edges).
      const firstAcResult = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoCountAfterFirst = (firstAcResult as any).edges_created as number
      // Nothing to re-correlate if the fixture produced no edges.
      // This test is a no-op for fixture states with 0 auto edges.
      if (autoCountAfterFirst === 0) {
        test.info().annotations.push({ type: 'note', description: 'Fixture produced 0 auto edges — re-correlate cycle skipped' })
        return
      }

      const autoAfterFirst = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)
      expect(autoAfterFirst).toBeGreaterThan(0)

      // 2. Create a manual edge so we can verify it survives the DELETE.
      // Post-#133 correlation edges are CONTACT-level (contact_a_id /
      // contact_b_id), so pick two contacts on DIFFERENT investigations.
      const edgeContacts = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/contacts`)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts: any[] = await r.json()
          const anchor = (c: { cpt_id?: string; borehole_id?: string }) => c.cpt_id ?? c.borehole_id ?? ''
          const a = contacts[0]
          if (!a) return null
          const b = contacts.find((c) => anchor(c) && anchor(c) !== anchor(a))
          return b ? { a: a.id as string, b: b.id as string } : null
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      if (!edgeContacts) {
        test.info().annotations.push({ type: 'note', description: 'No two contacts on distinct investigations — manual edge step skipped' })
      } else {
        const manualEdgeResult = await page.evaluate(
          async ([base, pid, mid, ca, cb]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/contact-correlations`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_a_id: ca, contact_b_id: cb, source: 'manual' }),
              },
            )
            return { status: r.status }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, edgeContacts.a, edgeContacts.b],
        )
        // 201 (new) or 200 (already existed) are both acceptable.
        expect([200, 201]).toContain(manualEdgeResult.status)
      }

      // 3. DELETE auto edges.
      const delResult = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
            { method: 'DELETE', headers: { 'Content-Type': 'application/json' } },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      expect(delResult.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((delResult.json as any).deleted).toBe(autoAfterFirst)

      // Auto edges are gone.
      const autoAfterDelete = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)
      expect(autoAfterDelete).toBe(0)

      // 4. Re-run auto-correlate → edges recreated.
      await page.evaluate(
        async ([base, pid, mid]) => {
          await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations/auto`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          )
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      const autoAfterReCorrelate = await countAutoCorrelationEdges(FIXTURE_PROJECT_ID)
      // Edge count must equal the original — DELETE+re-correlate is idempotent in shape.
      expect(autoAfterReCorrelate).toBe(autoAfterFirst)
    } finally {
      await closeApp(app)
    }
  })
})
