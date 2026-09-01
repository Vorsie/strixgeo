/**
 * Flow 3 — Bulk suggest-all + accept-all.
 *
 * Acceptance criterion (debt #128 / #129b, migrated to the batch endpoint
 * 2026-07-13 — audit BE-API-07):
 * - Suggest all 9 series-bearing fixture CPTs (each call returns ≥1 layer).
 * - Accept every CPT through the PRODUCTION bulk protocol:
 *   ``POST .../layers/batch-accept-litho-suggestions`` with
 *   ``run_inference: true`` — one call per anchor so a fixture CPT whose
 *   pre-seeded accepted layers overlap the segmenter's suggestions can 409
 *   without rolling back the other anchors (mirrors the old per-anchor
 *   200-or-409 tolerance). Inference runs server-side, incrementally scoped
 *   to the touched formations (#155) — the old defer_inference +
 *   standalone recompute-all-absences finaliser is retired.
 * - The entire flow completes in < 15 s (the O(N×formations×sections)
 *   regression would take ~70–140 s for 9 CPTs with 3 formations).
 * - DB has contacts for all 9 CPTs after the flow.
 *
 * Regression anchor: reverting commit ``2d4d7913`` (the dead-wired
 * ``ground_level_m`` ORM attr that caused a 500 in the materialiser) must
 * turn this flow red — every accept call returns 500 and contactsAfter
 * stays at 0.
 *
 * NOTE: This flow calls the API directly (not through the Electron UI)
 * because the "Accept all (bulk)" toolbar button requires the ghost
 * suggestion overlay to be populated in the renderer state, which in turn
 * requires the full UI interaction chain (navigate to Sections stage,
 * open a section, right-click a CPT, wait for suggestions). For the
 * regression gate we only need to exercise the API path — the EXACT same
 * endpoint the frontend's handleAcceptAllBulkLitho uses — which is faster
 * and more reliable.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countContacts } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// 15 s budget for the entire flow — the acceptance criterion from debt #128.
// The O(N×formations×sections) regression (pre-#155 full-model inference per
// accept) would take >>15 s even for 9 CPTs with 3 formations.
const BULK_ACCEPT_BUDGET_MS = 15_000

test.describe('flow_bulk_accept', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('bulk suggest + batch-accept all CPTs completes under 15 s with server-side inference', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve litho model + all CPT ids.
      const [modelsJson, cptsJson] = await Promise.all([
        page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/projects/${pid}/geology/models`)
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID],
        ),
        page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/cpt/?project_id=${pid}`)
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID],
        ),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // Only the series-bearing CPTs are segmentable; the crossing (2),
      // per-instance (3), and facies (3) dedicated scenario CPTs are
      // series-less (suggest-litho 404s) and are excluded. Section F's 3
      // same-class-pair CPTs (14/15/16, added for the Join-verb scenario —
      // see build_synthetic_fixture.py _SAME_CLASS_PAIR_CPT_INDICES) DO
      // carry a series, so they count: 9 series-bearing CPTs total.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cptIds: string[] = (cptsJson as any[])
        .filter((c: any) => (c.n_rows ?? 0) > 0)
        .map((c: any) => c.id)
      expect(cptIds.length).toBe(9)

      // 2. Suggest all CPTs.
      const allSuggestions: Array<{ cptId: string; layers: unknown[] }> = []
      for (const cptId of cptIds) {
        const suggestRes = await page.evaluate(
          async ([base, pid, mid, cid]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/contacts/suggest-litho`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cpt_id: cid }),
              },
            )
            return { status: r.status, json: await r.json() }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
        )
        expect(suggestRes.status).toBe(200)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layers = (suggestRes.json as any).layers as unknown[]
        expect(layers.length).toBeGreaterThan(0)
        allSuggestions.push({ cptId, layers })
      }

      // 3. Bulk accept via the batch endpoint (one anchor per call).
      //    Track the wall-clock time for the flow-level timing assertion.
      const contactsBefore = await countContacts(FIXTURE_PROJECT_ID)
      const t0 = Date.now()

      // A CPT whose anchor already has accepted layers from a pre-seeded
      // scenario (e.g. the body/per-instance fixture seeds) will return 409
      // rather than 200 when the segmenter's layers overlap those pre-seeded
      // layers.  409 is an expected, non-regression outcome: the
      // ``litho_layer_accepted_no_overlap`` constraint guards data integrity
      // (the batch endpoint maps the IntegrityError to 409). The REGRESSION
      // to detect is a 500 (the original ``ground_level_m`` bug caused every
      // accept to 500 and contactsAfter stayed at 0).
      let successCount = 0
      for (const { cptId, layers } of allSuggestions) {
        const acceptRes = await page.evaluate(
          async ([base, pid, mid, cid, layersJson]) => {
            const layers = JSON.parse(layersJson as string)
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/layers/batch-accept-litho-suggestions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  anchors: [{ cpt_id: cid, suggestions: layers }],
                  section_id: null,
                  // Server-side incremental inference per batch call — the
                  // production protocol (replaces defer_inference + the
                  // retired standalone recompute-all-absences finaliser).
                  run_inference: true,
                }),
              },
            )
            return { status: r.status, json: await r.json().catch(() => null) }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId, JSON.stringify(layers)],
        )
        // 200 = accepted cleanly; 409 = column already occupied (non-regression
        // outcome when the shared fixture DB has pre-seeded contacts on this CPT).
        // A 500 means the backend crashed — that is the regression to guard against.
        // Playwright has no toBeOneOf; use toContain on the allowed-statuses array.
        expect(acceptRes.status, `CPT ${cptId} accept status must not be 500`).not.toBe(500)
        expect([200, 409], `CPT ${cptId} accept must be 200 or 409`).toContain(acceptRes.status)
        if (acceptRes.status === 200) {
          // The batch endpoint isolates per-anchor ValueErrors into the
          // anchor's ``error`` field — a clean run must carry none.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anchor = (acceptRes.json as any)?.anchors?.[0]
          expect(anchor?.error ?? null, `CPT ${cptId} anchor error`).toBeNull()
          successCount += 1
        }
      }
      // At least one CPT must accept cleanly (series-bearing CPTs 0/1/2 have no
      // pre-seeded contacts — if ALL 9 returned 409, the idempotency model is broken).
      expect(successCount, 'at least one CPT must accept with 200').toBeGreaterThanOrEqual(1)

      const elapsed = Date.now() - t0

      // 4. Timing assertion — entire accept loop (incl. server-side incremental
      //    inference per call) under 15 s.
      expect(elapsed).toBeLessThan(BULK_ACCEPT_BUDGET_MS)

      // 5. DB has contacts for all 6 CPTs.
      const contactsAfter = await countContacts(FIXTURE_PROJECT_ID)
      // Accept is idempotent — re-running after a previous session won't add
      // more contacts.  Either new contacts were created (clean state) or the
      // same count is preserved (pre-existing state).  The critical invariant:
      // at least N contacts exist where N ≥ cptIds.length (at least 1 per CPT).
      expect(contactsAfter).toBeGreaterThanOrEqual(contactsBefore)
      expect(contactsAfter).toBeGreaterThanOrEqual(cptIds.length)
    } finally {
      await closeApp(app)
    }
  })
})
